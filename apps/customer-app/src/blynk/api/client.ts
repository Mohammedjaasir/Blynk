/** Blynk API base. Expo inlines EXPO_PUBLIC_* at build time, so read it as a plain property. */
export const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000/api/v1';
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Options {
  signal?: AbortSignal;
  /** GET when omitted (the catalogue and store reads). */
  method?: Method;
  /** Sent as JSON. Only for POST, PATCH and DELETE. */
  body?: unknown;
  /** Bearer access token for signed-in calls. */
  token?: string | null;
}

export async function apiRequest<T>(path: string, opts: Options = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  const method = opts.method ?? 'GET';
  const init: RequestInit = { method, signal: ctrl.signal };
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (method !== 'GET' && opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (Object.keys(headers).length) init.headers = headers;
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    const timedOut = ctrl.signal.aborted && !opts.signal?.aborted;
    throw new ApiError(
      timedOut ? 'This is taking too long. Check your connection and try again.' : "We couldn't reach Blynk. Check your connection and try again.",
      timedOut ? 408 : 0,
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let payload: { success?: boolean; data?: unknown; error?: { code?: string; message?: string; details?: unknown } } = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
  if (res.ok && payload.success !== false) return payload.data as T;
  // 502 OTP_DELIVERY_FAILED is a 5xx the customer must understand; keep its code, not the server text
  if (res.status >= 500) throw new ApiError('Something went wrong on our side. Please try again.', res.status, payload.error?.code, payload.error?.details);
  throw new ApiError(payload.error?.message ?? 'Request failed.', res.status, payload.error?.code, payload.error?.details);
}

export const apiPost = <T>(path: string, body: unknown, token?: string | null, signal?: AbortSignal) =>
  apiRequest<T>(path, { method: 'POST', body, token, signal });

export const apiPatch = <T>(path: string, body: unknown, token?: string | null, signal?: AbortSignal) =>
  apiRequest<T>(path, { method: 'PATCH', body, token, signal });

export const apiGet = <T>(path: string, token?: string | null, signal?: AbortSignal) =>
  apiRequest<T>(path, { token, signal });

export const apiDelete = <T>(path: string, token?: string | null, signal?: AbortSignal) =>
  apiRequest<T>(path, { method: 'DELETE', token, signal });
