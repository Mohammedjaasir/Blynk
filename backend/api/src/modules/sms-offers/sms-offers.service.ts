import crypto from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import { env } from '../../config/env.js';
import type { Database, SmsLanguage, SmsOfferAudience } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { isWithinOrderingHours, orderingClock } from '../../utils/time.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * SMS offers to registered customers (migration 027, owner 2026-10-06).
 *
 * Admin and Operations write an offer in Sinhala, Tamil and/or English; each
 * customer gets the version in the language they picked in the app, or the
 * offer's fallback language if they never picked one. Customers who turned
 * "Offers by SMS" off get nothing. Every SMS ends with a line saying how to
 * turn offers off. Offers go out only 8 AM - 9 PM (the ordering hours), and
 * each recipient's SMS is a row in the notifications outbox, so the worker
 * sends it with the usual retries.
 */

export const SMS_LANGUAGES: readonly SmsLanguage[] = ['si', 'ta', 'en'];
export const SMS_OFFER_AUDIENCES: readonly SmsOfferAudience[] = ['ALL', 'ORDERED_30D', 'ORDERED_90D', 'NEVER_ORDERED'];
export const MAX_OFFER_TEXT = 480;

/**
 * Appended to every offer SMS in its own language. The Sinhala and Tamil
 * lines should be checked by a native speaker before launch.
 */
export const OPT_OUT_LINE: Record<SmsLanguage, string> = {
  en: 'Stop offers: Blynk app > Profile > SMS & offers',
  si: 'දීමනා නවත්වන්න: Blynk app > Profile > SMS & offers',
  ta: 'சலுகைகளை நிறுத்த: Blynk app > Profile > SMS & offers',
};

export const withOptOut = (text: string, language: SmsLanguage) => `${text.trim()}\n${OPT_OUT_LINE[language]}`;

/**
 * The languages offers are written and sent in (SMS_OFFER_LANGUAGES; English
 * only at launch). Unknown entries are ignored; nothing valid means English.
 */
export function enabledOfferLanguages(configured: string = env.SMS_OFFER_LANGUAGES ?? 'en'): SmsLanguage[] {
  const wanted = configured.split(',').map((s) => s.trim());
  const picked = SMS_LANGUAGES.filter((l) => wanted.includes(l));
  return picked.length ? picked : ['en'];
}

/**
 * The language one customer is sent: their own if it is switched on, else
 * the offer's fallback if that is switched on, else the first one that is.
 */
export function languageFor(
  customer: SmsLanguage | null,
  fallback: SmsLanguage,
  enabled: SmsLanguage[] = enabledOfferLanguages()
): SmsLanguage {
  if (customer && enabled.includes(customer)) return customer;
  return enabled.includes(fallback) ? fallback : enabled[0];
}

// GSM 03.38: the basic set, and the extension set whose characters take two.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

/**
 * How many SMS parts a text costs. Plain Latin text: 160 characters in one
 * SMS, 153 per part when split. Sinhala, Tamil or any other non-GSM
 * character makes it Unicode: 70 in one SMS, 67 per part.
 */
export function smsParts(text: string): number {
  let gsmLength = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
  const units = text.length; // UTF-16 code units, which is what UCS-2 SMS counts
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

type Executor = Kysely<Database> | Transaction<Database>;

/**
 * Customers an audience reaches: active, registered, not opted out. With
 * `optedOut` it is the same audience's customers who turned offers off.
 */
function audienceQuery(executor: Executor, audience: SmsOfferAudience, optedOut = false) {
  let q = executor
    .selectFrom('users as u')
    .where('u.role', '=', 'CUSTOMER')
    .where('u.is_active', '=', true)
    .where('u.sms_offers_opted_out_at', optedOut ? 'is not' : 'is', null);
  const ordered = (days: number) =>
    sql<boolean>`exists (select 1 from orders o where o.customer_id = u.id and o.created_at >= now() - make_interval(days => ${days}))`;
  if (audience === 'ORDERED_30D') q = q.where(ordered(30));
  if (audience === 'ORDERED_90D') q = q.where(ordered(90));
  if (audience === 'NEVER_ORDERED') q = q.where(sql<boolean>`not exists (select 1 from orders o where o.customer_id = u.id)`);
  return q;
}

export interface AudienceSummary {
  audience: SmsOfferAudience;
  recipients: number;
  /** Recipients per language they will be sent, after the fallback. */
  by_language: Record<SmsLanguage, number>;
  /** How many of them get the fallback (never picked a language, or picked one that is off). */
  without_language: number;
  /** Customers this audience would reach but who turned offers off. */
  opted_out: number;
}

/** The number an offer SMS would go to, or null when no SMS can reach it. */
function smsRecipient(phone: string): string | null {
  try {
    return normalizeSriLankanPhone(phone);
  } catch {
    return null; // not a Sri Lankan mobile (or a deleted account's placeholder)
  }
}

export async function summarizeAudience(audience: SmsOfferAudience, fallback: SmsLanguage): Promise<AudienceSummary> {
  // Counted with exactly the filter sendOffer applies (a valid Sri Lankan
  // mobile), so the estimate is what a send queues.
  const rows = await audienceQuery(db, audience).select(['u.phone', 'u.sms_language']).execute();
  const by_language: Record<SmsLanguage, number> = { si: 0, ta: 0, en: 0 };
  let without_language = 0;
  const enabled = enabledOfferLanguages();
  for (const row of rows) {
    if (!smsRecipient(row.phone)) continue;
    const lang = languageFor(row.sms_language, fallback, enabled);
    by_language[lang] += 1;
    if (lang !== row.sms_language) without_language += 1;
  }
  // Opted out within this audience only (not every customer who opted out).
  const optedOutRows = await audienceQuery(db, audience, true).select(['u.phone']).execute();
  const opted_out = optedOutRows.filter((r) => smsRecipient(r.phone)).length;
  return {
    audience,
    recipients: by_language.si + by_language.ta + by_language.en,
    by_language,
    without_language,
    opted_out,
  };
}

/**
 * The text one customer is sent. The estimate refuses a send while a
 * language with recipients has no text, but a customer can change language
 * between that check and the send: then the fallback's text, else any
 * written text, is used; null (skip) only if nothing is written at all.
 */
function offerTextFor(lang: SmsLanguage, fallback: SmsLanguage, messages: OfferMessages): { lang: SmsLanguage; text: string } | null {
  for (const l of [lang, fallback, ...SMS_LANGUAGES]) {
    const t = messages[l]?.trim();
    if (t) return { lang: l, text: withOptOut(t, l) };
  }
  return null;
}

export type OfferMessages = Partial<Record<SmsLanguage, string>>;

export interface OfferEstimate extends AudienceSummary {
  /** The languages offers are written in right now (English only at launch). */
  languages: SmsLanguage[];
  /** SMS parts one recipient costs, per language (with the opt-out line). */
  parts_per_sms: Partial<Record<SmsLanguage, number>>;
  sms_parts_total: number;
  /** Languages that have recipients but no text yet. */
  missing_languages: SmsLanguage[];
}

export async function estimateOffer(
  audience: SmsOfferAudience,
  fallback: SmsLanguage,
  messages: OfferMessages
): Promise<OfferEstimate> {
  const summary = await summarizeAudience(audience, fallback);
  const parts_per_sms: Partial<Record<SmsLanguage, number>> = {};
  const missing_languages: SmsLanguage[] = [];
  let sms_parts_total = 0;
  for (const lang of SMS_LANGUAGES) {
    const text = messages[lang]?.trim();
    if (text) parts_per_sms[lang] = smsParts(withOptOut(text, lang));
    const count = summary.by_language[lang];
    if (count === 0) continue;
    if (!text) missing_languages.push(lang);
    else sms_parts_total += count * parts_per_sms[lang]!;
  }
  return { ...summary, languages: enabledOfferLanguages(), parts_per_sms, sms_parts_total, missing_languages };
}

const LANGUAGE_NAME: Record<SmsLanguage, string> = { si: 'Sinhala', ta: 'Tamil', en: 'English' };

/** Sends an offer to its audience: one outbox SMS per customer. */
export async function sendOffer(
  actor: AuditActor,
  input: { audience: SmsOfferAudience; fallback_language: SmsLanguage; messages: OfferMessages }
) {
  if (!isWithinOrderingHours(orderingClock.now())) {
    throw new AppError('Offers can be sent from 8 AM to 9 PM only.', 422, 'OUTSIDE_SENDING_HOURS');
  }
  const estimate = await estimateOffer(input.audience, input.fallback_language, input.messages);
  if (estimate.missing_languages.length) {
    const names = estimate.missing_languages.map((l) => LANGUAGE_NAME[l]).join(' and ');
    throw new AppError(`Write the ${names} text: some customers in this audience get that language.`, 400, 'OFFER_TEXT_MISSING', {
      missing_languages: estimate.missing_languages,
    });
  }
  if (estimate.recipients === 0) {
    throw new AppError('No customer in this audience can receive offers.', 400, 'OFFER_NO_RECIPIENTS');
  }

  return db.transaction().execute(async (trx) => {
    const offer = await trx
      .insertInto('sms_offers')
      .values({
        created_by: actor.actorId,
        audience: input.audience,
        fallback_language: input.fallback_language,
        message_si: input.messages.si?.trim() || null,
        message_ta: input.messages.ta?.trim() || null,
        message_en: input.messages.en?.trim() || null,
      })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();

    const customers = await audienceQuery(trx, input.audience).select(['u.id', 'u.phone', 'u.sms_language']).execute();
    let recipients = 0;
    let parts = 0;
    const now = new Date();
    const rows = [];
    for (const c of customers) {
      const phone = smsRecipient(c.phone);
      if (!phone) continue; // not a Sri Lankan mobile: an SMS could not reach it
      const picked = offerTextFor(languageFor(c.sms_language, input.fallback_language), input.fallback_language, input.messages);
      if (!picked) continue;
      const { lang, text } = picked;
      recipients += 1;
      parts += smsParts(text);
      rows.push({
        user_id: c.id,
        order_id: null,
        idempotency_key: `sms-offer:${offer.id}:${c.id}`,
        channel: 'SMS' as const,
        notification_type: 'SMS_OFFER',
        recipient: phone,
        payload: JSON.stringify({ text, offer_id: offer.id, language: lang }),
        status: 'QUEUED' as const,
        attempts: 0,
        max_attempts: 3,
        next_attempt_at: now,
        created_at: now,
        updated_at: now,
      });
    }
    for (let i = 0; i < rows.length; i += 500) {
      await trx
        .insertInto('notifications')
        .values(rows.slice(i, i + 500) as never)
        .onConflict((oc) => oc.column('idempotency_key').doNothing())
        .execute();
    }
    await trx
      .updateTable('sms_offers')
      .set({ recipient_count: recipients, sms_parts_total: parts })
      .where('id', '=', offer.id)
      .execute();
    await writeAudit(trx, actor, {
      action: 'SMS_OFFER_SENT',
      entityType: 'sms_offer',
      entityId: offer.id,
      newValues: { audience: input.audience, fallback_language: input.fallback_language, recipients, sms_parts_total: parts },
    });
    return { id: offer.id, created_at: offer.created_at, recipients, sms_parts_total: parts };
  });
}

/** Test SMS one staff member may send per rolling hour. */
export const MAX_TESTS_PER_HOUR = 5;

/** Sends one language's text to the staff member's own phone, to check it. */
export async function sendTestOffer(actor: AuditActor, language: SmsLanguage, message: string) {
  // Same sending window as real offers: a test at 11 PM still wakes someone.
  if (!isWithinOrderingHours(orderingClock.now())) {
    throw new AppError('Offers can be sent from 8 AM to 9 PM only.', 422, 'OUTSIDE_SENDING_HOURS');
  }
  const recent = await db
    .selectFrom('notifications')
    .select(sql<string>`count(*)`.as('n'))
    .where('user_id', '=', actor.actorId)
    .where('notification_type', '=', 'SMS_OFFER')
    .where('idempotency_key', 'like', 'sms-offer-test:%')
    .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirst();
  if (Number(recent?.n ?? 0) >= MAX_TESTS_PER_HOUR) {
    throw new AppError(
      `You can send ${MAX_TESTS_PER_HOUR} test SMS an hour. Try again later.`,
      429,
      'TOO_MANY_TESTS',
      { max_per_hour: MAX_TESTS_PER_HOUR }
    );
  }
  const staff = await db.selectFrom('users').select(['phone']).where('id', '=', actor.actorId).executeTakeFirst();
  let phone: string;
  try {
    phone = normalizeSriLankanPhone(staff?.phone ?? '');
  } catch {
    throw new AppError('Your account has no Sri Lankan mobile number to send the test to.', 400, 'NO_TEST_PHONE');
  }
  const text = withOptOut(message, language);
  const now = new Date();
  await db
    .insertInto('notifications')
    .values({
      user_id: actor.actorId,
      order_id: null,
      idempotency_key: `sms-offer-test:${crypto.randomUUID()}`,
      channel: 'SMS',
      notification_type: 'SMS_OFFER',
      recipient: phone,
      payload: JSON.stringify({ text, test: true, language }),
      status: 'QUEUED',
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: now,
      created_at: now,
      updated_at: now,
    } as never)
    .execute();
  return { sent_to: `${phone.slice(0, 6)}****${phone.slice(-2)}`, sms_parts: smsParts(text) };
}

/** The latest offers, newest first, with who sent them. */
export async function listOffers(limit = 50) {
  return db
    .selectFrom('sms_offers as o')
    .leftJoin('users as s', 's.id', 'o.created_by')
    .select([
      'o.id',
      'o.audience',
      'o.fallback_language',
      'o.message_si',
      'o.message_ta',
      'o.message_en',
      'o.recipient_count',
      'o.sms_parts_total',
      'o.created_at',
      's.full_name as sent_by_name',
      's.role as sent_by_role',
    ])
    .orderBy('o.created_at', 'desc')
    .limit(limit)
    .execute();
}
