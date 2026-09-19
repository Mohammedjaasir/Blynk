import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data for a screen: loading, error and data. A response that arrives
 * after a newer request started is dropped. A reload never clears what is on
 * screen: the rider keeps seeing the last known state (marked with its time)
 * while a refresh runs or fails.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const generation = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(
    async () => {
      const mine = ++generation.current;
      setLoading(true);
      try {
        const result = await load();
        if (mine === generation.current) {
          setData(result);
          setError(null);
          setLoadedAt(new Date());
        }
      } catch (err) {
        if (mine === generation.current) setError(err);
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    },
    [load]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, loadedAt, reload, setData };
}
