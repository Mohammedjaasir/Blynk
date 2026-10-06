import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingStatus } from '../components/TrackingStatus';
import {
  NOTIFICATIONS_OFF_NOTE,
  __resetNotificationPermissionForTests,
  ensureNotificationPermission,
} from '../lib/notification-permission';
import { DeliveryTracker } from '../lib/tracking';
import type { TrackingPlugin } from '../lib/tracking-plugin';

/**
 * Android 13+ POST_NOTIFICATIONS before background sharing starts. The native
 * NotificationPermission plugin and Capacitor's platform are fakes.
 */
const h = vi.hoisted(() => ({
  platform: { value: 'android' },
  notif: {
    check: vi.fn(async () => ({ display: 'prompt' as string })),
    request: vi.fn(async () => ({ display: 'granted' as string })),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform.value, isNativePlatform: () => h.platform.value !== 'web' },
  registerPlugin: (name: string) => (name === 'NotificationPermission' ? h.notif : {}),
}));

beforeEach(() => {
  __resetNotificationPermissionForTests();
  h.platform.value = 'android';
  h.notif.check.mockReset().mockResolvedValue({ display: 'prompt' });
  h.notif.request.mockReset().mockResolvedValue({ display: 'granted' });
});

describe('ensureNotificationPermission', () => {
  it('on the web resolves true without touching the native plugin', async () => {
    h.platform.value = 'web';
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(h.notif.check).not.toHaveBeenCalled();
    expect(h.notif.request).not.toHaveBeenCalled();
  });

  it('already granted: true, no prompt', async () => {
    h.notif.check.mockResolvedValue({ display: 'granted' });
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(h.notif.request).not.toHaveBeenCalled();
  });

  it('not yet asked: prompts once and resolves with the answer', async () => {
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(h.notif.request).toHaveBeenCalledTimes(1);
  });

  it('denied: false, and is not asked again in the same run (only re-checked)', async () => {
    h.notif.request.mockResolvedValue({ display: 'denied' });
    await expect(ensureNotificationPermission()).resolves.toBe(false);
    h.notif.check.mockResolvedValue({ display: 'denied' });
    await expect(ensureNotificationPermission()).resolves.toBe(false);
    expect(h.notif.request).toHaveBeenCalledTimes(1);
    expect(h.notif.check).toHaveBeenCalledTimes(2);
    // Turned on in Settings meanwhile: the re-check sees it.
    h.notif.check.mockResolvedValue({ display: 'granted' });
    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(h.notif.request).toHaveBeenCalledTimes(1);
  });

  it('a native failure never blocks sharing: resolves true', async () => {
    h.notif.check.mockRejectedValue(new Error('not implemented'));
    await expect(ensureNotificationPermission()).resolves.toBe(true);
  });
});

describe('DeliveryTracker with notification permission', () => {
  function plugin(ensure?: () => Promise<boolean>, location: 'granted' | 'denied' = 'granted') {
    const calls: string[] = [];
    const p: TrackingPlugin = {
      checkPermission: vi.fn(async () => location),
      requestPermission: vi.fn(async () => {
        calls.push('location');
        return location;
      }),
      start: vi.fn(async () => {
        calls.push('start');
      }),
      stop: vi.fn(async () => undefined),
      ...(ensure
        ? {
            ensureNotifications: vi.fn(async () => {
              calls.push('notifications');
              return ensure();
            }),
          }
        : {}),
    };
    return { p, calls };
  }

  it('asks after location permission and before the watcher starts; granted shows no note', async () => {
    const { p, calls } = plugin(async () => true);
    const tracker = new DeliveryTracker(p, vi.fn());
    await tracker.start('d-1');
    expect(calls).toEqual(['location', 'notifications', 'start']);
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: false });
  });

  it('denied still starts sharing, flagged notificationsOff', async () => {
    const { p } = plugin(async () => false);
    const tracker = new DeliveryTracker(p, vi.fn());
    await tracker.start('d-1');
    expect(p.start).toHaveBeenCalled();
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: true });
  });

  it('a rejecting check still starts sharing, with no note', async () => {
    const { p } = plugin(async () => {
      throw new Error('bridge down');
    });
    const tracker = new DeliveryTracker(p, vi.fn());
    await tracker.start('d-1');
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: false });
  });

  it('is not asked when location was refused', async () => {
    const { p, calls } = plugin(async () => false, 'denied');
    const tracker = new DeliveryTracker(p, vi.fn());
    await tracker.start('d-1');
    expect(calls).toEqual(['location']);
  });

  it('the real Android path end to end: denied once, then not prompted on the next delivery', async () => {
    h.notif.request.mockResolvedValue({ display: 'denied' });
    h.notif.check.mockResolvedValueOnce({ display: 'prompt' }).mockResolvedValue({ display: 'denied' });
    const { p } = plugin(ensureNotificationPermission);
    const tracker = new DeliveryTracker(p, vi.fn());
    await tracker.start('d-1');
    expect(tracker.getState().notificationsOff).toBe(true);
    await tracker.stop();
    await tracker.start('d-2');
    expect(tracker.getState()).toMatchObject({ active: true, notificationsOff: true });
    expect(h.notif.request).toHaveBeenCalledTimes(1);
  });
});

describe('TrackingStatus notifications note', () => {
  it('shows the one-line note while sharing with notifications off', () => {
    render(
      <TrackingStatus
        state={{ permission: 'granted', active: true, lastSentAt: new Date(), lastError: null, notificationsOff: true }}
      />
    );
    expect(screen.getByText(/sharing your location —/i)).toBeInTheDocument();
    expect(screen.getByText(NOTIFICATIONS_OFF_NOTE)).toBeInTheDocument();
  });

  it('keeps the note beside the retrying warning', () => {
    render(
      <TrackingStatus
        state={{ permission: 'granted', active: true, lastSentAt: null, lastError: 'network', notificationsOff: true }}
      />
    );
    expect(screen.getByText(NOTIFICATIONS_OFF_NOTE)).toBeInTheDocument();
  });

  it('no note when notifications are on, or once sharing stopped', () => {
    const { rerender } = render(
      <TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: null, lastError: null, notificationsOff: false }} />
    );
    expect(screen.queryByText(NOTIFICATIONS_OFF_NOTE)).not.toBeInTheDocument();
    rerender(
      <TrackingStatus
        state={{ permission: 'granted', active: false, lastSentAt: new Date(), lastError: null, notificationsOff: true }}
      />
    );
    expect(screen.queryByText(NOTIFICATIONS_OFF_NOTE)).not.toBeInTheDocument();
  });
});
