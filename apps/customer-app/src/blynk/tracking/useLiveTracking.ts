import { useEffect, useRef, useState } from 'react';
import { fetchRiderRoute, openLocationStream } from '@/blynk/api/tracking';
import { useSession } from '@/blynk/auth/session';
import { createLocationWatcher, type LocationState } from './locationStream';
import { trackingView, type RiderRoute, type TrackingView } from './model';
import { createRouteWatcher, type RouteWatcher } from './routeWatcher';

/* Every open tracker, so a session end (logout, refused login) can close them all at once. */
const trackers = new Set<() => void>();

/** Close every live rider stream and drop its last point (AppSessionCleaner's location.stopWatching). */
export function stopAllTracking() {
  [...trackers].forEach((stop) => stop());
}

/** Re-render this often so "Last seen ..." and LIVE -> STALE move without a new point (Flutter: 5 s). */
export const AGE_TICK_MS = 5_000;

const EMPTY: LocationState = { current: null, heading: null, closed: false, unavailable: false };

/**
 * The live rider for one order while it is mounted: the SSE stream, the road route (only while
 * the rider is LIVE) and a 5 s age tick, folded into one TrackingView. Pass null to stay idle.
 * Signed out = idle; a new sign-in starts fresh.
 */
export function useLiveTracking(orderId: string | null): TrackingView & { closed: boolean; unavailable: boolean } {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [loc, setLoc] = useState<LocationState>(EMPTY);
  const [route, setRoute] = useState<RiderRoute | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const routes = useRef<RouteWatcher | null>(null);

  useEffect(() => {
    if (!orderId || !userId) return;
    const lw = createLocationWatcher({ opener: openLocationStream, onChange: (s) => { setLoc(s); setNow(Date.now()); } });
    const rw = createRouteWatcher({ fetcher: (id) => fetchRiderRoute(id), onChange: setRoute });
    routes.current = rw;
    const stop = () => {
      lw.stop();
      rw.stop();
      trackers.delete(stop);
    };
    trackers.add(stop);
    rw.watch(orderId);
    lw.watch(orderId);
    const tick = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => {
      clearInterval(tick);
      stop();
      routes.current = null;
      setLoc(EMPTY);
      setRoute(null);
    };
  }, [orderId, userId]);

  const view = trackingView(loc, route, now);
  const live = view.riderVisible && view.freshness === 'live';
  // every rider update and age tick asks whether a fresh route is due; the watcher rate-limits
  useEffect(() => { routes.current?.refreshIfDue(live); });

  return { ...view, closed: loc.closed, unavailable: loc.unavailable };
}
