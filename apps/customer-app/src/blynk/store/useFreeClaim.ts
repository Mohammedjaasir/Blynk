import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useDeliveryLocation } from '../address/store';
import { useSession } from '../auth/session';
import { freeDeliveryCount } from '../lib/storeText';
import { getCheckoutInfo } from '../orders/api';
import type { FreeDeliveryStatus } from '../orders/types';
import { useStore } from './StoreContext';
import { freeDeliveryClaim, type FreeClaim } from './freeClaim';
import { DEMO } from '@/demo/mode';

/*
 * This customer's free deliveries (GET /orders/checkout-info `free_delivery`), cached per
 * user + address so Home never waits on it. Refreshed when a screen using it gains focus
 * (at most every 30 s), on sign-in / address change, and right after an order is placed
 * (invalidateFreeClaim). Signed out it is never asked for.
 */
type Entry = { key: string; status: FreeDeliveryStatus | null; at: number };
let entry: Entry | null = null;
let inflight: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => entry;
const FRESH_MS = 30_000;

function refresh(key: string, addressId: string, force = false) {
  if (inflight === key) return;
  if (!force && entry?.key === key && Date.now() - entry.at < FRESH_MS) return;
  inflight = key;
  getCheckoutInfo(addressId, 0)
    .then((info) => { entry = { key, status: info.free_delivery ?? null, at: Date.now() }; })
    // a failed ask keeps the last known answer for this key (or claims nothing)
    .catch(() => { if (entry?.key !== key) entry = { key, status: null, at: Date.now() - FRESH_MS + 5_000 }; })
    .finally(() => { if (inflight === key) inflight = null; emit(); });
}

/** After an order is placed (or anything else that may use a free delivery): ask again next time. */
export function invalidateFreeClaim() {
  if (entry) entry = { ...entry, at: 0 };
  emit();
}

/** What Home and the cart bar may say about free deliveries right now (see freeClaim.ts). */
export function useFreeClaim(): FreeClaim {
  const store = useStore();
  const session = useSession();
  const { address } = useDeliveryLocation();
  const me = session?.user.id ?? null;
  const addressId = address?.id ?? null;
  const key = me && addressId ? `${me}|${addressId}` : null;
  const cached = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!DEMO && key && addressId) refresh(key, addressId);
  }, [key, addressId, cached?.at]);
  useFocusEffect(useCallback(() => {
    if (!DEMO && key && addressId) refresh(key, addressId);
  }, [key, addressId]));

  const storeCount = freeDeliveryCount(store);
  const status = key && cached?.key === key ? cached.status : null;
  return useMemo(() => freeDeliveryClaim({ storeCount, signedIn: !!me, status }), [storeCount, me, status]);
}

export function __resetFreeClaimForTests() { entry = null; inflight = null; }
