import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { haversineM, roadDistanceM } from '../routing/index.js';
import { priceByKmTiers } from '../pricing/km-tiers.js';
import { readDeliveryFeeSetting, type DeliveryFeeMode } from '../configuration/settings.service.js';
import { orderRepository, type DBConnection } from './order.repository.js';
import { farthestPickupDistance, pickupPointsFor } from './pickup-points.js';

/*
 * THE delivery fee for one address (owner, 2026-10-10) - the only place it is
 * worked out. GET /orders/checkout-info, the validate-coupon preview and
 * order placement (authoritative, snapshotted on the order) all call
 * quoteDeliveryFee.
 *
 *   FLAT            fee = fee_lkr (as before; no distance is measured)
 *   DISTANCE_TIERS  distance = road km active hub -> address (OSRM route
 *                   service, 2.5 s timeout; straight line x 1.3 marked
 *                   estimated when OSRM cannot answer). With the cart's
 *                   products (owner, 2026-10-24): the LONGEST such distance
 *                   from any of the cart's pickup points - the hub for Blynk's
 *                   products, a seller's approved shop point for theirs
 *                   (pickup-points.ts); a Blynk-only cart = the hub, as before
 *                   fee = per-km tiers (pricing/km-tiers.ts): every started
 *                   km counts, the last row repeats, then the optional cap
 *                   max_fee_lkr. Without an address: the km-1 amount.
 *
 * This is the STANDARD fee. A free delivery (free-delivery.ts) still makes the
 * charged orders.delivery_fee 0 while orders.standard_delivery_fee keeps this
 * fee (the rider-pay basis).
 */

/** Straight line x this when OSRM cannot give the road distance (as rider pay). */
export const FEE_ROAD_FACTOR = 1.3;
const FEE_DISTANCE_TIMEOUT_MS = 2500;

type Point = { lat: number; lng: number };

export interface DeliveryFeeQuote {
  /** The standard fee for this address, before any free delivery. */
  fee_lkr: number;
  fee_mode: DeliveryFeeMode;
  /** Road km farthest pickup point (the hub for a Blynk-only cart) -> address (2 decimals); null in FLAT mode or without an address. */
  distance_km: number | null;
  /** true = OSRM was unavailable and the distance is straight line x 1.3. */
  distance_estimated: boolean | null;
  /** DISTANCE_TIERS: how many km were charged (every started km). */
  km_counted: number | null;
}

/** Swappable in tests (OSRM is mocked there). */
export const feeDistance = {
  roadMetres: (from: Point, to: Point): Promise<number> => roadDistanceM(from, to, undefined, undefined, FEE_DISTANCE_TIMEOUT_MS),
};

/**
 * Road distances already asked for, so the cart, the coupon preview and the
 * order ask OSRM once per address and charge what was shown. Only real road
 * answers are kept (an estimate is asked again next time).
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map<string, { km: number; at: number }>();
export const feeDistanceCache = { clear: () => cache.clear() };

const round2 = (v: number) => Math.round(v * 100) / 100;
const keyOf = (from: Point, to: Point) => [from.lat, from.lng, to.lat, to.lng].map((v) => v.toFixed(6)).join(',');

export async function measureFeeDistance(from: Point, to: Point): Promise<{ km: number; estimated: boolean }> {
  const key = keyOf(from, to);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { km: hit.km, estimated: false };
  try {
    const km = round2((await feeDistance.roadMetres(from, to)) / 1000);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { km, at: Date.now() });
    return { km, estimated: false };
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'Delivery fee: road distance unavailable; straight line x 1.3');
    return { km: round2((haversineM(from, to) * FEE_ROAD_FACTOR) / 1000), estimated: true };
  }
}

/**
 * The fee for delivering to `to` (null = no address known yet). `hub` saves a
 * lookup when the caller already has the active dark store.
 *
 * `productIds` (owner, 2026-10-24): the cart's products. The distance is then
 * measured from the FARTHEST pickup point of the cart - the Blynk store for
 * Blynk's products, a seller's approved shop point for that seller's products
 * (pickup-points.ts). Without it (or with only Blynk products) the distance
 * is from the store, as before.
 */
export async function quoteDeliveryFee(
  to: Point | null,
  opts: { executor?: DBConnection; hub?: { latitude: unknown; longitude: unknown } | null; productIds?: readonly string[] } = {}
): Promise<DeliveryFeeQuote> {
  const executor = opts.executor ?? db;
  const setting = await readDeliveryFeeSetting(executor);
  if (setting.fee_mode !== 'DISTANCE_TIERS') {
    return { fee_lkr: setting.fee_lkr, fee_mode: 'FLAT', distance_km: null, distance_estimated: null, km_counted: null };
  }
  const hub = opts.hub ?? (to ? await orderRepository.findActiveDarkStore(executor) : null);
  const points = to ? await pickupPointsFor(opts.productIds ?? [], hub ?? null) : [];
  // The fee's own measurement (cached OSRM, straight line x 1.3 fallback) for every leg; the longest wins.
  const distance = to ? await farthestPickupDistance(points, to, measureFeeDistance) : null;
  if (!to || !distance) {
    const price = priceByKmTiers(setting.tiers, 0, setting.max_fee_lkr);
    return { fee_lkr: price.total, fee_mode: 'DISTANCE_TIERS', distance_km: null, distance_estimated: null, km_counted: null };
  }
  const price = priceByKmTiers(setting.tiers, distance.km, setting.max_fee_lkr);
  return {
    fee_lkr: price.total,
    fee_mode: 'DISTANCE_TIERS',
    distance_km: distance.km,
    distance_estimated: distance.estimated,
    km_counted: price.km_counted,
  };
}
