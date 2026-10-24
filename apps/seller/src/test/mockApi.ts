import { vi } from 'vitest';

/**
 * A fake Blynk API for the fix tests: (method, path, query, body) in, an
 * envelope out. Unlike fetchStub it accepts multipart (FormData) bodies and
 * thrown errors (a handler that throws is a network failure).
 */
export type Call = { method: string; path: string; query: URLSearchParams; body: any };
export type Reply = { status?: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };

export const ok = (data: unknown): Reply => ({ status: 200, data });
export const fail = (status: number, code: string, message = code, details?: unknown): Reply => ({
  status,
  error: { code, message, details },
});

export function mockApi(handler: (call: Call) => Reply | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const raw = init?.body;
      const body =
        typeof FormData !== 'undefined' && raw instanceof FormData ? raw : raw ? JSON.parse(String(raw)) : null;
      const call = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname.replace(/^.*\/api\/v1/, ''),
        query: url.searchParams,
        body,
      };
      calls.push(call);
      const reply = handler(call) ?? fail(404, 'NOT_MOCKED');
      const status = reply.status ?? 200;
      const envelope = status < 400 ? { success: true, data: reply.data } : { success: false, error: reply.error };
      return { ok: status < 400, status, text: async () => JSON.stringify(envelope) } as Response;
    })
  );
  return {
    calls,
    find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
  };
}
