import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TURN_OFF_FAILED,
  TURN_ON_FAILED,
  createPushManager,
  type ForegroundMessage,
  type PushDeps,
  type PushPermission,
  type PushPlatform,
} from '../lib/push/manager';
import { registerDevice, unregisterDevice, unregisterDeviceWith } from '../lib/push/devices';
import { foregroundMessage, webPushPossible, createWebPushPlatform, BLYNK_WEB_PUSH_VAPID_KEY, BLYNK_WEB_FIREBASE } from '../lib/push/webPlatform';
import { signInStoredSession } from './fixtures';
import { mockApi, ok } from './mockApi';

/** A browser stand-in: the permission, the token Firebase would hand out, the foreground listener. */
function fakePlatform(init: { permission?: PushPermission; token?: string | null; promptAnswer?: PushPermission } = {}) {
  let permission: PushPermission = init.permission ?? 'default';
  let token: string | null = init.token === undefined ? 'tok-1' : init.token;
  let listener: ((m: ForegroundMessage) => void) | null = null;
  const platform: PushPlatform & { calls: string[] } = {
    name: 'web',
    calls: [],
    initialize: vi.fn(async () => undefined),
    permission: () => permission,
    requestPermission: vi.fn(async () => {
      permission = init.promptAnswer ?? 'granted';
      return permission;
    }),
    getToken: vi.fn(async () => (permission === 'granted' ? token : null)),
    deleteToken: vi.fn(async () => undefined),
    onMessage: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
  };
  return {
    platform,
    setPermission: (p: PushPermission) => {
      permission = p;
    },
    setToken: (t: string | null) => {
      token = t;
    },
    emit: (m: ForegroundMessage) => listener?.(m),
  };
}

function memoryStore(off = false) {
  let value = off;
  return { isOff: () => value, setOff: (v: boolean) => void (value = v), get value() { return value; } };
}

function manager(fake: ReturnType<typeof fakePlatform> | null, overrides: Partial<PushDeps> = {}, store = memoryStore()) {
  const register = vi.fn(async (_token: string) => undefined);
  const unregister = vi.fn(async (_token: string, _access?: string) => undefined);
  const m = createPushManager({
    platform: () => fake?.platform ?? null,
    register,
    unregister,
    store,
    ...overrides,
  });
  return { m, register, unregister, store };
}

describe('push manager: what the card shows', () => {
  it('is loading until push has started, then off, ready to be turned on', async () => {
    const { m } = manager(fakePlatform());
    expect(m.getState()).toEqual({ kind: 'loading', busy: false, error: null });
    await m.start();
    expect(m.getState().kind).toBe('off');
  });

  it('says unsupported when the browser cannot do web push', async () => {
    const { m } = manager(null);
    expect(await m.start()).toBe(false);
    expect(m.getState().kind).toBe('unsupported');
  });

  it('says needs-install on an iPhone browser tab (no web push until the app is on the Home Screen)', async () => {
    const { m } = manager(null, { needsInstall: () => true });
    await m.start();
    expect(m.getState().kind).toBe('needs-install');
  });

  it('treats a platform that fails to start as unsupported', async () => {
    const fake = fakePlatform();
    fake.platform.initialize = vi.fn(async () => {
      throw new Error('Firebase script blocked');
    });
    const { m } = manager(fake);
    expect(await m.start()).toBe(false);
    expect(m.getState().kind).toBe('unsupported');
    // and every call is a harmless no-op
    await m.signedIn();
    await m.turnOn();
    await m.signedOut('a');
  });

  it('says denied when the browser blocks notifications', async () => {
    const { m } = manager(fakePlatform({ permission: 'denied' }));
    await m.start();
    expect(m.getState().kind).toBe('denied');
  });

  it('refresh() picks up a permission the seller changed in the browser settings', async () => {
    const fake = fakePlatform({ permission: 'denied' });
    const { m } = manager(fake);
    await m.start();
    fake.setPermission('default');
    m.refresh();
    expect(m.getState().kind).toBe('off');
  });

  it('notifies subscribers when the state changes', async () => {
    const { m } = manager(fakePlatform());
    const seen = vi.fn();
    const off = m.subscribe(seen);
    await m.start();
    expect(seen).toHaveBeenCalled();
    off();
    seen.mockClear();
    m.refresh();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('push manager: signing in', () => {
  it('registers quietly when notifications are already allowed', async () => {
    const { m, register } = manager(fakePlatform({ permission: 'granted' }));
    await m.start();
    await m.signedIn();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('tok-1');
    expect(m.getState().kind).toBe('on');
    expect(m.registeredToken).toBe('tok-1');
  });

  it('never prompts and never registers when the permission has not been asked', async () => {
    const fake = fakePlatform();
    const { m, register } = manager(fake);
    await m.start();
    await m.signedIn();
    expect(fake.platform.requestPermission).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(m.getState().kind).toBe('off');
  });

  it('does not register again after the seller turned notifications off', async () => {
    const { m, register } = manager(fakePlatform({ permission: 'granted' }), {}, memoryStore(true));
    await m.start();
    await m.signedIn();
    expect(register).not.toHaveBeenCalled();
    expect(m.getState().kind).toBe('off');
  });

  it('a failed quiet registration is silent and the card still offers the button', async () => {
    const { m, register } = manager(fakePlatform({ permission: 'granted' }));
    register.mockRejectedValueOnce(new Error('offline'));
    await m.start();
    await m.signedIn();
    expect(m.getState()).toEqual({ kind: 'off', busy: false, error: null });
    await m.turnOn();
    expect(m.getState().kind).toBe('on');
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('does not send the same token twice', async () => {
    const { m, register } = manager(fakePlatform({ permission: 'granted' }));
    await m.start();
    await m.signedIn();
    await m.signedIn();
    expect(register).toHaveBeenCalledTimes(1);
  });
});

describe('push manager: Turn on notifications', () => {
  it('asks the browser, registers the token and shows on', async () => {
    const fake = fakePlatform();
    const { m, register, store } = manager(fake);
    await m.start();
    await m.signedIn();
    await m.turnOn();
    expect(fake.platform.requestPermission).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('tok-1');
    expect(m.getState()).toEqual({ kind: 'on', busy: false, error: null });
    expect(store.value).toBe(false);
  });

  it('shows busy while it works', async () => {
    const { m, register } = manager(fakePlatform());
    let release!: () => void;
    register.mockImplementationOnce(() => new Promise<undefined>((r) => (release = () => r(undefined))));
    await m.start();
    await m.signedIn();
    const pending = m.turnOn();
    expect(m.getState().busy).toBe(true);
    // let the prompt answer and the token request reach the server
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
    release();
    await pending;
    expect(m.getState()).toEqual({ kind: 'on', busy: false, error: null });
  });

  it('keeps the button when the seller dismisses the browser prompt', async () => {
    const { m, register } = manager(fakePlatform({ promptAnswer: 'default' }));
    await m.start();
    await m.signedIn();
    await m.turnOn();
    expect(register).not.toHaveBeenCalled();
    expect(m.getState()).toEqual({ kind: 'off', busy: false, error: null });
  });

  it('says denied when the seller blocks the prompt', async () => {
    const { m, register } = manager(fakePlatform({ promptAnswer: 'denied' }));
    await m.start();
    await m.signedIn();
    await m.turnOn();
    expect(register).not.toHaveBeenCalled();
    expect(m.getState().kind).toBe('denied');
  });

  it('shows a plain error when the server cannot be reached', async () => {
    const { m, register } = manager(fakePlatform());
    register.mockRejectedValue(new Error('offline'));
    await m.start();
    await m.signedIn();
    await m.turnOn();
    expect(m.getState()).toEqual({ kind: 'off', busy: false, error: TURN_ON_FAILED });
  });

  it('turning on again after Turn off clears the remembered choice', async () => {
    const store = memoryStore();
    const { m } = manager(fakePlatform({ permission: 'granted' }), {}, store);
    await m.start();
    await m.signedIn();
    await m.turnOff();
    expect(store.value).toBe(true);
    await m.turnOn();
    expect(store.value).toBe(false);
    expect(m.getState().kind).toBe('on');
  });
});

describe('push manager: Turn off and signing out', () => {
  it('Turn off deletes the device on the server and at Firebase, and remembers it', async () => {
    const fake = fakePlatform({ permission: 'granted' });
    const { m, unregister, store } = manager(fake);
    await m.start();
    await m.signedIn();
    await m.turnOff();
    expect(unregister).toHaveBeenCalledWith('tok-1');
    expect(fake.platform.deleteToken).toHaveBeenCalledTimes(1);
    expect(store.value).toBe(true);
    expect(m.getState()).toEqual({ kind: 'off', busy: false, error: null });
    expect(m.registeredToken).toBeNull();
  });

  it('Turn off that cannot reach the server stays on and says so', async () => {
    const { m, unregister, store } = manager(fakePlatform({ permission: 'granted' }));
    unregister.mockRejectedValue(new Error('offline'));
    await m.start();
    await m.signedIn();
    await m.turnOff();
    expect(m.getState()).toEqual({ kind: 'on', busy: false, error: TURN_OFF_FAILED });
    expect(store.value).toBe(false);
  });

  it('signing out deletes this device with the old access token, then the Firebase token', async () => {
    const fake = fakePlatform({ permission: 'granted' });
    const { m, unregister } = manager(fake);
    await m.start();
    await m.signedIn();
    await m.signedOut('old-access-token');
    expect(unregister).toHaveBeenCalledWith('tok-1', 'old-access-token');
    expect(fake.platform.deleteToken).toHaveBeenCalledTimes(1);
    expect(m.registeredToken).toBeNull();
    expect(m.getState().kind).toBe('off');
  });

  it('a failing sign-out call never matters', async () => {
    const fake = fakePlatform({ permission: 'granted' });
    const { m, unregister } = manager(fake);
    unregister.mockRejectedValue(new Error('offline'));
    await m.start();
    await m.signedIn();
    await expect(m.signedOut('a')).resolves.toBeUndefined();
    expect(fake.platform.deleteToken).toHaveBeenCalled();
  });

  it('signing in again after signing out registers again', async () => {
    const { m, register } = manager(fakePlatform({ permission: 'granted' }));
    await m.start();
    await m.signedIn();
    await m.signedOut('a');
    await m.signedIn();
    expect(register).toHaveBeenCalledTimes(2);
    expect(m.getState().kind).toBe('on');
  });
});

describe('push manager: a push while the app is open', () => {
  it('passes it to the toast listeners until they unsubscribe', async () => {
    const fake = fakePlatform({ permission: 'granted' });
    const { m } = manager(fake);
    const got: ForegroundMessage[] = [];
    const off = m.onForeground((x) => got.push(x));
    await m.start();
    fake.emit({ title: 'Mango Jam is live', body: 'Customers can order it now.', url: '/' });
    off();
    fake.emit({ title: 'later', body: '', url: null });
    expect(got).toEqual([{ title: 'Mango Jam is live', body: 'Customers can order it now.', url: '/' }]);
  });
});

describe('device calls to the API', () => {
  beforeEach(() => signInStoredSession());

  it('registers a web token: POST /me/devices { token, platform: web }', async () => {
    const api = mockApi(() => ok({ registered: true }));
    await registerDevice('abc:123');
    const [call] = api.find('POST', '/me/devices');
    expect(call!.body).toEqual({ token: 'abc:123', platform: 'web' });
  });

  it('turns a device off: DELETE /me/devices/:token (the token is URL-encoded)', async () => {
    const api = mockApi(() => ok({}));
    await unregisterDevice('abc:1/2');
    expect(api.find('DELETE', '/me/devices/abc%3A1%2F2')).toHaveLength(1);
  });

  it('signing out sends the DELETE with the old access token, outside the session', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }) as Response);
    await unregisterDeviceWith('tok', 'old-access', fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/me\/devices\/tok$/);
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer old-access');
  });
});

describe('web platform', () => {
  it('reads a foreground message from the notification block or from data', () => {
    expect(foregroundMessage({ notification: { title: 'Payment sent', body: 'We paid you LKR 1,500.00.' }, data: { url: '/statement' } })).toEqual({
      title: 'Payment sent',
      body: 'We paid you LKR 1,500.00.',
      url: '/statement',
    });
    expect(foregroundMessage({ data: { title: 'Hello', body: 'World' } })).toEqual({ title: 'Hello', body: 'World', url: null });
    expect(foregroundMessage({ data: { type: 'SELLER_APPROVED' } })).toBeNull();
    expect(foregroundMessage(null)).toBeNull();
  });

  it('is not possible in a browser without service workers and notifications (jsdom)', () => {
    expect(webPushPossible()).toBe(false);
    expect(createWebPushPlatform()).toBeNull();
  });

  it('with a (faked) browser it loads Firebase, gets the token with the VAPID key and reports foreground messages', async () => {
    const messaging = {
      getToken: vi.fn(async (_o: { vapidKey: string }) => 'web-token'),
      deleteToken: vi.fn(async () => true),
      onMessage: vi.fn((cb: (p: unknown) => void) => {
        cb({ notification: { title: 'Mango Jam is live', body: 'Customers can order it now.' } });
        return () => undefined;
      }),
    };
    const firebase = {
      apps: [] as unknown[],
      initializeApp: vi.fn(() => {
        firebase.apps.push({});
      }),
      messaging: Object.assign(() => messaging, { isSupported: () => true }),
    };
    const Notification = Object.assign(function () {}, {
      permission: 'default' as NotificationPermission,
      requestPermission: vi.fn(async () => {
        (Notification as unknown as { permission: string }).permission = 'granted';
        return 'granted' as NotificationPermission;
      }),
    });
    vi.stubGlobal('firebase', firebase);
    vi.stubGlobal('Notification', Notification);
    vi.stubGlobal('PushManager', function () {});
    const sw = {};
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
    try {
      const platform = createWebPushPlatform();
      expect(platform).not.toBeNull();
      await platform!.initialize();
      expect(firebase.initializeApp).toHaveBeenCalledWith(BLYNK_WEB_FIREBASE);
      // no token before notifications are allowed
      expect(await platform!.getToken()).toBeNull();
      expect(await platform!.requestPermission()).toBe('granted');
      expect(await platform!.getToken()).toBe('web-token');
      expect(messaging.getToken).toHaveBeenCalledWith({ vapidKey: BLYNK_WEB_PUSH_VAPID_KEY });
      const got: ForegroundMessage[] = [];
      platform!.onMessage((m) => got.push(m));
      expect(got).toEqual([{ title: 'Mango Jam is live', body: 'Customers can order it now.', url: null }]);
      await platform!.deleteToken();
      expect(messaging.deleteToken).toHaveBeenCalled();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    }
  });
});
