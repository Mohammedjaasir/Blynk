import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { SmsLanguage } from '../../database/types.js';
import type { DBConnection } from '../orders/order.repository.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Customer SMS language (owner, 2026-10-12): which language the customer-facing
 * TRANSACTIONAL texts go out in - order texts (on the way + delivery code,
 * cancelled, item unavailable, delivered), the sign-in code, dental
 * confirmation / reminder / cancellation and rider approval / rejection.
 * Offer SMS have their own per-offer languages (sms-offers) and the birthday
 * SMS is the text staff write, so neither is affected.
 *
 * system_configurations 'customer_sms_language' {"mode", "fallback"}; no row
 * (or a malformed one) = ENGLISH_ONLY, i.e. exactly the texts sent before.
 *
 *   ENGLISH_ONLY     every text in English (the default)
 *   CUSTOMER_CHOICE  the customer's own pick (users.sms_language, set in the
 *                    app under Profile > SMS & offers), else `fallback`
 *   ALWAYS_SINHALA   every text in Sinhala
 *   ALWAYS_TAMIL     every text in Tamil
 *
 * The language is decided when a text is queued and stored on the outbox row
 * (payload.lang), so a retry sends the same text. Admin and Operations set it
 * (GET/PATCH /admin/settings/customer-sms-language); audited
 * (CUSTOMER_SMS_LANGUAGE_UPDATED); applies to texts queued afterwards.
 */
export const CUSTOMER_SMS_LANGUAGE_KEY = 'customer_sms_language';
export const CUSTOMER_SMS_LANGUAGE_MODES = ['ENGLISH_ONLY', 'CUSTOMER_CHOICE', 'ALWAYS_SINHALA', 'ALWAYS_TAMIL'] as const;
export type CustomerSmsLanguageMode = (typeof CUSTOMER_SMS_LANGUAGE_MODES)[number];
export const SMS_LANGUAGE_CODES = ['si', 'ta', 'en'] as const;

export interface CustomerSmsLanguageSetting {
  mode: CustomerSmsLanguageMode;
  /** CUSTOMER_CHOICE only: the language for a customer who never picked one. */
  fallback: SmsLanguage;
}

export const DEFAULT_CUSTOMER_SMS_LANGUAGE: CustomerSmsLanguageSetting = { mode: 'ENGLISH_ONLY', fallback: 'en' };

export const updateCustomerSmsLanguageSchema = z
  .object({
    mode: z
      .enum(CUSTOMER_SMS_LANGUAGE_MODES, {
        errorMap: () => ({ message: 'mode must be ENGLISH_ONLY, CUSTOMER_CHOICE, ALWAYS_SINHALA or ALWAYS_TAMIL' }),
      })
      .optional(),
    fallback: z.enum(SMS_LANGUAGE_CODES, { errorMap: () => ({ message: 'fallback must be si, ta or en' }) }).optional(),
  })
  .strict()
  .refine((v) => v.mode !== undefined || v.fallback !== undefined, 'Nothing to change');
export type UpdateCustomerSmsLanguageInput = z.infer<typeof updateCustomerSmsLanguageSchema>;

const isLanguage = (v: unknown): v is SmsLanguage => typeof v === 'string' && (SMS_LANGUAGE_CODES as readonly string[]).includes(v);

export function customerSmsLanguageFrom(value: unknown): CustomerSmsLanguageSetting {
  const out = { ...DEFAULT_CUSTOMER_SMS_LANGUAGE };
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.mode === 'string' && (CUSTOMER_SMS_LANGUAGE_MODES as readonly string[]).includes(v.mode)) {
      out.mode = v.mode as CustomerSmsLanguageMode;
    }
    if (isLanguage(v.fallback)) out.fallback = v.fallback;
  }
  return out;
}

/**
 * The language one text goes out in, given the setting and the customer's own
 * pick (null = never picked, or no account). Pure - the rule in one place.
 */
export function resolveSmsLanguage(setting: CustomerSmsLanguageSetting, customerPick: SmsLanguage | null | undefined): SmsLanguage {
  switch (setting.mode) {
    case 'ALWAYS_SINHALA':
      return 'si';
    case 'ALWAYS_TAMIL':
      return 'ta';
    case 'CUSTOMER_CHOICE':
      return isLanguage(customerPick) ? customerPick : setting.fallback;
    default:
      return 'en';
  }
}

export async function readCustomerSmsLanguage(executor: DBConnection = db): Promise<CustomerSmsLanguageSetting & { updated_at: Date | null }> {
  const row = await executor
    .selectFrom('system_configurations')
    .select(['value', 'updated_at'])
    .where('key', '=', CUSTOMER_SMS_LANGUAGE_KEY)
    .executeTakeFirst();
  return { ...customerSmsLanguageFrom(row?.value), updated_at: row?.updated_at ?? null };
}

/** Swappable in tests, like checkoutSettings.read. */
export const customerSmsLanguageSettings = {
  read: (executor: DBConnection = db): Promise<CustomerSmsLanguageSetting> => readCustomerSmsLanguage(executor),
};

/**
 * The language for a text to this customer account (null = no account known).
 * Only CUSTOMER_CHOICE looks the customer up.
 */
export async function smsLanguageForUser(executor: DBConnection, userId: string | null | undefined): Promise<SmsLanguage> {
  const setting = await customerSmsLanguageSettings.read(executor);
  if (setting.mode !== 'CUSTOMER_CHOICE' || !userId) return resolveSmsLanguage(setting, null);
  const row = await executor.selectFrom('users').select('sms_language').where('id', '=', userId).executeTakeFirst();
  return resolveSmsLanguage(setting, row?.sms_language ?? null);
}

/**
 * The language for the sign-in code to a phone number (the account may not
 * exist yet). Only CUSTOMER_CHOICE looks the number up.
 */
export async function smsLanguageForPhone(phone: string): Promise<SmsLanguage> {
  const setting = await customerSmsLanguageSettings.read();
  if (setting.mode !== 'CUSTOMER_CHOICE') return resolveSmsLanguage(setting, null);
  const row = await db.selectFrom('users').select('sms_language').where('phone', '=', phone).executeTakeFirst();
  return resolveSmsLanguage(setting, row?.sms_language ?? null);
}

/** `payload.lang` for a queued text: left out for English, so English rows look exactly as before. */
export const langPayload = (lang: SmsLanguage): { lang?: SmsLanguage } => (lang === 'en' ? {} : { lang });

export const customerSmsLanguageService = {
  get: () => readCustomerSmsLanguage(),

  /** Audited (CUSTOMER_SMS_LANGUAGE_UPDATED); only the fields sent change. */
  async set(input: UpdateCustomerSmsLanguageInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', CUSTOMER_SMS_LANGUAGE_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = customerSmsLanguageFrom(before?.value);
      const next: CustomerSmsLanguageSetting = {
        mode: input.mode ?? previous.mode,
        fallback: input.fallback ?? previous.fallback,
      };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: CUSTOMER_SMS_LANGUAGE_KEY, value, description: 'Language of customer order / sign-in / dental / rider SMS' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'CUSTOMER_SMS_LANGUAGE_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: CUSTOMER_SMS_LANGUAGE_KEY, ...(before ? previous : {}) },
        newValues: { key: CUSTOMER_SMS_LANGUAGE_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Customer SMS language changed');
    });
    return await readCustomerSmsLanguage();
  },
};

/**
 * A customer SMS payload with its language (payload.lang, left out for
 * English), for texts queued through notificationService.enqueue: dental
 * confirmation / cancellation / reminder and rider approval / rejection.
 */
export async function withSmsLanguage(
  executor: DBConnection,
  userId: string | null | undefined,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return { ...payload, ...langPayload(await smsLanguageForUser(executor, userId)) };
}
