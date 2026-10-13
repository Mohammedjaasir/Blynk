import { API_BASE_URL, apiGet } from '@/blynk/api/client';
import { authed, freshAccessToken, getSession } from '@/blynk/auth/session';
import { StreamRefused, type StreamHandlers } from '@/blynk/tracking/locationStream';
import { parseRoute, type RiderRoute } from '@/blynk/tracking/model';

/*
 * Live order tracking calls (backend/api/src/modules/orders):
 *   GET /orders/:id/location/stream   SSE: `location` {latitude, longitude, accuracy, captured_at,
 *                                     received_at}, `closed` {reason}, ": heartbeat" every 15 s.
 *                                     404 not yours / not found; a "not_trackable" close when the
 *                                     order is not OUT_FOR_DELIVERY with a picked-up delivery.
 *   GET /orders/:id/route             { route: {coordinates, distance_m, duration_s, computed_at} | null }
 *                                     409 ORDER_NOT_TRACKABLE, 503 ROUTING_UNAVAILABLE, 404 ROUTE_NOT_FOUND.
 */

/** No byte for this long (heartbeats come every 15 s) means the line is dead: reconnect. */
export const STREAM_IDLE_MS = 45_000;

export const locationStreamUrl = (orderId: string) =>
  `${API_BASE_URL}/orders/${encodeURIComponent(orderId)}/location/stream`;

/**
 * Opens the stream with fetch (EventSource cannot send the Authorization header). A 401 gets one
 * fresh access token and one retry, like Flutter's openWebLocationStream; any other HTTP error
 * is a StreamRefused. `fetchImpl` is for tests.
 */
export function openLocationStream(orderId: string, h: StreamHandlers, fetchImpl: typeof fetch = fetch): () => void {
  let cancelled = false;
  let ctrl: AbortController | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const clearIdle = () => { if (idle) clearTimeout(idle); idle = null; };
  const armIdle = () => {
    clearIdle();
    idle = setTimeout(() => {
      if (cancelled) return;
      ctrl?.abort();
      fail(new Error('location stream went quiet'));
    }, STREAM_IDLE_MS);
  };
  let finished = false;
  const fail = (e: unknown) => { if (!finished && !cancelled) { finished = true; clearIdle(); h.onError(e); } };
  const done = () => { if (!finished && !cancelled) { finished = true; clearIdle(); h.onDone(); } };

  const open = async (token: string | null, mayRefresh: boolean): Promise<void> => {
    if (cancelled) return;
    ctrl = new AbortController();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    armIdle();
    let res: Response;
    try {
      res = await fetchImpl(locationStreamUrl(orderId), { headers, signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      fail(e);
      return;
    }
    if (cancelled) { ctrl.abort(); return; }
    if (res.status === 401 && mayRefresh && token) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      let fresh: string | null = null;
      try { fresh = await freshAccessToken(token); } catch { /* offline: refused below */ }
      if (cancelled) return;
      if (fresh) { await open(fresh, false); return; }
      fail(new StreamRefused(401));
      return;
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      fail(new StreamRefused(res.status));
      return;
    }
    const body = res.body;
    if (!body) { fail(new Error('this browser cannot read a streamed response')); return; }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (cancelled) return;
        if (end) break;
        armIdle();
        const text = decoder.decode(value, { stream: true });
        if (text) h.onChunk(text);
      }
      const tail = decoder.decode();
      if (tail && !cancelled) h.onChunk(tail);
      done();
    } catch (e) {
      fail(e);
    }
  };

  void open(getSession()?.accessToken ?? null, true);
  return () => {
    cancelled = true;
    clearIdle();
    ctrl?.abort();
  };
}

/** GET /orders/:id/route -> the parsed route, or null (no point yet, stale point, malformed). */
export async function fetchRiderRoute(orderId: string, signal?: AbortSignal): Promise<RiderRoute | null> {
  const data = await authed((t) => apiGet<{ route?: unknown } | null>(`/orders/${encodeURIComponent(orderId)}/route`, t, signal));
  return parseRoute(data?.route ?? null);
}
