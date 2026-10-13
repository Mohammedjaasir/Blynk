import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryStorage } from '../test/fixtures';
import { createPushManager, type PushPermission, type PushPlatform } from './manager';
import { clickedPushData, pushTargetOf } from './target';

function fakePlatform(perm: PushPermission = 'default', token: string | null = 'tok-1') {
  let permission = perm;
  let tap: ((d: Record<string, unknown>) => void) | null = null;
  const p = {
    name: 'web' as const,
    initialize: vi.fn(async () => undefined),
    permission: () => permission,
    requestPermission: vi.fn(async () => { permission = 'granted'; return permission; }),
    getToken: vi.fn(async () => (permission === 'granted' ? token : null)),
    deleteToken: vi.fn(async () => undefined),
    onTap: (cb: (d: Record<string, unknown>) => void) => { tap = cb; return () => { tap = null; }; },
    set: (v: PushPermission) => { permission = v; },
    tap: (d: Record<string, unknown>) => tap?.(d),
  };
  return p satisfies PushPlatform & Record<string, unknown>;
}

const deps = (platform: PushPlatform | null) => ({
  platform: () => platform,
  register: vi.fn(async (_t: string, _p: string) => undefined),
  unregister: vi.fn(async (_t: string, _a: string) => undefined),
  onTap: vi.fn(),
});

test('signed in without permission: no token is asked for, nothing is registered (no out-of-context prompt)', async () => {
  const p = fakePlatform('default');
  const d = deps(p);
  const m = createPushManager(d);
  await m.start();
  await m.signedIn();
  expect(p.getToken).not.toHaveBeenCalled();
  expect(p.requestPermission).not.toHaveBeenCalled();
  expect(d.register).not.toHaveBeenCalled();
});

test('requestPermission (from a tap) prompts, then registers POST /me/devices with platform web', async () => {
  const p = fakePlatform('default');
  const d = deps(p);
  const m = createPushManager(d);
  await m.start();
  await m.signedIn();
  expect(await m.requestPermission()).toBe('granted');
  expect(p.requestPermission).toHaveBeenCalledTimes(1);
  expect(d.register).toHaveBeenCalledWith('tok-1', 'web');
  // asking again does not prompt or register twice
  await m.requestPermission();
  await m.signedIn();
  expect(p.requestPermission).toHaveBeenCalledTimes(1);
  expect(d.register).toHaveBeenCalledTimes(1);
});

test('already allowed: signing in registers at once; a rotated token is registered too', async () => {
  const p = fakePlatform('granted');
  const d = deps(p);
  const m = createPushManager(d);
  await m.start();
  await m.signedIn();
  expect(d.register).toHaveBeenCalledWith('tok-1', 'web');
  await m.tokenRefreshed('tok-2');
  expect(d.register).toHaveBeenLastCalledWith('tok-2', 'web');
  expect(m.registeredToken).toBe('tok-2');
});

test('signed out: DELETE with the old access token, then the token is deleted at Firebase; failures are silent', async () => {
  const p = fakePlatform('granted');
  const d = deps(p);
  d.unregister.mockRejectedValueOnce(new Error('offline'));
  const m = createPushManager(d);
  await m.start();
  await m.signedIn();
  await expect(m.signedOut('old-access')).resolves.toBeUndefined();
  expect(d.unregister).toHaveBeenCalledWith('tok-1', 'old-access');
  expect(p.deleteToken).toHaveBeenCalled();
  expect(m.registeredToken).toBeNull();
  // a token refresh while signed out is not registered
  await m.tokenRefreshed('tok-3');
  expect(d.register).toHaveBeenCalledTimes(1);
});

test('a failed registration is retried on the next sign-in', async () => {
  const p = fakePlatform('granted');
  const d = deps(p);
  d.register.mockRejectedValueOnce(new Error('503'));
  const m = createPushManager(d);
  await m.start();
  await m.signedIn();
  expect(m.registeredToken).toBeNull();
  await m.signedIn();
  expect(d.register).toHaveBeenCalledTimes(2);
  expect(m.registeredToken).toBe('tok-1');
});

test('unsupported browser or a platform that cannot start: every call is a no-op', async () => {
  const none = deps(null);
  const m = createPushManager(none);
  expect(await m.start()).toBe(false);
  await m.signedIn();
  expect(await m.requestPermission()).toBe('unsupported');
  await m.signedOut('a');
  expect(none.register).not.toHaveBeenCalled();

  const broken = fakePlatform('granted');
  broken.initialize.mockRejectedValueOnce(new Error('blocked'));
  const d = deps(broken);
  const m2 = createPushManager(d);
  expect(await m2.start()).toBe(false);
  await m2.signedIn();
  expect(d.register).not.toHaveBeenCalled();
});

test('a tapped notification reaches onTap', async () => {
  const p = fakePlatform('granted');
  const d = deps(p);
  const m = createPushManager(d);
  await m.start();
  p.tap({ type: 'order', order_id: 'o1' });
  expect(d.onTap).toHaveBeenCalledWith({ type: 'order', order_id: 'o1' });
});

test('push targets: order updates open the order; anything else just opens the app', () => {
  expect(pushTargetOf({ type: 'order', order_id: ' 3f1c ' })).toEqual({ kind: 'order', id: '3f1c', path: '/order/3f1c' });
  expect(pushTargetOf({ type: 'order', order_id: '' })).toBeNull();
  expect(pushTargetOf({ type: 'order', order_id: '../admin' })).toBeNull();
  expect(pushTargetOf({ type: 'product', product_id: 'p1' })).toBeNull();
  expect(pushTargetOf(null)).toBeNull();
});

test('only Firebase "notification-clicked" worker messages count as taps', () => {
  expect(clickedPushData({ isFirebaseMessaging: true, messageType: 'notification-clicked', data: { type: 'order', order_id: 'o1' } }))
    .toEqual({ type: 'order', order_id: 'o1' });
  expect(clickedPushData({ isFirebaseMessaging: true, messageType: 'push-received', data: {} })).toBeNull();
  expect(clickedPushData({ messageType: 'notification-clicked', data: {} })).toBeNull();
  expect(clickedPushData('x')).toBeNull();
});

/* ------------------------------------------------------------------ device API */

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('registerDevice POSTs /me/devices; unregisterDevice DELETEs with the given token, outside the session', async () => {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'RIDER', full_name: 'N', email: null } });
  const { registerDevice, unregisterDevice } = await import('@/blynk/api/push');
  const { API_BASE_URL } = await import('@/blynk/api/client');
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { device: {} } }));
  await registerDevice('tok/1', 'web');
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/me/devices`, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ token: 'tok/1', platform: 'web' }),
  }));
  session.signOut();
  f.mockClear();
  await unregisterDevice('tok/1', 'a1');
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/me/devices/tok%2F1`);
  expect(f.mock.calls[0][1]).toMatchObject({ method: 'DELETE', headers: { Authorization: 'Bearer a1' } });
});
