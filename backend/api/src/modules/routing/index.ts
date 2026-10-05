import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { AppError } from '../../middleware/error.middleware.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Road routes for the delivery maps (2026-09-28).
 *
 * GET /api/v1/routing/route?from=<lat>,<lng>&to=<lat>,<lng>
 *   -> { route: { distance_m, duration_s, coordinates: [[lng, lat], ...] } }
 *
 * The apps never talk to the routing engine themselves: this endpoint calls a
 * self-hosted OSRM (infra/osrm, deployed on Coolify) on the server's internal
 * network, so OSRM needs no public address, no CORS and no second login. Any
 * signed-in user may ask (riders, operators, and customers for their own
 * order's tracking map); it only turns two points into a road line.
 *
 * OSRM_URL unset or OSRM down -> 503 ROUTING_UNAVAILABLE, and the apps fall
 * back to the map without a route line. Nothing else depends on it.
 */

const coordinate = z
  .string()
  .trim()
  .regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, 'Expected "<latitude>,<longitude>"')
  .transform((value) => {
    const [lat, lng] = value.split(',').map(Number);
    return { lat, lng };
  })
  .refine((p) => p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180, 'Coordinate out of range');

const routeQuery = z.object({ from: coordinate, to: coordinate });

export interface RouteResult {
  distance_m: number;
  duration_s: number;
  /** GeoJSON order: [longitude, latitude]. */
  coordinates: [number, number][];
}

export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  osrmUrl: string | undefined = env.OSRM_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteResult> {
  if (!osrmUrl) {
    throw new AppError('Route drawing is not configured on this server.', 503, 'ROUTING_UNAVAILABLE');
  }
  const url =
    `${osrmUrl.replace(/\/+$/, '')}/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  let response: Response | globalThis.Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    logger.warn({ err }, 'Routing engine unreachable');
    throw new AppError('The route could not be calculated right now.', 503, 'ROUTING_UNAVAILABLE');
  }
  const body = (await response.json().catch(() => null)) as
    | { code?: string; routes?: { distance: number; duration: number; geometry?: { coordinates?: [number, number][] } }[] }
    | null;
  const route = body?.routes?.[0];
  if (!response.ok || body?.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
    // NoRoute / NoSegment: a point is off the road network (sea, far away).
    throw new AppError('No road route was found between these points.', 404, 'ROUTE_NOT_FOUND');
  }
  return {
    distance_m: Math.round(route.distance),
    duration_s: Math.round(route.duration),
    coordinates: route.geometry.coordinates,
  };
}

export const routingRouter = Router();

routingRouter.get('/route', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = routeQuery.parse(req.query);
    const route = await fetchRoute(from, to);
    res.json({ success: true, data: { route } });
  } catch (err) {
    next(err);
  }
});

/**
 * Road order for a rider's trip stops (2026-10-02).
 *
 * POST /api/v1/routing/stop-order   (RIDER, ADMIN, OPERATIONS)
 *   body { from: { lat, lng }, stops: [{ id, lat, lng }] }   (1..5 stops)
 *   -> { stops: [{ id, lat, lng, duration_s, distance_m }], fallback }
 *
 * Asks OSRM's `table` service once for the driving duration/distance between
 * every pair of points, then picks the order. Each stop's duration_s and
 * distance_m are the leg from the previous point (from -> first stop, first
 * -> second, ...).
 *
 * Ordering: exhaustive. With at most 5 stops there are at most 5! = 120 open
 * paths starting at `from`; every one is scored by total driving duration
 * and the smallest wins (ties: shorter total distance, then the order the
 * stops were sent in). That is the true optimum, unlike nearest-next greedy,
 * for a few microseconds of work.
 *
 * Fallback: OSRM unset, unreachable, slower than 2 s, an error reply, or any
 * pair with no road route -> 200 with `fallback: true` and the straight-line
 * order instead (nearest next by great-circle distance, starting at `from`).
 * Then distance_m is the straight-line leg in metres (an estimate, not road
 * distance) and duration_s is null - no time is guessed. The apps treat
 * fallback as "no road data" and keep their own straight-line order.
 */

const point = {
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
};

const stopOrderBody = z.object({
  from: z.object(point),
  stops: z
    .array(z.object({ id: z.string().trim().min(1).max(100), ...point }))
    .min(1)
    .max(5)
    .refine((stops) => new Set(stops.map((s) => s.id)).size === stops.length, 'Stop ids must be unique'),
});

export interface LatLngPoint {
  lat: number;
  lng: number;
}
export interface StopInput extends LatLngPoint {
  id: string;
}
export interface OrderedStop extends StopInput {
  /** Driving seconds from the previous point; null on fallback. */
  duration_s: number | null;
  /** Road metres from the previous point; straight-line metres on fallback. */
  distance_m: number | null;
}
export interface StopOrderResult {
  stops: OrderedStop[];
  fallback: boolean;
}

/** Great-circle distance in metres. */
function haversineM(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line order: nearest next, starting at `from`. */
export function straightLineOrder(from: LatLngPoint, stops: StopInput[]): StopOrderResult {
  const remaining = [...stops];
  const ordered: OrderedStop[] = [];
  let here: LatLngPoint = from;
  while (remaining.length) {
    let pick = 0;
    let best = Number.POSITIVE_INFINITY;
    remaining.forEach((s, i) => {
      const m = haversineM(here, s);
      if (m < best) {
        best = m;
        pick = i;
      }
    });
    const [next] = remaining.splice(pick, 1);
    ordered.push({ ...next, duration_s: null, distance_m: Math.round(best) });
    here = next;
  }
  return { stops: ordered, fallback: true };
}

/** All orderings of [0..n-1], in lexicographic order (the sent order first). */
function permutations(n: number): number[][] {
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (!rest.length) out.push(prefix);
    rest.forEach((v, i) => walk([...prefix, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  walk([], Array.from({ length: n }, (_, i) => i));
  return out;
}

function isMatrix(m: unknown, size: number): m is number[][] {
  return (
    Array.isArray(m) &&
    m.length === size &&
    m.every((row) => Array.isArray(row) && row.length === size && row.every((v) => typeof v === 'number' && Number.isFinite(v)))
  );
}

/** Never throws: any OSRM trouble returns the straight-line order with fallback: true. */
export async function orderStopsByRoad(
  from: LatLngPoint,
  stops: StopInput[],
  osrmUrl: string | undefined = env.OSRM_URL,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000,
): Promise<StopOrderResult> {
  if (!osrmUrl) return straightLineOrder(from, stops);
  const points = [from, ...stops];
  const url =
    `${osrmUrl.replace(/\/+$/, '')}/table/v1/driving/` +
    `${points.map((p) => `${p.lng},${p.lat}`).join(';')}?annotations=duration,distance`;
  let durations: number[][];
  let distances: number[][];
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await response.json()) as { code?: string; durations?: unknown; distances?: unknown } | null;
    // A null cell means OSRM found no road between that pair.
    if (!response.ok || body?.code !== 'Ok' || !isMatrix(body.durations, points.length) || !isMatrix(body.distances, points.length)) {
      logger.warn({ status: response.status, code: body?.code }, 'Routing engine gave no usable table; straight-line stop order');
      return straightLineOrder(from, stops);
    }
    durations = body.durations;
    distances = body.distances;
  } catch (err) {
    logger.warn({ err }, 'Routing engine unreachable or slow; straight-line stop order');
    return straightLineOrder(from, stops);
  }

  let best: { order: number[]; duration: number; distance: number } | null = null;
  for (const order of permutations(stops.length)) {
    let at = 0;
    let duration = 0;
    let distance = 0;
    for (const i of order) {
      duration += durations[at][i + 1];
      distance += distances[at][i + 1];
      at = i + 1;
    }
    if (!best || duration < best.duration || (duration === best.duration && distance < best.distance)) {
      best = { order, duration, distance };
    }
  }
  // Strict "<" keeps the first of equal candidates; permutations() starts at the
  // sent order, so exact ties stay as close to it as possible.
  let at = 0;
  const ordered = best!.order.map((i) => {
    const leg = { duration_s: Math.round(durations[at][i + 1]), distance_m: Math.round(distances[at][i + 1]) };
    at = i + 1;
    return { ...stops[i], ...leg };
  });
  return { stops: ordered, fallback: false };
}

routingRouter.post(
  '/stop-order',
  requireAuth,
  requireRoles('RIDER', 'ADMIN', 'OPERATIONS'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, stops } = stopOrderBody.parse(req.body);
      const result = await orderStopsByRoad(from, stops);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);
