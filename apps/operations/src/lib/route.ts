import { apiRequest } from '../api/client';

/**
 * Delivery route helpers (2026-09-28). Pure pieces behind DeliveryMap, kept
 * here so they are tested without a WebGL map.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoadRoute {
  distance_m: number;
  duration_s: number;
  /** GeoJSON order: [longitude, latitude]. */
  coordinates: [number, number][];
}

/** The worldwide, free, keyless map style (OpenFreeMap, open source). */
export const MAP_STYLE_URL: string =
  (import.meta.env?.VITE_MAP_STYLE_URL as string | undefined) || 'https://tiles.openfreemap.org/styles/liberty';

/** Re-ask for a route only after moving this far (metres) - not every GPS fix. */
export const REROUTE_AFTER_M = 75;

/** A coordinate from the API (NUMERIC columns can arrive as strings), or null. */
export function toLatLng(lat: unknown, lng: unknown): LatLng | null {
  const a = typeof lat === 'string' ? Number(lat) : lat;
  const b = typeof lng === 'string' ? Number(lng) : lng;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  if (a === 0 && b === 0) return null; // "no location" placeholder, never a real address here
  return { lat: a, lng: b };
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** True when the rider has moved far enough from where the last route began. */
export function shouldReroute(lastFrom: LatLng | null, now: LatLng): boolean {
  return lastFrom === null || distanceM(lastFrom, now) >= REROUTE_AFTER_M;
}

/** "2.4 km · 9 min" (or "650 m · 3 min"). */
export function formatRouteSummary(route: Pick<RoadRoute, 'distance_m' | 'duration_s'>): string {
  const d = route.distance_m < 1000 ? `${Math.round(route.distance_m)} m` : `${(route.distance_m / 1000).toFixed(1)} km`;
  const minutes = Math.max(1, Math.round(route.duration_s / 60));
  return `${d} · ${minutes} min`;
}

/** The road route from the Blynk API (which asks the self-hosted OSRM). */
export async function fetchRoadRoute(from: LatLng, to: LatLng): Promise<RoadRoute> {
  const q = `from=${from.lat.toFixed(6)},${from.lng.toFixed(6)}&to=${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
  return (await apiRequest<{ route: RoadRoute }>(`/routing/route?${q}`)).route;
}
