import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AppShareLinks, AppUpdatesSetting } from '../api/types';
import { AppUpdatePrompt, AppVersionCard } from '../components/AppUpdate';
import { AppUpdatesSettingsCard } from '../components/AppUpdatesSettingsCard';
import { __resetAppUpdateForTests, appUpdateDeps, updateStore, type UpdateManifest, type UpdatePolicy } from '../lib/app-update';
import { minimumWarning, parseMinVersionCode, parseShareHours } from '../lib/appUpdatesSettings';
import { OPERATIONS_STAFF, fail, mockApi, ok, renderAs } from './helpers';

/**
 * In-app updates (owner, 2026-10-12): the "Update available" card, the
 * blocking "Update required" screen, More > App version, and More > App
 * updates (the setting Admin also has).
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

const SHA = 'b'.repeat(64);
const manifest = (code: number): UpdateManifest => ({
  app: 'ops',
  version_code: code,
  version_name: `1.${code}`,
  sha256: SHA,
  size: 6_291_456,
  released_at: '2026-10-12T06:00:00.000Z',
});
const saved = { ...appUpdateDeps };

function fakeDevice(opts: { installed?: number; manifest?: UpdateManifest | null; policy?: UpdatePolicy | null; offline?: boolean } = {}) {
  const deps = {
    isNative: () => true,
    getInstalledVersion: async () => ({ versionCode: opts.installed ?? 10, versionName: `1.${opts.installed ?? 10}` }),
    fetchManifest: vi.fn(async () => {
      if (opts.offline) throw new TypeError('Failed to fetch');
      return opts.manifest === undefined ? manifest(11) : opts.manifest;
    }),
    fetchPolicy: vi.fn(async () => {
      if (opts.offline) throw new TypeError('Failed to fetch');
      return opts.policy === undefined ? { min_version_code: 0, mode: 'optional' as const, notes: '' } : opts.policy;
    }),
    canRequestInstall: vi.fn(async () => true),
    openInstallSettings: vi.fn(async () => undefined),
    freshAccessToken: vi.fn(async () => 'fresh-access-token'),
    downloadAndInstall: vi.fn(async (_m: UpdateManifest, _token: string, onProgress: (f: number) => void) => {
      onProgress(0.4);
    }),
  };
  Object.assign(appUpdateDeps, deps);
  return deps;
}

beforeEach(() => __resetAppUpdateForTests());
afterEach(() => {
  cleanup();
  Object.assign(appUpdateDeps, saved);
  __resetAppUpdateForTests();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('Update prompt', () => {
  it('shows nothing on web / in a browser', async () => {
    appUpdateDeps.isNative = () => false;
    const { container } = render(<AppUpdatePrompt signedIn />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when the installed app is the latest', async () => {
    fakeDevice({ installed: 11 });
    const { container } = render(<AppUpdatePrompt signedIn />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('optional: "Update available" with the notes; Later hides it', async () => {
    const user = userEvent.setup();
    fakeDevice({ policy: { min_version_code: 0, mode: 'optional', notes: 'Faster order screen' } });
    render(<AppUpdatePrompt signedIn />);
    expect(await screen.findByText('Update available — v1.11')).toBeInTheDocument();
    expect(screen.getByText('Faster order screen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Update available — v1.11')).not.toBeInTheDocument();
  });

  it('Update downloads with progress, then Android\'s install screen', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    let finish: () => void = () => undefined;
    deps.downloadAndInstall.mockImplementation(
      (_m, _token, onProgress) =>
        new Promise<void>((resolve) => {
          onProgress(0.4);
          finish = resolve;
        })
    );
    render(<AppUpdatePrompt signedIn />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByText(/Downloading the update… 40% of 6.0 MB/)).toBeInTheDocument();
    // A just-renewed token, renewed right before the download, goes to the plugin.
    expect(deps.freshAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.downloadAndInstall).toHaveBeenCalledWith(manifest(11), 'fresh-access-token', expect.any(Function));
    await act(async () => finish());
    expect(await screen.findByText(/install screen is open/)).toBeInTheDocument();
  });

  it('asks for the install permission first and opens settings', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    deps.canRequestInstall.mockResolvedValue(false);
    render(<AppUpdatePrompt signedIn />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByText(/allow Blynk Ops to install apps/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(deps.openInstallSettings).toHaveBeenCalled();
    expect(deps.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('a corrupted download says so and offers Try again', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    deps.downloadAndInstall.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'CHECKSUM_MISMATCH' }));
    render(<AppUpdatePrompt signedIn />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The download was corrupted. Try again.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(deps.downloadAndInstall).toHaveBeenCalledTimes(2));
  });

  it('required: a blocking screen with only Update (no Later)', async () => {
    fakeDevice({ manifest: manifest(12), policy: { min_version_code: 12, mode: 'required', notes: 'New payment flow' } });
    render(<AppUpdatePrompt signedIn />);
    const dialog = await screen.findByRole('dialog', { name: 'Update required' });
    expect(within(dialog).getByText(/Install Blynk Ops 1.12 to keep using the app/)).toBeInTheDocument();
    expect(within(dialog).getByText('New payment flow')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Later' })).not.toBeInTheDocument();
  });

  it('signed out: nothing is checked or shown, even below a required minimum; sign-in brings the block', async () => {
    const deps = fakeDevice({ manifest: manifest(12), policy: { min_version_code: 12, mode: 'required', notes: '' } });
    const { container, rerender } = render(<AppUpdatePrompt signedIn={false} />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
    expect(deps.fetchManifest).not.toHaveBeenCalled();
    expect(deps.fetchPolicy).not.toHaveBeenCalled();
    rerender(<AppUpdatePrompt signedIn />);
    expect(await screen.findByRole('dialog', { name: 'Update required' })).toBeInTheDocument();
    expect(deps.fetchManifest).toHaveBeenCalledTimes(1);
    // Signing out (the login screen) lifts the block at once.
    rerender(<AppUpdatePrompt signedIn={false} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a 401 says "Please sign in again"; a 403 says the account cannot download', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    deps.downloadAndInstall.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'UNAUTHORIZED' }));
    deps.downloadAndInstall.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'FORBIDDEN' }));
    render(<AppUpdatePrompt signedIn />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in again.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Your account can't download this app."));
  });

  it('a refused token renewal never reaches the plugin', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    deps.freshAccessToken.mockRejectedValueOnce(Object.assign(new Error('Please sign in again.'), { code: 'UNAUTHORIZED', status: 401 }));
    render(<AppUpdatePrompt signedIn />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in again.');
    expect(deps.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('required but offline with nothing remembered: no block (policy unknown)', async () => {
    fakeDevice({ offline: true });
    const { container } = render(<AppUpdatePrompt signedIn />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('More > App version', () => {
  // Only reachable signed in; the prompt in App sets this from the session.
  beforeEach(() => updateStore.setSignedIn(true));

  it('shows the installed version; Check for updates asks again', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice({ installed: 11 });
    render(<AppVersionCard />);
    expect(await screen.findByText('Blynk Ops 1.11 (build 11)')).toBeInTheDocument();
    expect(await screen.findByText('You have the latest version.')).toBeInTheDocument();
    deps.fetchManifest.mockResolvedValue(manifest(12));
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Version 1.12 is available.')).toBeInTheDocument();
    expect(deps.fetchManifest).toHaveBeenCalledTimes(2);
  });

  it('says when it could not check', async () => {
    fakeDevice({ offline: true });
    render(<AppVersionCard />);
    expect(await screen.findByText('Could not check for updates. Check your connection.')).toBeInTheDocument();
  });

  it('in a browser it explains updates come from the Android app', async () => {
    appUpdateDeps.isNative = () => false;
    render(<AppVersionCard />);
    expect(await screen.findByText('Updates are installed from the Android app.')).toBeInTheDocument();
  });
});

const LINK_OFF = { active: false, path: null, hours: null, created_at: null, expires_at: null };
const LINKS_OFF: AppShareLinks = { ops: LINK_OFF, rider: LINK_OFF, updated_at: null };
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const LINKS_RIDER_ON: AppShareLinks = {
  ops: LINK_OFF,
  rider: {
    active: true,
    path: `/app-updates/share/${TOKEN}/rider.apk`,
    hours: 6,
    created_at: '2026-10-12T06:00:00.000Z',
    expires_at: '2026-10-12T12:00:00.000Z',
  },
  updated_at: '2026-10-12T06:00:00.000Z',
};

const SETTING: AppUpdatesSetting = {
  ops: { min_version_code: 0, mode: 'optional', notes: '' },
  rider: { min_version_code: 3, mode: 'required', notes: 'Rider fix' },
  updated_at: null,
};

describe('More > App updates (setting)', () => {
  it('helpers: minimum version code and the warning', () => {
    expect(parseMinVersionCode('')).toEqual({ value: 0 });
    expect(parseMinVersionCode(' 42 ')).toEqual({ value: 42 });
    expect(parseMinVersionCode('-1')).toHaveProperty('error');
    expect(parseMinVersionCode('1.5')).toHaveProperty('error');
    expect(minimumWarning(60, 'required', { version_code: 55, version_name: '1.5', released_at: '', size: 1 })).toMatch(/above the published/);
    expect(minimumWarning(60, 'optional', { version_code: 55, version_name: '1.5', released_at: '', size: 1 })).toBeNull();
  });

  it('shows the published versions and saves both apps', async () => {
    const user = userEvent.setup();
    tokenStore.save('test-access', 'test-refresh');
    const api = mockApi({
      'GET /admin/settings/app-updates': () => ok(SETTING),
      'PATCH /admin/settings/app-updates': (call) => ok({ ...SETTING, ...(call.body as object), updated_at: '2026-10-12T06:00:00Z' }),
      // The signed-in manifest endpoint (the APKs are not public any more).
      'GET /app-updates/manifest': (call) => (call.query.app === 'ops' ? ok(manifest(57)) : fail(404, 'NOT_FOUND')),
      'GET /admin/settings/app-share-links': () => ok(LINKS_OFF),
    });
    render(<AppUpdatesSettingsCard />);
    expect(await screen.findByLabelText('Blynk Ops latest published version')).toHaveTextContent('1.57 (version code 57)');
    expect(await screen.findByLabelText('Blynk Rider latest published version')).toHaveTextContent('not found');
    expect(screen.getByLabelText('Blynk Rider minimum version code')).toHaveValue('3');

    const opsMin = screen.getByLabelText('Blynk Ops minimum version code');
    await user.clear(opsMin);
    await user.type(opsMin, '57');
    const opsMode = screen.getByRole('group', { name: 'Blynk Ops update mode' });
    await user.click(within(opsMode).getByRole('button', { name: 'Required' }));
    await user.type(screen.getByLabelText('Blynk Ops release notes'), 'Faster orders');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/app-updates')[0]?.body).toEqual({
        ops: { min_version_code: 57, mode: 'required', notes: 'Faster orders' },
        rider: { min_version_code: 3, mode: 'required', notes: 'Rider fix' },
      })
    );
    expect(await screen.findByText('App update settings saved.')).toBeInTheDocument();
    expect(api.find('GET', '/app-updates/manifest').map((c) => c.query.app).sort()).toEqual(['ops', 'rider']);
  });

  it('refuses a bad minimum without saving', async () => {
    const user = userEvent.setup();
    tokenStore.save('test-access', 'test-refresh');
    const api = mockApi({ 'GET /admin/settings/app-updates': () => ok(SETTING) });
    render(<AppUpdatesSettingsCard />);
    const opsMin = await screen.findByLabelText('Blynk Ops minimum version code');
    await user.clear(opsMin);
    await user.type(opsMin, 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blynk Ops: Enter a whole number');
    expect(api.find('PATCH', '/admin/settings/app-updates')).toHaveLength(0);
  });

  it('is on the More page with App version', async () => {
    renderAs(OPERATIONS_STAFF, '/more', { 'GET /admin/settings/app-updates': () => ok(SETTING) });
    expect(await screen.findByRole('heading', { name: 'App updates' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'App version' })).toBeInTheDocument();
  });
});

describe('More > App updates > Share link', () => {
  it('hours must be 1-72', () => {
    expect(parseShareHours('24')).toEqual({ value: 24 });
    expect(parseShareHours(' 1 ')).toEqual({ value: 1 });
    expect(parseShareHours('72')).toEqual({ value: 72 });
    for (const bad of ['0', '73', '1.5', '', 'x', '-3']) expect(parseShareHours(bad)).toHaveProperty('error');
  });

  it('turns a link on for N hours, shows the full link with Copy and expiry, and turns it off', async () => {
    const user = userEvent.setup();
    tokenStore.save('test-access', 'test-refresh');
    let links: AppShareLinks = LINKS_OFF;
    const api = mockApi({
      'GET /admin/settings/app-updates': () => ok(SETTING),
      'GET /app-updates/manifest': () => fail(404, 'NOT_FOUND'),
      'GET /admin/settings/app-share-links': () => ok(links),
      'PATCH /admin/settings/app-share-links': (call) => {
        links = (call.body as { enabled: boolean }).enabled ? LINKS_RIDER_ON : LINKS_OFF;
        return ok(links);
      },
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<AppUpdatesSettingsCard />);
    const rider = await screen.findByRole('group', { name: 'Blynk Rider share link' });
    expect(await within(rider).findByText(/Off\. Only signed-in staff can download Blynk Rider/)).toBeInTheDocument();
    const hours = within(rider).getByLabelText('Blynk Rider share link hours');
    expect(hours).toHaveValue('24');

    await user.clear(hours);
    await user.type(hours, '99');
    await user.click(within(rider).getByRole('button', { name: 'Turn on share link' }));
    expect(await within(rider).findByRole('alert')).toHaveTextContent('1 to 72');
    expect(api.find('PATCH', '/admin/settings/app-share-links')).toHaveLength(0);

    await user.clear(hours);
    await user.type(hours, '6');
    await user.click(within(rider).getByRole('button', { name: 'Turn on share link' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-share-links')[0]?.body).toEqual({ app: 'rider', enabled: true, hours: 6 }));
    const address = await within(rider).findByLabelText('Blynk Rider share link address');
    expect((address as HTMLInputElement).value).toMatch(new RegExp(`/api/v1/app-updates/share/${TOKEN}/rider\\.apk$`));
    expect(within(rider).getByText(/Anyone with this link can download Blynk Rider until/)).toBeInTheDocument();

    await user.click(within(rider).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith((address as HTMLInputElement).value);

    await user.click(within(rider).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-share-links')[1]?.body).toEqual({ app: 'rider', enabled: false }));
    expect(await within(rider).findByText(/Off\. Only signed-in staff/)).toBeInTheDocument();
    // Blynk Ops was never touched.
    expect(within(screen.getByRole('group', { name: 'Blynk Ops share link' })).getByText(/Off\./)).toBeInTheDocument();
  });

  it('shows a refusal from the server', async () => {
    const user = userEvent.setup();
    tokenStore.save('test-access', 'test-refresh');
    mockApi({
      'GET /admin/settings/app-updates': () => ok(SETTING),
      'GET /app-updates/manifest': () => fail(404, 'NOT_FOUND'),
      'GET /admin/settings/app-share-links': () => ok(LINKS_OFF),
      'PATCH /admin/settings/app-share-links': () => fail(403, 'FORBIDDEN', 'Forbidden'),
    });
    render(<AppUpdatesSettingsCard />);
    const ops = await screen.findByRole('group', { name: 'Blynk Ops share link' });
    await user.click(await within(ops).findByRole('button', { name: 'Turn on share link' }));
    expect(await within(ops).findByRole('alert')).toBeInTheDocument();
  });
});
