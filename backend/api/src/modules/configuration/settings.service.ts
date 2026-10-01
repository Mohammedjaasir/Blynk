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

  /**
   * What the customer app and landing site may know about the store. Only
   * values with a real source: the fee (system_configurations), the active
   * dark store's name and radius (dark_stores), and the delivery window the
   * order scheduler uses (utils/time.ts DEFAULT_OPERATING_HOURS).
   */
  async getPublicStore() {
    const [fee, store] = await Promise.all([
      this.getDeliveryFee(),
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
    };
  }
}

export const settingsService = new SettingsService();
