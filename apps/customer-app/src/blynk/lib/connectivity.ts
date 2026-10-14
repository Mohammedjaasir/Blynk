import { useSyncExternalStore } from 'react';
import { ApiError, setNetworkObserver } from '../api/client';

/*
 * Whether the app is offline (Flutter ConnectivityHint + ConnectivityBanner). A hint, not a
 * monitor: it learns from the requests the app makes (no plugin, no polling of its own), plus
 * the browser's online/offline events on the web.
 *  - a failed connection sets it;
 *  - any answer from the server, a 4xx or 5xx included, clears it (the network works);
 *  - a timeout says nothing either way.
 * Coming back online shows "Back online" for a moment.
 */

export type NetEvent = 'response' | 'network-error' | 'timeout' | 'browser-offline' | 'browser-online';
export type NetState = { offline: boolean; restoredAt: number | null };
export type BannerMode = 'offline' | 'restored' | null;

export const ONLINE: NetState = { offline: false, restoredAt: null };
/** How long "Back online" stays. */
export const RESTORED_MS = 3000;

export function nextNetState(s: NetState, e: NetEvent, now: number): NetState {
  switch (e) {
    case 'network-error':
    case 'browser-offline':
      return s.offline ? s : { offline: true, restoredAt: null };
    case 'response':
    case 'browser-online':
      return s.offline ? { offline: false, restoredAt: now } : s;
    default:
      return s; // a timeout is inconclusive
  }
}

/** What the banner shows at `now`. */
export function bannerMode(s: NetState, now: number): BannerMode {
  if (s.offline) return 'offline';
  return s.restoredAt != null && now - s.restoredAt < RESTORED_MS ? 'restored' : null;
}

/** The event a finished request stands for (null error: the server answered). */
export function eventFor(error: ApiError | null): NetEvent {
  if (!error) return 'response';
  if (error.code === 'TIMEOUT') return 'timeout';
  if (error.code === 'NETWORK_ERROR' || error.status === 0) return 'network-error';
  return 'response';
}

/* ---- the one app-wide hint ---- */

let state: NetState = ONLINE;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function emit(e: NetEvent) {
  const next = nextNetState(state, e, Date.now());
  if (next === state) return;
  state = next;
  notify();
  // "Back online" goes by itself after a moment (unless the connection dropped again meanwhile)
  const stamp = next.restoredAt;
  if (stamp != null) {
    setTimeout(() => {
      if (state.restoredAt !== stamp) return;
      state = { ...state, restoredAt: null };
      notify();
    }, RESTORED_MS);
  }
}
export const recordNetwork = (error: ApiError | null) => emit(eventFor(error));
export const getNetState = () => state;
/** Tests only. */
export const resetNetState = () => { state = ONLINE; };

let installed = false;
/** Wires the hint to the API client and (web) the browser's online/offline events. Idempotent. */
export function installConnectivity() {
  if (installed) return;
  installed = true;
  setNetworkObserver(recordNetwork);
  const w = typeof window !== 'undefined' ? (window as Window & typeof globalThis) : null;
  if (w && typeof w.addEventListener === 'function') {
    w.addEventListener('offline', () => emit('browser-offline'));
    w.addEventListener('online', () => emit('browser-online'));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) emit('browser-offline');
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** The banner's mode: offline, "Back online" (cleared by the store after RESTORED_MS), or nothing. */
export function useConnectivityBanner(): BannerMode {
  const s = useSyncExternalStore(subscribe, getNetState, getNetState);
  return s.offline ? 'offline' : s.restoredAt != null ? 'restored' : null;
}
