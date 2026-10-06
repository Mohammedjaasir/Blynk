import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` every `ms` while the page is visible and `paused` is false,
 * and once more when the page becomes visible again. Hidden tabs never poll.
 */
export function useAutoRefresh(refresh: () => void, ms: number, paused = false) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (paused) return;
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const timer = setInterval(() => {
      if (visible()) latest.current();
    }, ms);
    const onVisibility = () => {
      if (visible()) latest.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, paused]);
}
