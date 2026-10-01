import type { ExpressionBuilder } from 'kysely';
import type { Database } from '../../database/types.js';
import { db } from '../../database/connection.js';
import type { DBConnection } from '../orders/order.repository.js';
import { ACTIVE_DELIVERY_STATUSES, CLOSED_ORDER_STATUSES } from '../orders/lifecycle/catalogue.js';

/**
 * Rider trips (batching, 2026-09-30): one rider may carry more than one order
 * at a time, up to a store-configured cap (system_configurations
 * 'rider_batching', migration 021). Every order keeps its own delivery row,
 * delivery code and COD; nothing here merges them.
 *
 * Rules, enforced by ASSIGN_RIDER under the rider row lock:
 *   - a rider holds at most `max_active_deliveries` open deliveries (default 2);
 *   - a second drop-off further than `max_dropoff_distance_km` (straight line,
 *     default 1.5 km) from any drop-off the rider already holds is refused
 *     with 409 BATCH_DROPOFFS_TOO_FAR unless staff confirm it
 *     (`confirm_far_batch: true`) - "allow with a warning", made explicit;
 *   - the rider's existing delivery may be at any active stage (even picked
 *     up): the new order is PACKED at the store, so the rider collects it on
 *     their next visit. Nothing about the lifecycle changes.
 */
export const RIDER_BATCHING_KEY = 'rider_batching';
export const DEFAULT_MAX_ACTIVE_DELIVERIES = 2;
export const DEFAULT_MAX_DROPOFF_DISTANCE_KM = 1.5;
/** A rider's last GPS point older than this is "location unknown" (suggestions). */
export const LOCATION_FRESH_MINUTES = 15;

export interface BatchingRules {
  max_active_deliveries: number;
  max_dropoff_distance_km: number;
}

function positive(value: unknown, fallback: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return integer ? Math.floor(value) : value;
}

/** The stored rules, or the defaults when the row is missing or malformed. */
export async function getBatchingRules(executor: DBConnection = db): Promise<BatchingRules> {
  const row = await executor
    .selectFrom('system_configurations')
    .select('value')
    .where('key', '=', RIDER_BATCHING_KEY)
    .executeTakeFirst();
  const value = (row?.value && typeof row.value === 'object' ? row.value : {}) as Record<string, unknown>;
  return {
    max_active_deliveries: positive(value.max_active_deliveries, DEFAULT_MAX_ACTIVE_DELIVERIES, true),
    max_dropoff_distance_km: positive(value.max_dropoff_distance_km, DEFAULT_MAX_DROPOFF_DISTANCE_KM),
  };
}

/**
 * A delivery the rider still holds: an active assignment on an order that is
 * not closed. A cancelled order leaves its ASSIGNED delivery row as it was
 * (lifecycle cancelOrder), and that must not use up the rider's capacity.
 */
export function isOpenDelivery(eb: ExpressionBuilder<Database, 'deliveries' | 'orders'>) {
  return eb.and([
    eb('deliveries.assignment_status', 'in', ACTIVE_DELIVERY_STATUSES),
    eb('orders.order_status', 'not in', CLOSED_ORDER_STATUSES),
  ]);
}

/** The rider's open deliveries with their drop-off points. */
export async function findOpenDeliveriesForRiders(riderIds: string[], executor: DBConnection = db) {
  if (riderIds.length === 0) return [];
  const rows = await executor
    .selectFrom('deliveries')
    .innerJoin('orders', 'orders.id', 'deliveries.order_id')
    .select([
      'deliveries.id as delivery_id',
      'deliveries.rider_id',
      'deliveries.assignment_status',
      'orders.id as order_id',
      'orders.order_number',
      'orders.delivery_latitude',
      'orders.delivery_longitude',
    ])
    .where('deliveries.rider_id', 'in', riderIds)
    .where((eb) => isOpenDelivery(eb))
    .orderBy('deliveries.assigned_at', 'asc')
    .orderBy('deliveries.id', 'asc')
    .execute();
  return rows.map((r) => ({ ...r, dropoff: toPoint(r.delivery_latitude, r.delivery_longitude) }));
}

export interface Point {
  lat: number;
  lng: number;
}

/** A NUMERIC pair from the database, or null (0,0 is the "no location" placeholder). */
export function toPoint(lat: unknown, lng: unknown): Point | null {
  const a = Number(lat);
  const b = Number(lng);
  if (lat === null || lng === null || lat === undefined || lng === undefined) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lng: b };
}

/** Great-circle (straight-line) distance in kilometres. */
export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** One decimal, the way staff read it ("about 2.3 km"). */
export const roundKm = (km: number) => Math.round(km * 10) / 10;

/** Row lock on the rider: serializes every assignment to the same rider (the cap check). */
export async function lockRider(executor: DBConnection, riderId: string) {
  return await executor.selectFrom('riders').selectAll().where('id', '=', riderId).forUpdate().executeTakeFirst();
}
