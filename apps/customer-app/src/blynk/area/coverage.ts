import type { StoreInfo } from '@/blynk/api/types';
import { townFromHub } from '@/blynk/address/forms';
import { CENTRE_PLACE_ID, CLOCK_TOWER, FALLBACK_RADIUS_KM, PLACES, type LatLng, type Place } from './places';

/*
 * The delivery area: the circle around the active dark store (GET /store radius_km and
 * store_location), the named places with their distance from it, and the area list's pin
 * placement. Everything here is advisory - for drawing and for guiding the customer; the
 * address book and checkout refuse an address outside the zone (422 DELIVERY_OUTSIDE_RADIUS).
 */

export type Coverage = {
  center: LatLng;
  radiusKm: number;
  /** true when both the centre and the radius came from GET /store (not the fallback). */
  fromServer: boolean;
  /** "Clock Tower" while the store is at the Dharga Town Clock Tower, else null. */
  landmark: string | null;
  /** The store's town, from the hub name ("Dharga Town"). */
  town: string;
};

export type PlaceAt = Place & { km: number; inside: boolean };

const R_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export const validLatLng = (p: unknown): p is LatLng => {
  const q = p as LatLng | null | undefined;
  return !!q && typeof q.lat === 'number' && typeof q.lng === 'number' && Number.isFinite(q.lat) && Number.isFinite(q.lng)
    && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180;
};

/** Great-circle distance in km (the same haversine the server's isWithinDeliveryRadius uses). */
export function kmBetween(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0 = north, clockwise, degrees. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The delivery area from GET /store, or the Clock Tower and 4 km until it answers. */
export function coverageOf(store: Pick<StoreInfo, 'radius_km' | 'store_location' | 'hub_name'> | null | undefined): Coverage {
  const loc = store?.store_location;
  const centerOk = validLatLng(loc);
  const r = Number(store?.radius_km);
  const radiusOk = Number.isFinite(r) && r > 0 && r <= 100;
  const center = centerOk ? { lat: loc.lat, lng: loc.lng } : { ...CLOCK_TOWER };
  return {
    center,
    radiusKm: radiusOk ? r : FALLBACK_RADIUS_KM,
    fromServer: centerOk && radiusOk,
    landmark: kmBetween(center, CLOCK_TOWER) <= 0.15 ? 'Clock Tower' : null,
    town: townFromHub(store?.hub_name),
  };
}

/** "Clock Tower, Dharga Town", or just the town when the store is elsewhere. */
export const centreName = (c: Coverage) => (c.landmark ? `${c.landmark}, ${c.town}` : c.town);

/** "1.4 km" under 10 km, "11 km" from 10 km. */
export function kmText(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 0.05) return '0 km';
  return km < 10 ? `${(Math.round(km * 10) / 10).toFixed(1)} km` : `${Math.round(km)} km`;
}

/** The radius as people say it: "4 km", "3.5 km". */
export function radiusText(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return '';
  const r = Math.round(km * 10) / 10;
  return Number.isInteger(r) ? `${r} km` : `${r.toFixed(1)} km`;
}

/** Every named place with its distance from the store and whether it is inside the radius, nearest first. */
export function placesAround(c: Coverage, places: readonly Place[] = PLACES): PlaceAt[] {
  return places
    .map((p) => {
      const km = kmBetween(c.center, p);
      return { ...p, km, inside: km <= c.radiusKm };
    })
    .sort((a, b) => a.km - b.km);
}

/**
 * "Choose your area": the store's own town first, then the listed places inside the radius
 * (nearest first), then the listed places outside it, which the list shows as not delivered to.
 */
export function deliveryAreas(c: Coverage, places: readonly Place[] = PLACES): { inside: PlaceAt[]; outside: PlaceAt[] } {
  const all = placesAround(c, places).filter((p) => p.listed || !p.inside);
  const centre = all.filter((p) => p.id === CENTRE_PLACE_ID && p.inside);
  const rest = all.filter((p) => p.id !== CENTRE_PLACE_ID);
  return {
    inside: [...centre, ...rest.filter((p) => p.inside && p.listed)],
    outside: rest.filter((p) => !p.inside),
  };
}

/** Where the pin starts for a picked area: its centre (the customer fine-tunes it on the map). */
export const pinForArea = (area: Pick<Place, 'lat' | 'lng'>): LatLng => ({ lat: area.lat, lng: area.lng });

/**
 * A spot we made up rather than one the customer chose: the store itself or the middle of a listed
 * area (where the map opens without a GPS fix). An address must never be saved there untouched
 * (owner, 2026-10-22: "they must add the address only ... take their device location or choose from the map").
 */
export function isDefaultPin(c: Coverage, p: LatLng, places: readonly Place[] = PLACES): boolean {
  if (!validLatLng(p)) return true;
  return kmBetween(c.center, p) <= DEFAULT_PIN_KM || places.some((q) => kmBetween(q, p) <= DEFAULT_PIN_KM);
}
const DEFAULT_PIN_KM = 0.03;

/** Is this spot inside the drawn circle? Advisory only (the server decides). */
export function insideCoverage(c: Coverage, p: LatLng): { inside: boolean; km: number } {
  const km = kmBetween(c.center, p);
  return { inside: km <= c.radiusKm, km };
}

/** The nearest listed place within `maxKm` of a spot ("Near Aluthgama"), or null. */
export function nearestPlace(c: Coverage, p: LatLng, maxKm = 1.2, places: readonly Place[] = PLACES): PlaceAt | null {
  let best: PlaceAt | null = null;
  for (const q of places) {
    if (!q.listed) continue;
    const d = kmBetween(p, q);
    if (d <= maxKm && (!best || d < kmBetween(p, best))) best = { ...q, km: kmBetween(c.center, q), inside: kmBetween(c.center, q) <= c.radiusKm };
  }
  return best;
}

/** The point `km` away from `from` on `bearingDeg` (for the circle outline). */
export function destination(from: LatLng, km: number, bearingDeg: number): LatLng {
  const d = km / R_KM;
  const b = rad(bearingDeg);
  const lat1 = rad(from.lat);
  const lng1 = rad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** The radius as a closed GeoJSON ring ([lng, lat] pairs) for the map picker's overlay. */
export function circleRing(c: Coverage, steps = 72): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(c.center, c.radiusKm, (360 * i) / steps);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/**
 * A flat projection around the store for the drawn map: km east/north of the centre, then
 * pixels. Good to well under 1% at this size.
 */
export function toKm(c: Coverage, p: LatLng): { x: number; y: number } {
  return {
    x: (p.lng - c.center.lng) * 111.32 * Math.cos(rad(c.center.lat)),
    y: (p.lat - c.center.lat) * 110.574,
  };
}

export type Frame = { width: number; height: number; cx: number; cy: number; pxPerKm: number };

/** Fit the circle (plus a margin of `pad` x the radius) into a width x height drawing. */
export function frameFor(c: Coverage, width: number, height: number, pad = 1.32): Frame {
  return { width, height, cx: width / 2, cy: height / 2, pxPerKm: Math.min(width, height) / (2 * c.radiusKm * pad) };
}

export function project(c: Coverage, f: Frame, p: LatLng): { x: number; y: number } {
  const k = toKm(c, p);
  return { x: f.cx + k.x * f.pxPerKm, y: f.cy - k.y * f.pxPerKm };
}

/** Is a projected point inside the drawing (with an inset margin)? */
export const inFrame = (f: Frame, pt: { x: number; y: number }, inset = 6) =>
  pt.x >= inset && pt.x <= f.width - inset && pt.y >= inset && pt.y <= f.height - inset;

/** Where a ray from the centre towards `pt` leaves the drawing (for an off-map arrow), inset. */
export function edgePoint(f: Frame, pt: { x: number; y: number }, inset = 14): { x: number; y: number } {
  const dx = pt.x - f.cx;
  const dy = pt.y - f.cy;
  const sx = dx === 0 ? Infinity : (dx > 0 ? f.width - inset - f.cx : inset - f.cx) / dx;
  const sy = dy === 0 ? Infinity : (dy > 0 ? f.height - inset - f.cy : inset - f.cy) / dy;
  const s = Math.min(sx, sy);
  return { x: f.cx + dx * s, y: f.cy + dy * s };
}
