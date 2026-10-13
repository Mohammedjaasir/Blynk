/*
 * The rider's live point, the road route and the words under the map, as the Flutter shop has
 * them (Models/rider_location_model.dart, rider_route_model.dart, rider_heading.dart,
 * UI/Widgets/Organisms/order_tracking_map.dart). Nothing here is ever guessed: a malformed
 * point or route is dropped, and the time to the door comes only from the server's route.
 */

export type RiderPoint = {
  lat: number;
  lng: number;
  /** Metres; null when the rider's phone reported none. */
  accuracy: number | null;
  capturedAt: number;
  receivedAt: number;
};

export type RiderRoute = {
  /** [lat, lng] pairs from the rider to the door. */
  points: [number, number][];
  distanceM: number;
  durationS: number;
  computedAt: number;
};

export type Freshness = 'live' | 'stale' | 'offline';

/** LIVE up to 18 s old, STALE up to 2 min, OFFLINE beyond (server timestamps). */
export const LIVE_WINDOW_MS = 18_000;
export const STALE_CEILING_MS = 120_000;

export function classifyFreshness(capturedAt: number, now: number): Freshness {
  const age = now - capturedAt;
  if (age <= LIVE_WINDOW_MS) return 'live';
  if (age <= STALE_CEILING_MS) return 'stale';
  return 'offline';
}

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** A full ISO timestamp with real date parts, as milliseconds; null otherwise. */
export function isoTime(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = ISO.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  if (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** The SSE `location` event's data, or null when anything is missing or out of range. */
export function parsePoint(raw: unknown): RiderPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const lat = finite(j.latitude);
  const lng = finite(j.longitude);
  const acc = finite(j.accuracy);
  const capturedAt = isoTime(j.captured_at);
  const receivedAt = isoTime(j.received_at);
  if (lat === null || lng === null || capturedAt === null || receivedAt === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, accuracy: acc !== null && acc > 0 ? acc : null, capturedAt, receivedAt };
}

/** GET /orders/:id/route data.route ({coordinates: [[lng, lat]...], distance_m, duration_s, computed_at}). */
export function parseRoute(raw: unknown): RiderRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  const coords = j.coordinates;
  const distance = j.distance_m;
  const duration = j.duration_s;
  const computedAt = typeof j.computed_at === 'string' ? Date.parse(j.computed_at) : NaN;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (typeof distance !== 'number' || typeof duration !== 'number' || !Number.isFinite(distance) || !Number.isFinite(duration)) return null;
  if (distance < 0 || duration < 0 || !Number.isFinite(computedAt)) return null;
  const points: [number, number][] = [];
  for (const p of coords) {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    const [lng, lat] = p as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    points.push([lat, lng]);
  }
  return { points, distanceM: Math.round(distance), durationS: Math.round(duration), computedAt };
}

/** "Arriving in ~6 min": whole minutes, rounded up, never below 1. */
export function arrivingText(durationS: number): string {
  const minutes = durationS <= 0 ? 1 : Math.ceil(durationS / 60);
  return `Arriving in ~${minutes} min`;
}

/** "Last seen 45 seconds ago" / "Last seen 2 minutes ago"; never negative. */
export function lastSeenText(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s <= 0) return 'Last seen just now';
  if (s < 60) return `Last seen ${s} ${s === 1 ? 'second' : 'seconds'} ago`;
  const m = Math.floor(s / 60);
  return `Last seen ${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
}

export const UNAVAILABLE_TEXT = 'Live location unavailable right now.';

/* ------------------------------------------------------------------ heading */

/** The rider must move this far before the arrow turns (GPS jitter). */
export const HEADING_MIN_MOVE_M = 8;
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/* ------------------------------------------------------------------ view */

export type TrackingView = {
  /** Draw the rider (a live or stale point that is not offline, on an open stream). */
  riderVisible: boolean;
  rider: RiderPoint | null;
  freshness: Freshness | null;
  heading: number | null;
  /** The road line, only while the rider is on the map. */
  route: [number, number][];
  /** "Arriving in ~N min", only for a LIVE rider with a server route. */
  eta: string | null;
  /** Under-map words: "Live", "Last seen ...", or the unavailable line. */
  caption: { live: boolean; text: string };
};

/** Everything the map and its captions draw, from the stream state and the route (Flutter's TrackingSnapshot). */
export function trackingView(
  s: { current: RiderPoint | null; heading: number | null; closed: boolean; unavailable: boolean },
  route: RiderRoute | null,
  now: number,
): TrackingView {
  const freshness = s.current ? classifyFreshness(s.current.capturedAt, now) : null;
  const riderVisible = !!s.current && !!freshness && freshness !== 'offline' && !s.closed && !s.unavailable;
  const live = riderVisible && freshness === 'live';
  const caption = live
    ? { live: true, text: 'Live' }
    : riderVisible && freshness === 'stale' && s.current
      ? { live: false, text: lastSeenText(now - s.current.capturedAt) }
      : { live: false, text: UNAVAILABLE_TEXT };
  return {
    riderVisible,
    rider: riderVisible ? s.current : null,
    freshness,
    heading: riderVisible ? s.heading : null,
    route: riderVisible && route ? route.points : [],
    eta: live && route ? arrivingText(route.durationS) : null,
    caption,
  };
}
