import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-app updates behind sign-in (owner, 2026-10-12): the manifest comes from
 * the signed-in GET /app-updates/manifest through the app's own API client
 * (token attached, renewed on a 401), and the native download gets a
 * just-renewed access token as a method argument. The native plugin is
 * replaced here; everything between it and fetch is the real code.
 */
const plugin = vi.hoisted(() => ({
  getInstalledVersion: vi.fn(async () => ({ versionCode: 10, versionName: '1.10' })),
  canRequestInstall: vi.fn(async () => ({ allowed: true })),
  openInstallSettings: vi.fn(async () => undefined),
  downloadAndInstall: vi.fn(async (_options: { expectedSha256: string; size: number; accessToken: string }) => ({
    status: 'installing',
  })),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    registerPlugin: () => plugin,
    Capacitor: { ...actual.Capacitor, getPlatform: () => 'android', isNativePlatform: () => true },
  };
});

import { BASE_URL, freshAccessToken, tokenStore } from '../api/client';
import { APP_NAME, __resetAppUpdateForTests, appUpdateDeps, updateStore } from '../lib/app-update';

const SHA = 'd'.repeat(64);
const MANIFEST = { app: APP_NAME, version_code: 11, version_name: '1.11', sha256: SHA, size: 4_000_000, released_at: '' };

interface Seen {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

/** A fake API: a handler per "METHOD /path" (path after /api/v1, with the query). */
function fakeApi(handlers: Record<string, (seen: Seen) => { status: number; body?: unknown }>) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const call: Seen = {
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        authorization: headers.get('Authorization'),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      seen.push(call);
      const path = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url;
      const handler = handlers[`${call.method} ${path}`];
      if (!handler) throw new TypeError('Failed to fetch');
      const reply = handler(call);
      return {
        ok: reply.status < 400,
        status: reply.status,
        text: async () => JSON.stringify(reply.body ?? {}),
      } as Response;
    })
  );
  return seen;
}

const envelope = (data: unknown) => ({ success: true, data });
const refused = (_status: number, code: string) => ({ success: false, error: { code, message: code } });

beforeEach(() => {
  __resetAppUpdateForTests();
  plugin.downloadAndInstall.mockClear();
  tokenStore.save('old-access', 'old-refresh');
});
afterEach(() => {
  __resetAppUpdateForTests();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('fetchManifest (signed in, through the API client)', () => {
  it('asks the authenticated endpoint for its own app with the stored token', async () => {
    const seen = fakeApi({ [`GET /app-updates/manifest?app=${APP_NAME}`]: () => ({ status: 200, body: envelope(MANIFEST) }) });
    expect(await appUpdateDeps.fetchManifest()).toEqual(MANIFEST);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${BASE_URL}/app-updates/manifest?app=${APP_NAME}`);
    expect(seen[0].authorization).toBe('Bearer old-access');
    // Nothing is fetched from the old public address any more.
    expect(seen.some((s) => s.url.includes('blynk.lk/download'))).toBe(false);
  });

  it('an expired access token is renewed once and the request retried', async () => {
    let calls = 0;
    const seen = fakeApi({
      [`GET /app-updates/manifest?app=${APP_NAME}`]: (s) =>
        ++calls === 1 || s.authorization !== 'Bearer new-access'
          ? { status: 401, body: refused(401, 'UNAUTHORIZED') }
          : { status: 200, body: envelope(MANIFEST) },
      'POST /auth/refresh': () => ({ status: 200, body: envelope({ access_token: 'new-access', refresh_token: 'new-refresh' }) }),
    });
    expect(await appUpdateDeps.fetchManifest()).toEqual(MANIFEST);
    expect(seen.map((s) => `${s.method} ${s.authorization ?? ''}`)).toEqual([
      'GET Bearer old-access',
      'POST ',
      'GET Bearer new-access',
    ]);
  });

  it('nothing published (404) or not allowed (403) is "no manifest"; no signal throws', async () => {
    fakeApi({ [`GET /app-updates/manifest?app=${APP_NAME}`]: () => ({ status: 404, body: refused(404, 'NOT_FOUND') }) });
    expect(await appUpdateDeps.fetchManifest()).toBeNull();
    fakeApi({ [`GET /app-updates/manifest?app=${APP_NAME}`]: () => ({ status: 403, body: refused(403, 'FORBIDDEN') }) });
    expect(await appUpdateDeps.fetchManifest()).toBeNull();
    fakeApi({});
    await expect(appUpdateDeps.fetchManifest()).rejects.toBeTruthy();
  });

  it('a manifest for the other app is ignored', async () => {
    const other = APP_NAME === 'ops' ? 'rider' : 'ops';
    fakeApi({ [`GET /app-updates/manifest?app=${APP_NAME}`]: () => ({ status: 200, body: envelope({ ...MANIFEST, app: other }) }) });
    expect(await appUpdateDeps.fetchManifest()).toBeNull();
  });
});

describe('freshAccessToken', () => {
  it('renews the session and returns the new access token', async () => {
    const seen = fakeApi({
      'POST /auth/refresh': () => ({ status: 200, body: envelope({ access_token: 'new-access', refresh_token: 'new-refresh' }) }),
    });
    expect(await freshAccessToken()).toBe('new-access');
    expect(seen[0].body).toEqual({ refresh_token: 'old-refresh' });
    expect(tokenStore.access).toBe('new-access');
  });

  it('a refused refresh signs out and says sign in again', async () => {
    fakeApi({ 'POST /auth/refresh': () => ({ status: 401, body: refused(401, 'INVALID_REFRESH_TOKEN') }) });
    await expect(freshAccessToken()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });

  it('no signal keeps the session', async () => {
    fakeApi({});
    await expect(freshAccessToken()).rejects.toMatchObject({ status: 0 });
    expect(tokenStore.refresh).toBe('old-refresh');
  });
});

describe('install: the native plugin gets a just-renewed token, once', () => {
  it('renews right before the download and passes the token as a method argument', async () => {
    let refreshes = 0;
    fakeApi({
      [`GET /app-updates/manifest?app=${APP_NAME}`]: () => ({ status: 200, body: envelope(MANIFEST) }),
      [`GET /app-updates/policy?app=${APP_NAME}`]: () => ({ status: 200, body: envelope({ min_version_code: 0, mode: 'optional', notes: '' }) }),
      'POST /auth/refresh': () => {
        refreshes += 1;
        return { status: 200, body: envelope({ access_token: `renewed-${refreshes}`, refresh_token: `refresh-${refreshes}` }) };
      },
    });
    await updateStore.start();
    updateStore.setSignedIn(true);
    await vi.waitFor(() => expect(updateStore.getState().manifest).toEqual(MANIFEST));
    expect(refreshes).toBe(0);
    await updateStore.install();
    expect(refreshes).toBe(1);
    expect(plugin.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(plugin.downloadAndInstall).toHaveBeenCalledWith({ expectedSha256: SHA, size: 4_000_000, accessToken: 'renewed-1' });
    expect(updateStore.getState().phase).toBe('installing');
    // The token is not kept by the update code (only the session's own store has it).
    const stored = Object.keys(localStorage)
      .filter((k) => k.includes('appUpdate'))
      .map((k) => localStorage.getItem(k) ?? '');
    expect(stored.join('')).not.toContain('renewed-1');
  });

  it('a refused renewal stops before the plugin with "Please sign in again."', async () => {
    fakeApi({
      [`GET /app-updates/manifest?app=${APP_NAME}`]: () => ({ status: 200, body: envelope(MANIFEST) }),
      [`GET /app-updates/policy?app=${APP_NAME}`]: () => ({ status: 200, body: envelope({ min_version_code: 0, mode: 'optional', notes: '' }) }),
      'POST /auth/refresh': () => ({ status: 401, body: refused(401, 'INVALID_REFRESH_TOKEN') }),
    });
    await updateStore.start();
    updateStore.setSignedIn(true);
    await vi.waitFor(() => expect(updateStore.getState().manifest).toEqual(MANIFEST));
    await updateStore.install();
    expect(plugin.downloadAndInstall).not.toHaveBeenCalled();
    expect(updateStore.getState()).toMatchObject({ phase: 'error', installError: 'Please sign in again.' });
  });

  it('the plugin answering 403 / 401 is put in plain words', async () => {
    fakeApi({
      [`GET /app-updates/manifest?app=${APP_NAME}`]: () => ({ status: 200, body: envelope(MANIFEST) }),
      [`GET /app-updates/policy?app=${APP_NAME}`]: () => ({ status: 200, body: envelope({ min_version_code: 0, mode: 'optional', notes: '' }) }),
      'POST /auth/refresh': () => ({ status: 200, body: envelope({ access_token: 'a', refresh_token: 'r' }) }),
    });
    await updateStore.start();
    updateStore.setSignedIn(true);
    await vi.waitFor(() => expect(updateStore.getState().manifest).toEqual(MANIFEST));
    plugin.downloadAndInstall.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'FORBIDDEN' }));
    await updateStore.install();
    expect(updateStore.getState().installError).toBe("Your account can't download this app.");
    plugin.downloadAndInstall.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'UNAUTHORIZED' }));
    await updateStore.install();
    expect(updateStore.getState().installError).toBe('Please sign in again.');
  });

  it('signed out, no request is made at all', async () => {
    const seen = fakeApi({});
    await updateStore.start();
    await updateStore.check({ force: true });
    expect(seen).toHaveLength(0);
  });
});
