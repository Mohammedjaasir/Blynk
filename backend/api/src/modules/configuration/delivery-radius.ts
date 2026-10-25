import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Delivery radius (owner's brother, 2026-10-25: "make the delivery radius an admin setting - 4 km for
 * now, 6 km next week to add Beruwala"). It is the active store's `radius_km`: checkout and the
 * address book refuse an address further away than this from the store (DELIVERY_OUTSIDE_RADIUS,
 * orders/delivery-zone.ts), and the customer app's delivery-area map draws it (GET /store radius_km).
 * Audited (DELIVERY_RADIUS_UPDATED); orders already placed are untouched.
 */
export const MIN_DELIVERY_RADIUS_KM = 0.5;
export const MAX_DELIVERY_RADIUS_KM = 50;

export const updateDeliveryRadiusSchema = z
  .object({
    radius_km: z
      .number({ required_error: 'The radius is required', invalid_type_error: 'The radius must be a number' })
      .finite()
      .min(MIN_DELIVERY_RADIUS_KM, `The radius must be at least ${MIN_DELIVERY_RADIUS_KM} km`)
      .max(MAX_DELIVERY_RADIUS_KM, `The radius can be at most ${MAX_DELIVERY_RADIUS_KM} km`)
      .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'The radius can have at most 2 decimals'),
  })
  .strict();
export type UpdateDeliveryRadiusInput = z.infer<typeof updateDeliveryRadiusSchema>;

export interface DeliveryRadius {
  radius_km: number;
  store_name: string;
}

async function activeStore(executor = db) {
  const store = await executor
    .selectFrom('dark_stores')
    .select(['id', 'name', 'radius_km'])
    .where('is_active', '=', true)
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!store) throw new AppError('No active dark store hub found.', 500, 'STORE_UNAVAILABLE');
  return store;
}

export const deliveryRadiusService = {
  async get(): Promise<DeliveryRadius> {
    const store = await activeStore();
    return { radius_km: Number(store.radius_km), store_name: store.name };
  },

  async set(input: UpdateDeliveryRadiusInput, actor: AuditActor): Promise<DeliveryRadius> {
    const radius = Math.round(input.radius_km * 100) / 100;
    return await db.transaction().execute(async (trx) => {
      const store = await activeStore(trx as unknown as typeof db);
      await trx.updateTable('dark_stores').set({ radius_km: radius, updated_at: new Date() }).where('id', '=', store.id).execute();
      await writeAudit(trx, actor, {
        action: 'DELIVERY_RADIUS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: 'delivery_radius', radius_km: Number(store.radius_km) },
        newValues: { key: 'delivery_radius', radius_km: radius },
      });
      logger.info({ from: Number(store.radius_km), to: radius, actorId: actor.actorId }, 'Delivery radius changed');
      return { radius_km: radius, store_name: store.name };
    });
  },
};
