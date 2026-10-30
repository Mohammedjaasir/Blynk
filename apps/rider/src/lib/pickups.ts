import { useEffect, useRef, useState } from 'react';
import { deliveriesApi } from '../api/resources';
import type { DeliverySummary, PickupPoint } from '../api/types';
import { toLatLng, type LatLng } from './route';

/**
 * Seller orders (owner, 2026-10-30): the rider must know WHERE to collect the
 * goods. The backend sends `pickups` on the delivery detail: the Blynk store
 * and/or each seller's approved shop (name, address, how to find it, phone,
 * and whether the seller has marked the order ready). Pure helpers first, so
 * they are tested without a screen.
 */

export const STORE_NAME = 'Blynk store';
export const READY_TEXT = 'Ready for pick-up';
export const PREPARING_TEXT = 'The seller is still preparing this order';
export const WAIT_FOR_SELLER_NOTE = 'Wait for the seller to mark it ready before leaving.';
export const WAIT_FOR_STORE_NOTE = "The store hasn't packed this order yet. Wait for it before leaving.";

export const sellerPickups = (pickups: PickupPoint[] | undefined): PickupPoint[] =>
  (pickups ?? []).filter((p) => p.kind === 'SELLER');

/** The store is always ready; an older API that sends no flag is read as ready. */
export const isPickupReady = (p: PickupPoint): boolean => p.kind === 'STORE' || p.ready !== false;

export function pickupName(p: PickupPoint): string {
  const name = p.shop_name?.trim();
  if (name) return name;
  return p.kind === 'STORE' ? STORE_NAME : 'The seller';
}

/** The place of the shop on the map, or null when the pin is missing or junk. */
export const pickupLatLng = (p: PickupPoint): LatLng | null => toLatLng(p.lat, p.lng);

/** The seller pickup the map draws the shop -> customer leg from: the first one with a usable pin. */
export function mapPickup(pickups: PickupPoint[] | undefined): { point: PickupPoint; at: LatLng } | null {
  for (const point of sellerPickups(pickups)) {
    const at = pickupLatLng(point);
    if (at) return { point, at };
  }
  return null;
}

/**
 * What an order that is not packed yet says: the seller's shop makes it
 * ready, the Blynk store packs the rest. A seller order that is still being
 * prepared never blames "the store".
 */
export function beingPackedNote(pickups: PickupPoint[] | undefined): string {
  const waiting = sellerPickups(pickups).some((p) => !isPickupReady(p));
  const store = (pickups ?? []).some((p) => p.kind === 'STORE');
  return waiting && !store ? WAIT_FOR_SELLER_NOTE : WAIT_FOR_STORE_NOTE;
}

/**
 * The one-line pickup hint on the deliveries list: "At <shop>" while the
 * seller is still preparing, green "Ready at <shop>" once it is ready. Null
 * for a store-only order.
 */
export function pickupListLine(pickups: PickupPoint[] | undefined): { text: string; ready: boolean } | null {
  const sellers = sellerPickups(pickups);
  if (sellers.length === 0) return null;
  const waiting = sellers.filter((p) => !isPickupReady(p));
  if (waiting.length > 0) return { text: `At ${waiting.map(pickupName).join(', ')}`, ready: false };
  return { text: `Ready at ${sellers.map(pickupName).join(', ')}`, ready: true };
}

/** The list has to know the pickups only while the rider still has to collect the goods. */
const needsPickups = (d: DeliverySummary) =>
  (d.assignment_status === 'ASSIGNED' || d.assignment_status === 'ACCEPTED') &&
  (d.order_status === 'PLACED' || d.order_status === 'PACKED');

/**
 * Pickups for the deliveries list. When the list endpoint already carries
 * them they win; otherwise each delivery still to collect asks for its detail
 * once (again when its order status changes, e.g. the seller marks it ready).
 * Best effort: a failed ask just leaves the line out.
 */
export function usePickups(list: DeliverySummary[] | null): Map<string, PickupPoint[]> {
  const [fetched, setFetched] = useState<Record<string, { pickups: PickupPoint[] }>>({});
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    for (const d of list ?? []) {
      if (d.pickups || !needsPickups(d)) continue;
      const key = `${d.delivery_id}:${d.order_status}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      deliveriesApi
        .detail(d.delivery_id)
        .then((detail) => {
          if (alive.current) {
            setFetched((prev) => ({ ...prev, [d.delivery_id]: { pickups: detail.pickups ?? [] } }));
          }
        })
        .catch(() => {
          asked.current.delete(key); // ask again on the next refresh
        });
    }
  }, [list]);

  const out = new Map<string, PickupPoint[]>();
  for (const d of list ?? []) {
    // A stale answer stays on screen until the fresh one arrives (no flicker).
    const known = d.pickups ?? fetched[d.delivery_id]?.pickups;
    if (known) out.set(d.delivery_id, known);
  }
  return out;
}
