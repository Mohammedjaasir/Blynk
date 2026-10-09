import { z } from 'zod';
import { db } from '../../database/connection.js';
import { DEFAULT_OPERATING_HOURS } from '../../utils/time.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

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
  })
  .strict()
  .refine((v) => v.coupons_enabled !== undefined || v.new_customer_free_deliveries !== undefined, 'Nothing to change');
export type UpdateCheckoutSettingsInput = z.infer<typeof updateCheckoutSettingsSchema>;

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

const hhmm = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

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
      .where('key', 'in', [COUPONS_ENABLED_KEY, FREE_DELIVERIES_KEY])
      .execute();
    const coupons = rows.find((r) => r.key === COUPONS_ENABLED_KEY);
    const free = rows.find((r) => r.key === FREE_DELIVERIES_KEY);
    const stamps = rows.map((r) => r.updated_at).filter((d): d is Date => d instanceof Date);
    return {
      coupons_enabled: (coupons ? couponsEnabledFrom(coupons.value) : null) ?? DEFAULT_COUPONS_ENABLED,
      new_customer_free_deliveries: (free ? freeDeliveriesFrom(free.value) : null) ?? { ...DEFAULT_FREE_DELIVERIES },
      updated_at: stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null,
    };
  }

  /** Audited (CHECKOUT_SETTINGS_UPDATED); only the switches sent are written. */
  async setCheckoutSettings(input: UpdateCheckoutSettingsInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select(['key', 'value'])
        .where('key', 'in', [COUPONS_ENABLED_KEY, FREE_DELIVERIES_KEY])
        .forUpdate()
        .execute();
      const writes: Array<{ key: string; value: object; description: string }> = [];
      if (input.coupons_enabled !== undefined) {
        writes.push({ key: COUPONS_ENABLED_KEY, value: { enabled: input.coupons_enabled }, description: 'Whether customers can enter a coupon code at checkout' });
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

  /**
   * What the customer app and landing site may know about the store. Only
   * values with a real source: the fee (system_configurations), the active
   * dark store's name and radius (dark_stores), and the delivery window the
   * order scheduler uses (utils/time.ts DEFAULT_OPERATING_HOURS), plus the
   * checkout switches (show a coupon field; the free deliveries and since when).
   */
  async getPublicStore() {
    const [fee, checkout, store] = await Promise.all([
      this.getDeliveryFee(),
      this.getCheckoutSettings(),
      db
        .selectFrom('dark_stores')
        .select(['name', 'radius_km'])
        .where('is_active', '=', true)
        .orderBy('created_at', 'asc')
        .limit(1)
        .executeTakeFirst(),
    ]);
    return {
      delivery_fee_lkr: fee.fee_lkr,
      hub_name: store?.name ?? null,
      delivery_hours: {
        start: hhmm(DEFAULT_OPERATING_HOURS.startHour),
        end: hhmm(DEFAULT_OPERATING_HOURS.endHour),
        timezone: 'Asia/Colombo',
      },
      radius_km: store ? Number(store.radius_km) : null,
      coupons_enabled: checkout.coupons_enabled,
      new_customer_free_deliveries: checkout.new_customer_free_deliveries,
    };
  }
}

export const settingsService = new SettingsService();
