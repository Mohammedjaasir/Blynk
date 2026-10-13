import type { RiderRoute } from './model';

/*
 * The road route for one order, asked for only while the rider is LIVE and at most every 25 s
 * (60 s after a failure), like Flutter's RiderRouteProvider. A failure clears the route: the map
 * then has no line and no time - never a guess. The server caches per order as well.
 */
export const ROUTE_REFRESH_MS = 25_000;
export const ROUTE_RETRY_AFTER_FAILURE_MS = 60_000;

export function createRouteWatcher(opts: {
  fetcher: (orderId: string) => Promise<RiderRoute | null>;
  now?: () => number;
  onChange?: (r: RiderRoute | null) => void;
}) {
  const now = opts.now ?? Date.now;
  let orderId: string | null = null;
  let route: RiderRoute | null = null;
  let lastAttempt: number | null = null;
  let lastFailed = false;
  let inFlight = false;
  let gen = 0;

  const reset = () => {
    gen++;
    orderId = null;
    route = null;
    lastAttempt = null;
    lastFailed = false;
    inFlight = false;
  };

  return {
    watch(id: string) {
      if (orderId === id) return;
      reset();
      orderId = id;
    },
    stop() {
      if (orderId === null) return;
      reset();
      opts.onChange?.(null);
    },
    /** Ask for a fresh route when one is due; call on every rider update and the age tick. */
    refreshIfDue(riderLive: boolean) {
      const id = orderId;
      if (!id || !riderLive || inFlight) return;
      if (lastAttempt !== null && now() - lastAttempt < (lastFailed ? ROUTE_RETRY_AFTER_FAILURE_MS : ROUTE_REFRESH_MS)) return;
      const g = gen;
      inFlight = true;
      lastAttempt = now();
      opts.fetcher(id).then(
        (r) => {
          if (g !== gen) return;
          inFlight = false;
          lastFailed = false;
          route = r;
          opts.onChange?.(route);
        },
        () => {
          if (g !== gen) return;
          inFlight = false;
          lastFailed = true;
          route = null;
          opts.onChange?.(route);
        },
      );
    },
    get route() { return route; },
  };
}

export type RouteWatcher = ReturnType<typeof createRouteWatcher>;
