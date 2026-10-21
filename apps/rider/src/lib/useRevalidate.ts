import { useEffect } from 'react';
import { ASSIGNMENT_EVENT } from './riderPush';

/**
 * Keeps a screen current: re-reads when the app returns to the front, when
 * the connection comes back, at once when a "New delivery" push arrives
 * (lib/riderPush.ts, 2026-10-21), and on a slow interval while the screen is
 * visible, for phones without push.
 */
export function useRevalidate(reload: () => void, intervalMs = 30_000) {
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const timer = setInterval(refreshIfVisible, intervalMs);
    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('online', refreshIfVisible);
    window.addEventListener(ASSIGNMENT_EVENT, reload);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.removeEventListener('online', refreshIfVisible);
      window.removeEventListener(ASSIGNMENT_EVENT, reload);
    };
  }, [reload, intervalMs]);
}
