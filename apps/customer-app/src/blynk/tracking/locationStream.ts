import { createSseParser } from './sse';
import { bearingDegrees, HEADING_MIN_MOVE_M, metresBetween, parsePoint, type RiderPoint } from './model';

/*
 * The rider's live position for one order: GET /orders/:id/location/stream (SSE), with the
 * behaviour of Flutter's LocationProvider:
 *  - `location` events replace the point (an older or equal captured_at is ignored);
 *  - `closed` with not_trackable / delivery_closed ends tracking for good (the order left
 *    OUT_FOR_DELIVERY); any other close (server_shutdown) reconnects;
 *  - a dropped line reconnects after 1, 2, 4, 8, 16, then 30 s (±20 % jitter); the backoff
 *    resets once a connection has stayed up 30 s;
 *  - a permanent refusal (4xx other than 408 / 429) stops for good ("unavailable");
 *  - the heading turns only after the rider has moved 8 m (GPS jitter).
 */

export type StreamHandlers = {
  onChunk: (text: string) => void;
  onError: (e: unknown) => void;
  onDone: () => void;
};

/** Opens the stream for an order; returns a function that cancels it. */
export type StreamOpener = (orderId: string, h: StreamHandlers) => () => void;

/** The server answered the stream request with an HTTP error. */
export class StreamRefused extends Error {
  constructor(readonly status: number) {
    super(`location stream refused (${status})`);
    this.name = 'StreamRefused';
  }
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

/** 1, 2, 4, 8, 16, then 30 s. */
export const reconnectDelayMs = (attempt: number) => Math.min(30, attempt >= 5 ? 30 : 2 ** attempt) * 1000;
export const MAX_JITTER = 0.2;
export const HEALTHY_MS = 30_000;

export type LocationState = {
  current: RiderPoint | null;
  heading: number | null;
  /** The order is no longer on the road: the stream ended for good. */
  closed: boolean;
  /** The server refused the stream (not yours, not found, signed out). */
  unavailable: boolean;
};

const EMPTY: LocationState = { current: null, heading: null, closed: false, unavailable: false };

export function createLocationWatcher(opts: {
  opener: StreamOpener;
  jitter?: () => number;
  onChange?: (s: LocationState) => void;
}) {
  const jitter = opts.jitter ?? (() => (Math.random() * 2 - 1) * MAX_JITTER);
  let state: LocationState = EMPTY;
  let orderId: string | null = null;
  let gen = 0;
  let attempt = 0;
  let cancel: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let healthyTimer: ReturnType<typeof setTimeout> | null = null;
  let anchor: RiderPoint | null = null;

  const emit = (patch: Partial<LocationState>) => {
    state = { ...state, ...patch };
    opts.onChange?.(state);
  };

  function stopAll() {
    const c = cancel;
    cancel = null;
    try { c?.(); } catch { /* already gone */ }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (healthyTimer) clearTimeout(healthyTimer);
    reconnectTimer = null;
    healthyTimer = null;
  }

  function connect(g: number) {
    if (g !== gen || !orderId) return;
    const parser = createSseParser();
    let healthyArmed = false;
    let ended = false;
    const end = (err: unknown) => {
      if (ended) return;
      ended = true;
      onEnded(g, err);
    };
    try {
      cancel = opts.opener(orderId, {
        onChunk: (text) => {
          if (g !== gen || ended || state.closed || state.unavailable) return;
          for (const ev of parser.push(text)) {
            if (!healthyArmed) {
              healthyArmed = true;
              if (healthyTimer) clearTimeout(healthyTimer);
              healthyTimer = setTimeout(() => { healthyTimer = null; if (g === gen) attempt = 0; }, HEALTHY_MS);
            }
            const reconnect = apply(ev.event, ev.data);
            if (g !== gen || state.closed) return;
            if (reconnect) {
              const c = cancel;
              cancel = null;
              try { c?.(); } catch { /* ignore */ }
              end(null);
              return;
            }
          }
        },
        onError: (e) => { if (g === gen) end(e); },
        onDone: () => { if (g === gen) end(null); },
      });
    } catch (e) {
      end(e);
    }
  }

  function onEnded(g: number, err: unknown) {
    if (g !== gen || state.closed || state.unavailable) return;
    cancel = null;
    if (healthyTimer) { clearTimeout(healthyTimer); healthyTimer = null; }
    if (err instanceof StreamRefused && err.permanent) {
      stopAll();
      anchor = null;
      emit({ unavailable: true, current: null, heading: null });
      return;
    }
    const base = reconnectDelayMs(attempt++);
    const j = Math.max(-MAX_JITTER, Math.min(MAX_JITTER, jitter()));
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(g); }, Math.round(base * (1 + j)));
  }

  /** Apply one event. True when this connection should be dropped and reopened. */
  function apply(event: string, data: string): boolean {
    if (event === 'location') {
      let raw: unknown;
      try { raw = JSON.parse(data); } catch { return false; }
      const p = parsePoint(raw);
      if (!p) return false;
      if (state.current && p.capturedAt <= state.current.capturedAt) return false;
      let heading = state.heading;
      if (!anchor) anchor = p;
      else if (metresBetween(anchor, p) >= HEADING_MIN_MOVE_M) {
        heading = bearingDegrees(anchor, p);
        anchor = p;
      }
      emit({ current: p, heading });
      return false;
    }
    if (event === 'closed') {
      let reason: unknown;
      try { reason = (JSON.parse(data) as { reason?: unknown } | null)?.reason; } catch { /* not JSON */ }
      if (reason === 'not_trackable' || reason === 'delivery_closed') {
        stopAll();
        anchor = null;
        emit({ closed: true, current: null, heading: null });
        return false;
      }
      return true;
    }
    return false;
  }

  return {
    /** Start (or restart) watching an order. */
    watch(id: string) {
      gen++;
      stopAll();
      orderId = id;
      attempt = 0;
      anchor = null;
      state = EMPTY;
      emit({});
      connect(gen);
    },
    /** Stop and forget the point (the screen left, or the session ended). */
    stop() {
      gen++;
      stopAll();
      orderId = null;
      anchor = null;
      state = EMPTY;
      emit({});
    },
    get state() { return state; },
  };
}

export type LocationWatcher = ReturnType<typeof createLocationWatcher>;
