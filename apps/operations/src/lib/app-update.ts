import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { useSyncExternalStore } from 'react';
import { ApiError, apiRequest, freshAccessToken } from '../api/client';

/**
 * In-app updates (owner, 2026-10-12). The app finds a newer APK, downloads it
 * inside the app, checks it and opens Android's install screen (the user taps
 * Install; data and sign-in are kept).
 *
 * - GET /app-updates/manifest?app=<app> (signed in, through the app's own API
 *   client so the token is attached and renewed) says what the latest APK is
 *   (version_code, version_name, sha256, size). The APKs are not public any
 *   more (owner, 2026-10-12): signed out, nothing is checked or shown, and the
 *   login screen always stays usable.
 * - GET /app-updates/policy?app=<app> (public, set by Admin and Operations)
 *   says whether an older install must update: mode 'required' with
 *   min_version_code blocks the app until it is updated; 'optional' only
 *   shows a reminder that can be put off for a day.
 * - The native AppUpdatePlugin (android/.../AppUpdatePlugin.java) downloads
 *   only this app's own APK from a URL fixed in the app,
 *   https://blynk-api.valgrowlabs.com/api/v1/app-updates/download?app=<app>
 *   (the production API - keep it the same host as the release
 *   VITE_API_BASE_URL), with a just-renewed access token passed in for that
 *   one request (never logged or stored). It checks size, SHA-256 and the
 *   signing key, and opens the installer.
 *
 * Checked on start and when the app comes back to the front (at most every
 * CHECK_INTERVAL_MS). Off Android (web, dev in a browser) nothing happens.
 * The last answer is remembered, so a required update still blocks offline.
 *
 * Same file in apps/operations and apps/rider apart from the constants below.
 */
export type StaffApp = 'ops' | 'rider';
export const APP_NAME: StaffApp = 'ops';
export const APP_LABEL = 'Blynk Ops';
export const MANIFEST_PATH = '/app-updates/manifest';
const API_BASE_URL: string = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';
const STORAGE_PREFIX = `blynk.${APP_NAME}.appUpdate`;

export const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const DISMISS_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export interface UpdateManifest {
  app: StaffApp;
  version_code: number;
  version_name: string;
  sha256: string;
  size: number;
  released_at: string;
}
export type UpdateMode = 'optional' | 'required';
export interface UpdatePolicy {
  min_version_code: number;
  mode: UpdateMode;
  notes: string;
}
export interface InstalledVersion {
  versionCode: number;
  versionName: string;
}
export interface Dismissal {
  versionCode: number;
  until: number;
}

export type UpdateDecision =
  | { kind: 'none' }
  | { kind: 'available'; manifest: UpdateManifest; notes: string }
  | { kind: 'required'; manifest: UpdateManifest | null; notes: string; minVersionCode: number };

/**
 * What to show. Required: the policy is 'required' and the installed code is
 * below its minimum - unless the published APK is not newer than what is
 * installed (nothing to install; never lock staff out). With no manifest
 * known yet (offline) a required update still blocks, with a Try again.
 * Available: a newer published APK that was not put off for later.
 */
export function decideUpdate(input: {
  installed: InstalledVersion | null;
  manifest: UpdateManifest | null;
  policy: UpdatePolicy | null;
  dismissed: Dismissal | null;
  now: number;
}): UpdateDecision {
  const { installed, manifest, policy, dismissed, now } = input;
  if (!installed) return { kind: 'none' };
  const newer = manifest && manifest.version_code > installed.versionCode ? manifest : null;
  const notes = policy?.notes ?? '';
  if (policy && policy.mode === 'required' && installed.versionCode < policy.min_version_code && (newer || !manifest)) {
    return { kind: 'required', manifest: newer, notes, minVersionCode: policy.min_version_code };
  }
  if (!newer) return { kind: 'none' };
  if (dismissed && dismissed.versionCode === newer.version_code && dismissed.until > now) return { kind: 'none' };
  return { kind: 'available', manifest: newer, notes };
}

/** Accepts only a well-formed manifest for this app. */
export function parseManifest(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.app !== APP_NAME) return null;
  if (typeof v.version_code !== 'number' || !Number.isInteger(v.version_code) || v.version_code < 1) return null;
  if (typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(v.sha256)) return null;
  if (typeof v.size !== 'number' || !Number.isInteger(v.size) || v.size <= 0) return null;
  return {
    app: APP_NAME,
    version_code: v.version_code,
    version_name: typeof v.version_name === 'string' ? v.version_name : String(v.version_code),
    sha256: v.sha256.toLowerCase(),
    size: v.size,
    released_at: typeof v.released_at === 'string' ? v.released_at : '',
  };
}

export function parsePolicy(value: unknown): UpdatePolicy | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const code = v.min_version_code;
  if (typeof code !== 'number' || !Number.isInteger(code) || code < 0) return null;
  return {
    min_version_code: code,
    mode: v.mode === 'required' ? 'required' : 'optional',
    notes: typeof v.notes === 'string' ? v.notes : '',
  };
}

/** The plugin's (and the token renewal's) rejection codes in the user's words. */
export function installErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'UNAUTHORIZED':
      return 'Please sign in again.';
    case 'FORBIDDEN':
      return "Your account can't download this app.";
    case 'CHECKSUM_MISMATCH':
    case 'SIZE_MISMATCH':
    case 'INVALID_APK':
      return 'The download was corrupted. Try again.';
    case 'NETWORK':
    case 'TIMEOUT':
      return 'Could not download the update. Check your connection and try again.';
    case 'SIGNATURE_MISMATCH':
      return 'This update is not signed by Blynk, so it was not installed. Tell the store.';
    case 'BUSY':
      return 'The update is already downloading.';
    case 'INSTALL_PERMISSION':
      return `Allow ${APP_LABEL} to install apps, then tap Update again.`;
    default:
      return 'Could not install the update. Try again.';
  }
}

export function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Native plugin + network (replaceable in tests through `appUpdateDeps`).
// ---------------------------------------------------------------------------
interface AppUpdatePlugin {
  getInstalledVersion(): Promise<{ versionCode: number; versionName: string }>;
  canRequestInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  /** accessToken: used by the plugin only as this one request's Authorization header. */
  downloadAndInstall(options: { expectedSha256: string; size: number; accessToken: string }): Promise<{ status: string }>;
  addListener(
    event: 'downloadProgress',
    listener: (p: { downloaded: number; total: number }) => void
  ): Promise<PluginListenerHandle>;
}
const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

async function getText(url: string): Promise<{ ok: boolean; text: string }> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller?.signal });
    return { ok: res.ok, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

export const appUpdateDeps = {
  isNative(): boolean {
    try {
      return Capacitor.getPlatform() === 'android';
    } catch {
      return false;
    }
  },
  async getInstalledVersion(): Promise<InstalledVersion> {
    const v = await AppUpdate.getInstalledVersion();
    return { versionCode: Number(v.versionCode), versionName: String(v.versionName ?? '') };
  },
  /**
   * Signed in only (the API client attaches and renews the token). Throws
   * when unreachable; null when nothing is published (404), this account may
   * not download the app (403), or the manifest is malformed.
   */
  async fetchManifest(): Promise<UpdateManifest | null> {
    try {
      return parseManifest(await apiRequest<unknown>(`${MANIFEST_PATH}?app=${APP_NAME}`));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403 || err.status === 401)) return null;
      throw err;
    }
  },
  async fetchPolicy(): Promise<UpdatePolicy | null> {
    const { ok, text } = await getText(`${API_BASE_URL}/app-updates/policy?app=${APP_NAME}`);
    if (!ok) return null;
    return parsePolicy((JSON.parse(text) as { data?: unknown }).data);
  },
  async canRequestInstall(): Promise<boolean> {
    return (await AppUpdate.canRequestInstall()).allowed;
  },
  async openInstallSettings(): Promise<void> {
    await AppUpdate.openInstallSettings();
  },
  /** A just-renewed access token (api/client.ts); throws ApiError UNAUTHORIZED / NETWORK. */
  freshAccessToken: (): Promise<string> => freshAccessToken(),
  async downloadAndInstall(
    manifest: UpdateManifest,
    accessToken: string,
    onProgress: (fraction: number) => void
  ): Promise<void> {
    const handle = await AppUpdate.addListener('downloadProgress', (p) => {
      if (p.total > 0) onProgress(Math.min(1, p.downloaded / p.total));
    }).catch(() => null);
    try {
      await AppUpdate.downloadAndInstall({ expectedSha256: manifest.sha256, size: manifest.size, accessToken });
    } finally {
      await handle?.remove().catch(() => undefined);
    }
  },
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// One shared store: the prompt (App) and "Check for updates" (More) read it.
// ---------------------------------------------------------------------------
export type InstallPhase = 'idle' | 'permission' | 'downloading' | 'installing' | 'error';

export interface UpdateState {
  /** null until known; false off Android. */
  supported: boolean | null;
  /** Signed in (set by the prompt from the session). Signed out: nothing is checked or shown. */
  signedIn: boolean;
  installed: InstalledVersion | null;
  manifest: UpdateManifest | null;
  policy: UpdatePolicy | null;
  lastChecked: number | null;
  checking: boolean;
  /** The last check could not reach the server. */
  offline: boolean;
  dismissed: Dismissal | null;
  phase: InstallPhase;
  progress: number | null;
  installError: string | null;
}

const initialState = (): UpdateState => ({
  supported: null,
  signedIn: false,
  installed: null,
  manifest: null,
  policy: null,
  lastChecked: null,
  checking: false,
  offline: false,
  dismissed: null,
  phase: 'idle',
  progress: null,
  installError: null,
});

let state: UpdateState = initialState();
const listeners = new Set<() => void>();
let started: Promise<void> | null = null;
let stopVisibility: (() => void) | null = null;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: the reminder simply comes back */
  }
}

export const updateStore = {
  getState: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Once per app run: read the installed version, the remembered answer, then check. */
  start(): Promise<void> {
    if (started) return started;
    started = (async () => {
      if (!appUpdateDeps.isNative()) {
        set({ supported: false });
        return;
      }
      let installed: InstalledVersion;
      try {
        installed = await appUpdateDeps.getInstalledVersion();
      } catch {
        set({ supported: false });
        return;
      }
      const cached = readJson<{ manifest: unknown; policy: unknown; checkedAt: number }>('cache');
      set({
        supported: true,
        installed,
        manifest: parseManifest(cached?.manifest),
        policy: parsePolicy(cached?.policy),
        dismissed: readJson<Dismissal>('dismissed'),
      });
      if (typeof document !== 'undefined') {
        const onVisible = () => {
          if (document.visibilityState !== 'visible') return;
          // Back from Android's install screen without installing (an install
          // restarts the app): offer the button again.
          if (state.phase === 'installing') updateStore.resetPhase();
          // Back from "Install unknown apps": continue once it is allowed.
          if (state.phase === 'permission') {
            appUpdateDeps
              .canRequestInstall()
              .then((allowed) => allowed && state.phase === 'permission' && updateStore.resetPhase())
              .catch(() => undefined);
          }
          void updateStore.check();
        };
        document.addEventListener('visibilitychange', onVisible);
        stopVisibility = () => document.removeEventListener('visibilitychange', onVisible);
      }
      await updateStore.check({ force: true });
    })();
    return started;
  },

  /**
   * Signed in or out (the prompt follows the session). Signing in checks at
   * once; signing out hides everything and stops any further checks.
   */
  setSignedIn(signedIn: boolean): void {
    if (signedIn === state.signedIn) return;
    set({ signedIn, lastChecked: null, offline: false, ...(signedIn ? {} : { phase: 'idle', progress: null, installError: null }) });
    if (signedIn) void updateStore.check({ force: true });
  },

  /** Asks the server again (at most every CHECK_INTERVAL_MS unless forced). Signed in only. */
  async check(options: { force?: boolean } = {}): Promise<void> {
    if (!state.supported || !state.signedIn || state.checking) return;
    const now = appUpdateDeps.now();
    if (!options.force && state.lastChecked !== null && now - state.lastChecked < CHECK_INTERVAL_MS) return;
    set({ checking: true });
    const [manifest, policy] = await Promise.allSettled([appUpdateDeps.fetchManifest(), appUpdateDeps.fetchPolicy()]);
    const patch: Partial<UpdateState> = { checking: false, lastChecked: now };
    patch.offline = manifest.status === 'rejected' && policy.status === 'rejected';
    // A failed fetch keeps the remembered answer; a reachable but missing one clears it.
    if (manifest.status === 'fulfilled') patch.manifest = manifest.value;
    if (policy.status === 'fulfilled') patch.policy = policy.value;
    set(patch);
    writeJson('cache', { manifest: state.manifest, policy: state.policy, checkedAt: now });
  },

  /** "Later": hide this version's reminder for a day (never a required update). */
  dismiss() {
    const decision = currentDecision();
    if (decision.kind !== 'available') return;
    const dismissed = { versionCode: decision.manifest.version_code, until: appUpdateDeps.now() + DISMISS_MS };
    writeJson('dismissed', dismissed);
    set({ dismissed });
  },

  /** The Update button: permission first, then download, check and install. */
  async install(): Promise<void> {
    const decision = currentDecision();
    const manifest = decision.kind === 'none' ? null : decision.manifest;
    if (!manifest || state.phase === 'downloading') return;
    set({ installError: null });
    let allowed = true;
    try {
      allowed = await appUpdateDeps.canRequestInstall();
    } catch {
      allowed = true; // let the plugin decide
    }
    if (!allowed) {
      set({ phase: 'permission' });
      return;
    }
    set({ phase: 'downloading', progress: 0 });
    try {
      // Renewed right before the download: the plugin sends it once, as the
      // Authorization header of that single request.
      const accessToken = await appUpdateDeps.freshAccessToken();
      await appUpdateDeps.downloadAndInstall(manifest, accessToken, (progress) => set({ progress }));
      set({ phase: 'installing', progress: 1 });
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'INSTALL_PERMISSION') {
        set({ phase: 'permission', progress: null });
        return;
      }
      set({ phase: 'error', progress: null, installError: installErrorMessage(err) });
    }
  },

  async openInstallSettings(): Promise<void> {
    try {
      await appUpdateDeps.openInstallSettings();
    } catch {
      set({ phase: 'error', installError: `Open Settings > Apps > ${APP_LABEL} > Install unknown apps, and allow it.` });
    }
  },

  /** Back from the install screen without installing: offer the button again. */
  resetPhase() {
    set({ phase: 'idle', progress: null, installError: null });
  },
};

export function currentDecision(s: UpdateState = state): UpdateDecision {
  // Signed out: nothing (the login screen stays usable, even below a required minimum).
  if (!s.signedIn) return { kind: 'none' };
  return decideUpdate({
    installed: s.installed,
    manifest: s.manifest,
    policy: s.policy,
    dismissed: s.dismissed,
    now: appUpdateDeps.now(),
  });
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(updateStore.subscribe, updateStore.getState, updateStore.getState);
}

/** Test-only: a fresh app run; `clearStorage` also forgets the remembered answers. */
export function __resetAppUpdateForTests(clearStorage = true): void {
  stopVisibility?.();
  stopVisibility = null;
  started = null;
  state = initialState();
  if (clearStorage) {
    try {
      localStorage.removeItem(`${STORAGE_PREFIX}.cache`);
      localStorage.removeItem(`${STORAGE_PREFIX}.dismissed`);
    } catch {
      /* ignored */
    }
  }
  listeners.forEach((l) => l());
}
