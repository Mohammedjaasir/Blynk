import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
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
