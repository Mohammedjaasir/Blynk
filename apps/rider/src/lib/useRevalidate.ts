import { useEffect } from 'react';

/**
 * Keeps a screen current without push: re-reads when the app returns to the
 * front, when the connection comes back, and on a slow interval while the
 * screen is visible. Riders are assigned by the store (no WebSockets), so
 * this is how a new assignment or a cancellation reaches the phone.
 */
export function useRevalidate(reload: () => void, intervalMs = 30_000) {
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const timer = setInterval(refreshIfVisible, intervalMs);
    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('online', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.removeEventListener('online', refreshIfVisible);
    };
  }, [reload, intervalMs]);
}
