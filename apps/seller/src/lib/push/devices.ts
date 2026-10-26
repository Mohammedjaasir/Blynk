import { API_BASE_URL, apiRequest } from '../../api/client';

/*
 * Push devices (backend/api/src/modules/notifications/push/devices.controller.ts), any signed-in
 * user, the SELLER role included:
 *   POST   /me/devices          { token, platform: 'android' | 'ios' | 'web' }  (upsert)
 *   DELETE /me/devices/:token
 */
export const registerDevice = (token: string): Promise<void> =>
  apiRequest<unknown>('/me/devices', { method: 'POST', body: { token, platform: 'web' } }).then(() => undefined);

/** Turn notifications off while signed in (the client renews the session if it has to). */
export const unregisterDevice = (token: string): Promise<void> =>
  apiRequest<unknown>(`/me/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).then(() => undefined);

/**
 * Sent with the access token the seller had before signing out, outside apiRequest on purpose:
 * after a sign-out nothing here may refresh or touch the session. A failure is fine - the token
 * is deleted at Firebase too, and the server drops dead tokens.
 */
export async function unregisterDeviceWith(
  token: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    await fetchImpl(`${API_BASE_URL}/me/devices/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
