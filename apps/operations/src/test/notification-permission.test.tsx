import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingPlugin } from '../lib/geolocation-plugin';

/**
 * Android 13+ POST_NOTIFICATIONS before screen-off sharing starts. The
 * native NotificationPermission and BackgroundGeolocation plugins, Capacitor's
 * platform and the browser watcher are all fakes.
 */
const h = vi.hoisted(() => ({
  platform: { value: 'android' },
  notif: {
    check: vi.fn(async () => ({ display: 'prompt' as string })),
    request: vi.fn(async () => ({ display: 'granted' as string })),
  },
  bg: {
    checkPermissions: vi.fn(async () => ({ location: 'granted' as string })),
    requestPermissions: vi.fn(async () => ({ location: 'granted' as string })),
    addWatcher: vi.fn(async () => 'w-1'),
    removeWatcher: vi.fn(async () => undefined),
  },
  browser: {
    checkPermission: vi.fn(async () => 'granted' as const),
    requestPermission: vi.fn(async () => 'granted' as const),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform.value, isNativePlatform: () => h.platform.value !== 'web' },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: (name: string) => (name === 'NotificationPermission' ? h.notif : h.bg),
}));
vi.mock('../lib/geolocation-plugin', () => ({ browserGeolocationPlugin: h.browser }));

type NotifModule = typeof import('../lib/notification-permission');
type ModeModule = typeof import('../lib/location-mode');
type TrackingModule = typeof import('../lib/tracking');

let notif: NotifModule;
let mode: ModeModule;
let tracking: TrackingModule;

beforeEach(async () => {
  notif = await import('../lib/notification-permission');
  mode = await import('../lib/location-mode');
  tracking = await import('../lib/tracking');
  notif.__resetNotificationPermissionForTests();
  mode.__resetLocationModeForTests();
  h.platform.value = 'android';
  h.notif.check.mockReset().mockResolvedValue({ display: 'prompt' });
  h.notif.request.mockReset().mockResolvedValue({ display: 'granted' });
  h.bg.checkPermissions.mockReset().mockResolvedValue({ location: 'granted' });
  h.bg.addWatcher.mockClear();
  h.browser.start.mockClear();
});

describe('ensureNotificationPermission', () => {
  it('on the web resolves true without touching the native plugin', async () => {
    h.platform.value = 'web';
    await expect(notif.ensureNotificationPermission()).resolves.toBe(true);
    expect(h.notif.check).not.toHaveBeenCalled();
  });

  it('already granted: true, no prompt', async () => {
    h.notif.check.mockResolvedValue({ display: 'granted' });
    await expect(notif.ensureNotificationPermission()).resolves.toBe(true);
    expect(h.notif.request).not.toHaveBeenCalled();
  });

  it('denied: false, and not asked again in the same run', async () => {
    h.notif.request.mockResolvedValue({ display: 'denied' });
    await expect(notif.ensureNotificationPermission()).resolves.toBe(false);
    h.notif.check.mockResolvedValue({ display: 'denied' });
    await expect(notif.ensureNotificationPermission()).resolves.toBe(false);
    expect(h.notif.request).toHaveBeenCalledTimes(1);
  });

  it('a native failure never blocks sharing: resolves true', async () => {
    h.notif.check.mockRejectedValue(new Error('not implemented'));
    await expect(notif.ensureNotificationPermission()).resolves.toBe(true);
  });
});

describe('deliveryLocationPlugin + DeliveryTracker', () => {
  it('background mode: asks after location, before the native watcher; denied still shares, with a note', async () => {
    h.notif.request.mockResolvedValue({ display: 'denied' });
    const tracker = new tracking.DeliveryTracker(mode.deliveryLocationPlugin, vi.fn());
    await tracker.start('d-1');
    expect(mode.getLocationMode()).toBe('background');
    expect(h.notif.request).toHaveBeenCalledTimes(1);
    expect(h.notif.request.mock.invocationCallOrder[0]).toBeGreaterThan(h.bg.checkPermissions.mock.invocationCallOrder[0]);
    expect(h.notif.request.mock.invocationCallOrder[0]).toBeLessThan(h.bg.addWatcher.mock.invocationCallOrder[0]);
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: true });
  });

  it('background mode, granted: shares with no note', async () => {
    const tracker = new tracking.DeliveryTracker(mode.deliveryLocationPlugin, vi.fn());
    await tracker.start('d-1');
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: false });
  });

  it('foreground mode (screen-off sharing declined): no notification exists, so no prompt', async () => {
    h.bg.checkPermissions.mockResolvedValue({ location: 'prompt' });
    const tracker = new tracking.DeliveryTracker(mode.deliveryLocationPlugin, vi.fn());
    await tracker.start('d-1');
    expect(mode.getLocationMode()).toBe('foreground');
    expect(h.notif.check).not.toHaveBeenCalled();
    expect(h.browser.start).toHaveBeenCalled();
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: false });
  });

  it('web: no prompt', async () => {
    h.platform.value = 'web';
    const tracker = new tracking.DeliveryTracker(mode.deliveryLocationPlugin, vi.fn());
    await tracker.start('d-1');
    expect(h.notif.check).not.toHaveBeenCalled();
    expect(tracker.getState().notificationsOff).toBe(false);
  });

  it('a plugin without ensureNotifications is unaffected', async () => {
    const plain: TrackingPlugin = {
      checkPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      start: async () => undefined,
      stop: async () => undefined,
    };
    const tracker = new tracking.DeliveryTracker(plain, vi.fn());
    await tracker.start('d-1');
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: false });
  });
});

describe('TrackingStatus notifications note', () => {
  it('shows the one-line note while sharing with notifications off, and none otherwise', async () => {
    const { TrackingStatus } = await import('../components/TrackingStatus');
    const base = { permission: 'granted' as const, active: true, lastSentAt: new Date(), lastError: null, stopReason: null };
    const { rerender } = render(<TrackingStatus state={{ ...base, notificationsOff: true }} />);
    expect(screen.getByText(notif.NOTIFICATIONS_OFF_NOTE)).toBeInTheDocument();
    rerender(<TrackingStatus state={{ ...base, lastError: 'network', notificationsOff: true }} />);
    expect(screen.getByText(notif.NOTIFICATIONS_OFF_NOTE)).toBeInTheDocument();
    rerender(<TrackingStatus state={{ ...base, notificationsOff: false }} />);
    expect(screen.queryByText(notif.NOTIFICATIONS_OFF_NOTE)).not.toBeInTheDocument();
    rerender(<TrackingStatus state={{ ...base, active: false, notificationsOff: true }} />);
    expect(screen.queryByText(notif.NOTIFICATIONS_OFF_NOTE)).not.toBeInTheDocument();
  });
});
