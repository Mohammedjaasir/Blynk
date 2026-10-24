import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { DEMO } from '@/demo/mode';
import { fetchBuyAgain, listBaskets } from './api';
import { useRepeatOn } from './gate';
import type { BuyAgainEntry, RepeatBasket } from './models';
import { repeatErrorText } from './payload';

/* ---------------------------------------------------------------- buy again */

/* The last answer per customer, so coming back to Home shows the rail at once while it re-asks. */
let buyCache: { userId: string; data: BuyAgainEntry[] | 'failed' } | null = null;

/**
 * GET /me/buy-again for the signed-in customer, asked again whenever the screen comes into focus
 * (back from a delivered order, signing in). null while unknown, 'failed' when the call failed
 * with nothing cached (an older API without the endpoint). Nothing for a guest or the design mock.
 */
export function useBuyAgain(): { signedIn: boolean; entries: BuyAgainEntry[] | null | 'failed' } {
  const session = useSession();
  const userId = session && !needsRegistration(session) ? session.user.id : null;
  const [state, setState] = useState(buyCache);
  const load = useCallback(() => {
    if (DEMO || !userId) return;
    const ctrl = new AbortController();
    fetchBuyAgain(ctrl.signal)
      .then((data) => { buyCache = { userId, data }; setState(buyCache); })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        if (!buyCache || buyCache.userId !== userId) { buyCache = { userId, data: 'failed' }; setState(buyCache); }
      });
    return () => ctrl.abort();
  }, [userId]);
  useFocusEffect(load);
  return { signedIn: !!userId, entries: userId && state?.userId === userId ? state.data : null };
}

/* ---------------------------------------------------------------- repeat baskets (one shared list) */

type ListState = { userId: string | null; list: RepeatBasket[] | null; loading: boolean; error: string | null };
let list: ListState = { userId: null, list: null, loading: false, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<ListState>) => { list = { ...list, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const get = () => list;
let inflight: Promise<void> | null = null;

/** Re-reads GET /me/repeat-baskets for this customer (one request at a time). */
export function refreshBaskets(userId: string): Promise<void> {
  if (inflight && list.userId === userId) return inflight;
  if (list.userId !== userId) set({ userId, list: null, error: null });
  set({ loading: true });
  inflight = listBaskets()
    .then((l) => { if (list.userId === userId) set({ list: l, error: null }); })
    .catch((e) => { if (list.userId === userId) set({ error: repeatErrorText(e) }); })
    .finally(() => { inflight = null; set({ loading: false }); });
  return inflight;
}

/** A basket created or changed: the list follows at once (cancelled ones leave it). */
export function upsertBasket(b: RepeatBasket) {
  const cur = list.list ?? [];
  const next = b.status === 'CANCELLED'
    ? cur.filter((x) => x.id !== b.id)
    : cur.some((x) => x.id === b.id) ? cur.map((x) => (x.id === b.id ? b : x)) : [...cur, b];
  set({ list: next });
}

export function removeBasket(id: string) {
  set({ list: (list.list ?? []).filter((x) => x.id !== id) });
}

/**
 * The customer's repeat baskets while the feature is on. `on` false: hidden (store switch off,
 * 503 REPEAT_NOT_READY, signed out). Loaded on first use and on each focus of a screen using it.
 */
export function useRepeatBaskets(): { on: boolean; list: RepeatBasket[] | null; loading: boolean; error: string | null; refresh: () => void } {
  const on = useRepeatOn();
  const session = useSession();
  const userId = on && session ? session.user.id : null;
  const s = useSyncExternalStore(subscribe, get, get);
  const refresh = useCallback(() => { if (userId) void refreshBaskets(userId); }, [userId]);
  useFocusEffect(refresh);
  useEffect(refresh, [refresh]);
  const mine = userId && s.userId === userId;
  return { on, list: mine ? s.list : null, loading: !!mine && s.loading, error: mine ? s.error : null, refresh };
}
