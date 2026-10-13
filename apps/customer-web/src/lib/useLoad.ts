import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const hasData = useRef(false);
  const setData: typeof setDataState = (v) => { hasData.current = true; setDataState(v); };
  const run = useCallback(async () => {
    const id = ++latest.current;
    // Silent refresh: only show loading while there is nothing to show yet.
    if (!hasData.current) setLoading(true);
    setError(null);
    try {
      const d = await fn();
      if (id !== latest.current) return;
      hasData.current = true;
      setDataState(d);
    } catch (e) {
      if (id !== latest.current) return;
      setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0));
    } finally {
      if (id === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, retry: run, setData };
}
