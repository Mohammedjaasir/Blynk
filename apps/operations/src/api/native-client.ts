import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { ApiError, BASE_URL, REQUEST_TIMEOUT_MS, endSession, refreshSession, tokenStore, type RefreshTransport } from './client';

/**
 * Native HTTP for the live-location POSTs ONLY (2026-10-02).
 *
 * Android throttles requests the WebView makes ~5 min after the app is
 * backgrounded (background-geolocation README + issue #14), which would
 * silently stop location posts while the screen is locked. The Rider app
 * fixes that by turning on Capacitor's GLOBAL native-HTTP switch
 * (plugins.CapacitorHttp.enabled). Operations deliberately does NOT: it
 * uploads images as multipart FormData through fetch, which the patched
 * fetch does not carry reliably. So only this one call goes through
 * `CapacitorHttp.request` directly; everything else keeps using fetch.
 *
 * Same contract as client.ts's `apiRequest`: Bearer token, one shared
 * single-flight refresh on a 401 (here sent natively too), the session ends
 * if that refresh is refused, and a non-2xx answer becomes an `ApiError`
 * carrying the server's status and code (tracker-session.ts stops sharing on
 * a 409 / 404 DELIVERY_NOT_FOUND exactly as it does for the fetch path).
 */

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

type Json = Record<string, unknown>;

const nativeRefresh: RefreshTransport = async (url, body) => {
  const response = await CapacitorHttp.request({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: body,
    responseType: 'text',
    connectTimeout: REQUEST_TIMEOUT_MS,
    readTimeout: REQUEST_TIMEOUT_MS,
  });
  const ok = response.status >= 200 && response.status < 300;
  return { ok, text: typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {}) };
};

async function sendNative(path: string, method: string, body: Json): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = tokenStore.access;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await CapacitorHttp.request({
      url: `${BASE_URL}${path}`,
      method,
      headers,
      data: JSON.stringify(body),
      responseType: 'text',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {});
    return { status: response.status, text };
  } catch {
    throw new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
  }
}

export async function nativeApiRequest<T>(path: string, options: { method: 'POST' | 'PATCH'; body: Json }): Promise<T> {
  let response = await sendNative(path, options.method, options.body);
  if (response.status === 401 && tokenStore.refresh) {
    if (await refreshSession(nativeRefresh)) response = await sendNative(path, options.method, options.body);
  }
  if (response.status === 401) endSession('expired');

  let payload: Json = {};
  try {
    payload = response.text ? (JSON.parse(response.text) as Json) : {};
  } catch {
    // A non-JSON body (proxy error page) is still an error to report cleanly.
  }
  if (response.status < 200 || response.status >= 300) {
    const error = (payload.error ?? {}) as { message?: string; code?: string; details?: unknown };
    throw new ApiError(error.message ?? 'Request failed.', response.status, error.code, error.details);
  }
  return (payload.data ?? payload) as T;
}
