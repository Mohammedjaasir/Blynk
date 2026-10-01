import { vi } from 'vitest';

/** A fetch Response in the API's envelope ({ success, data } or { success: false, error }). */
export function respond(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data })),
  } as Response);
}

export type Handler = (method: string, path: string, body: Record<string, unknown> | undefined) => Promise<Response>;

/** Stubs global fetch with a (method, path-after-/api/v1, body) handler; returns the mock. */
export function stubFetch(handler: Handler) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^.*\/api\/v1/, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    return handler(init?.method ?? 'GET', path, body);
  });
  vi.stubGlobal('fetch', mock);
  return {
    mock,
    /** Bodies sent with `method` to a path ending in `path`. */
    sent: (method: string, path: string) =>
      mock.mock.calls
        .filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).replace(/\?.*$/, '').endsWith(path))
        .map(([, init]) => JSON.parse(String((init as RequestInit).body))),
    /** Paths (with query) requested with `method`. */
    paths: (method = 'GET') =>
      mock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method).map(([url]) => String(url).replace(/^.*\/api\/v1/, '')),
  };
}
