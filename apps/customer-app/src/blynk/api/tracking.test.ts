import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryStorage } from '../test/fixtures';

/* The fetch-based SSE opener and the route call, over fresh modules with a signed-in session. */
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sse(chunks: string[]) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function load() {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  const api = await import('./tracking');
  const client = await import('./client');
  const stream = await import('@/blynk/tracking/locationStream');
  return { ...api, ...client, ...stream, session };
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const handlers = () => {
  const chunks: string[] = [];
  let err: unknown = null;
  let done = false;
  let settle!: () => void;
  const finished = new Promise<void>((r) => { settle = r; });
  return {
    h: {
      onChunk: (t: string) => { chunks.push(t); },
      onError: (e: unknown) => { err = e; settle(); },
      onDone: () => { done = true; settle(); },
    },
    finished,
    get chunks() { return chunks.join(''); },
    get err() { return err; },
    get done() { return done; },
  };
};

test('opens the stream with the bearer token and passes the text through', async () => {
  const { openLocationStream, locationStreamUrl } = await load();
  const f = vi.fn().mockResolvedValue(sse(['event: location\ndata: {"a":1}\n\n', ': heartbeat\n\n']));
  const r = handlers();
  openLocationStream('o 1', r.h, f as unknown as typeof fetch);
  await r.finished;
  expect(f.mock.calls[0][0]).toBe(locationStreamUrl('o 1'));
  expect(locationStreamUrl('o 1')).toContain('/orders/o%201/location/stream');
  expect(f.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer a1', Accept: 'text/event-stream' });
  expect(r.chunks).toBe('event: location\ndata: {"a":1}\n\n: heartbeat\n\n');
  expect(r.done).toBe(true);
});

test('a 401 gets one fresh token and one retry', async () => {
  const { openLocationStream, session } = await load();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { access_token: 'a2', refresh_token: 'r2' } }));
  const f = vi.fn()
    .mockResolvedValueOnce(json(401, { success: false }))
    .mockResolvedValueOnce(sse(['event: location\ndata: {}\n\n']));
  const r = handlers();
  openLocationStream('o1', r.h, f as unknown as typeof fetch);
  await r.finished;
  expect(f).toHaveBeenCalledTimes(2);
  expect(f.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer a2' });
  expect(session.getSession()?.accessToken).toBe('a2');
  expect(r.done).toBe(true);
});

test('a 404 is a permanent refusal; a refused refresh is a 401 refusal', async () => {
  const { openLocationStream, StreamRefused } = await load();
  const r = handlers();
  openLocationStream('o1', r.h, vi.fn().mockResolvedValue(json(404, { success: false })) as unknown as typeof fetch);
  await r.finished;
  expect(r.err).toBeInstanceOf(StreamRefused);
  expect((r.err as InstanceType<typeof StreamRefused>).status).toBe(404);
  expect((r.err as InstanceType<typeof StreamRefused>).permanent).toBe(true);

  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'no' } }));
  const r2 = handlers();
  openLocationStream('o1', r2.h, vi.fn().mockResolvedValue(json(401, { success: false })) as unknown as typeof fetch);
  await r2.finished;
  expect((r2.err as InstanceType<typeof StreamRefused>).status).toBe(401);
});

test('cancel stops quietly: no error after the caller left', async () => {
  const { openLocationStream } = await load();
  let abortSeen = false;
  const f = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
    init.signal?.addEventListener('abort', () => { abortSeen = true; rej(new DOMException('aborted', 'AbortError')); });
  }));
  const r = handlers();
  const cancel = openLocationStream('o1', r.h, f as unknown as typeof fetch);
  await Promise.resolve();
  cancel();
  await new Promise((res) => setTimeout(res, 5));
  expect(abortSeen).toBe(true);
  expect(r.err).toBeNull();
  expect(r.done).toBe(false);
});

test('fetchRiderRoute GETs the route and parses it; null route stays null', async () => {
  const { fetchRiderRoute, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json(200, { success: true, data: { route: { coordinates: [[80, 7], [80.01, 7.01]], distance_m: 1500, duration_s: 240, computed_at: '2026-10-13T10:00:00.000Z' } } }))
    .mockResolvedValueOnce(json(200, { success: true, data: { route: null } }));
  const route = await fetchRiderRoute('o1');
  expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/orders/o1/route`);
  expect(route).toMatchObject({ points: [[7, 80], [7.01, 80.01]], durationS: 240 });
  expect(await fetchRiderRoute('o1')).toBeNull();
});
