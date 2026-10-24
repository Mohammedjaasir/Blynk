import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLocationWatcher, reconnectDelayMs, StreamRefused, type StreamHandlers } from './locationStream';
import {
  arrivingText, classifyFreshness, lastSeenText, parsePoint, parseRoute, trackingView, type RiderPoint,
} from './model';
import { TRACKING_WORDS } from './words';
import { createRouteWatcher } from './routeWatcher';
import { createSseParser, parseFrame } from './sse';

const T0 = Date.parse('2026-10-13T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const loc = (lat: number, lng: number, at: number) =>
  `event: location\ndata: ${JSON.stringify({ latitude: lat, longitude: lng, accuracy: 6, captured_at: iso(at), received_at: iso(at + 400) })}\n\n`;

/* ------------------------------------------------------------------ SSE parsing */

describe('SSE parser', () => {
  test('frames split across chunks, CRLF, comments and multi-line data', () => {
    const p = createSseParser();
    expect(p.push('event: loc')).toEqual([]);
    expect(p.push('ation\r\ndata: {"a":\r\ndata: 1}\r\n\r\n: heartbeat\n\nevent: closed\ndata: {"reason":"x"}\n\n')).toEqual([
      { event: 'location', data: '{"a":\n1}' },
      { event: ':', data: '' },
      { event: 'closed', data: '{"reason":"x"}' },
    ]);
  });

  test('a frame without an event name is a "message"; a comment-only frame is null', () => {
    expect(parseFrame('data: hi')).toEqual({ event: 'message', data: 'hi' });
    expect(parseFrame(': heartbeat')).toBeNull();
  });

  test('a runaway partial frame is dropped', () => {
    const p = createSseParser();
    p.push(`data: ${'x'.repeat(70_000)}`);
    const out = p.push('\n\nevent: location\ndata: 1\n\n').filter((e) => e.event !== ':');
    expect(out).toEqual([{ event: 'location', data: '1' }]);
  });
});

/* ------------------------------------------------------------------ points, routes, words */

describe('model', () => {
  test('parsePoint never invents a point', () => {
    expect(parsePoint({ latitude: 7.1, longitude: 79.9, accuracy: 0, captured_at: iso(T0), received_at: iso(T0) }))
      .toEqual({ lat: 7.1, lng: 79.9, accuracy: null, capturedAt: T0, receivedAt: T0 });
    expect(parsePoint({ latitude: '7.1', longitude: '79.9', captured_at: iso(T0), received_at: iso(T0) })?.lat).toBe(7.1);
    expect(parsePoint({ latitude: 91, longitude: 79.9, captured_at: iso(T0), received_at: iso(T0) })).toBeNull();
    expect(parsePoint({ latitude: 7, longitude: 79, captured_at: '2026-13-01T00:00:00Z', received_at: iso(T0) })).toBeNull();
    expect(parsePoint({ latitude: 7, longitude: 79, captured_at: '2026-02-30T00:00:00Z', received_at: iso(T0) })).toBeNull();
    expect(parsePoint({ latitude: 7, longitude: 79 })).toBeNull();
    expect(parsePoint(null)).toBeNull();
  });

  test('parseRoute flips [lng, lat] and refuses anything malformed', () => {
    const ok = { coordinates: [[79.9, 7.1], [79.91, 7.11]], distance_m: 1234.4, duration_s: 301.6, computed_at: iso(T0) };
    expect(parseRoute(ok)).toEqual({ points: [[7.1, 79.9], [7.11, 79.91]], distanceM: 1234, durationS: 302, computedAt: T0 });
    expect(parseRoute({ ...ok, coordinates: [[79.9, 7.1]] })).toBeNull();
    expect(parseRoute({ ...ok, coordinates: [[79.9, 'x'], [1, 2]] })).toBeNull();
    expect(parseRoute({ ...ok, duration_s: -1 })).toBeNull();
    expect(parseRoute(null)).toBeNull();
  });

  test('freshness: live to 18 s, stale to 2 min, then offline', () => {
    expect(classifyFreshness(T0, T0 + 18_000)).toBe('live');
    expect(classifyFreshness(T0, T0 + 18_001)).toBe('stale');
    expect(classifyFreshness(T0, T0 + 120_000)).toBe('stale');
    expect(classifyFreshness(T0, T0 + 120_001)).toBe('offline');
    expect(classifyFreshness(T0 + 5000, T0)).toBe('live'); // clock skew
  });

  test('words', () => {
    expect(arrivingText(0)).toBe('Arriving in ~1 min');
    expect(arrivingText(301)).toBe('Arriving in ~6 min');
    expect(lastSeenText(-5)).toBe('Last seen just now');
    expect(lastSeenText(1000)).toBe('Last seen 1 second ago');
    expect(lastSeenText(45_000)).toBe('Last seen 45 seconds ago');
    expect(lastSeenText(125_000)).toBe('Last seen 2 minutes ago');
  });

  test('view: ETA only for a live rider with a route; line while visible; nothing when offline or closed', () => {
    const p: RiderPoint = { lat: 7, lng: 80, accuracy: null, capturedAt: T0, receivedAt: T0 };
    const route = { points: [[7, 80], [7.01, 80.01]] as [number, number][], distanceM: 900, durationS: 200, computedAt: T0 };
    const s = { current: p, heading: 90, closed: false, unavailable: false };
    const live = trackingView(s, route, T0 + 1000);
    expect(live).toMatchObject({ riderVisible: true, eta: 'Arriving in ~4 min', caption: { live: true, text: 'Live' }, heading: 90 });
    expect(live.route).toHaveLength(2);
    const stale = trackingView(s, route, T0 + 60_000);
    expect(stale).toMatchObject({ riderVisible: true, eta: null, caption: { live: false, text: 'Last seen 1 minute ago' } });
    expect(stale.route).toHaveLength(2);
    const off = trackingView(s, route, T0 + 200_000);
    expect(off).toMatchObject({ riderVisible: false, rider: null, eta: null, route: [], caption: { text: TRACKING_WORDS.unavailable } });
    expect(trackingView({ ...s, closed: true }, route, T0).riderVisible).toBe(false);
    expect(trackingView({ ...s, current: null }, null, T0).caption.text).toBe(TRACKING_WORDS.unavailable);
  });
});

/* ------------------------------------------------------------------ the location stream */

type Conn = { h: StreamHandlers; cancelled: boolean };

function fakeOpener() {
  const conns: Conn[] = [];
  const opener = (_id: string, h: StreamHandlers) => {
    const c: Conn = { h, cancelled: false };
    conns.push(c);
    return () => { c.cancelled = true; };
  };
  return { conns, opener };
}

describe('location watcher', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('backoff steps: 1, 2, 4, 8, 16, 30, 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  test('points replace each other; an older or equal point is ignored; heading turns after 8 m', () => {
    const { conns, opener } = fakeOpener();
    const w = createLocationWatcher({ opener, jitter: () => 0 });
    w.watch('o1');
    const c = conns[0].h;
    c.onChunk(loc(7.0, 80.0, T0));
    expect(w.state.current).toMatchObject({ lat: 7.0, lng: 80.0 });
    expect(w.state.heading).toBeNull();
    c.onChunk(loc(7.5, 80.0, T0 - 1000)); // older
    expect(w.state.current?.lat).toBe(7.0);
    c.onChunk(loc(7.00002, 80.0, T0 + 1000)); // ~2 m: jitter, heading unchanged
    expect(w.state.heading).toBeNull();
    c.onChunk(loc(7.001, 80.0, T0 + 2000)); // ~111 m north
    expect(Math.round(w.state.heading ?? -1)).toBe(0);
    c.onChunk('event: location\ndata: {not json\n\n'); // malformed: ignored
    expect(w.state.current?.lat).toBe(7.001);
  });

  test('a dropped line reconnects with backoff and jitter; a healthy 30 s resets the backoff', () => {
    const { conns, opener } = fakeOpener();
    const w = createLocationWatcher({ opener, jitter: () => 0.2 });
    w.watch('o1');
    conns[0].h.onError(new TypeError('network'));
    vi.advanceTimersByTime(1199);
    expect(conns).toHaveLength(1);
    vi.advanceTimersByTime(1); // 1 s * 1.2
    expect(conns).toHaveLength(2);
    conns[1].h.onDone();
    vi.advanceTimersByTime(2400);
    expect(conns).toHaveLength(3);
    // this one proves itself: a heartbeat, then 30 s up
    conns[2].h.onChunk(': heartbeat\n\n');
    vi.advanceTimersByTime(30_000);
    conns[2].h.onError(new Error('drop'));
    vi.advanceTimersByTime(1200); // back to the first step
    expect(conns).toHaveLength(4);
  });

  test('a permanent refusal (404) stops for good; 429 and 5xx retry', () => {
    const { conns, opener } = fakeOpener();
    const w = createLocationWatcher({ opener, jitter: () => 0 });
    w.watch('o1');
    conns[0].h.onError(new StreamRefused(503));
    vi.advanceTimersByTime(1000);
    expect(conns).toHaveLength(2);
    conns[1].h.onError(new StreamRefused(429));
    vi.advanceTimersByTime(2000);
    expect(conns).toHaveLength(3);
    conns[2].h.onChunk(loc(7, 80, T0));
    conns[2].h.onError(new StreamRefused(404));
    expect(w.state).toMatchObject({ unavailable: true, current: null });
    vi.advanceTimersByTime(120_000);
    expect(conns).toHaveLength(3);
  });

  test('closed not_trackable / delivery_closed ends tracking; server_shutdown reconnects', () => {
    const { conns, opener } = fakeOpener();
    const w = createLocationWatcher({ opener, jitter: () => 0 });
    w.watch('o1');
    conns[0].h.onChunk(loc(7, 80, T0));
    conns[0].h.onChunk('event: closed\ndata: {"reason":"server_shutdown"}\n\n');
    expect(conns[0].cancelled).toBe(true);
    expect(w.state.closed).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(conns).toHaveLength(2);
    conns[1].h.onChunk('event: closed\ndata: {"reason":"delivery_closed"}\n\n');
    expect(w.state).toMatchObject({ closed: true, current: null });
    expect(conns[1].cancelled).toBe(true);
    conns[1].h.onDone();
    vi.advanceTimersByTime(60_000);
    expect(conns).toHaveLength(2);
  });

  test('stop() cancels the line and ignores anything late', () => {
    const { conns, opener } = fakeOpener();
    const w = createLocationWatcher({ opener, jitter: () => 0 });
    w.watch('o1');
    w.stop();
    expect(conns[0].cancelled).toBe(true);
    conns[0].h.onChunk(loc(7, 80, T0));
    conns[0].h.onError(new Error('late'));
    vi.advanceTimersByTime(60_000);
    expect(w.state.current).toBeNull();
    expect(conns).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ the route */

describe('route watcher', () => {
  test('asks only while the rider is live, every 25 s, 60 s after a failure', async () => {
    let now = T0;
    const fetcher = vi.fn<(id: string) => Promise<null>>().mockResolvedValue(null);
    const r = createRouteWatcher({ fetcher, now: () => now });
    r.watch('o1');
    r.refreshIfDue(false);
    expect(fetcher).not.toHaveBeenCalled();
    r.refreshIfDue(true);
    r.refreshIfDue(true); // in flight
    expect(fetcher).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve();
    now += 24_000; r.refreshIfDue(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 1_000; r.refreshIfDue(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValueOnce(new Error('503'));
    await Promise.resolve(); await Promise.resolve();
    now += 25_000; r.refreshIfDue(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await Promise.resolve(); await Promise.resolve();
    expect(r.route).toBeNull();
    now += 30_000; r.refreshIfDue(true);
    expect(fetcher).toHaveBeenCalledTimes(3); // failure: waits 60 s
    now += 30_000; r.refreshIfDue(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
