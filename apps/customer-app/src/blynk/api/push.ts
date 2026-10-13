import { API_BASE_URL, apiPost } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';

/*
 * Push devices (backend/api/src/modules/notifications/push/devices.controller.ts), any signed-in
 * user:
 *   POST   /me/devices          { token, platform: 'android' | 'ios' | 'web' }  (upsert)
 *   DELETE /me/devices/:token
 */
export type PushPlatformName = 'android' | 'ios' | 'web';

export const registerDevice = (token: string, platform: PushPlatformName) =>
  authed((t) => apiPost<unknown>('/me/devices', { token, platform }, t)).then(() => undefined);

/**
 * Sent with the access token the customer had before logging out, outside authed() on purpose:
 * after a logout nothing here may refresh or touch the session (Flutter's _unregisterWithApi).
 * A failure is fine - the token is deleted at Firebase too, and the server drops dead tokens.
 */
export async function unregisterDevice(token: string, accessToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
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
