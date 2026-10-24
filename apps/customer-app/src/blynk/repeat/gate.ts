import { useSyncExternalStore } from 'react';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { useStore } from '@/blynk/store/StoreContext';
import { DEMO } from '@/demo/mode';
import { onRepeatNotReady } from './api';
import { repeatOn } from './payload';

/*
 * Repeat baskets show only while GET /store says `repeat_baskets_enabled` (false until migration
 * 054 is run in Coolify) and no call has answered 503 REPEAT_NOT_READY in this session. Buy again
 * needs no migration and is not gated here.
 */

let notReady = false;
const listeners = new Set<() => void>();
onRepeatNotReady(() => {
  if (notReady) return;
  notReady = true;
  listeners.forEach((l) => l());
});
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const get = () => notReady;

/** The feature is on for this customer (signed in and registered). */
export function useRepeatOn(): boolean {
  const store = useStore();
  const session = useSession();
  const seen = useSyncExternalStore(subscribe, get, get);
  return repeatOn(store, seen, DEMO) && !!session && !needsRegistration(session);
}
