import { db } from '../../database/connection.js';
import { sellerPickupPoints } from '../sellers/seller.location.js';
import type { DBConnection } from './order.repository.js';

/*
 * Where an order's goods are collected (owner, 2026-10-24: "coordinates should
 * work by seller place and delivery charge should charge by from that
 * coordinates and admin can approve this").
 *
 *   - Blynk's own products are collected at the Blynk store (the active dark
 *     store, as before).
 *   - A seller's product is collected at that seller's APPROVED shop point
 *     (sellers/seller.location.ts sellerPickupPoints). A seller with no
 *     approved point - none pinned yet, only a waiting or rejected one, or
 *     migration 053 not run - is collected at the Blynk store, as before.
 *
 * The pickup points of a cart / order are the DISTINCT points: the store when
 * any item is collected there (or when there are no items to look at), plus
 * each seller's point once. One rider trip collects everything and delivers,
 * so the delivery fee (delivery-fee.ts) and the rider's distance pay
 * (riders/rider.pay-rules.ts) are worked out on the LONGEST road distance from
 * any pickup point to the customer - the farthest leg. A Blynk-only cart has
 * one point, the store: exactly the distance it had before.
 *
 * Nothing is stored for this (no migration): staff and rider order details
 * compute `pickups` on read from the order's items.
 */

export interface PickupPoint {
  kind: 'STORE' | 'SELLER';
  seller_id?: string;
  shop_name?: string;
  lat: number;
  lng: number;
}

type HubLike = { latitude: unknown; longitude: unknown } | null | undefined;

function storePoint(hub: HubLike): PickupPoint | null {
  if (!hub) return null;
  const lat = Number(hub.latitude);
  const lng = Number(hub.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { kind: 'STORE', lat, lng } : null;
}

/**
 * The distinct pickup points for these products, given the store (`hub`, the
 * active dark store; null = unknown). The store comes first when it is one of
 * them, then the sellers by shop name. Never throws because of the seller
 * lookup (sellerPickupPoints answers an empty Map on any trouble).
 */
export async function pickupPointsFor(productIds: readonly string[], hub: HubLike): Promise<PickupPoint[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const store = storePoint(hub);
  const sellerPoints = ids.length ? await sellerPickupPoints(ids) : new Map();
  const needsStore = ids.length === 0 || ids.some((id) => !sellerPoints.has(id));

  const sellers = new Map<string, PickupPoint>();
  for (const p of sellerPoints.values()) {
    if (!sellers.has(p.seller_id)) {
      sellers.set(p.seller_id, { kind: 'SELLER', seller_id: p.seller_id, shop_name: p.shop_name, lat: p.lat, lng: p.lng });
    }
  }
  const out: PickupPoint[] = [];
  if (needsStore && store) out.push(store);
  out.push(...[...sellers.values()].sort((a, b) => (a.shop_name ?? '').localeCompare(b.shop_name ?? '') || a.seller_id!.localeCompare(b.seller_id!)));
  return out;
}

type Point = { lat: number; lng: number };

/**
 * The farthest pickup point: every point's distance to `to` by `measure` (the
 * caller's own method - the fee's cached OSRM, or rider pay's; both fall back
 * to straight line x 1.3), and the longest wins. `estimated` is true when any
 * leg had to be estimated. One point (a Blynk-only cart: the store) is
 * exactly the single measurement of before. null when there is no point.
 */
export async function farthestPickupDistance(
  points: ReadonlyArray<PickupPoint>,
  to: Point,
  measure: (from: Point, to: Point) => Promise<{ km: number; estimated: boolean }>
): Promise<{ km: number; estimated: boolean; from: PickupPoint } | null> {
  if (!points.length) return null;
  const legs = await Promise.all(points.map(async (p) => ({ from: p, ...(await measure({ lat: p.lat, lng: p.lng }, to)) })));
  const far = legs.reduce((best, leg) => (leg.km > best.km ? leg : best));
  return { km: far.km, estimated: legs.some((l) => l.estimated), from: far.from };
}

/**
 * The products a stored order's goods are collected for: its items (combo
 * items included) that are still in the bag - an item resolved UNAVAILABLE was
 * removed from the order and is not collected.
 */
export async function orderProductIds(orderId: string, executor: DBConnection = db): Promise<string[]> {
  const rows = await executor
    .selectFrom('order_items')
    .select('product_id')
    .where('order_id', '=', orderId)
    .where('item_status', '!=', 'UNAVAILABLE')
    .execute();
  return [...new Set(rows.map((r) => r.product_id))];
}

/**
 * The pickup points of a stored order (staff / rider order details; rider
 * pay). Without `dark_store_id` the order's own is read.
 */
export async function orderPickups(
  order: { id: string; dark_store_id?: string },
  executor: DBConnection = db
): Promise<PickupPoint[]> {
  // One after the other: `executor` may be a transaction (one connection).
  const productIds = await orderProductIds(order.id, executor);
  const storeId =
    order.dark_store_id ??
    (await executor.selectFrom('orders').select('dark_store_id').where('id', '=', order.id).executeTakeFirst())?.dark_store_id;
  if (!storeId) return await pickupPointsFor(productIds, null);
  const hub = await executor
    .selectFrom('dark_stores')
    .select(['latitude', 'longitude'])
    .where('id', '=', storeId)
    .executeTakeFirst();
  return await pickupPointsFor(productIds, hub ?? null);
}
