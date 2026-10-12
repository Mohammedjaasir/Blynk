import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { AppUpdatePrompt, AppVersionCard } from '../components/AppUpdate';
import { __resetAppUpdateForTests, appUpdateDeps, type UpdateManifest, type UpdatePolicy } from '../lib/app-update';
import { RIDER, fail, renderAs } from './helpers';

/**
 * In-app updates (owner, 2026-10-12): the "Update available" card, the
 * blocking "Update required" screen and My day > App version. Admin and
 * Operations set the policy (tested in those apps and the backend).
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

const SHA = 'b'.repeat(64);
const manifest = (code: number): UpdateManifest => ({
  app: 'rider',
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
    downloadAndInstall: vi.fn(async (_m: UpdateManifest, onProgress: (f: number) => void) => {
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
    const { container } = render(<AppUpdatePrompt />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when the installed app is the latest', async () => {
    fakeDevice({ installed: 11 });
    const { container } = render(<AppUpdatePrompt />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('optional: "Update available" with the notes; Later hides it', async () => {
    const user = userEvent.setup();
    fakeDevice({ policy: { min_version_code: 0, mode: 'optional', notes: 'Clearer stop list' } });
    render(<AppUpdatePrompt />);
    expect(await screen.findByText('Update available — v1.11')).toBeInTheDocument();
    expect(screen.getByText('Clearer stop list')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Update available — v1.11')).not.toBeInTheDocument();
  });

  it('Update downloads with progress, then Android\'s install screen', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    let finish: () => void = () => undefined;
    deps.downloadAndInstall.mockImplementation(
      (_m, onProgress) =>
        new Promise<void>((resolve) => {
          onProgress(0.4);
          finish = resolve;
        })
    );
    render(<AppUpdatePrompt />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByText(/Downloading the update… 40% of 6.0 MB/)).toBeInTheDocument();
    expect(deps.downloadAndInstall).toHaveBeenCalledWith(manifest(11), expect.any(Function));
    await act(async () => finish());
    expect(await screen.findByText(/install screen is open/)).toBeInTheDocument();
  });

  it('asks for the install permission first and opens settings', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    deps.canRequestInstall.mockResolvedValue(false);
    render(<AppUpdatePrompt />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByText(/allow Blynk Rider to install apps/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(deps.openInstallSettings).toHaveBeenCalled();
    expect(deps.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('a corrupted download says so and offers Try again', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice();
    deps.downloadAndInstall.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'CHECKSUM_MISMATCH' }));
    render(<AppUpdatePrompt />);
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The download was corrupted. Try again.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(deps.downloadAndInstall).toHaveBeenCalledTimes(2));
  });

  it('required: a blocking screen with only Update (no Later)', async () => {
    fakeDevice({ manifest: manifest(12), policy: { min_version_code: 12, mode: 'required', notes: 'New payment flow' } });
    render(<AppUpdatePrompt />);
    const dialog = await screen.findByRole('dialog', { name: 'Update required' });
    expect(within(dialog).getByText(/Install Blynk Rider 1.12 to keep using the app/)).toBeInTheDocument();
    expect(within(dialog).getByText('New payment flow')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Later' })).not.toBeInTheDocument();
  });

  it('required but offline with nothing remembered: no block (policy unknown)', async () => {
    fakeDevice({ offline: true });
    const { container } = render(<AppUpdatePrompt />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('My day > App version', () => {
  it('shows the installed version; Check for updates asks again', async () => {
    const user = userEvent.setup();
    const deps = fakeDevice({ installed: 11 });
    render(<AppVersionCard />);
    expect(await screen.findByText('Blynk Rider 1.11 (build 11)')).toBeInTheDocument();
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

describe('My day', () => {
  it('has the App version section', async () => {
    renderAs(RIDER, '/day', {
      // Shown even when the day itself cannot load.
      'GET /riders/me/day': () => fail(500, 'INTERNAL_SERVER_ERROR'),
      'GET /riders/me/earnings': () => fail(500, 'INTERNAL_SERVER_ERROR'),
    });
    expect(await screen.findByRole('region', { name: 'App version' })).toHaveTextContent('Updates are installed from the Android app.');
  });
});
