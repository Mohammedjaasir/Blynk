import { useSyncExternalStore } from 'react';
import { ApiError } from '@/blynk/api/client';
import type { StoreInfo } from '@/blynk/api/types';

/*
 * Ratings + rider tips (migration 055) and product requests (migration 056) arrive with their
 * migrations, which staff run by hand (docs/superpowers/plans/2026-10-24-groups-ratings-requests.md).
 * Each one shows only while GET /store says it is on (`ratings_enabled`, `product_requests_enabled`;
 * missing on an older server = off) and the API has not answered its 503 `<FEATURE>_NOT_READY`
 * during this run of the app (then it hides until the next start).
 */

export type Feature = 'ratings' | 'requests';

const FLAG: Record<Feature, string> = { ratings: 'ratings_enabled', requests: 'product_requests_enabled' };
const NOT_READY: Record<Feature, string> = { ratings: 'RATINGS_NOT_READY', requests: 'PRODUCT_REQUESTS_NOT_READY' };

/** What GET /store says (null store or a missing flag = off). */
export function storeSaysOn(store: StoreInfo | null | undefined, feature: Feature): boolean {
  if (!store) return false;
  return (store as unknown as Record<string, unknown>)[FLAG[feature]] === true;
}

/** A 503 `*_NOT_READY` (its own code, or any `_NOT_READY` code this feature's endpoint sent). */
export function isNotReady(e: unknown, feature?: Feature): boolean {
  if (!(e instanceof ApiError) || e.status !== 503 || !e.code) return false;
  return feature ? e.code === NOT_READY[feature] || e.code.endsWith('_NOT_READY') : e.code.endsWith('_NOT_READY');
}

const off = new Set<Feature>();
const listeners = new Set<() => void>();
let version = 0;

/** The API said the feature is not ready: hide it for the rest of this run. */
export function markNotReady(feature: Feature) {
  if (off.has(feature)) return;
  off.add(feature);
  version++;
  listeners.forEach((l) => l());
}

/** Call from a catch: a NOT_READY answer turns the feature off. True when it did. */
export function noteNotReady(e: unknown, feature: Feature): boolean {
  if (!isNotReady(e, feature)) return false;
  markNotReady(feature);
  return true;
}

export const featureOn = (store: StoreInfo | null | undefined, feature: Feature): boolean => storeSaysOn(store, feature) && !off.has(feature);

/** Tests only. */
export function resetFeatureGate() { off.clear(); version++; listeners.forEach((l) => l()); }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snap = () => version;

/** Re-renders when a feature is switched off by a NOT_READY answer. */
export function useFeatureOn(store: StoreInfo | null | undefined, feature: Feature): boolean {
  useSyncExternalStore(subscribe, snap, snap);
  return featureOn(store, feature);
}
