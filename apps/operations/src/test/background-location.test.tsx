import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliverySummary } from '../api/types';
import type { TrackingPoint } from '../lib/geolocation-plugin';

/**
 * Screen-off location sharing in the Ops Android app (2026-10-02):
 * lib/location-mode.ts (which watcher, the explanation screen, the
 * "Not now" fallback), api/native-client.ts (location POSTs over native
 * HTTP, never global CapacitorHttp) and background-location-plugin.ts (the
 * native adapter). Capacitor, the community plugin and the browser watcher
 * are all fakes - nothing native or networked runs here.
 */
const h = vi.hoisted(() => {
  const makeFake = () => {
    const fake = {
      onPoint: (() => {}) as (p: TrackingPoint) => void,
      checkPermission: vi.fn(async () => 'not_requested' as string),
      requestPermission: vi.fn(async () => 'granted' as string),
      start: vi.fn(async (onPoint: (p: TrackingPoint) => void) => {
        fake.onPoint = onPoint;
      }),
      stop: vi.fn(async () => undefined),
    };
    return fake;
  };
  return {
    native: { value: false },
    http: vi.fn(),
    background: makeFake(),
    browser: makeFake(),
    nativePlugin: {
      addWatcher: vi.fn(async () => 'w-1'),
      removeWatcher: vi.fn(async () => undefined),
      checkPermissions: vi.fn(async () => ({ location: 'prompt' })),
      requestPermissions: vi.fn(async () => ({ location: 'granted' })),
    },
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native.value },
  CapacitorHttp: { request: h.http },
  registerPlugin: () => h.nativePlugin,
}));
vi.mock('../lib/geolocation-plugin', () => ({ browserGeolocationPlugin: h.browser }));

type LocationModeModule = typeof import('../lib/location-mode');
type SessionModule = typeof import('../lib/tracker-session');

function summary(overrides: Partial<DeliverySummary> = {}): DeliverySummary {
  return {
    delivery_id: 'd-1',
    order_id: 'o-1',
    assignment_status: 'PICKED_UP',
    assigned_at: new Date().toISOString(),
    accepted_at: null,
    picked_up_at: new Date().toISOString(),
    order_number: 'BL-20261002-0001',
    order_status: 'OUT_FOR_DELIVERY',
    total_amount: 610,
    payment_method: 'COD',
    payment_status: 'PENDING',
    delivery_recipient_name: 'Priya Fernando',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '12 Galle Road',
    delivery_address_line2: null,
    delivery_city: 'Colombo 3',
    delivery_instructions: null,
    ...overrides,
  };
}
const onRoad = () => summary();
const arrived = () => summary({ assignment_status: 'ARRIVED_AT_CUSTOMER' });

let clock = Date.parse('2026-10-02T10:00:00Z');
const point = (): TrackingPoint => ({ latitude: 6.9, longitude: 79.85, accuracy: 8, capturedAt: new Date((clock += 60_000)) });

let mode: LocationModeModule;
let session: SessionModule;

/** Uses the real background-location-plugin, but a fake for its native half
 * when a test wants the tracker's lifecycle against a simple TrackingPlugin. */
async function load({ fakeBackground }: { fakeBackground: boolean }) {
  vi.resetModules();
  vi.doUnmock('../lib/background-location-plugin');
  if (fakeBackground) {
    vi.doMock('../lib/background-location-plugin', () => ({ backgroundLocationPlugin: h.background }));
  }
  mode = await import('../lib/location-mode');
  session = await import('../lib/tracker-session');
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.native.value = false;
  h.background.checkPermission.mockResolvedValue('not_requested');
  h.background.requestPermission.mockResolvedValue('granted');
  h.browser.requestPermission.mockResolvedValue('granted');
  localStorage.clear();
  await load({ fakeBackground: true });
});

describe('web / dev build (not native)', () => {
  it('uses the browser watcher, never prompts, never touches the native plugin', async () => {
    const prompter = vi.fn(async () => true);
    mode.setBackgroundPrompter(prompter);
    await session.syncTracking(onRoad());
    expect(prompter).not.toHaveBeenCalled();
    expect(h.browser.start).toHaveBeenCalledTimes(1);
    expect(h.background.start).not.toHaveBeenCalled();
    expect(mode.getLocationMode()).toBe('web');
  });
});

describe('Android app: start/stop lifecycle', () => {
  beforeEach(() => {
    h.native.value = true;
  });

  it('explains first, then asks Android, then runs the background watcher; arrival stops it', async () => {
    const prompter = vi.fn(async () => true);
    mode.setBackgroundPrompter(prompter);
    await session.syncTracking(onRoad());
    expect(prompter).toHaveBeenCalledTimes(1);
    expect(prompter.mock.invocationCallOrder[0]).toBeLessThan(h.background.requestPermission.mock.invocationCallOrder[0]);
    expect(h.background.start).toHaveBeenCalledTimes(1);
    expect(h.browser.start).not.toHaveBeenCalled();
    expect(mode.getLocationMode()).toBe('background');
    expect(session.getTracker().getState().active).toBe(true);

    await session.syncTracking(arrived());
    expect(h.background.stop).toHaveBeenCalledTimes(1);
    expect(session.getTracker().getState().active).toBe(false);
  });

  it('skips the explanation when Android already granted location; sign-out (stopTracking) stops it', async () => {
    h.background.checkPermission.mockResolvedValue('granted');
    const prompter = vi.fn(async () => true);
    mode.setBackgroundPrompter(prompter);
    await session.syncTracking(onRoad());
    expect(prompter).not.toHaveBeenCalled();
    expect(h.background.requestPermission).not.toHaveBeenCalled();
    expect(h.background.start).toHaveBeenCalledTimes(1);

    await session.stopTracking();
    expect(h.background.stop).toHaveBeenCalledTimes(1);
    expect(session.getTracker().getDeliveryId()).toBeNull();
  });

  it('delivered / failed (not trackable any more) stop the native watcher', async () => {
    h.background.checkPermission.mockResolvedValue('granted');
    await session.syncTracking(onRoad());
    await session.syncTracking(summary({ assignment_status: 'DELIVERED', order_status: 'DELIVERED' }));
    expect(h.background.stop).toHaveBeenCalledTimes(1);
    await session.syncTracking(onRoad());
    await session.syncTracking(summary({ assignment_status: 'FAILED', order_status: 'OUT_FOR_DELIVERY' }));
    expect(h.background.stop).toHaveBeenCalledTimes(2);
  });

  it('"Not now" falls back to foreground-only sharing and is not asked again this run', async () => {
    const prompter = vi.fn(async () => false);
    mode.setBackgroundPrompter(prompter);
    await session.syncTracking(onRoad());
    expect(h.background.requestPermission).not.toHaveBeenCalled();
    expect(h.background.start).not.toHaveBeenCalled();
    expect(h.browser.start).toHaveBeenCalledTimes(1);
    expect(mode.getLocationMode()).toBe('foreground');

    await session.syncTracking(arrived());
    expect(h.browser.stop).toHaveBeenCalledTimes(1);
    await session.syncTracking(summary({ delivery_id: 'd-2' }));
    expect(prompter).toHaveBeenCalledTimes(1);
    expect(h.browser.start).toHaveBeenCalledTimes(2);
  });

  it('Android refusing location reports denied without a second (WebView) prompt', async () => {
    h.background.requestPermission.mockResolvedValue('denied');
    mode.setBackgroundPrompter(async () => true);
    await session.syncTracking(onRoad());
    expect(h.browser.requestPermission).not.toHaveBeenCalled();
    expect(h.browser.start).not.toHaveBeenCalled();
    expect(session.getTracker().getState().permission).toBe('denied');
  });

  it('a server refusal (409) on a native post stops the native watcher', async () => {
    h.background.checkPermission.mockResolvedValue('granted');
    localStorage.setItem('blynk.operations.accessToken', 'tok');
    h.http.mockResolvedValue({ status: 409, data: JSON.stringify({ error: { code: 'NOT_TRACKABLE', message: 'no' } }), headers: {}, url: '' });
    await session.syncTracking(onRoad());
    await act(async () => {
      h.background.onPoint(point());
      await new Promise((r) => setTimeout(r, 0));
    });
    await session.stopTrackingFor('d-other'); // drains the queue
    expect(h.http).toHaveBeenCalled();
    expect(h.background.stop).toHaveBeenCalled();
  });
});

describe('native-post path (api/native-client.ts)', () => {
  beforeEach(() => {
    h.native.value = true;
    localStorage.setItem('blynk.operations.accessToken', 'access-1');
    localStorage.setItem('blynk.operations.refreshToken', 'refresh-1');
  });

  it('posts location over CapacitorHttp with the bearer token, never through fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    h.http.mockResolvedValue({ status: 200, data: JSON.stringify({ data: { accepted: true } }), headers: {}, url: '' });
    const { delivery } = await import('../api/resources');
    const result = await delivery.sendLocation('d-1', { latitude: 6.9, longitude: 79.8, accuracy: 5, captured_at: '2026-10-02T10:00:00Z' });
    expect(result).toEqual({ accepted: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    const req = h.http.mock.calls[0][0];
    expect(req.method).toBe('POST');
    expect(req.url).toMatch(/\/riders\/deliveries\/d-1\/location$/);
    expect(req.headers.Authorization).toBe('Bearer access-1');
    expect(JSON.parse(req.data)).toMatchObject({ latitude: 6.9, captured_at: '2026-10-02T10:00:00Z' });
    vi.unstubAllGlobals();
  });

  it('on 401 refreshes once over native HTTP, saves the new tokens and retries', async () => {
    h.http
      .mockResolvedValueOnce({ status: 401, data: '{}', headers: {}, url: '' })
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify({ data: { access_token: 'access-2', refresh_token: 'refresh-2' } }), headers: {}, url: '' })
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify({ data: { accepted: true } }), headers: {}, url: '' });
    const { delivery } = await import('../api/resources');
    await delivery.sendLocation('d-1', { latitude: 1, longitude: 2, accuracy: 3, captured_at: 'x' });
    expect(h.http).toHaveBeenCalledTimes(3);
    expect(h.http.mock.calls[1][0].url).toMatch(/\/auth\/refresh$/);
    expect(JSON.parse(h.http.mock.calls[1][0].data)).toEqual({ refresh_token: 'refresh-1' });
    expect(h.http.mock.calls[2][0].headers.Authorization).toBe('Bearer access-2');
    expect(localStorage.getItem('blynk.operations.refreshToken')).toBe('refresh-2');
  });

  it('turns a server refusal into an ApiError with its status and code', async () => {
    h.http.mockResolvedValue({ status: 404, data: JSON.stringify({ error: { code: 'DELIVERY_NOT_FOUND', message: 'gone' } }), headers: {}, url: '' });
    const { delivery } = await import('../api/resources');
    await expect(delivery.sendLocation('d-1', { latitude: 1, longitude: 2, accuracy: 3, captured_at: 'x' })).rejects.toMatchObject({
      status: 404,
      code: 'DELIVERY_NOT_FOUND',
    });
  });

  it('a native transport failure is a NETWORK ApiError', async () => {
    h.http.mockRejectedValue(new Error('offline'));
    const { delivery } = await import('../api/resources');
    await expect(delivery.sendLocation('d-1', { latitude: 1, longitude: 2, accuracy: 3, captured_at: 'x' })).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK',
    });
  });
});

describe('the native adapter (background-location-plugin.ts)', () => {
  beforeEach(async () => {
    await load({ fakeBackground: false });
  });

  it('starts a watcher with the foreground-service notification, maps points and errors, and removes it on stop', async () => {
    const { backgroundLocationPlugin, NOTIFICATION_TITLE } = await import('../lib/background-location-plugin');
    expect(NOTIFICATION_TITLE).toBe('Blynk Ops is sharing your location for an active delivery');
    const onPoint = vi.fn();
    const onError = vi.fn();
    await backgroundLocationPlugin.start(onPoint, onError);
    const [options, callback] = h.nativePlugin.addWatcher.mock.calls[0] as unknown as [
      Record<string, unknown>,
      (p?: unknown, e?: unknown) => void,
    ];
    expect(options).toMatchObject({ backgroundTitle: NOTIFICATION_TITLE, distanceFilter: 25, stale: false });
    expect(typeof options.backgroundMessage).toBe('string');
    callback({ latitude: 6.9, longitude: 79.8, accuracy: 5, time: 1_000 });
    expect(onPoint).toHaveBeenCalledWith({ latitude: 6.9, longitude: 79.8, accuracy: 5, capturedAt: new Date(1_000) });
    callback(undefined, { code: 'NOT_AUTHORIZED' });
    expect(onError).toHaveBeenCalledWith('permission_denied');
    await backgroundLocationPlugin.stop();
    expect(h.nativePlugin.removeWatcher).toHaveBeenCalledWith({ id: 'w-1' });
  });

  it('maps Android permission answers', async () => {
    const { backgroundLocationPlugin } = await import('../lib/background-location-plugin');
    expect(await backgroundLocationPlugin.checkPermission()).toBe('not_requested');
    expect(await backgroundLocationPlugin.requestPermission()).toBe('granted');
    h.nativePlugin.requestPermissions.mockRejectedValueOnce(new Error('x'));
    expect(await backgroundLocationPlugin.requestPermission()).toBe('unavailable');
  });
});

describe('explanation screen and status notice', () => {
  let BackgroundLocationPrompt: typeof import('../components/BackgroundLocationPrompt').BackgroundLocationPrompt;
  let TrackingStatus: typeof import('../components/TrackingStatus').TrackingStatus;
  beforeEach(async () => {
    h.native.value = true;
    ({ BackgroundLocationPrompt } = await import('../components/BackgroundLocationPrompt'));
    ({ TrackingStatus } = await import('../components/TrackingStatus'));
  });

  it('shows the explanation when a delivery goes on the road; Continue starts the background watcher', async () => {
    render(<BackgroundLocationPrompt />);
    let started!: Promise<void>;
    act(() => {
      started = session.syncTracking(onRoad());
    });
    expect(await screen.findByRole('dialog', { name: /keep sharing your location when the screen is off/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await act(() => started);
    expect(h.background.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('after "Not now", the status says location stops when the screen is off', async () => {
    render(<BackgroundLocationPrompt />);
    let started!: Promise<void>;
    act(() => {
      started = session.syncTracking(onRoad());
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    await act(() => started);
    render(<TrackingStatus state={session.getTracker().getState()} />);
    expect(screen.getByText('Location stops when your screen is off.')).toBeInTheDocument();
  });

  it('background mode says sharing continues with the screen off, with no notice', async () => {
    h.background.checkPermission.mockResolvedValue('granted');
    await session.syncTracking(onRoad());
    render(<TrackingStatus state={session.getTracker().getState()} />);
    expect(screen.getByText(/also while your screen is off/)).toBeInTheDocument();
    expect(screen.queryByText('Location stops when your screen is off.')).not.toBeInTheDocument();
  });
});
