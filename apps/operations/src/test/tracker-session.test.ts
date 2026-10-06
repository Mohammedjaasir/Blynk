import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { DeliverySummary } from '../api/types';
import type { TrackingPoint } from '../lib/geolocation-plugin';
import { __resetTrackerSessionForTests, getTracker, stopTracking, stopTrackingFor, syncTracking } from '../lib/tracker-session';

/**
 * `lib/tracker-session.ts`'s singleton + serialized queue (ported from
 * apps/rider/src/lib/tracker-session.ts's own tests, common.md rule 2),
 * against a fake plugin and a fake `delivery.sendLocation` - the real
 * plugin needs a real browser and the real send needs the network, neither
 * touched here.
 */
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
  return { fake, sendLocation: vi.fn() };
});

vi.mock('../lib/geolocation-plugin', () => ({ browserGeolocationPlugin: h.fake }));
vi.mock('../api/resources', () => ({ delivery: { sendLocation: h.sendLocation } }));

function summary(overrides: Partial<DeliverySummary> = {}): DeliverySummary {
  return {
    delivery_id: 'd-1',
    order_id: 'o-1',
    assignment_status: 'PICKED_UP',
    assigned_at: new Date().toISOString(),
    accepted_at: null,
    picked_up_at: new Date().toISOString(),
    order_number: 'BL-20260922-0001',
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

const onRoad = (delivery_id = 'd-1') => summary({ delivery_id, assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });

let clock = Date.parse('2026-09-22T10:00:00Z');
const point = (): TrackingPoint => ({
  latitude: 6.4,
  longitude: 80.0,
  accuracy: 10,
  capturedAt: new Date((clock += 60_000)),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.sendLocation.mockResolvedValue({ accepted: true });
  __resetTrackerSessionForTests();
});

describe('syncTracking', () => {
  it('starts tracking a trackable delivery, once, however often it is synced - never merely because a screen calls it', async () => {
    await syncTracking(onRoad());
    await syncTracking(onRoad());
    expect(h.fake.start).toHaveBeenCalledTimes(1);
    expect(getTracker().getDeliveryId()).toBe('d-1');
    expect(getTracker().getState().active).toBe(true);
  });

  it('never starts for a delivery that is only "open" but not yet in the trackable window (e.g. still ASSIGNED)', async () => {
    await syncTracking(summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' }));
    expect(h.fake.start).not.toHaveBeenCalled();
    expect(getTracker().getDeliveryId()).toBeNull();
  });

  it('a different trackable delivery stops the old tracking first, then starts the new one', async () => {
    await syncTracking(onRoad('d-old'));
    await syncTracking(onRoad('d-new'));
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
    expect(h.fake.start).toHaveBeenCalledTimes(2);
    expect(getTracker().getDeliveryId()).toBe('d-new');
  });

  it('stops when the tracked delivery itself leaves the trackable window, including arrival', async () => {
    await syncTracking(onRoad());
    expect(getTracker().getState().active).toBe(true);
    await syncTracking(summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' }));
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
    expect(getTracker().getDeliveryId()).toBeNull();
    expect(getTracker().getState().active).toBe(false);
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
  });

  it('sends points with the delivery id and the exact API payload shape (latitude/longitude/accuracy/captured_at)', async () => {
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
  it('a 409 from the location endpoint stops the tracker (mirrors DELIVERY_NOT_TRACKABLE)', async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Not trackable.', 409, 'DELIVERY_NOT_TRACKABLE'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.fake.stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getTracker().getState().active).toBe(false));
    expect(getTracker().getDeliveryId()).toBeNull();
  });

  it('a 404 DELIVERY_NOT_FOUND stops the tracker too, and says why', async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Gone.', 404, 'DELIVERY_NOT_FOUND'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.fake.stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getTracker().getState().stopReason).toBe('This delivery is no longer assigned to you.'));
    expect(getTracker().getState().lastError).toBe('refused');
  });

  it.each([
    ['RIDER_PROFILE_NOT_FOUND', 'No rider profile is linked to this account.'],
    ['RIDER_INACTIVE', "This account's rider profile isn't active."],
    ['RIDER_PROFILE_DISABLED', 'An admin switched off your rider profile.'],
  ])('a 403 %s stops sharing and keeps the real reason, never "network"', async (code, reason) => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Refused.', 403, code));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(getTracker().getState().stopReason).toBe(reason));
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
    expect(getTracker().getState()).toMatchObject({ active: false, lastError: 'refused' });
    expect(getTracker().getDeliveryId()).toBeNull();
  });

  it('any other non-retryable 4xx (e.g. a 400) stops too, with the server message', async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Latitude is out of range.', 400, 'SOMETHING_ELSE'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(getTracker().getState().stopReason).toBe('Latitude is out of range.'));
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
  });

  it('a new delivery starts with no stale stop reason', async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Refused.', 403, 'RIDER_INACTIVE'));
    await syncTracking(onRoad('d-a'));
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(getTracker().getState().stopReason).not.toBeNull());
    await syncTracking(onRoad('d-b'));
    expect(getTracker().getState()).toMatchObject({ active: true, stopReason: null, lastError: null });
  });

  it.each([
    ['a 500', new ApiError('Boom', 500, 'INTERNAL')],
    ['a 503', new ApiError('Down', 503)],
    ['a 429', new ApiError('Slow down', 429, 'RATE_LIMITED')],
    ['a dropped connection', new ApiError('Could not reach the Blynk API.', 0, 'NETWORK')],
    ['a timeout', new ApiError('The Blynk API did not answer in time.', 0, 'TIMEOUT')],
  ])('%s keeps tracking and reports a network problem, never stops', async (_label, err) => {
    h.sendLocation.mockRejectedValueOnce(err);
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(getTracker().getState().lastError).toBe('network'));
    expect(h.fake.stop).not.toHaveBeenCalled();
    expect(getTracker().getState().active).toBe(true);
  });
});
