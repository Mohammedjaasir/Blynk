/*
 * Push registration for the seller app, kept in step with the session and with the seller's
 * choice (the customer app's manager, apps/customer-app/src/blynk/push/manager.ts, plus a
 * visible on / off switch). The platform and the API calls are injected so the rules are
 * testable without a browser:
 *  - start() once; if the platform cannot start (an unsupported browser, no service worker,
 *    the Firebase script blocked) push is simply off and every call below is a no-op;
 *  - signedIn(): register this device (POST /me/devices) - only when notifications are already
 *    allowed and the seller has not turned them off: a browser hands out a token only then, and
 *    asking first would prompt out of context;
 *  - turnOn(): called from the tap on "Turn on notifications": asks the browser, then registers;
 *  - turnOff(): DELETE /me/devices/:token, then delete the token at Firebase, and remember the
 *    choice so the next sign-in does not quietly register again;
 *  - signedOut(accessToken): DELETE /me/devices/:token with the old access token, then delete
 *    the token at Firebase; a failure never matters;
 *  - quiet registration failures are silent: the next sign-in or tap tries again.
 */

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** A push that arrived while the app was open. */
export interface ForegroundMessage {
  title: string;
  body: string;
  /** Where a tap should go (the data.url the server sets), if anywhere. */
  url: string | null;
}

export interface PushPlatform {
  name: 'web';
  initialize(): Promise<void>;
  permission(): PushPermission;
  requestPermission(): Promise<PushPermission>;
  /** Null until notifications are allowed. */
  getToken(): Promise<string | null>;
  deleteToken(): Promise<void>;
  /** A message arrived while the app is open. Returns an unsubscribe. */
  onMessage(cb: (message: ForegroundMessage) => void): () => void;
}

/**
 * What the notifications card shows:
 *  - loading: push is still starting;
 *  - unsupported: this browser cannot do web push;
 *  - needs-install: an iPhone browser tab (web push only works from the Home Screen app);
 *  - denied: the browser is set to block notifications for this site;
 *  - off: can be turned on (not asked yet, turned off by the seller, or not registered yet);
 *  - on: this device is registered.
 */
export type NotifyKind = 'loading' | 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

export interface NotifyState {
  kind: NotifyKind;
  /** A turn on / turn off is under way. */
  busy: boolean;
  /** Plain words for the last failed tap. */
  error: string | null;
}

export type PushDeps = {
  platform: () => PushPlatform | null;
  register: (token: string) => Promise<void>;
  /** With an access token, the call is made outside the session (see signedOut). */
  unregister: (token: string, accessToken?: string) => Promise<void>;
  /** True on an iPhone / iPad browser tab, where the app must be installed first. */
  needsInstall?: () => boolean;
  /** Remembers "the seller turned notifications off" across reloads. */
  store?: { isOff(): boolean; setOff(off: boolean): void };
};

export const TURN_ON_FAILED = 'Could not turn on notifications. Check your internet and try again.';
export const TURN_OFF_FAILED = 'Could not turn off notifications. Check your internet and try again.';

const OFF_KEY = 'blynk.seller.push.off';

/** The seller's "off" choice, in localStorage (never throws: private windows block it). */
export const offStore = {
  isOff(): boolean {
    try {
      return localStorage.getItem(OFF_KEY) === '1';
    } catch {
      return false;
    }
  },
  setOff(off: boolean) {
    try {
      if (off) localStorage.setItem(OFF_KEY, '1');
      else localStorage.removeItem(OFF_KEY);
    } catch {
      /* the choice just will not survive a reload */
    }
  },
};

export function createPushManager(deps: PushDeps) {
  const store = deps.store ?? offStore;
  let started: Promise<PushPlatform | null> | null = null;
  let startedDone = false;
  // the started platform, once known: turnOn() reaches the browser prompt with no await before
  // it, so the prompt stays inside the tap that asked (Safari needs that)
  let platformNow: PushPlatform | null = null;
  let isSignedIn = false;
  let registered: string | null = null;
  let registering: Promise<boolean> | null = null;
  let userOff = store.isOff();
  let working = false;
  let error: string | null = null;
  const listeners = new Set<() => void>();
  const foreground = new Set<(m: ForegroundMessage) => void>();

  const ready = () => started ?? Promise.resolve(null);

  function compute(): NotifyState {
    const busy = working || registering !== null;
    if (!startedDone) return { kind: 'loading', busy, error };
    if (!platformNow) return { kind: deps.needsInstall?.() ? 'needs-install' : 'unsupported', busy, error };
    const permission = platformNow.permission();
    if (permission === 'denied') return { kind: 'denied', busy, error };
    if (permission === 'granted' && !userOff && registered) return { kind: 'on', busy, error };
    return { kind: 'off', busy, error };
  }

  let snapshot = compute();
  const changed = () => {
    snapshot = compute();
    listeners.forEach((l) => l());
  };

  /** Get this device's token and send it to the server. `explicit`: the seller asked for it. */
  async function syncToken(explicit = false): Promise<boolean> {
    const p = platformNow ?? (await ready());
    if (!p || !isSignedIn || p.permission() !== 'granted') return false;
    if (userOff && !explicit) return false;
    if (registering) return registering;
    registering = (async () => {
      try {
        const token = await p.getToken();
        if (!token || !isSignedIn) return false;
        if (token !== registered) {
          await deps.register(token);
          if (!isSignedIn) return false;
          registered = token;
        }
        return true;
      } catch {
        /* no token (blocked, offline) or the server is down: try again later */
        return false;
      }
    })().finally(() => {
      registering = null;
      changed();
    });
    changed();
    return registering;
  }

  return {
    /** Start push once. Never throws; resolves false when push is off. */
    start(): Promise<boolean> {
      started ??= (async () => {
        const p = deps.platform();
        if (!p) return null;
        try {
          await p.initialize();
          p.onMessage((m) => foreground.forEach((l) => l(m)));
          platformNow = p;
          return p;
        } catch {
          return null;
        }
      })().finally(() => {
        startedDone = true;
        changed();
      });
      return started.then((p) => !!p);
    },

    async signedIn(): Promise<void> {
      isSignedIn = true;
      await syncToken();
    },

    async signedOut(accessToken?: string | null): Promise<void> {
      isSignedIn = false;
      const p = await ready();
      if (!p) return;
      const token = registered;
      registered = null;
      if (token && accessToken) {
        try {
          await deps.unregister(token, accessToken);
        } catch {
          /* fine: the token is deleted at Firebase too */
        }
      }
      try {
        await p.deleteToken();
      } catch {
        /* ignore */
      }
      changed();
    },

    /** "Turn on notifications": ask the browser (from the tap), then register. */
    async turnOn(): Promise<void> {
      const p = platformNow ?? (await ready());
      if (!p) {
        changed();
        return;
      }
      working = true;
      error = null;
      changed();
      try {
        let permission = p.permission();
        if (permission === 'default') {
          try {
            permission = await p.requestPermission();
          } catch {
            permission = p.permission();
          }
        }
        if (permission !== 'granted') return;
        userOff = false;
        store.setOff(false);
        if (!(await syncToken(true))) error = TURN_ON_FAILED;
      } finally {
        working = false;
        changed();
      }
    },

    /** "Turn off": this device stops receiving them; the choice is remembered. */
    async turnOff(): Promise<void> {
      const p = platformNow ?? (await ready());
      if (!p) return;
      working = true;
      error = null;
      changed();
      try {
        const token = registered;
        if (token) await deps.unregister(token);
        try {
          await p.deleteToken();
        } catch {
          /* ignore: the server no longer sends to it */
        }
        registered = null;
        userOff = true;
        store.setOff(true);
      } catch {
        error = TURN_OFF_FAILED;
      } finally {
        working = false;
        changed();
      }
    },

    /** Re-read the browser's permission (the seller may have changed it in the browser settings). */
    refresh() {
      changed();
    },

    /** Messages that arrive while the app is open (shown as a toast). Returns an unsubscribe. */
    onForeground(listener: (m: ForegroundMessage) => void) {
      foreground.add(listener);
      return () => {
        foreground.delete(listener);
      };
    },

    getState(): NotifyState {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get registeredToken() {
      return registered;
    },
  };
}

export type PushManager = ReturnType<typeof createPushManager>;
