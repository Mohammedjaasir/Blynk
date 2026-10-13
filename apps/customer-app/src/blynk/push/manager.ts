import type { PushPlatformName } from '@/blynk/api/push';

/*
 * Push registration, kept in step with the session (Flutter's PushNotifications +
 * PushSessionSync), with the platform and the API calls injected so the rules are testable:
 *  - start() once; if the platform cannot start (an unsupported browser, no service worker,
 *    the Firebase script blocked) push is simply off and every call below is a no-op;
 *  - signedIn(): register this device (POST /me/devices) - only when notifications are already
 *    allowed: a browser hands out a token only then, and asking first would prompt out of
 *    context;
 *  - requestPermission(): called at a moment that explains itself (placing an order, "Notify
 *    me", the account screen's switch), from the tap itself; registers right after;
 *  - a new token (token refresh) is registered while signed in; the same token is not sent twice;
 *  - signedOut(accessToken): DELETE /me/devices/:token with the old access token, then delete
 *    the token at Firebase; a failure never matters;
 *  - registration failures are silent: the next sign-in or permission grant tries again.
 */

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface PushPlatform {
  name: PushPlatformName;
  initialize(): Promise<void>;
  permission(): PushPermission;
  requestPermission(): Promise<PushPermission>;
  /** Null until notifications are allowed. */
  getToken(): Promise<string | null>;
  deleteToken(): Promise<void>;
  /** A notification was tapped (its data). Returns an unsubscribe. */
  onTap(cb: (data: Record<string, unknown>) => void): () => void;
}

export type PushDeps = {
  platform: () => PushPlatform | null;
  register: (token: string, platform: PushPlatformName) => Promise<void>;
  unregister: (token: string, accessToken: string) => Promise<void>;
  onTap?: (data: Record<string, unknown>) => void;
};

export function createPushManager(deps: PushDeps) {
  let started: Promise<PushPlatform | null> | null = null;
  // the started platform, once known: requestPermission() reaches the browser prompt with no
  // await before it, so the prompt stays inside the tap that asked (Safari needs that)
  let platformNow: PushPlatform | null = null;
  let isSignedIn = false;
  let registered: string | null = null;
  let registering: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());

  const ready = () => started ?? Promise.resolve(null);

  async function registerToken(p: PushPlatform, token: string) {
    if (token === registered) return;
    try {
      await deps.register(token, p.name);
      if (isSignedIn) registered = token;
    } catch {
      /* offline or the server is down: the next sign-in or grant tries again */
    }
  }

  async function syncToken() {
    const p = await ready();
    if (!p || !isSignedIn || p.permission() !== 'granted') return;
    if (registering) return registering;
    registering = (async () => {
      try {
        const token = await p.getToken();
        if (token && isSignedIn) await registerToken(p, token);
      } catch { /* no token (blocked, offline): try again later */ }
    })().finally(() => { registering = null; });
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
          p.onTap((data) => deps.onTap?.(data));
          platformNow = p;
          return p;
        } catch {
          return null;
        }
      })();
      return started.then((p) => { changed(); return !!p; });
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
        try { await deps.unregister(token, accessToken); } catch { /* fine: see above */ }
      }
      try { await p.deleteToken(); } catch { /* ignore */ }
    },
    /** Ask the browser to allow notifications (call from a tap). Registers when allowed. */
    async requestPermission(): Promise<PushPermission> {
      const p = platformNow ?? (await ready());
      if (!p) return 'unsupported';
      let result: PushPermission = p.permission();
      if (result === 'default') {
        try { result = await p.requestPermission(); } catch { result = p.permission(); }
      }
      changed();
      if (result === 'granted') await syncToken();
      return result;
    },
    /** A rotated token while signed in. */
    async tokenRefreshed(token: string) {
      const p = await ready();
      if (p && isSignedIn && token) await registerToken(p, token);
    },
    async permission(): Promise<PushPermission> {
      const p = await ready();
      return p ? p.permission() : 'unsupported';
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    get registeredToken() { return registered; },
  };
}

export type PushManager = ReturnType<typeof createPushManager>;
