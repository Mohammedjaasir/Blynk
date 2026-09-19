import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data for a screen and exposes the four states every screen renders:
 * loading, error, empty (data with no rows) and loaded. A response that
 * arrives after a newer request started is dropped.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await load();
      if (mine === generation.current) setData(result);
    } catch (err) {
      if (mine === generation.current) setError(err);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Debounced copy of a value, for search boxes. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
