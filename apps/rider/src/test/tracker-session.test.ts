import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import {
  __resetTrackerSessionForTests,
  getTracker,
  stopTracking,
  stopTrackingFor,
  syncTracking,
  syncTrackingFromList,
} from '../lib/tracker-session';
import type { TrackingPoint } from '../lib/tracking-plugin';
import { summary } from './helpers';

// A fake plugin and a fake send: the real plugin needs a native bridge and
// the real send needs the network. Neither is touched here.
const h = vi.hoisted(() => {
  const fake = {
    onPoint: (() => {}) as (p: TrackingPoint) => void,
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async (onPoint: (p: TrackingPoint) => void) => {
      fake.onPoint = onPoint;
    }),
    stop: vi.fn(async () => undefined),
  };
  return { fake, sendLocation: vi.fn(), list: vi.fn() };
});

vi.mock('../lib/tracking-plugin', () => ({ capacitorTrackingPlugin: h.fake }));
vi.mock('../api/resources', () => ({ deliveriesApi: { sendLocation: h.sendLocation, list: h.list } }));

const onRoad = (delivery_id = 'd-1') =>
  summary({ delivery_id, assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });

let clock = Date.parse('2026-09-19T10:00:00Z');
const point = (): TrackingPoint => ({
  latitude: 6.4,
  longitude: 80.0,
  accuracy: 10,
  // Far apart in time so the tracker's throttle never swallows a test point.
  capturedAt: new Date((clock += 60_000)),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.sendLocation.mockResolvedValue({ accepted: true });
  h.list.mockResolvedValue([]);
  __resetTrackerSessionForTests();
});

describe('syncTracking', () => {
  it('starts tracking a trackable delivery, once, however often it is synced', async () => {
    await syncTracking(onRoad());
    await syncTracking(onRoad());
    await syncTracking(onRoad());
    expect(h.fake.start).toHaveBeenCalledTimes(1);
    expect(getTracker().getDeliveryId()).toBe('d-1');
    expect(getTracker().getState().active).toBe(true);
  });

  it('does not double-start when syncs overlap', async () => {
    await Promise.all([syncTracking(onRoad()), syncTracking(onRoad())]);
    expect(h.fake.start).toHaveBeenCalledTimes(1);
  });

  it('a different trackable delivery stops the old tracking first, then starts the new one', async () => {
    await syncTracking(onRoad('d-old'));
    await syncTracking(onRoad('d-new'));
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
    expect(h.fake.start).toHaveBeenCalledTimes(2);
    expect(h.fake.stop.mock.invocationCallOrder[0]).toBeLessThan(h.fake.start.mock.invocationCallOrder[1]);
    expect(getTracker().getDeliveryId()).toBe('d-new');

    // Points after the switch belong to the new delivery only.
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.sendLocation).toHaveBeenCalledTimes(1));
    expect(h.sendLocation.mock.calls.map((c) => c[0])).toEqual(['d-new']);
  });

  it('stops when the tracked delivery itself becomes non-trackable, including arrival', async () => {
    const closed = [
      summary({ assignment_status: 'PICKED_UP', order_status: 'CANCELLED' }),
      summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' }),
      summary({ assignment_status: 'DELIVERED', order_status: 'DELIVERED' }),
      summary({ assignment_status: 'FAILED', order_status: 'FAILED' }),
    ];
    for (const next of closed) {
      vi.clearAllMocks();
      await syncTracking(onRoad());
      expect(getTracker().getState().active).toBe(true);
      await syncTracking(next);
      expect(h.fake.stop).toHaveBeenCalledTimes(1);
      expect(getTracker().getDeliveryId()).toBeNull();
      expect(getTracker().getState().active).toBe(false);
    }
  });

  it('a different delivery that is not trackable leaves the tracked one alone', async () => {
    await syncTracking(onRoad('d-a'));
    h.fake.stop.mockClear();
    for (const other of [
      summary({ delivery_id: 'd-b', assignment_status: 'ASSIGNED', order_status: 'PACKED' }),
      summary({ delivery_id: 'd-b', assignment_status: 'DELIVERED', order_status: 'DELIVERED' }),
      summary({ delivery_id: 'd-b', assignment_status: 'PICKED_UP', order_status: 'CANCELLED' }),
    ]) {
      await syncTracking(other);
    }
    expect(h.fake.stop).not.toHaveBeenCalled();
    expect(getTracker().getDeliveryId()).toBe('d-a');
    expect(getTracker().getState().active).toBe(true);
  });

  it('stopTracking() stops whatever is tracked, and stopTrackingFor() only the delivery it names', async () => {
    await syncTracking(onRoad('d-a'));
    await stopTrackingFor('d-other');
    expect(h.fake.stop).not.toHaveBeenCalled();
    await stopTrackingFor('d-a');
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
    expect(getTracker().getDeliveryId()).toBeNull();

    await syncTracking(onRoad('d-b'));
    await stopTracking();
    expect(h.fake.stop).toHaveBeenCalledTimes(2);
    expect(getTracker().getDeliveryId()).toBeNull();
  });

  it('retries a native stop that failed: the next sync calls plugin.stop again instead of forgetting the watcher', async () => {
    await syncTracking(onRoad('d-a'));
    h.fake.stop.mockRejectedValueOnce(new Error('native stop failed'));
    await expect(stopTracking()).rejects.toThrow('native stop failed');
    expect(getTracker().getState().active).toBe(true); // the watcher may still be running
    await syncTracking(summary({ delivery_id: 'd-elsewhere', assignment_status: 'ASSIGNED', order_status: 'PACKED' }));
    expect(h.fake.stop).toHaveBeenCalledTimes(2);
    expect(getTracker().getState().active).toBe(false);
  });

  it('does not touch the plugin when there is nothing to stop', async () => {
    await stopTracking();
    await syncTracking(summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' }));
    expect(h.fake.stop).not.toHaveBeenCalled();
    expect(h.fake.start).not.toHaveBeenCalled();
  });

  it('sends points with the delivery id and the API payload shape', async () => {
    await syncTracking(onRoad());
    const p = point();
    h.fake.onPoint(p);
    await vi.waitFor(() => expect(h.sendLocation).toHaveBeenCalledTimes(1));
    expect(h.sendLocation).toHaveBeenCalledWith('d-1', {
      latitude: 6.4,
      longitude: 80.0,
      accuracy: 10,
      captured_at: p.capturedAt.toISOString(),
    });
  });
});

describe('server-authoritative stop', () => {
  it('a 409 from the location endpoint stops the tracker and is not reported as a network problem', async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Not trackable.', 409, 'DELIVERY_NOT_TRACKABLE'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.fake.stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getTracker().getState().active).toBe(false));
    expect(getTracker().getDeliveryId()).toBeNull();
    expect(getTracker().getState().lastError).toBeNull();
    expect(getTracker().getState().lastSentAt).toBeNull();
  });

  it("a 404 DELIVERY_NOT_FOUND (no longer this rider's) stops the tracker silently; another 404 stops it with a reason", async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Gone.', 404, 'DELIVERY_NOT_FOUND'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.fake.stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getTracker().getState().active).toBe(false));
    expect(getTracker().getState().lastError).toBeNull();

    __resetTrackerSessionForTests();
    vi.clearAllMocks();
    h.sendLocation.mockRejectedValueOnce(new ApiError('Nope.', 404, 'SOMETHING_ELSE'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(getTracker().getState().lastError).toBe('refused'));
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
  });

  it('a refusal that arrives while a switch to another delivery is mid-start does not interleave a stop', async () => {
    let rejectOld: (e: unknown) => void = () => {};
    h.sendLocation.mockImplementationOnce(() => new Promise((_, reject) => (rejectOld = reject)));
    await syncTracking(onRoad('d-old'));
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.sendLocation).toHaveBeenCalledTimes(1));

    let releasePermission: () => void = () => {};
    h.fake.requestPermission.mockImplementationOnce(() => new Promise((r) => (releasePermission = () => r('granted'))));
    const switching = syncTracking(onRoad('d-new'));
    await vi.waitFor(() => expect(h.fake.requestPermission).toHaveBeenCalledTimes(2));
    h.fake.stop.mockClear();
    rejectOld(new ApiError('Not trackable.', 409, 'DELIVERY_NOT_TRACKABLE'));
    await new Promise((r) => setTimeout(r, 20));
    releasePermission();
    await switching;

    expect(h.fake.stop).not.toHaveBeenCalled();
    expect(getTracker().getDeliveryId()).toBe('d-new');
    expect(getTracker().getState().active).toBe(true);
  });

  it('a 409 for an old delivery does not stop the tracking of the one that replaced it', async () => {
    let rejectOld: (e: unknown) => void = () => {};
    h.sendLocation.mockImplementationOnce(() => new Promise((_, reject) => (rejectOld = reject)));
    await syncTracking(onRoad('d-old'));
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.sendLocation).toHaveBeenCalledTimes(1));

    await syncTracking(onRoad('d-new'));
    h.fake.stop.mockClear();
    rejectOld(new ApiError('Not trackable.', 409, 'DELIVERY_NOT_TRACKABLE'));
    await new Promise((r) => setTimeout(r, 20));

    expect(h.fake.stop).not.toHaveBeenCalled();
    expect(getTracker().getDeliveryId()).toBe('d-new');
    expect(getTracker().getState().active).toBe(true);
  });

  it('any other failure keeps tracking and reports a network problem', async () => {
    for (const err of [new ApiError('Could not reach the Blynk API.', 0, 'NETWORK'), new ApiError('Boom', 500, 'INTERNAL')]) {
      __resetTrackerSessionForTests();
      vi.clearAllMocks();
      h.sendLocation.mockRejectedValueOnce(err);
      await syncTracking(onRoad());
      h.fake.onPoint(point());
      await vi.waitFor(() => expect(getTracker().getState().lastError).toBe('network'));
      expect(h.fake.stop).not.toHaveBeenCalled();
      expect(getTracker().getState().active).toBe(true);
      expect(getTracker().getDeliveryId()).toBe('d-1');
    }
  });
});

describe('syncTrackingFromList (the Queue, when no Delivery screen is open)', () => {
  const idle = (delivery_id: string) => summary({ delivery_id, assignment_status: 'ASSIGNED', order_status: 'PACKED' });

  it('starts tracking the on-road delivery in the list', async () => {
    await syncTrackingFromList([idle('d-1'), onRoad('d-2')]);
    expect(getTracker().getDeliveryId()).toBe('d-2');
    expect(h.fake.start).toHaveBeenCalledTimes(1);
  });

  it('with several trackable, keeps the one already tracked, else takes the first', async () => {
    await syncTrackingFromList([onRoad('d-1'), onRoad('d-2')]);
    expect(getTracker().getDeliveryId()).toBe('d-1');
    await syncTrackingFromList([onRoad('d-2'), onRoad('d-1')]);
    expect(getTracker().getDeliveryId()).toBe('d-1');
    expect(h.fake.start).toHaveBeenCalledTimes(1);
  });

  it('stops an active tracker when the loaded list has nothing trackable, or is empty', async () => {
    await syncTracking(onRoad('d-1'));
    await syncTrackingFromList([idle('d-1'), idle('d-2')]);
    expect(getTracker().getDeliveryId()).toBeNull();
    expect(h.fake.stop).toHaveBeenCalledTimes(1);

    await syncTracking(onRoad('d-1'));
    await syncTrackingFromList([]);
    expect(getTracker().getDeliveryId()).toBeNull();
    expect(h.fake.stop).toHaveBeenCalledTimes(2);
  });

  it('does nothing when idle and nothing is trackable', async () => {
    await syncTrackingFromList([idle('d-1')]);
    expect(h.fake.start).not.toHaveBeenCalled();
    expect(h.fake.stop).not.toHaveBeenCalled();
  });
});

describe('refusals that stop sharing with the reason (no retry loop)', () => {
  it.each([
    [new ApiError('No profile.', 403, 'RIDER_PROFILE_NOT_FOUND'), /rider profile isn't active/],
    [new ApiError('Inactive.', 403, 'RIDER_INACTIVE'), /rider profile isn't active/],
    [new ApiError('Bad point.', 400, 'VALIDATION_ERROR'), /server refused your location/],
    [new ApiError('Expired.', 401, 'UNAUTHORIZED'), /session has ended/],
  ])('%s stops the tracker and says why', async (err, reason) => {
    h.sendLocation.mockRejectedValue(err);
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(getTracker().getState().lastError).toBe('refused'));
    expect(getTracker().getState().stopReason).toMatch(reason);
    expect(getTracker().getState().active).toBe(false);
    expect(getTracker().getDeliveryId()).toBeNull();
    expect(h.fake.stop).toHaveBeenCalledTimes(1);

    // Stopped means stopped: a late point from the native side sends nothing more.
    h.fake.onPoint(point());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sendLocation).toHaveBeenCalledTimes(1);
  });

  it('429 and 5xx keep tracking and retry on the next point', async () => {
    for (const err of [new ApiError('Slow down.', 429, 'RATE_LIMITED'), new ApiError('Down.', 503, 'UNAVAILABLE'), new ApiError('No answer.', 0, 'TIMEOUT')]) {
      __resetTrackerSessionForTests();
      vi.clearAllMocks();
      h.sendLocation.mockRejectedValueOnce(err).mockResolvedValue({ accepted: true });
      await syncTracking(onRoad());
      h.fake.onPoint(point());
      await vi.waitFor(() => expect(getTracker().getState().lastError).toBe('network'));
      expect(h.fake.stop).not.toHaveBeenCalled();
      h.fake.onPoint(point());
      await vi.waitFor(() => expect(getTracker().getState().lastError).toBeNull());
      expect(h.sendLocation).toHaveBeenCalledTimes(2);
    }
  });

  it('a later start clears the refusal', async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Bad point.', 400, 'VALIDATION_ERROR'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(getTracker().getState().lastError).toBe('refused'));
    await syncTracking(onRoad());
    expect(getTracker().getState().lastError).toBeNull();
    expect(getTracker().getState().stopReason).toBeNull();
    expect(getTracker().getState().active).toBe(true);
  });
});

describe('trips: one stop closes, the next on the road keeps sharing', () => {
  it('after the tracked stop is marked arrived, tracking moves to the other picked-up delivery', async () => {
    await syncTracking(onRoad('d-1'));
    h.list.mockResolvedValue([
      summary({ delivery_id: 'd-1', assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' }),
      onRoad('d-2'),
    ]);
    await syncTracking(summary({ delivery_id: 'd-1', assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' }));
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(getTracker().getDeliveryId()).toBe('d-2');
    expect(getTracker().getState().active).toBe(true);
    expect(h.fake.start).toHaveBeenCalledTimes(2);
  });

  it('with nothing else on the road it stays stopped', async () => {
    await syncTracking(onRoad('d-1'));
    await syncTracking(summary({ delivery_id: 'd-1', assignment_status: 'DELIVERED', order_status: 'DELIVERED' }));
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(getTracker().getDeliveryId()).toBeNull();
  });

  it('a list that cannot load leaves tracking stopped and does not reject', async () => {
    await syncTracking(onRoad('d-1'));
    h.list.mockRejectedValue(new ApiError('Could not reach the Blynk API.', 0, 'NETWORK'));
    await expect(
      syncTracking(summary({ delivery_id: 'd-1', assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' }))
    ).resolves.toBeUndefined();
    expect(getTracker().getDeliveryId()).toBeNull();
  });

  it('does not re-read the list when the delivery viewed was not the one tracked', async () => {
    await syncTracking(onRoad('d-1'));
    await syncTracking(summary({ delivery_id: 'd-9', assignment_status: 'DELIVERED', order_status: 'DELIVERED' }));
    await syncTracking(onRoad('d-1'));
    expect(h.list).not.toHaveBeenCalled();
  });
});
