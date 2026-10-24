import { describe, it, expect } from 'vitest';
import { onboarding, type StepKey } from '../lib/onboarding';
import { formatKm, geoMessage, insideSriLanka, kmBetween, mapStart, shopLocation, FALLBACK_STORE } from '../lib/location';
import { product, seller, submission } from './fixtures';

const stateOf = (data: ReturnType<typeof onboarding>, key: StepKey) => data.steps.find((s) => s.key === key)!.state;

describe('getting-started tracker', () => {
  it('a new PENDING shop: created done, pin is your turn, Blynk is checking, the rest later', () => {
    const data = onboarding(seller({ status: 'PENDING' }), []);
    expect(data.steps.map((s) => s.state)).toEqual(['done', 'current', 'waiting', 'next', 'next']);
    expect(data.doneCount).toBe(1);
    expect(data.complete).toBe(false);
    const pin = data.steps[1]!;
    expect(pin.title).toBe('Pin your shop - Blynk approves the location');
    expect(pin.action).toEqual({ label: 'Pin your shop', to: '/shop#location' });
  });

  it('a pin waiting for Admin is "waiting", not done', () => {
    const data = onboarding(
      seller({ status: 'PENDING', location_status: 'PENDING', pending_latitude: 6.45, pending_longitude: 80.02 }),
      []
    );
    expect(stateOf(data, 'pin')).toBe('waiting');
    expect(data.doneCount).toBe(1);
  });

  it('the pin counts as done only once the location is APPROVED', () => {
    const data = onboarding(
      seller({ status: 'PENDING', location_status: 'APPROVED', latitude: 6.45, longitude: 80.02 }),
      []
    );
    expect(stateOf(data, 'pin')).toBe('done');
    expect(data.doneCount).toBe(2);
  });

  it('a turned-down pin shows the reason and asks to move it', () => {
    const data = onboarding(
      seller({ status: 'PENDING', location_status: 'REJECTED', location_reject_reason: 'That is the bus stand.' }),
      []
    );
    const pin = data.steps[1]!;
    expect(pin.state).toBe('problem');
    expect(pin.detail).toMatch(/that is the bus stand/i);
    expect(pin.action?.label).toBe('Move the pin');
  });

  it('newly approved with no products: adding the first product is the seller\'s turn', () => {
    const data = onboarding(seller({ status: 'APPROVED', location_status: 'APPROVED', latitude: 6.45, longitude: 80.02 }), []);
    expect(data.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'next']);
    expect(data.steps[3]!.action).toEqual({ label: 'Add it now', to: '/products/new' });
  });

  it('products sent but none live yet: Blynk is checking them', () => {
    const waiting = product({ id: 'submission:x', live: false, is_active: false, pending: submission() });
    const data = onboarding(seller({ location_status: 'APPROVED', latitude: 6.45, longitude: 80.02 }), [waiting]);
    expect(stateOf(data, 'first-product')).toBe('done');
    expect(stateOf(data, 'selling')).toBe('waiting');
  });

  it('every step done once a product is live and the location approved', () => {
    const data = onboarding(seller({ location_status: 'APPROVED', latitude: 6.45, longitude: 80.02 }), [product()]);
    expect(data.complete).toBe(true);
    expect(data.doneCount).toBe(5);
  });

  it('a REJECTED shop: Blynk\'s check needs a change', () => {
    const data = onboarding(seller({ status: 'REJECTED' }), []);
    expect(stateOf(data, 'checked')).toBe('problem');
    expect(stateOf(data, 'first-product')).toBe('next');
  });

  it('an older API (a point but no location_status) counts the point as approved', () => {
    expect(stateOf(onboarding(seller({ latitude: 6.45, longitude: 80.02 }), [product()]), 'pin')).toBe('done');
  });
});

describe('location helpers', () => {
  it('opens the map on the waiting pin, else the approved one, else the store, else the clock tower', () => {
    const store = { lat: 6.44, lng: 80.01 };
    expect(mapStart(shopLocation(seller({ location_status: 'PENDING', pending_latitude: 6.5, pending_longitude: 80.1, latitude: 6.4, longitude: 80 })), store)).toEqual({ lat: 6.5, lng: 80.1 });
    expect(mapStart(shopLocation(seller({ location_status: 'APPROVED', latitude: 6.4, longitude: 80 })), store)).toEqual({ lat: 6.4, lng: 80 });
    expect(mapStart(shopLocation(seller()), store)).toEqual(store);
    expect(mapStart(shopLocation(seller()), null)).toEqual(FALLBACK_STORE);
  });

  it('knows Sri Lanka, measures and words distances', () => {
    expect(insideSriLanka({ lat: 6.44, lng: 80.01 })).toBe(true);
    expect(insideSriLanka({ lat: 13.08, lng: 80.27 })).toBe(false);
    expect(kmBetween({ lat: 6.441313, lng: 80.011437 }, { lat: 6.4775, lng: 79.985 })).toBeCloseTo(4.95, 1);
    expect(formatKm(0.42)).toBe('420 m');
    expect(formatKm(2.43)).toBe('2.4 km');
    expect(formatKm(23.6)).toBe('24 km');
  });

  it('explains a refused location request in plain words', () => {
    expect(geoMessage({ code: 1 })).toMatch(/location is blocked/i);
    expect(geoMessage({ code: 3 })).toMatch(/took too long/i);
    expect(geoMessage(new Error('x'))).toMatch(/cannot share your location/i);
  });
});
