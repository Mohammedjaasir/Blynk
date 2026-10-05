import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client';
import type { DeliverySummary } from '../api/types';
import { nextAction } from './delivery';
import { distanceM, toLatLng, type LatLng } from './route';

/**
 * Rider trips (2026-09-30): the store may give a rider two orders for one
 * trip. Each order is still its own delivery - its own pickup, handover code
 * and cash - so each stop opens the ordinary delivery screen. This only
 * decides the order to show the stops in.
 */

export interface TripStop {
  delivery: DeliverySummary;
  /** Straight line from the rider's position, when both are known. */
  distanceM: number | null;
  /**
   * Whole minutes by road from the previous point (rounded up), for stops on
   * the road when the road order is known; otherwise null.
   */
  roadMin: number | null;
}

/** One stop of POST /routing/stop-order's answer, in road order. */
export interface RoadLeg {
  id: string;
  /** Driving seconds from the previous point (the rider, then each stop). */
  duration_s: number | null;
  distance_m: number | null;
}

/** The road order for the stops on the road (never a fallback answer). */
export interface RoadOrder {
  stops: RoadLeg[];
}

/** At the door first, then on the road, then still to collect at the store. */
const GROUP: Record<string, number> = { collect: 0, arrive: 1, pickUp: 2 };

/** A delivery the rider can act on now: part of the trip. */
export const isTripStop = (d: DeliverySummary) => nextAction(d).kind in GROUP;

/** The stops on the road that have a location: what is sent for a road order. */
export function roadStopsOf(list: DeliverySummary[]): { id: string; lat: number; lng: number }[] {
  return list
    .filter((d) => isTripStop(d) && GROUP[nextAction(d).kind] === GROUP.arrive)
    .flatMap((d) => {
      const p = toLatLng(d.delivery_latitude, d.delivery_longitude);
      return p ? [{ id: d.delivery_id, ...p }] : [];
    });
}

/** True when `road` answers exactly the stops on the road in `list` now. */
function roadFits(list: DeliverySummary[], road: RoadOrder | null): road is RoadOrder {
  if (!road) return false;
  const now = roadStopsOf(list).map((s) => s.id);
  return now.length === road.stops.length && road.stops.every((s) => now.includes(s.id));
}

/**
 * The stops in a sensible order: whatever is at the door, then the drop-offs
 * on the road, then orders still to pick up. On the road, the road order from
 * the API (lib/trip useRoadOrder) when there is one; otherwise nearest first
 * in a straight line (each next stop the nearest to the one before, starting
 * from the rider's position). Without a position the API's order (oldest
 * assignment first) is kept.
 */
export function orderTrip(list: DeliverySummary[], from: LatLng | null, road: RoadOrder | null = null): TripStop[] {
  const byRoad = roadFits(list, road) ? road : null;
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
    if (g === GROUP.arrive && byRoad) {
      // Road order; a stop without a location (not sent) keeps its place after.
      const rank = (d: DeliverySummary) => {
        const i = byRoad.stops.findIndex((s) => s.id === d.delivery_id);
        return i < 0 ? byRoad.stops.length : i;
      };
      remaining.sort((a, b) => rank(a) - rank(b));
      ordered.push(...remaining);
      const last = remaining[remaining.length - 1];
      here = toLatLng(last.delivery_latitude, last.delivery_longitude) ?? here;
      continue;
    }
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
    const leg = byRoad?.stops.find((s) => s.id === d.delivery_id);
    const roadMin = leg && typeof leg.duration_s === 'number' ? Math.max(1, Math.ceil(leg.duration_s / 60)) : null;
    return { delivery: d, distanceM: from && p ? distanceM(from, p) : null, roadMin };
  });
}

/** "about 6 min by road". */
export const formatByRoad = (min: number) => `about ${min} min by road`;

/** The API's road order (OSRM), or null when it fell back to a straight line. */
export async function fetchStopOrder(
  from: LatLng,
  stops: { id: string; lat: number; lng: number }[]
): Promise<RoadOrder | null> {
  const r = await apiRequest<{ stops: RoadLeg[]; fallback: boolean }>('/routing/stop-order', {
    method: 'POST',
    body: { from: { lat: from.lat, lng: from.lng }, stops },
  });
  return r.fallback ? null : { stops: r.stops };
}

/** Ask for a new road order only after moving this far (metres), or when the stops change. */
export const ROAD_REORDER_AFTER_M = 200;
/** The API takes at most this many stops; more keeps the straight-line order. */
const ROAD_MAX_STOPS = 5;

/**
 * The road order for the stops on the road, from the rider's position. Asked
 * again only when the set of stops changes or the rider has moved more than
 * ROAD_REORDER_AFTER_M - never on every GPS fix. Null while unknown, on any
 * error, and when the API fell back to a straight line: the list then keeps
 * the straight-line order and shows no road times.
 */
export function useRoadOrder(list: DeliverySummary[] | null, from: LatLng | null, enabled: boolean): RoadOrder | null {
  const stops = list ? roadStopsOf(list) : [];
  const key = stops
    .map((s) => `${s.id}@${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)
    .sort()
    .join('|');
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const asked = useRef<{ key: string; from: LatLng } | null>(null);
  const [answer, setAnswer] = useState<{ key: string; road: RoadOrder | null } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const lat = from?.lat;
  const lng = from?.lng;
  useEffect(() => {
    if (!enabled || lat === undefined || lng === undefined || !key || stopsRef.current.length > ROAD_MAX_STOPS) return;
    const here = { lat, lng };
    const last = asked.current;
    if (last && last.key === key && distanceM(last.from, here) < ROAD_REORDER_AFTER_M) return;
    const mine = { key, from: here };
    asked.current = mine;
    // No cleanup-cancel: a small GPS move re-runs this effect without asking
    // again, and must not drop the answer already on its way.
    fetchStopOrder(here, stopsRef.current)
      .catch(() => null)
      .then((road) => {
        if (mounted.current && asked.current === mine) setAnswer({ key, road });
      });
  }, [enabled, key, lat, lng]);

  return enabled && answer && answer.key === key ? answer.road : null;
}

/** "650 m away", "2.4 km away". */
export function formatAway(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`;
}

/**
 * The phone's position, once, for ordering the stops. Null until known, and
 * null for good when there is no GPS or permission - the list then keeps the
 * API's order. Sent only to the Blynk API for the road order
 * (POST /routing/stop-order); never stored.
 */
export function useRiderPosition(enabled: boolean): LatLng | null {
  const [position, setPosition] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
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
