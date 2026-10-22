import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_MS,
  DISMISS_MS,
  __resetAppUpdateForTests,
  appUpdateDeps,
  currentDecision,
  decideUpdate,
  installErrorMessage,
  parseManifest,
  parsePolicy,
  updateStore,
  type UpdateManifest,
  type UpdatePolicy,
} from '../lib/app-update';

/**
 * In-app updates (owner, 2026-10-12): when to offer or force an update, and
 * the store behind the prompt and More > App version. The native plugin and
 * the network are replaced through appUpdateDeps.
 */
const SHA = 'a'.repeat(64);
const manifest = (code: number, name = `1.${code}`): UpdateManifest => ({
  app: 'ops',
  version_code: code,
  version_name: name,
  sha256: SHA,
  size: 5_000_000,
  released_at: '2026-10-12T06:00:00.000Z',
});
const policy = (p: Partial<UpdatePolicy> = {}): UpdatePolicy => ({ min_version_code: 0, mode: 'optional', notes: '', ...p });
const installed = (code: number) => ({ versionCode: code, versionName: `1.${code}` });
const NOW = 1_760_000_000_000;

describe('decideUpdate', () => {
  const base = { installed: installed(10), manifest: manifest(10), policy: policy(), dismissed: null, now: NOW };

  it('nothing on web/dev (no installed version) or when up to date', () => {
    expect(decideUpdate({ ...base, installed: null, manifest: manifest(99) })).toEqual({ kind: 'none' });
    expect(decideUpdate(base)).toEqual({ kind: 'none' });
    expect(decideUpdate({ ...base, manifest: manifest(9) })).toEqual({ kind: 'none' });
  });

  it('a newer published APK is available, with the notes', () => {
    expect(decideUpdate({ ...base, manifest: manifest(11), policy: policy({ notes: 'Faster' }) })).toEqual({
      kind: 'available',
      manifest: manifest(11),
      notes: 'Faster',
      auto: false,
    });
  });

  it('"Later" hides that version for a day only', () => {
    const dismissed = { versionCode: 11, until: NOW + 1000 };
    expect(decideUpdate({ ...base, manifest: manifest(11), dismissed }).kind).toBe('none');
    expect(decideUpdate({ ...base, manifest: manifest(11), dismissed: { ...dismissed, until: NOW - 1 } }).kind).toBe('available');
    // A newer version than the one put off shows again.
    expect(decideUpdate({ ...base, manifest: manifest(12), dismissed }).kind).toBe('available');
  });

  it('automatic: available with auto, never blocks (even below a minimum), ignores an earlier Later', () => {
    const automatic = policy({ mode: 'automatic', min_version_code: 50, notes: 'Auto' });
    expect(decideUpdate({ ...base, manifest: manifest(11), policy: automatic })).toEqual({
      kind: 'available',
      manifest: manifest(11),
      notes: 'Auto',
      auto: true,
    });
    const dismissed = { versionCode: 11, until: NOW + DISMISS_MS };
    expect(decideUpdate({ ...base, manifest: manifest(11), policy: automatic, dismissed }).kind).toBe('available');
    // Offline (no manifest) or up to date: nothing, never the blocking screen.
    expect(decideUpdate({ ...base, manifest: null, policy: automatic })).toEqual({ kind: 'none' });
    expect(decideUpdate({ ...base, manifest: manifest(10), policy: automatic })).toEqual({ kind: 'none' });
  });

  it('required below the minimum: blocks, and cannot be dismissed', () => {
    const d = decideUpdate({
      ...base,
      manifest: manifest(12),
      policy: policy({ mode: 'required', min_version_code: 12, notes: 'Must' }),
      dismissed: { versionCode: 12, until: NOW + DISMISS_MS },
    });
    expect(d).toEqual({ kind: 'required', manifest: manifest(12), notes: 'Must', minVersionCode: 12 });
  });

  it('required at or above the minimum is just optional', () => {
    const d = decideUpdate({ ...base, manifest: manifest(12), policy: policy({ mode: 'required', min_version_code: 10 }) });
    expect(d.kind).toBe('available');
  });

  it('optional mode never blocks, even below the minimum', () => {
    expect(decideUpdate({ ...base, manifest: manifest(12), policy: policy({ min_version_code: 50 }) }).kind).toBe('available');
  });

  it('never locks staff out when nothing newer is published; blocks offline (no manifest) with a Try again', () => {
    const required = policy({ mode: 'required', min_version_code: 50 });
    expect(decideUpdate({ ...base, manifest: manifest(10), policy: required }).kind).toBe('none');
    expect(decideUpdate({ ...base, manifest: null, policy: required })).toEqual({
      kind: 'required',
      manifest: null,
      notes: '',
      minVersionCode: 50,
    });
  });
});

describe('parsing and messages', () => {
  it('accepts only a well-formed manifest for this app', () => {
    expect(parseManifest(manifest(3))).toEqual(manifest(3));
    expect(parseManifest({ ...manifest(3), sha256: SHA.toUpperCase() })?.sha256).toBe(SHA);
    expect(parseManifest({ ...manifest(3), app: 'rider' })).toBeNull();
    expect(parseManifest({ ...manifest(3), sha256: 'abc' })).toBeNull();
    expect(parseManifest({ ...manifest(3), size: 0 })).toBeNull();
    expect(parseManifest({ ...manifest(3), version_code: 2.5 })).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parsePolicy({ min_version_code: 4, mode: 'required', notes: 'x' })).toEqual(policy({ min_version_code: 4, mode: 'required', notes: 'x' }));
    expect(parsePolicy({ min_version_code: -1 })).toBeNull();
    expect(parsePolicy({ min_version_code: 0, mode: 'automatic' })).toEqual(policy({ mode: 'automatic' }));
    expect(parsePolicy({ min_version_code: 0, mode: 'sometimes' })?.mode).toBe('optional');
    expect(parsePolicy({ min_version_code: 0 })?.mode).toBe('optional');
  });

  it('sign-in problems in plain words', () => {
    expect(installErrorMessage({ code: 'UNAUTHORIZED' })).toBe('Please sign in again.');
    expect(installErrorMessage({ code: 'FORBIDDEN' })).toBe("Your account can't download this app.");
    expect(installErrorMessage({ code: 'TIMEOUT' })).toMatch(/Check your connection/);
  });

  it('turns the plugin codes into plain words', () => {
    expect(installErrorMessage({ code: 'CHECKSUM_MISMATCH' })).toBe('The download was corrupted. Try again.');
    expect(installErrorMessage({ code: 'SIZE_MISMATCH' })).toBe('The download was corrupted. Try again.');
    expect(installErrorMessage({ code: 'NETWORK' })).toMatch(/Check your connection/);
    expect(installErrorMessage({ code: 'SIGNATURE_MISMATCH' })).toMatch(/not signed by Blynk/);
    expect(installErrorMessage(new Error('x'))).toBe('Could not install the update. Try again.');
  });
});

describe('update store', () => {
  const saved = { ...appUpdateDeps };
  let now = NOW;
  let fetchManifest: ReturnType<typeof vi.fn>;
  let fetchPolicy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetAppUpdateForTests();
    // Update checks are for signed-in staff only (the prompt sets this from the session).
    updateStore.setSignedIn(true);
    now = NOW;
    fetchManifest = vi.fn(async () => manifest(11));
    fetchPolicy = vi.fn(async () => policy());
    Object.assign(appUpdateDeps, {
      isNative: () => true,
      getInstalledVersion: async () => installed(10),
      fetchManifest,
      fetchPolicy,
      canRequestInstall: async () => true,
      openInstallSettings: vi.fn(async () => undefined),
      freshAccessToken: vi.fn(async () => 'fresh-access-token'),
      downloadAndInstall: vi.fn(async (_m: UpdateManifest, _token: string, onProgress: (f: number) => void) => {
        onProgress(0.5);
      }),
      now: () => now,
    });
  });
  afterEach(() => {
    Object.assign(appUpdateDeps, saved);
    __resetAppUpdateForTests();
  });

  it('does nothing off Android', async () => {
    appUpdateDeps.isNative = () => false;
    await updateStore.start();
    expect(updateStore.getState().supported).toBe(false);
    expect(fetchManifest).not.toHaveBeenCalled();
    expect(currentDecision().kind).toBe('none');
  });

  it('checks on start; checks again on return only after a few hours', async () => {
    await updateStore.start();
    expect(currentDecision().kind).toBe('available');
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    await updateStore.check();
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    now += CHECK_INTERVAL_MS;
    await updateStore.check();
    expect(fetchManifest).toHaveBeenCalledTimes(2);
    expect(fetchPolicy).toHaveBeenCalledTimes(2);
  });

  it('dismiss hides the reminder for a day and is remembered', async () => {
    await updateStore.start();
    updateStore.dismiss();
    expect(currentDecision().kind).toBe('none');
    // A new launch the same day still remembers it.
    __resetAppUpdateForTests(false);
    updateStore.setSignedIn(true);
    await updateStore.start();
    expect(currentDecision().kind).toBe('none');
    now += DISMISS_MS + 1;
    expect(currentDecision().kind).toBe('available');
  });

  it('offline: keeps the remembered answer, so a required update still blocks', async () => {
    fetchPolicy.mockResolvedValue(policy({ mode: 'required', min_version_code: 11 }));
    await updateStore.start();
    expect(currentDecision().kind).toBe('required');
    expect(updateStore.getState().offline).toBe(false);
    // Next launch with no signal.
    __resetAppUpdateForTests(false);
    updateStore.setSignedIn(true);
    fetchManifest.mockRejectedValue(new TypeError('Failed to fetch'));
    fetchPolicy.mockRejectedValue(new TypeError('Failed to fetch'));
    await updateStore.start();
    expect(updateStore.getState().offline).toBe(true);
    expect(currentDecision()).toMatchObject({ kind: 'required', minVersionCode: 11 });
  });

  it('installs: permission missing -> settings; then download with progress -> installer', async () => {
    await updateStore.start();
    appUpdateDeps.canRequestInstall = async () => false;
    await updateStore.install();
    expect(updateStore.getState().phase).toBe('permission');
    expect(appUpdateDeps.downloadAndInstall).not.toHaveBeenCalled();
    await updateStore.openInstallSettings();
    expect(appUpdateDeps.openInstallSettings).toHaveBeenCalled();

    appUpdateDeps.canRequestInstall = async () => true;
    updateStore.resetPhase();
    await updateStore.install();
    expect(appUpdateDeps.freshAccessToken).toHaveBeenCalledTimes(1);
    expect(appUpdateDeps.downloadAndInstall).toHaveBeenCalledWith(manifest(11), 'fresh-access-token', expect.any(Function));
    expect(updateStore.getState().phase).toBe('installing');
  });

  it('a corrupted download says so and offers Try again', async () => {
    await updateStore.start();
    appUpdateDeps.downloadAndInstall = async () => {
      throw Object.assign(new Error('bad'), { code: 'CHECKSUM_MISMATCH' });
    };
    await updateStore.install();
    expect(updateStore.getState()).toMatchObject({ phase: 'error', installError: 'The download was corrupted. Try again.' });
  });

  it('signed out: never asks the server and shows nothing, even below a required minimum', async () => {
    fetchPolicy.mockResolvedValue(policy({ mode: 'required', min_version_code: 11 }));
    updateStore.setSignedIn(false);
    await updateStore.start();
    await updateStore.check({ force: true });
    expect(fetchManifest).not.toHaveBeenCalled();
    expect(fetchPolicy).not.toHaveBeenCalled();
    expect(currentDecision().kind).toBe('none');
    // Signing in checks at once.
    updateStore.setSignedIn(true);
    await vi.waitFor(() => expect(currentDecision().kind).toBe('required'));
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    // Signing out hides it again (the login screen stays usable).
    updateStore.setSignedIn(false);
    expect(currentDecision().kind).toBe('none');
  });

  it('a token that cannot be renewed: "Please sign in again", and the plugin is not called', async () => {
    await updateStore.start();
    appUpdateDeps.freshAccessToken = vi.fn(async () => {
      throw Object.assign(new Error('Please sign in again.'), { status: 401, code: 'UNAUTHORIZED' });
    });
    await updateStore.install();
    expect(updateStore.getState()).toMatchObject({ phase: 'error', installError: 'Please sign in again.' });
    expect(appUpdateDeps.downloadAndInstall).not.toHaveBeenCalled();
  });

  it('the plugin refusing with 401 / 403', async () => {
    await updateStore.start();
    appUpdateDeps.downloadAndInstall = async () => {
      throw Object.assign(new Error('x'), { code: 'FORBIDDEN' });
    };
    await updateStore.install();
    expect(updateStore.getState().installError).toBe("Your account can't download this app.");
    appUpdateDeps.downloadAndInstall = async () => {
      throw Object.assign(new Error('x'), { code: 'UNAUTHORIZED' });
    };
    await updateStore.install();
    expect(updateStore.getState().installError).toBe('Please sign in again.');
  });

  describe('automatic mode (owner, 2026-10-22)', () => {
    const installCalls = () => (appUpdateDeps.downloadAndInstall as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const automatic = () => policy({ mode: 'automatic' });

    it('a newer version, signed in, idle: starts exactly one install by itself', async () => {
      fetchPolicy.mockResolvedValue(automatic());
      await updateStore.start();
      await vi.waitFor(() => expect(installCalls()).toBe(1));
      expect(appUpdateDeps.downloadAndInstall).toHaveBeenCalledWith(manifest(11), 'fresh-access-token', expect.any(Function));
      await vi.waitFor(() => expect(updateStore.getState().phase).toBe('installing'));
      // Back from the install screen without installing, and later foreground checks: no second attempt.
      updateStore.resetPhase();
      await updateStore.check({ force: true });
      expect(updateStore.maybeAutoInstall()).toBe(false);
      expect(installCalls()).toBe(1);
      expect(updateStore.getState().phase).toBe('idle');
      expect(currentDecision()).toMatchObject({ kind: 'available', auto: true });
    });

    it('signed out: nothing starts; signing in starts it', async () => {
      fetchPolicy.mockResolvedValue(automatic());
      updateStore.setSignedIn(false);
      await updateStore.start();
      await updateStore.check({ force: true });
      expect(updateStore.maybeAutoInstall()).toBe(false);
      expect(installCalls()).toBe(0);
      updateStore.setSignedIn(true);
      await vi.waitFor(() => expect(installCalls()).toBe(1));
    });

    it('a failed attempt is not repeated for the same version (the Update button stays), a newer version tries again', async () => {
      fetchPolicy.mockResolvedValue(automatic());
      appUpdateDeps.downloadAndInstall = vi.fn(async () => {
        throw Object.assign(new Error('x'), { code: 'NETWORK' });
      });
      await updateStore.start();
      await vi.waitFor(() => expect(updateStore.getState().phase).toBe('error'));
      expect(appUpdateDeps.downloadAndInstall).toHaveBeenCalledTimes(1);
      updateStore.resetPhase();
      await updateStore.check({ force: true });
      expect(updateStore.maybeAutoInstall()).toBe(false);
      expect(appUpdateDeps.downloadAndInstall).toHaveBeenCalledTimes(1);
      expect(currentDecision()).toMatchObject({ kind: 'available', auto: true });
      // The manual button still works.
      await updateStore.install();
      expect(appUpdateDeps.downloadAndInstall).toHaveBeenCalledTimes(2);
      // A newer published version is a new attempt.
      fetchManifest.mockResolvedValue(manifest(12));
      updateStore.resetPhase();
      await updateStore.check({ force: true });
      await vi.waitFor(() => expect(appUpdateDeps.downloadAndInstall).toHaveBeenCalledTimes(3));
    });

    it('an earlier Later does not stop it; a download already in progress is never doubled', async () => {
      fetchPolicy.mockResolvedValue(automatic());
      await updateStore.start();
      await vi.waitFor(() => expect(installCalls()).toBe(1));
      let finish: () => void = () => undefined;
      appUpdateDeps.downloadAndInstall = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      updateStore.resetPhase();
      fetchManifest.mockResolvedValue(manifest(12));
      updateStore.dismiss();
      await updateStore.check({ force: true });
      await vi.waitFor(() => expect(updateStore.getState().phase).toBe('downloading'));
      expect(updateStore.maybeAutoInstall()).toBe(false);
      await updateStore.check({ force: true });
      expect(appUpdateDeps.downloadAndInstall).toHaveBeenCalledTimes(1);
      finish();
    });

    it('install permission missing: shows the permission step, then continues by itself once allowed', async () => {
      fetchPolicy.mockResolvedValue(automatic());
      appUpdateDeps.canRequestInstall = async () => false;
      await updateStore.start();
      await vi.waitFor(() => expect(updateStore.getState().phase).toBe('permission'));
      expect(installCalls()).toBe(0);
      // Still waiting for the permission: later checks do not start anything.
      await updateStore.check({ force: true });
      expect(updateStore.maybeAutoInstall()).toBe(false);
      expect(updateStore.getState().phase).toBe('permission');
      appUpdateDeps.canRequestInstall = async () => true;
      updateStore.resetPhase(); // "I have allowed it"
      await vi.waitFor(() => expect(installCalls()).toBe(1));
    });

    it('last check offline: does not start', async () => {
      fetchPolicy.mockResolvedValue(automatic());
      await updateStore.start();
      await vi.waitFor(() => expect(installCalls()).toBe(1));
      updateStore.resetPhase();
      __resetAppUpdateForTests(false);
      updateStore.setSignedIn(true);
      fetchManifest.mockRejectedValue(new TypeError('Failed to fetch'));
      fetchPolicy.mockRejectedValue(new TypeError('Failed to fetch'));
      await updateStore.start();
      expect(updateStore.getState().offline).toBe(true);
      expect(updateStore.maybeAutoInstall()).toBe(false);
      expect(installCalls()).toBe(1);
    });

    it('optional mode never starts by itself', async () => {
      await updateStore.start();
      await updateStore.check({ force: true });
      expect(updateStore.maybeAutoInstall()).toBe(false);
      expect(installCalls()).toBe(0);
      expect(currentDecision()).toMatchObject({ kind: 'available', auto: false });
    });

    it('required mode is unchanged: blocks, never starts by itself', async () => {
      fetchPolicy.mockResolvedValue(policy({ mode: 'required', min_version_code: 11 }));
      await updateStore.start();
      await updateStore.check({ force: true });
      expect(currentDecision().kind).toBe('required');
      expect(updateStore.maybeAutoInstall()).toBe(false);
      expect(installCalls()).toBe(0);
    });
  });
});
