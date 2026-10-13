import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { API_BASE_URL } from '@/blynk/api/client';

/* Each test loads a fresh session module over a fake localStorage, as a page load would. */
let store: Map<string, string>;
const KEY = 'blynk.app.session.v1';

const user = (full_name: string | null = 'Nimal Perera') => ({ id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name, email: null });
const verify = (full_name: string | null = 'Nimal Perera') => ({
  access_token: 'a1', refresh_token: 'r1', token_type: 'Bearer', expires_in: 900, user: user(full_name),
});

/** A fresh session module, plus the ApiError class from the same fresh module graph. */
async function load() {
  vi.resetModules();
  const session = await import('./session');
  const { ApiError } = await import('@/blynk/api/client');
  return { ...session, ApiError };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('signIn persists the session and a fresh load restores it', async () => {
  const a = await load();
  expect(a.getSession()).toBeNull();
  a.signIn(verify());
  expect(JSON.parse(store.get(KEY) as string)).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', user: { phone: '+94771234567' } });

  const b = await load();
  expect(b.getSession()).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', user: { id: 'u1', full_name: 'Nimal Perera' } });
});

test('a corrupt or empty stored value restores as signed out', async () => {
  store.set(KEY, '{not json');
  expect((await load()).getSession()).toBeNull();
  store.set(KEY, JSON.stringify({ accessToken: 1 }));
  expect((await load()).getSession()).toBeNull();
});

test('signOut clears the stored session and revokes the refresh token', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { message: 'ok' } }));
  const a = await load();
  a.signIn(verify());
  a.signOut();
  expect(a.getSession()).toBeNull();
  expect((await load()).getSession()).toBeNull();
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/auth/logout`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ refresh_token: 'r1' }) }));
});

test('authed refreshes once on a 401, stores the rotated pair and retries', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    json(200, { success: true, data: { access_token: 'a2', refresh_token: 'r2', token_type: 'Bearer', expires_in: 900 } }),
  );
  const a = await load();
  a.signIn(verify());
  const seen: string[] = [];
  const result = await a.authed(async (t) => {
    seen.push(t);
    if (t === 'a1') throw new a.ApiError('expired', 401, 'UNAUTHORIZED');
    return 'ok';
  });
  expect(result).toBe('ok');
  expect(seen).toEqual(['a1', 'a2']);
  expect(f).toHaveBeenCalledTimes(1);
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/auth/refresh`, expect.objectContaining({ body: JSON.stringify({ refresh_token: 'r1' }) }));
  expect(a.getSession()).toMatchObject({ accessToken: 'a2', refreshToken: 'r2', user: { id: 'u1' } });
  expect((await load()).getSession()).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
});

test('authed refreshes only once: a second 401 is returned, not looped', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    json(200, { success: true, data: { access_token: 'a2', refresh_token: 'r2' } }),
  );
  const a = await load();
  a.signIn(verify());
  const calls = vi.fn(async () => { throw new a.ApiError('nope', 401); });
  await expect(a.authed(calls)).rejects.toMatchObject({ status: 401 });
  expect(calls).toHaveBeenCalledTimes(2);
  expect(f).toHaveBeenCalledTimes(1);
});

test('a refused refresh clears the session', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' } }));
  const a = await load();
  a.signIn(verify());
  await expect(a.authed(async () => { throw new a.ApiError('expired', 401); })).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  expect(a.getSession()).toBeNull();
  expect((await load()).getSession()).toBeNull();
});

test('errors other than 401 pass through without a refresh', async () => {
  const f = vi.spyOn(globalThis, 'fetch');
  const a = await load();
  a.signIn(verify());
  await expect(a.authed(async () => { throw new a.ApiError('bad', 400, 'VALIDATION_ERROR'); })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(f).not.toHaveBeenCalled();
  expect(a.getSession()).not.toBeNull();
});

test('needsRegistration: signed in with an empty or whitespace full_name', async () => {
  const a = await load();
  expect(a.needsRegistration(null)).toBe(false);
  for (const name of [null, '', '   ']) {
    a.signIn(verify(name));
    expect(a.needsRegistration()).toBe(true);
  }
  a.signIn(verify('Nimal'));
  expect(a.needsRegistration()).toBe(false);
  a.updateUser({ full_name: ' ' });
  expect(a.needsRegistration()).toBe(true);
  a.updateUser({ full_name: 'Kamala' });
  expect(a.needsRegistration(a.getSession())).toBe(false);
});

test('a refresh that fails on the server side (5xx) or offline keeps the customer signed in', async () => {
  const a = await load();
  a.signIn(verify());
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(503, { success: false, error: { code: 'UNAVAILABLE', message: 'down' } }));
  await expect(a.authed(async () => { throw new a.ApiError('expired', 401); })).rejects.toMatchObject({ status: 503 });
  expect(a.getSession()).not.toBeNull();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
  await expect(a.authed(async () => { throw new a.ApiError('expired', 401); })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  expect(a.getSession()).not.toBeNull();
});

test('a 403 refresh (account deactivated, staff disabled) ends the session as "rejected", once', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(403, { success: false, error: { code: 'ACCOUNT_DEACTIVATED', message: 'inactive' } }));
  const a = await load();
  a.signIn(verify());
  const ended: string[] = [];
  a.onSessionEnd((s, reason) => ended.push(`${s.user.id}:${reason}`));
  await Promise.all([
    a.authed(async () => { throw new a.ApiError('expired', 401); }).catch(() => undefined),
    a.authed(async () => { throw new a.ApiError('expired', 401); }).catch(() => undefined),
  ]);
  expect(a.getSession()).toBeNull();
  expect(ended).toEqual(['u1:rejected']);
});

test('revalidateSession refreshes the stored user from GET /auth/me (riders and Operations keep shopping)', async () => {
  const a = await load();
  a.signIn(verify());
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {
    success: true, data: { id: 'u1', phone: '+94771234567', role: 'RIDER', full_name: 'Nimal P', email: null },
  }));
  await a.revalidateSession();
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/auth/me`, expect.anything());
  expect(a.getSession()?.user).toMatchObject({ role: 'RIDER', full_name: 'Nimal P' });
});

test('revalidateSession ignores an answer for another user and never throws offline', async () => {
  const a = await load();
  a.signIn(verify());
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { id: 'someone-else', role: 'ADMIN', full_name: 'X' } }));
  await a.revalidateSession();
  expect(a.getSession()?.user).toMatchObject({ id: 'u1', role: 'CUSTOMER' });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
  await expect(a.revalidateSession()).resolves.toBeUndefined();
  expect(a.getSession()).not.toBeNull();
});

test('freshAccessToken: reuses a token another call already refreshed, else refreshes once', async () => {
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { access_token: 'a2', refresh_token: 'r2' } }));
  const a = await load();
  a.signIn(verify());
  expect(await a.freshAccessToken('a1')).toBe('a2');
  expect(await a.freshAccessToken('a1')).toBe('a2'); // a1 is stale now: no second refresh
  expect(f).toHaveBeenCalledTimes(1);
});
