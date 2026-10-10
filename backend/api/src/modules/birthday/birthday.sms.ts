import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { withinSmsWindow } from '../../utils/store-hours.js';
import { storeSchedule } from '../configuration/store-schedule.js';
import { OUTBOX_PAUSE_LOCK_KEY } from '../notifications/outbox-pause.js';
import { birthdayOfferSettings, birthdaySmsText, type BirthdayOfferSetting } from '../configuration/settings.service.js';
import { birthdayOfferStatus } from './birthday.offer.js';
import { colomboDay, monthDayCodes } from './birthday.rules.js';

/**
 * The birthday SMS (owner, 2026-10-09): "Happy birthday from Blynk! X% off
 * your order this week." on the customer's birthday, once a year.
 *
 * Runs from the appointment reminder job's tick (dental/appointment-
 * reminders.ts, every few minutes in the worker). The first tick from opening time
 * Colombo on the day queues it, never outside the opening hours (Ops/Admin set them, owner 2026-10-10). Only when the
 * birthday offer AND its SMS are switched on, and only to active customers
 * who have not turned "Offers by SMS" off and have not already used this
 * birthday's gift (the SMS would promise a discount they cannot get).
 *
 * Exactly once a year: each SMS is a notifications outbox row (the worker
 * sends it with the usual retries) whose idempotency key is
 * `bday:<year>:<user id>` (46 characters; SBS keys must stay <= 80) -
 * customers who already have that row are skipped and a duplicate insert is
 * ignored, so several workers or ticks never send twice. A 29 February
 * birthday gets its SMS on 28 February in other years.
 */

export const BIRTHDAY_SMS_TYPE = 'BIRTHDAY_OFFER';
const DEFAULT_BATCH = 500;

export const birthdaySmsKey = (year: number, userId: string) => `bday:${year}:${userId}`;

function smsRecipient(phone: string): string | null {
  try {
    return normalizeSriLankanPhone(phone);
  } catch {
    return null; // a deleted account's placeholder or not a Sri Lankan mobile
  }
}

export interface BirthdaySmsOptions {
  now?: Date;
  batchSize?: number;
  /** Polling runs yield to the outbox pause lock (outbox-pause.ts). */
  yieldToPause?: boolean;
  /** Restrict to these customers (tests, manual runs). */
  userIds?: string[];
  /** The setting; read from system_configurations when omitted. */
  setting?: BirthdayOfferSetting;
}

/** One pass: queues today's birthday SMS. Returns the customers queued. */
export async function runBirthdaySms(opts: BirthdaySmsOptions = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  // Sending window = the opening hours set by Ops and Admin (owner, 2026-10-10).
  if (!withinSmsWindow((await storeSchedule.read()).hours, now)) return [];
  const setting = opts.setting ?? (await birthdayOfferSettings.read());
  if (!setting.enabled || !setting.sms_enabled) return [];

  const today = colomboDay(now);
  const codes = monthDayCodes([today]);
  const text = birthdaySmsText(setting);

  const queued = await db.transaction().execute(async (trx) => {
    if (opts.yieldToPause) {
      const { rows } = await sql<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock_shared(${OUTBOX_PAUSE_LOCK_KEY}) AS ok`.execute(trx);
      if (!rows[0]?.ok) return [];
    }
    let q = trx
      .selectFrom('users as u')
      .select(['u.id', 'u.phone'])
      .where('u.role', '=', 'CUSTOMER')
      .where('u.is_active', '=', true)
      .where('u.sms_offers_opted_out_at', 'is', null)
      .where('u.date_of_birth', 'is not', null)
      .where(sql<boolean>`(EXTRACT(MONTH FROM u.date_of_birth) * 100 + EXTRACT(DAY FROM u.date_of_birth)) = ANY(${codes}::numeric[])`)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('notifications as n')
              .select('n.id')
              .where(sql<boolean>`n.idempotency_key = 'bday:' || ${today.year}::text || ':' || u.id::text`)
          )
        )
      );
    if (opts.userIds) q = q.where('u.id', 'in', opts.userIds.length ? opts.userIds : ['00000000-0000-0000-0000-000000000000']);
    const customers = await q.orderBy('u.id').limit(opts.batchSize ?? DEFAULT_BATCH).execute();

    const out: string[] = [];
    for (const c of customers) {
      const phone = smsRecipient(c.phone);
      if (!phone) continue;
      const status = await birthdayOfferStatus(trx, c.id, setting, now);
      if (status.used) continue;
      const at = new Date();
      const inserted = await trx
        .insertInto('notifications')
        .values({
          user_id: c.id,
          order_id: null,
          idempotency_key: birthdaySmsKey(today.year, c.id),
          channel: 'SMS',
          notification_type: BIRTHDAY_SMS_TYPE,
          recipient: phone,
          payload: JSON.stringify({ text, percent: setting.percent }),
          status: 'QUEUED',
          attempts: 0,
          max_attempts: 3,
          next_attempt_at: at,
          created_at: at,
          updated_at: at,
        } as never)
        .onConflict((oc) => oc.column('idempotency_key').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted) out.push(c.id);
    }
    return out;
  });
  if (queued.length) logger.info({ queued: queued.length }, 'Birthday SMS queued');
  return queued;
}
