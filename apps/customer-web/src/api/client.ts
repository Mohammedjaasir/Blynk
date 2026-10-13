export const API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Options { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; auth?: boolean; signal?: AbortSignal }

export async function apiRequest<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const timedOut = ctrl.signal.aborted && !opts.signal?.aborted;
    throw new ApiError(
      timedOut ? 'This is taking too long. Check your connection and try again.' : "We couldn't reach Blynk. Check your connection and try again.",
      timedOut ? 408 : 0,
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let payload: { success?: boolean; data?: unknown; error?: { code?: string; message?: string; details?: unknown } } = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
  if (res.ok && payload.success !== false) return payload.data as T;
  if (res.status >= 500) throw new ApiError('Something went wrong on our side. Please try again.', res.status, payload.error?.code);
  throw new ApiError(payload.error?.message ?? 'Request failed.', res.status, payload.error?.code, payload.error?.details);
}
