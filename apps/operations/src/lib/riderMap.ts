import type { LiveRider, LiveRiderMap, LiveWaitingOrder } from '../api/types';

/**
 * Words and rules for the Rider map (owner, 2026-10-25). The server decides who is free, who is
 * on a trip and how old a position is; this only phrases it and picks the colours.
 */

/** Refresh every 15 s while the screen is on and visible. */
export const RIDER_MAP_REFRESH_MS = 15_000;
/** A position older than this is "stale" (grey): the rider may have moved on. */
export const STALE_AFTER_SECONDS = 180;

export type RiderTone = 'free' | 'trip' | 'stale';

export const TONE_LABEL: Record<RiderTone, string> = { free: 'Free', trip: 'On a trip', stale: 'Not seen lately' };

/** Colours as the legend and the dots use them (brand yellow stays for the store). */
export const TONE_COLOR: Record<RiderTone, string> = { free: '#0c831f', trip: '#1d6fe0', stale: '#8a8f9c' };
export const ORDER_COLOR = { waiting: '#d92d20', assigned: '#12151f' } as const;

/** The dot's colour state: grey when the last point is older than 3 minutes, else free or on a trip. */
export function riderTone(r: Pick<LiveRider, 'status' | 'position'>): RiderTone {
  if (!r.position || r.position.age_seconds > STALE_AFTER_SECONDS) return 'stale';
  return r.status === 'ON_TRIP' ? 'trip' : 'free';
}

export const riderName = (r: Pick<LiveRider, 'full_name' | 'phone'>) => r.full_name?.trim() || r.phone || 'Rider';

/** "FM" for Farhan Mohamed, "F" for one word, "?" when nothing is known. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

/** "just now", "40 s ago", "3 min ago", "1 h 5 min ago". */
export function ageText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min ago` : `${h} h ago`;
}

/** "2 min", "45 s": how long an order has waited. */
export function waitText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Straight-line km (the same measure the API's trip rules use). */
export function kmBetween(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const kmText = (km: number) => (km < 0.1 ? 'right there' : `${km.toFixed(1)} km`);

/** Where a rider stands on the map, or null. */
export const riderPoint = (r: Pick<LiveRider, 'position'>): LatLng | null => (r.position ? { lat: r.position.lat, lng: r.position.lng } : null);

export interface RiderOrderOption {
  rider: LiveRider;
  tone: RiderTone;
  /** Straight line from the rider's last point to the order's drop-off; null when either is unknown. */
  km: number | null;
  /** Under the trip cap, so the assign call can succeed. */
  canTake: boolean;
}

/** Riders for one order, those who can take it first, then the nearest. */
export function ridersForOrder(order: LiveWaitingOrder, riders: LiveRider[]): RiderOrderOption[] {
  return riders
    .map((rider) => {
      const at = riderPoint(rider);
      return {
        rider,
        tone: riderTone(rider),
        km: at && order.dropoff ? kmBetween(at, order.dropoff) : null,
        canTake: rider.capacity_left > 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.canTake) - Number(a.canTake) ||
        (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY) ||
        riderName(a.rider).localeCompare(riderName(b.rider))
    );
}

/** The waiting orders a rider could take, nearest to the rider's last point first. */
export function ordersForRider(rider: LiveRider, orders: LiveWaitingOrder[]): { order: LiveWaitingOrder; km: number | null }[] {
  const at = riderPoint(rider);
  return orders
    .map((order) => ({ order, km: at && order.dropoff ? kmBetween(at, order.dropoff) : null }))
    .sort((a, b) => (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY) || b.order.waiting_seconds - a.order.waiting_seconds);
}

/** Every point worth fitting on screen: the store, riders with a position, and the orders' drop-offs. */
export function allPoints(data: LiveRiderMap): LatLng[] {
  const pts: LatLng[] = [];
  if (data.store) pts.push({ lat: data.store.lat, lng: data.store.lng });
  for (const r of data.riders) {
    const p = riderPoint(r);
    if (p) pts.push(p);
    for (const d of r.deliveries) if (d.dropoff) pts.push(d.dropoff);
  }
  for (const o of data.unassigned_orders) if (o.dropoff) pts.push(o.dropoff);
  return pts;
}

/** Riders on the list but not on the map (never reported a position). */
export const ridersWithoutPosition = (data: LiveRiderMap) => data.riders.filter((r) => !r.position);

/** One line for the screen's top: "2 riders free, 1 on a trip, 3 orders waiting". */
export function summaryText(data: LiveRiderMap): string {
  const free = data.riders.filter((r) => r.status === 'FREE').length;
  const trip = data.riders.length - free;
  const waiting = data.unassigned_orders.length;
  return `${plural(free, 'rider')} free, ${trip} on a trip, ${plural(waiting, 'order')} waiting`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The words for the refusals an "Assign here" can meet; anything else uses the API's own message. */
export const ASSIGN_REFUSALS: Record<string, string> = {
  RIDER_AT_CAPACITY: 'This rider already carries as many orders as one trip allows.',
  ORDER_ALREADY_ASSIGNED: 'Another rider just took this order.',
  ORDER_NOT_READY_FOR_ASSIGNMENT: 'This order is no longer waiting for a rider.',
};
