import { useEffect, useState } from 'react';
import type { DeliverySummary } from '../api/types';
import { nextAction } from './delivery';
import { distanceM, toLatLng, type LatLng } from './route';

/**
 * Rider trips (backend migration 021): the store may give a rider - here the
 * operator delivering themselves - two orders for one trip. Each order is
 * still its own delivery, with its own pickup, handover code and cash, so
 * each stop opens the ordinary delivery screen. This only decides the order
 * the stops are shown in. Ported from apps/rider/src/lib/trip.ts (the apps
 * share no package).
 */

export interface TripStop {
  delivery: DeliverySummary;
  /** Straight line from the operator's position, when both are known. */
  distanceM: number | null;
}

/** At the door first, then on the road, then still to collect at the store. */
const GROUP: Record<string, number> = { collect: 0, arrive: 1, pickUp: 2 };

/** A delivery the operator can act on now: part of the trip. */
export const isTripStop = (d: DeliverySummary) => nextAction(d).kind in GROUP;

/**
 * The stops in a sensible order: whatever is at the door, then the drop-offs
 * on the road nearest first (each next stop the nearest to the one before,
 * starting from the operator's position), then orders still to pick up.
 * Without a position the API's order (oldest assignment first) is kept.
 */
export function orderTrip(list: DeliverySummary[], from: LatLng | null): TripStop[] {
  const stops = list.filter(isTripStop);
  const groups = new Map<number, DeliverySummary[]>();
  for (const d of stops) {
    const g = GROUP[nextAction(d).kind];
    groups.set(g, [...(groups.get(g) ?? []), d]);
  }
  const ordered: DeliverySummary[] = [];
  let here = from;
  for (const g of [...groups.keys()].sort()) {
    const remaining = [...groups.get(g)!];
    while (remaining.length) {
      let pick = 0;
      if (here) {
        let best = Number.POSITIVE_INFINITY;
        remaining.forEach((d, i) => {
          const p = toLatLng(d.delivery_latitude, d.delivery_longitude);
          const m = p ? distanceM(here!, p) : Number.POSITIVE_INFINITY;
          if (m < best) {
            best = m;
            pick = i;
          }
        });
      }
      const [next] = remaining.splice(pick, 1);
      ordered.push(next);
      // Stops still at the store are all collected there: no chaining.
      if (g !== GROUP.pickUp) here = toLatLng(next.delivery_latitude, next.delivery_longitude) ?? here;
    }
  }
  return ordered.map((d) => {
    const p = toLatLng(d.delivery_latitude, d.delivery_longitude);
    return { delivery: d, distanceM: from && p ? distanceM(from, p) : null };
  });
}

/** Two or more deliveries to act on make a trip; otherwise null. */
export function tripOf(list: DeliverySummary[], from: LatLng | null): TripStop[] | null {
  return list.filter(isTripStop).length >= 2 ? orderTrip(list, from) : null;
}

/** "650 m away", "2.4 km away". */
export function formatAway(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`;
}

export const owesCash = (d: Pick<DeliverySummary, 'payment_method' | 'payment_status'>) =>
  d.payment_method === 'COD' && d.payment_status === 'PENDING';

/**
 * The device's position, once, for ordering the stops. Null until known, and
 * null for good when there is no GPS or permission - the list then keeps the
 * API's order. Never sent anywhere.
 */
export function useCurrentPosition(enabled: boolean): LatLng | null {
  const [position, setPosition] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (!cancelled) setPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
        },
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 }
      );
    } catch {
      // No usable GPS: keep the API's order.
    }
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return position;
}
