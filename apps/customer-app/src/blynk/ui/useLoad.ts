import { useCallback, useEffect, useRef, useState } from 'react';

export type Load<T> = { data: T | null; error: unknown; loading: boolean; reload: () => void; set: (v: T) => void };

type Answer<T> = { key: string; data: T | null; error: unknown };

/**
 * One async read for a screen: loading, the answer, the failure, and reload. The read runs again
 * whenever `deps` change (compared by value) and on reload(); an older answer never shows for a
 * newer request. `enabled: false` waits (e.g. until the customer is signed in).
 */
export function useLoad<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[], enabled = true): Load<T> {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const [nonce, setNonce] = useState(0);
  const key = `${JSON.stringify(deps)}#${nonce}`;
  const [answer, setAnswer] = useState<Answer<T> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    fnRef.current(ctrl.signal)
      .then((data) => { if (!ctrl.signal.aborted) setAnswer({ key, data, error: null }); })
      .catch((error) => { if (!ctrl.signal.aborted) setAnswer({ key, data: null, error }); });
    return () => ctrl.abort();
  }, [key, enabled]);

  const current = answer?.key === key ? answer : null;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((data: T) => setAnswer({ key, data, error: null }), [key]);
  return { data: current?.data ?? null, error: current?.error ?? null, loading: enabled && !current, reload, set };
}
