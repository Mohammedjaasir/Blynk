import { z } from 'zod';
import { db } from '../../database/connection.js';
import { orderingClock } from '../../utils/time.js';
import { DateTime } from 'luxon';
import { STORE_TIMEZONE, displayHours, storeStatusAt } from '../../utils/store-hours.js';
import { storeSchedule } from './store-schedule.js';
import { doctorsAccess } from './doctors-access.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { smsParts } from '../sms-offers/sms-offers.service.js';
import { RIDER_BATCHING_KEY, getBatchingRules, type BatchingRules } from '../riders/batching.js';

/**
 * Store-wide settings and the public store facts (GET /store).
 *
 * The delivery fee lives in system_configurations.delivery_fee
 * ({"fee_lkr": 100}, migration 015). Placing an order snapshots it into
 * orders.delivery_fee (order.repository getDeliveryFee), so changing it only
 * affects orders placed afterwards.
 */

export const DELIVERY_FEE_KEY = 'delivery_fee';
/** order.repository.ts getDeliveryFee falls back to the same value. */
export const DEFAULT_DELIVERY_FEE_LKR = 100;

export const updateDeliveryFeeSchema = z.object({
  fee_lkr: z
    .number({ required_error: 'fee_lkr is required', invalid_type_error: 'fee_lkr must be a number' })
    .finite()
    .min(0, 'The delivery fee cannot be negative')
    .max(1000, 'The delivery fee can be at most LKR 1000')
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'The delivery fee can have at most 2 decimals'),
});
export type UpdateDeliveryFeeInput = z.infer<typeof updateDeliveryFeeSchema>;

/**
 * Checkout switches (owner, 2026-10-08), each editable by Admin and
 * Operations. No migration: a missing row means the default below.
 *  - coupons_enabled {"enabled": bool}: "Coupon code is not needed", so off
 *    until someone turns it on.
 *  - new_customer_free_deliveries {"enabled": bool, "count": int, "since":
 *    ISO}: each customer's first `count` orders placed at/after `since` go
 *    out with no delivery fee. Owner, 2026-10-09: this is for every customer,
 *    existing ones too, so orders before `since` do not use one up; a row
 *    without `since` counts from DEFAULT_FREE_DELIVERIES_SINCE. The key keeps
 *    its old name so stored rows and older apps keep working.
 */
export const COUPONS_ENABLED_KEY = 'coupons_enabled';
/**
 * show_offer_savings {"enabled": bool} (owner, 2026-10-10): whether the
 * customer app shows "Save LKR X" on offer products and combo packs. The
 * owner removed the line, so off until someone turns it back on.
 */
export const SHOW_OFFER_SAVINGS_KEY = 'show_offer_savings';
export const DEFAULT_SHOW_OFFER_SAVINGS = false;
export const FREE_DELIVERIES_KEY = 'new_customer_free_deliveries';
export const DEFAULT_COUPONS_ENABLED = false;
/** Owner, 2026-10-09: midnight in Asia/Colombo on the day it went to everyone. */
export const DEFAULT_FREE_DELIVERIES_SINCE = new Date('2026-10-09T00:00:00+05:30').toISOString();
export const DEFAULT_FREE_DELIVERIES = { enabled: true, count: 2, since: DEFAULT_FREE_DELIVERIES_SINCE } as const;
export const MAX_FREE_DELIVERIES = 10;
/** A "since" may run this far ahead of the server clock (client clock skew). */
const SINCE_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface FreeDeliveriesSetting {
  enabled: boolean;
  count: number;
  since: string;
}

export interface CheckoutSettings {
  coupons_enabled: boolean;
  new_customer_free_deliveries: FreeDeliveriesSetting;
  show_offer_savings: boolean;
}

export const updateCheckoutSettingsSchema = z
  .object({
    coupons_enabled: z.boolean({ invalid_type_error: 'coupons_enabled must be true or false' }).optional(),
    new_customer_free_deliveries: z
      .object({
        enabled: z.boolean({ required_error: 'enabled is required', invalid_type_error: 'enabled must be true or false' }),
        count: z
          .number({ required_error: 'count is required', invalid_type_error: 'count must be a number' })
          .int('count must be a whole number')
          .min(0, 'count cannot be negative')
          .max(MAX_FREE_DELIVERIES, `count can be at most ${MAX_FREE_DELIVERIES}`),
        // Omitted keeps the stored start; "Start again from today" sends now.
        since: z
          .string({ invalid_type_error: 'since must be a date and time' })
          .datetime({ offset: true, message: 'since must be a date and time, e.g. 2026-10-09T00:00:00+05:30' })
          .refine((v) => Date.parse(v) <= Date.now() + SINCE_FUTURE_SKEW_MS, 'since cannot be in the future')
          .optional(),
      })
      .strict()
      .optional(),
    show_offer_savings: z.boolean({ invalid_type_error: 'show_offer_savings must be true or false' }).optional(),
  })
  .strict()
  .refine(
    (v) => v.coupons_enabled !== undefined || v.new_customer_free_deliveries !== undefined || v.show_offer_savings !== undefined,
    'Nothing to change',
  );
export type UpdateCheckoutSettingsInput = z.infer<typeof updateCheckoutSettingsSchema>;

/** {"enabled": bool} rows (coupons_enabled, show_offer_savings). */
function couponsEnabledFrom(value: unknown): boolean | null {
  if (value && typeof value === 'object') {
    const enabled = (value as { enabled?: unknown }).enabled;
    if (typeof enabled === 'boolean') return enabled;
  }
  return null;
}

function freeDeliveriesFrom(value: unknown): FreeDeliveriesSetting | null {
  if (value && typeof value === 'object') {
    const { enabled, count, since } = value as { enabled?: unknown; count?: unknown; since?: unknown };
    if (typeof enabled === 'boolean' && typeof count === 'number' && Number.isInteger(count) && count >= 0) {
      const sinceMs = typeof since === 'string' ? Date.parse(since) : NaN;
      return {
        enabled,
        count: Math.min(count, MAX_FREE_DELIVERIES),
        since: Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : DEFAULT_FREE_DELIVERIES_SINCE,
      };
    }
  }
  return null;
}

/**
 * The checkout switches as order placement applies them. Tests replace
 * `read` (tests/setup/checkout-settings.ts) so suites written before the
 * switches keep their coupons and full delivery fee; a test about the
 * switches restores settingsService.getCheckoutSettings.
 */
export const checkoutSettings = {
  read: (): Promise<CheckoutSettings> => settingsService.getCheckoutSettings(),
};

/**
 * Rider commission (owner, 2026-10-09): the share of the standard delivery
 * fee a COMMISSION rider earns when they have no percentage of their own
 * (riders.commission_percent, migration 032). system_configurations
 * 'rider_commission' {"default_percent": 80}; a missing or malformed row
 * means 80. Changing it affects deliveries settled afterwards only - each
 * delivery snapshots the share it was paid at.
 */
export const RIDER_COMMISSION_KEY = 'rider_commission';
export const DEFAULT_RIDER_COMMISSION_PERCENT = 80;

export const commissionPercentSchema = z
  .number({ required_error: 'The percentage is required', invalid_type_error: 'The percentage must be a number' })
  .finite()
  .min(0, 'The percentage cannot be below 0')
  .max(100, 'The percentage can be at most 100')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'The percentage can have at most 2 decimals');

export const updateRiderCommissionSchema = z
  .object({ default_percent: commissionPercentSchema })
  .strict();
export type UpdateRiderCommissionInput = z.infer<typeof updateRiderCommissionSchema>;

function commissionFrom(value: unknown): number | null {
  if (value && typeof value === 'object') {
    const p = (value as { default_percent?: unknown }).default_percent;
    if (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100) return p;
  }
  return null;
}

/**
 * Rider trips (owner, 2026-10-10): "ops can control the 2 orders for one
 * delivery if it's in the same route". The rules ASSIGN_RIDER already applies
 * (riders/batching.ts, system_configurations 'rider_batching'): how many open
 * deliveries one rider may hold (1 = no trips) and how far apart (straight
 * line, km) two drop-offs may be before staff must confirm. Admin and
 * Operations edit them here; audited (RIDER_TRIPS_UPDATED); they apply to
 * assignments made afterwards - nothing already assigned is undone.
 */
export const MIN_TRIP_ORDERS = 1;
export const MAX_TRIP_ORDERS = 5;
export const MIN_DROPOFF_KM = 0.5;
export const MAX_DROPOFF_KM = 10;

export const updateRiderTripsSchema = z
  .object({
    max_active_deliveries: z
      .number({ invalid_type_error: 'The number of orders must be a number' })
      .int('The number of orders must be a whole number')
      .min(MIN_TRIP_ORDERS, `A rider carries at least ${MIN_TRIP_ORDERS} order`)
      .max(MAX_TRIP_ORDERS, `A rider can carry at most ${MAX_TRIP_ORDERS} orders at once`)
      .optional(),
    max_dropoff_distance_km: z
      .number({ invalid_type_error: 'The distance must be a number' })
      .finite()
      .min(MIN_DROPOFF_KM, `The distance must be at least ${MIN_DROPOFF_KM} km`)
      .max(MAX_DROPOFF_KM, `The distance can be at most ${MAX_DROPOFF_KM} km`)
      .refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6, 'The distance can have at most 1 decimal')
      .optional(),
  })
  .strict()
  .refine((v) => v.max_active_deliveries !== undefined || v.max_dropoff_distance_km !== undefined, 'Nothing to change');
export type UpdateRiderTripsInput = z.infer<typeof updateRiderTripsSchema>;

/**
 * Birthday offer (owner, 2026-10-09): X% off ONE order a customer places in
 * their birthday week (birthday +-3 days, Asia/Colombo), and a "happy
 * birthday" SMS on the day. Admin and Operations switch it on/off and set the
 * % and the SMS text. system_configurations 'birthday_offer'
 * {"enabled", "percent", "sms_enabled", "sms_text"}; no row (or a malformed
 * one) means the defaults below - off until someone turns it on.
 * `{percent}` in the SMS text becomes the % (e.g. "10").
 */
export const BIRTHDAY_OFFER_KEY = 'birthday_offer';
export const BIRTHDAY_WINDOW_DAYS = 3;
export const MAX_BIRTHDAY_PERCENT = 50;
export const MAX_BIRTHDAY_SMS_TEXT = 300;
export const DEFAULT_BIRTHDAY_SMS_TEXT = 'Happy birthday from Blynk! {percent}% off your order this week.';
export const DEFAULT_BIRTHDAY_OFFER = {
  enabled: false,
  percent: 10,
  sms_enabled: true,
  sms_text: DEFAULT_BIRTHDAY_SMS_TEXT,
} as const;

export interface BirthdayOfferSetting {
  enabled: boolean;
  percent: number;
  sms_enabled: boolean;
  sms_text: string;
}

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

export const updateBirthdayOfferSchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    percent: z
      .number({ invalid_type_error: 'The percentage must be a number' })
      .finite()
      .gt(0, 'The percentage must be more than 0')
      .max(MAX_BIRTHDAY_PERCENT, `The percentage can be at most ${MAX_BIRTHDAY_PERCENT}`)
      .refine(twoDecimals, 'The percentage can have at most 2 decimals')
      .optional(),
    sms_enabled: z.boolean({ invalid_type_error: 'sms_enabled must be true or false' }).optional(),
    sms_text: z
      .string({ invalid_type_error: 'The SMS text must be text' })
      .trim()
      .min(1, 'Write the birthday SMS text')
      .max(MAX_BIRTHDAY_SMS_TEXT, `The SMS text can be at most ${MAX_BIRTHDAY_SMS_TEXT} characters`)
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type UpdateBirthdayOfferInput = z.infer<typeof updateBirthdayOfferSchema>;

/** "10" for 10, "12.5" for 12.5. */
export const formatPercent = (p: number) => String(Number(p.toFixed(2)));

/** The SMS a customer gets: the text with {percent} filled in. */
export function birthdaySmsText(setting: Pick<BirthdayOfferSetting, 'percent' | 'sms_text'>): string {
  return setting.sms_text.replace(/\{percent\}/gi, formatPercent(setting.percent)).trim();
}

function birthdayOfferFrom(value: unknown): BirthdayOfferSetting {
  const out: BirthdayOfferSetting = { ...DEFAULT_BIRTHDAY_OFFER };
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
    if (typeof v.percent === 'number' && Number.isFinite(v.percent) && v.percent > 0 && v.percent <= MAX_BIRTHDAY_PERCENT) {
      out.percent = v.percent;
    }
    if (typeof v.sms_enabled === 'boolean') out.sms_enabled = v.sms_enabled;
    if (typeof v.sms_text === 'string' && v.sms_text.trim()) out.sms_text = v.sms_text.trim();
  }
  return out;
}

/**
 * The birthday offer as checkout and the SMS pass apply it. Tests may
 * replace `read`, like checkoutSettings.
 */
export const birthdayOfferSettings = {
  read: (): Promise<BirthdayOfferSetting> => settingsService.getBirthdayOfferSetting(),
};

/** The stored fee, or null when the row is missing or malformed. */
function feeFrom(value: unknown): number | null {
  if (value && typeof value === 'object') {
    const fee = (value as { fee_lkr?: unknown }).fee_lkr;
    if (typeof fee === 'number' && Number.isFinite(fee)) return fee;
  }
  return null;
}

export class SettingsService {
  async getDeliveryFee(): Promise<{ fee_lkr: number; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', DELIVERY_FEE_KEY)
      .executeTakeFirst();
    const fee = row ? feeFrom(row.value) : null;
    // Same fallback as order placement, so what is shown is what is charged.
    return { fee_lkr: fee ?? DEFAULT_DELIVERY_FEE_LKR, updated_at: fee === null ? null : row!.updated_at };
  }

  async setDeliveryFee(input: UpdateDeliveryFeeInput, actor: AuditActor) {
    const fee = Math.round(input.fee_lkr * 100) / 100;
    const value = JSON.stringify({ fee_lkr: fee });
    return await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', DELIVERY_FEE_KEY)
        .forUpdate()
        .executeTakeFirst();
      const row = await trx
        .insertInto('system_configurations')
        .values({ key: DELIVERY_FEE_KEY, value, description: 'Standard flat delivery fee in LKR' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .returning(['updated_at'])
        .executeTakeFirstOrThrow();

      const previous = before ? feeFrom(before.value) : null;
      await writeAudit(trx, actor, {
        action: 'DELIVERY_FEE_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: DELIVERY_FEE_KEY, fee_lkr: previous },
        newValues: { key: DELIVERY_FEE_KEY, fee_lkr: fee },
      });
      logger.info({ previous, fee, actorId: actor.actorId }, 'Delivery fee changed');
      return { fee_lkr: fee, updated_at: row.updated_at };
    });
  }

  async getCheckoutSettings(): Promise<CheckoutSettings & { updated_at: Date | null }> {
    const rows = await db
      .selectFrom('system_configurations')
      .select(['key', 'value', 'updated_at'])
      .where('key', 'in', [COUPONS_ENABLED_KEY, FREE_DELIVERIES_KEY, SHOW_OFFER_SAVINGS_KEY])
      .execute();
    const coupons = rows.find((r) => r.key === COUPONS_ENABLED_KEY);
    const free = rows.find((r) => r.key === FREE_DELIVERIES_KEY);
    const savings = rows.find((r) => r.key === SHOW_OFFER_SAVINGS_KEY);
    const stamps = rows.map((r) => r.updated_at).filter((d): d is Date => d instanceof Date);
    return {
      coupons_enabled: (coupons ? couponsEnabledFrom(coupons.value) : null) ?? DEFAULT_COUPONS_ENABLED,
      new_customer_free_deliveries: (free ? freeDeliveriesFrom(free.value) : null) ?? { ...DEFAULT_FREE_DELIVERIES },
      show_offer_savings: (savings ? couponsEnabledFrom(savings.value) : null) ?? DEFAULT_SHOW_OFFER_SAVINGS,
      updated_at: stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null,
    };
  }

  /** Audited (CHECKOUT_SETTINGS_UPDATED); only the switches sent are written. */
  async setCheckoutSettings(input: UpdateCheckoutSettingsInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select(['key', 'value'])
        .where('key', 'in', [COUPONS_ENABLED_KEY, FREE_DELIVERIES_KEY, SHOW_OFFER_SAVINGS_KEY])
        .forUpdate()
        .execute();
      const writes: Array<{ key: string; value: object; description: string }> = [];
      if (input.coupons_enabled !== undefined) {
        writes.push({ key: COUPONS_ENABLED_KEY, value: { enabled: input.coupons_enabled }, description: 'Whether customers can enter a coupon code at checkout' });
      }
      if (input.show_offer_savings !== undefined) {
        writes.push({ key: SHOW_OFFER_SAVINGS_KEY, value: { enabled: input.show_offer_savings }, description: "Whether the customer app shows 'Save LKR' on offers" });
      }
      if (input.new_customer_free_deliveries !== undefined) {
        // An omitted `since` keeps the stored one (or the default start).
        const stored = before.find((r) => r.key === FREE_DELIVERIES_KEY);
        const since =
          input.new_customer_free_deliveries.since !== undefined
            ? new Date(input.new_customer_free_deliveries.since).toISOString()
            : ((stored ? freeDeliveriesFrom(stored.value) : null)?.since ?? DEFAULT_FREE_DELIVERIES_SINCE);
        writes.push({
          key: FREE_DELIVERIES_KEY,
          value: { enabled: input.new_customer_free_deliveries.enabled, count: input.new_customer_free_deliveries.count, since },
          description: "How many orders since `since` have no delivery fee, for every customer",
        });
      }
      for (const w of writes) {
        const value = JSON.stringify(w.value);
        await trx
          .insertInto('system_configurations')
          .values({ key: w.key, value, description: w.description })
          .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
          .execute();
      }
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const w of writes) {
        oldValues[w.key] = before.find((r) => r.key === w.key)?.value ?? null;
        newValues[w.key] = w.value;
      }
      await writeAudit(trx, actor, {
        action: 'CHECKOUT_SETTINGS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: 'checkout', ...oldValues },
        newValues: { key: 'checkout', ...newValues },
      });
      logger.info({ oldValues, newValues, actorId: actor.actorId }, 'Checkout settings changed');
    });
    return await this.getCheckoutSettings();
  }

  async getRiderCommission(): Promise<{ default_percent: number; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', RIDER_COMMISSION_KEY)
      .executeTakeFirst();
    const pct = row ? commissionFrom(row.value) : null;
    return { default_percent: pct ?? DEFAULT_RIDER_COMMISSION_PERCENT, updated_at: pct === null ? null : row!.updated_at };
  }

  /** Audited (RIDER_COMMISSION_UPDATED); applies to deliveries settled afterwards. */
  async setRiderCommission(input: UpdateRiderCommissionInput, actor: AuditActor) {
    const pct = Math.round(input.default_percent * 100) / 100;
    const value = JSON.stringify({ default_percent: pct });
    return await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', RIDER_COMMISSION_KEY)
        .forUpdate()
        .executeTakeFirst();
      const row = await trx
        .insertInto('system_configurations')
        .values({ key: RIDER_COMMISSION_KEY, value, description: "A commission rider's default share of the standard delivery fee, %" })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .returning(['updated_at'])
        .executeTakeFirstOrThrow();
      const previous = before ? commissionFrom(before.value) : null;
      await writeAudit(trx, actor, {
        action: 'RIDER_COMMISSION_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: RIDER_COMMISSION_KEY, default_percent: previous },
        newValues: { key: RIDER_COMMISSION_KEY, default_percent: pct },
      });
      logger.info({ previous, pct, actorId: actor.actorId }, 'Rider commission default changed');
      return { default_percent: pct, updated_at: row.updated_at };
    });
  }

  async getBirthdayOfferSetting(): Promise<BirthdayOfferSetting> {
    return (await this.getBirthdayOffer()).setting;
  }

  /** Admin/Operations view: the setting plus the SMS exactly as it goes out. */
  async getBirthdayOffer(): Promise<{ setting: BirthdayOfferSetting; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', BIRTHDAY_OFFER_KEY)
      .executeTakeFirst();
    return { setting: birthdayOfferFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  presentBirthdayOffer(view: { setting: BirthdayOfferSetting; updated_at: Date | null }) {
    const preview = birthdaySmsText(view.setting);
    return {
      ...view.setting,
      sms_preview: preview,
      sms_parts: smsParts(preview),
      window_days: BIRTHDAY_WINDOW_DAYS,
      updated_at: view.updated_at,
    };
  }

  /** Audited (BIRTHDAY_OFFER_UPDATED); only the fields sent change. */
  async setBirthdayOffer(input: UpdateBirthdayOfferInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', BIRTHDAY_OFFER_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = birthdayOfferFrom(before?.value);
      const next: BirthdayOfferSetting = {
        enabled: input.enabled ?? previous.enabled,
        percent: input.percent !== undefined ? Math.round(input.percent * 100) / 100 : previous.percent,
        sms_enabled: input.sms_enabled ?? previous.sms_enabled,
        sms_text: input.sms_text ?? previous.sms_text,
      };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: BIRTHDAY_OFFER_KEY, value, description: 'Birthday offer: % off one order in the birthday week, and the birthday SMS' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'BIRTHDAY_OFFER_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: BIRTHDAY_OFFER_KEY, ...(before ? previous : {}) },
        newValues: { key: BIRTHDAY_OFFER_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Birthday offer changed');
    });
    return this.presentBirthdayOffer(await this.getBirthdayOffer());
  }

  /** Rider trips (owner, 2026-10-10): the rules ASSIGN_RIDER applies right now. */
  async getRiderTrips(): Promise<BatchingRules & { updated_at: Date | null }> {
    const [rules, row] = await Promise.all([
      getBatchingRules(),
      db.selectFrom('system_configurations').select('updated_at').where('key', '=', RIDER_BATCHING_KEY).executeTakeFirst(),
    ]);
    return { ...rules, updated_at: row?.updated_at ?? null };
  }

  /** Audited (RIDER_TRIPS_UPDATED); only the fields sent change. */
  async setRiderTrips(input: UpdateRiderTripsInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', RIDER_BATCHING_KEY)
        .forUpdate()
        .executeTakeFirst();
      // The rules as applied (defaults for a missing or malformed row).
      const previous = await getBatchingRules(trx);
      const next: BatchingRules = {
        max_active_deliveries: input.max_active_deliveries ?? previous.max_active_deliveries,
        max_dropoff_distance_km:
          input.max_dropoff_distance_km !== undefined
            ? Math.round(input.max_dropoff_distance_km * 10) / 10
            : previous.max_dropoff_distance_km,
      };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: RIDER_BATCHING_KEY, value, description: 'Rider trips: open deliveries per rider, and max km between drop-offs' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'RIDER_TRIPS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: RIDER_BATCHING_KEY, ...(before ? previous : {}) },
        newValues: { key: RIDER_BATCHING_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Rider trip rules changed');
    });
    return await this.getRiderTrips();
  }

  /**
   * What the customer app and landing site may know about the store. Only
   * values with a real source: the fee (system_configurations), the active
   * dark store's name and radius (dark_stores), the opening hours and whether
   * the store is open now (store-schedule.ts, set by Ops and Admin - owner,
   * 2026-10-10), plus the
   * checkout switches (show a coupon field; the free deliveries and since when;
   * show "Save LKR" on offers).
   */
  async getPublicStore() {
    const [fee, checkout, schedule, store, doctors] = await Promise.all([
      this.getDeliveryFee(),
      this.getCheckoutSettings(),
      storeSchedule.read(),
      db
        .selectFrom('dark_stores')
        .select(['name', 'radius_km'])
        .where('is_active', '=', true)
        .orderBy('created_at', 'asc')
        .limit(1)
        .executeTakeFirst(),
      doctorsAccess.read(),
    ]);
    const now = orderingClock.now();
    const status = storeStatusAt(schedule, now);
    const today = DateTime.fromJSDate(now).setZone(STORE_TIMEZONE).toISODate()!;
    const in30 = DateTime.fromJSDate(now).setZone(STORE_TIMEZONE).plus({ days: 30 }).toISODate()!;
    return {
      delivery_fee_lkr: fee.fee_lkr,
      hub_name: store?.name ?? null,
      // Today's hours, or the next open day's when today is closed.
      delivery_hours: { ...displayHours(schedule, now), timezone: STORE_TIMEZONE },
      radius_km: store ? Number(store.radius_km) : null,
      coupons_enabled: checkout.coupons_enabled,
      new_customer_free_deliveries: checkout.new_customer_free_deliveries,
      // Owner, 2026-10-10: the customer app shows "Save LKR X" only when on.
      show_offer_savings: checkout.show_offer_savings,
      // Store timing (owner, 2026-10-10): set by Ops and Admin.
      hours: { same_every_day: schedule.hours.same_every_day, days: schedule.hours.days },
      ...status,
      upcoming_holidays: schedule.holidays.filter((h) => h.date >= today && h.date <= in30),
      delivery_slots_enabled: schedule.slots.enabled,
      // Owner, 2026-10-10: guests must sign in before the app shows doctors.
      doctors_require_sign_in: doctors.require_sign_in,
    };
  }
}

export const settingsService = new SettingsService();
