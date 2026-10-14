import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { DEMO } from '@/demo/mode';
import { fetchUsuals } from './api';
import type { Usuals } from './usuals';

/* The last answer per customer, so coming back to Home shows the row at once while it re-asks. */
let cache: { userId: string; data: Usuals } | null = null;

/**
 * "Your usuals" for the signed-in customer (GET /me/usuals). Asked again every time the screen
 * comes into focus (back from checkout after placing an order, signing in or out). Nothing for a
 * guest, in the design mock, or while unknown; a failed call keeps the last answer.
 */
export function useUsuals(): Usuals | null {
  const session = useSession();
  const userId = session && !needsRegistration(session) ? session.user.id : null;
  const [state, setState] = useState<{ userId: string; data: Usuals } | null>(() => cache);
  const load = useCallback(() => {
    if (DEMO || !userId) return;
    const ctrl = new AbortController();
    fetchUsuals(ctrl.signal)
      .then((data) => { cache = { userId, data }; setState(cache); })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [userId]);
  useFocusEffect(load);
  return userId && state?.userId === userId ? state.data : null;
}
