import { Request, Response, NextFunction } from 'express';
import { orderRepository } from './order.repository.js';
import { orderItemParamsSchema } from './order.schema.js';
import { AppError } from '../../middleware/error.middleware.js';
import { fetchRoute, type RouteResult } from '../routing/index.js';

/**
 * GET /orders/:id/route - the road route from the rider's latest point to the
 * customer's delivery point, with OSRM's distance and driving time, for the
 * customer's tracking map and "Arriving in ~N min" (owner, 2026-10-10).
 *
 * This REVERSES plan rule D.13 ("no route, no ETA") of
 * docs/superpowers/plans/2026-09-19-blynk-live-location-tracking.md: the
 * owner asked for a Rapido-style route line and ETA on 2026-10-10.
 *
 * Who may ask: the order's own customer (404 for "no such order" AND "not
 * yours", like the location stream), only while the order is
 * OUT_FOR_DELIVERY with a PICKED_UP delivery (409 ORDER_NOT_TRACKABLE
 * otherwise). The route's first point is the rider's position, which this
 * customer already receives on the location stream - nobody else gets it.
 *
 * Answers:
 *  - 200 { route: { coordinates, distance_m, duration_s, computed_at } }
 *  - 200 { route: null } while there is no rider point yet, or the latest
 *    point is older than RIDER_POINT_MAX_AGE_MS (a time from an old point
 *    would be made up);
 *  - 503 ROUTING_UNAVAILABLE when OSRM is not configured / down, 404
 *    ROUTE_NOT_FOUND when OSRM finds no road. The app hides the line and the
 *    ETA on anything but a route: it never shows a guessed time.
 *
 * Caching (so customers polling cannot hammer OSRM): one entry per order, in
 * this process.
 *  - an answer (route or failure) younger than MIN_RECOMPUTE_MS (25 s) is
 *    reused whatever the rider did;
 *  - after that it is recomputed only when the rider has moved more than
 *    RECOMPUTE_MOVE_M (50 m) from the point it was computed from, or it is
 *    older than MAX_ROUTE_AGE_MS (2 min) - a rider standing still does not
 *    need a new OSRM call every 25 s, but the time is refreshed now and then;
 *  - concurrent requests for one order share one OSRM call;
 *  - entries older than ENTRY_TTL_MS are dropped, and the map is capped.
 */

export const MIN_RECOMPUTE_MS = 25_000;
export const RECOMPUTE_MOVE_M = 50;
export const MAX_ROUTE_AGE_MS = 120_000;
export const RIDER_POINT_MAX_AGE_MS = 120_000;
const ENTRY_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 2_000;

export interface CustomerRoute extends RouteResult {
  computed_at: string;
}

type Point = { lat: number; lng: number };

interface CacheEntry {
  at: number;
  from: Point;
  to: Point;
  route: CustomerRoute | null;
  error: AppError | null;
}

/** Injectable for tests: the OSRM call and the clock. */
export const routeDeps = {
  fetchRoute: (from: Point, to: Point): Promise<RouteResult> => fetchRoute(from, to),
  now: (): number => Date.now(),
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

/** Test-only: forget every cached route. */
export function clearRouteCache() {
  cache.clear();
  inFlight.clear();
}

function metres(a: Point, b: Point): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Whether a cached entry still answers for a rider now at [from]. */
export function isReusable(entry: CacheEntry, from: Point, to: Point, now: number): boolean {
  const age = now - entry.at;
  if (age < 0 || age >= ENTRY_TTL_MS) return false;
  // The delivery point is a snapshot on the order, but compare anyway.
  if (metres(entry.to, to) > 1) return false;
  if (age < MIN_RECOMPUTE_MS) return true;
  if (entry.error) return false; // a failure is retried after the minimum gap
  return metres(entry.from, from) <= RECOMPUTE_MOVE_M && age < MAX_ROUTE_AGE_MS;
}

function prune(now: number) {
  for (const [key, entry] of cache) {
    if (now - entry.at >= ENTRY_TTL_MS) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function compute(orderId: string, from: Point, to: Point): Promise<CacheEntry> {
  const at = routeDeps.now();
  let entry: CacheEntry;
  try {
    const r = await routeDeps.fetchRoute(from, to);
    entry = { at, from, to, route: { ...r, computed_at: new Date(at).toISOString() }, error: null };
  } catch (err) {
    const error =
      err instanceof AppError ? err : new AppError('The route could not be calculated right now.', 503, 'ROUTING_UNAVAILABLE');
    entry = { at, from, to, route: null, error };
  }
  cache.delete(orderId); // re-insert at the end: Map order is the eviction order
  cache.set(orderId, entry);
  prune(at);
  return entry;
}

export async function routeForOrder(orderId: string, from: Point, to: Point): Promise<CacheEntry> {
  const now = routeDeps.now();
  const cached = cache.get(orderId);
  if (cached && isReusable(cached, from, to, now)) return cached;
  const pending = inFlight.get(orderId);
  if (pending) return pending;
  const p = compute(orderId, from, to).finally(() => inFlight.delete(orderId));
  inFlight.set(orderId, p);
  return p;
}

export async function getOrderRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: orderId } = orderItemParamsSchema.parse(req.params);
    const order = await orderRepository.findOrderById(orderId, req.user!.id);
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    const row = await orderRepository.findRouteContextForCustomer(orderId, req.user!.id);
    if (!row) throw new AppError('This order is not on the road right now.', 409, 'ORDER_NOT_TRACKABLE');

    const to = { lat: Number(row.delivery_latitude), lng: Number(row.delivery_longitude) };
    const capturedAt = row.location_captured_at?.getTime();
    if (
      row.current_latitude == null ||
      row.current_longitude == null ||
      capturedAt == null ||
      routeDeps.now() - capturedAt > RIDER_POINT_MAX_AGE_MS ||
      !Number.isFinite(to.lat) ||
      !Number.isFinite(to.lng)
    ) {
      res.json({ success: true, data: { route: null } });
      return;
    }
    const from = { lat: Number(row.current_latitude), lng: Number(row.current_longitude) };

    const entry = await routeForOrder(orderId, from, to);
    if (entry.error) throw entry.error;
    res.json({ success: true, data: { route: entry.route } });
  } catch (err) {
    next(err);
  }
}
