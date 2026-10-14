import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { savingsHeader } from '../checkout/savings';
import { doctorsVisible, showMyAppointments } from '../doctors/access';
import { bannerMode, eventFor, getNetState, nextNetState, ONLINE, recordNetwork, resetNetState, RESTORED_MS } from '../lib/connectivity';
import { configProblem, isLocalHost } from '../lib/config';
import { getHasOpenOrder, hasOpenOrder, isOpenOrder, setKnownOrders } from '../orders/openOrders';
import { addUsualsInto, availableUsuals, parseUsuals, showUsuals, usualsAddedMessage } from '../rewards/usuals';
import { milk, store, sugar } from './fixtures';

describe('your usuals (GET /me/usuals)', () => {
  const raw = {
    order: { id: 'o1', order_number: 'BL-20261011-1934', placed_at: '2026-10-11T08:00:00Z' },
    items: [
      { product: { ...milk, selling_price: '540.00', offer_price: '513.00' }, quantity: 2 },
      { product: { ...sugar, is_available: false }, quantity: 0 },
      { product: { id: 'broken' }, quantity: 1 },
      'junk',
    ],
    unavailable: ['Red Rice 5KG', ' ', null],
  };

  it('parses products at today\'s prices, keeps sold-out ones, drops malformed ones', () => {
    const u = parseUsuals(raw)!;
    expect(u.orderNumber).toBe('BL-20261011-1934');
    expect(u.items.map((i) => [i.product.id, i.quantity, i.product.is_available])).toEqual([['p-milk', 2, true], ['p-sugar', 1, false]]);
    expect(u.items[0].product.selling_price).toBe(540);
    expect(u.items[0].product.offer_price).toBe(513);
    expect(u.unavailable).toEqual(['Red Rice 5KG']);
    expect(availableUsuals(u).map((i) => i.product.id)).toEqual(['p-milk']);
  });

  it('no order yet is an empty answer; anything else is null', () => {
    expect(parseUsuals({ order: null, items: [], unavailable: [] })).toEqual({ orderId: null, orderNumber: null, items: [], unavailable: [] });
    expect(parseUsuals(null)).toBeNull();
    expect(parseUsuals([1])).toBeNull();
  });

  it('shows only for a signed-in customer with products', () => {
    const u = parseUsuals(raw)!;
    expect(showUsuals(true, u)).toBe(true);
    expect(showUsuals(false, u)).toBe(false);
    expect(showUsuals(true, null)).toBe(false);
    expect(showUsuals(true, { ...u, items: [] })).toBe(false);
  });

  it('Add all adds the available ones at their last quantity and names the rest', () => {
    const added: [string, number][] = [];
    const r = addUsualsInto(parseUsuals(raw)!, (p, n) => { added.push([p.id, n]); return n; });
    expect(added).toEqual([['p-milk', 2]]);
    expect(r).toEqual({ addedUnits: 2, unavailable: ['White Sugar 1KG', 'Red Rice 5KG'] });
    expect(usualsAddedMessage(r)).toEqual({ text: 'Added 2 items. Not available now: White Sugar 1KG, Red Rice 5KG.', ok: true });
    expect(usualsAddedMessage({ addedUnits: 1, unavailable: [] }).text).toBe('Added 1 item.');
    expect(usualsAddedMessage({ addedUnits: 0, unavailable: [] })).toEqual({ text: 'These are already in your cart.', ok: false });
    expect(usualsAddedMessage({ addedUnits: 0, unavailable: ['X'] }).text).toBe('Nothing was added. Not available now: X.');
  });
});

describe('offline banner state', () => {
  afterEach(() => resetNetState());

  it('a connection failure sets it, any server answer clears it, a timeout says nothing', () => {
    let s = nextNetState(ONLINE, 'network-error', 1000);
    expect(s.offline).toBe(true);
    expect(nextNetState(s, 'timeout', 2000)).toBe(s);
    s = nextNetState(s, 'response', 3000);
    expect(s).toEqual({ offline: false, restoredAt: 3000 });
    expect(nextNetState(ONLINE, 'response', 1)).toBe(ONLINE);
    expect(nextNetState(ONLINE, 'browser-offline', 1).offline).toBe(true);
  });

  it('shows offline, then "Back online" for a moment, then nothing', () => {
    expect(bannerMode({ offline: true, restoredAt: null }, 0)).toBe('offline');
    expect(bannerMode({ offline: false, restoredAt: 1000 }, 1000 + RESTORED_MS - 1)).toBe('restored');
    expect(bannerMode({ offline: false, restoredAt: 1000 }, 1000 + RESTORED_MS)).toBeNull();
    expect(bannerMode(ONLINE, 5)).toBeNull();
  });

  it('classifies request outcomes (a 4xx or 5xx proves the network works)', () => {
    expect(eventFor(null)).toBe('response');
    expect(eventFor(new ApiError('x', 0, 'NETWORK_ERROR'))).toBe('network-error');
    expect(eventFor(new ApiError('x', 408, 'TIMEOUT'))).toBe('timeout');
    expect(eventFor(new ApiError('x', 500))).toBe('response');
    expect(eventFor(new ApiError('x', 404, 'NOT_FOUND'))).toBe('response');
  });

  it('the app-wide hint follows recorded requests', () => {
    recordNetwork(new ApiError('x', 0, 'NETWORK_ERROR'));
    expect(getNetState().offline).toBe(true);
    recordNetwork(new ApiError('x', 408, 'TIMEOUT'));
    expect(getNetState().offline).toBe(true);
    recordNetwork(null);
    expect(getNetState().offline).toBe(false);
    expect(getNetState().restoredAt).not.toBeNull();
  });
});

describe('config problem screen', () => {
  const release = { dev: false, pageHost: null };
  it('a release build needs an https, non-local API address', () => {
    expect(configProblem({ ...release, apiBaseUrl: undefined })).toBe('API_URL_MISSING');
    expect(configProblem({ ...release, apiBaseUrl: '  ' })).toBe('API_URL_MISSING');
    expect(configProblem({ ...release, apiBaseUrl: 'not a url' })).toBe('API_URL_INVALID');
    expect(configProblem({ ...release, apiBaseUrl: 'ftp://api.blynk.lk' })).toBe('API_URL_INVALID');
    expect(configProblem({ ...release, apiBaseUrl: 'http://localhost:4000/api/v1' })).toBe('API_URL_LOCAL');
    expect(configProblem({ ...release, apiBaseUrl: 'https://127.0.0.1/api/v1' })).toBe('API_URL_LOCAL');
    expect(configProblem({ ...release, apiBaseUrl: 'http://api.blynk.lk/api/v1' })).toBe('API_URL_NOT_HTTPS');
    expect(configProblem({ ...release, apiBaseUrl: 'https://api.blynk.lk/api/v1' })).toBeNull();
  });

  it('development builds, the design mock and local previews always start', () => {
    expect(configProblem({ dev: true, pageHost: null, apiBaseUrl: undefined })).toBeNull();
    expect(configProblem({ ...release, demo: true, apiBaseUrl: undefined })).toBeNull();
    expect(configProblem({ dev: false, pageHost: 'localhost', apiBaseUrl: 'http://localhost:4610/api/v1' })).toBeNull();
    // the production site with a local API is broken
    expect(configProblem({ dev: false, pageHost: 'blynk.lk', apiBaseUrl: 'http://localhost:4610/api/v1' })).toBe('API_URL_LOCAL');
  });

  it('knows local hosts', () => {
    for (const h of ['localhost', 'api.localhost', 'printer.local', '127.0.0.1', '10.0.2.2', '[::1]', '169.254.1.1', '0.0.0.0']) expect(isLocalHost(h)).toBe(true);
    for (const h of ['blynk.lk', 'api.blynk.lk', '192.168.1.10', '8.8.8.8']) expect(isLocalHost(h)).toBe(false);
  });
});

describe('doctors hidden by GET /store doctors_enabled', () => {
  it('hidden when false or before /store answers; shown when true or absent (older backend)', () => {
    expect(doctorsVisible({ ...store, doctors_enabled: false })).toBe(false);
    expect(doctorsVisible(null)).toBe(false);
    expect(doctorsVisible({ ...store, doctors_enabled: true })).toBe(true);
    expect(doctorsVisible(store)).toBe(true);
  });

  it('My appointments stays reachable for a customer with appointments', () => {
    expect(showMyAppointments(true, true, false)).toBe(true);
    expect(showMyAppointments(true, false, true)).toBe(true);
    expect(showMyAppointments(true, false, false)).toBe(false);
    expect(showMyAppointments(false, true, true)).toBe(false);
  });
});

describe('checkout savings header', () => {
  it('adds the coupon / birthday / referral discount and points to the offer savings', () => {
    expect(savingsHeader({ offerSaved: 54, showOfferSavings: true, discount: 100, pointsValue: 50, toPay: 1846 }))
      .toEqual({ saved: 204, before: 2050, show: true });
  });

  it('offer savings count only while show_offer_savings is on; discounts always count', () => {
    expect(savingsHeader({ offerSaved: 54, showOfferSavings: false, discount: 100, pointsValue: 0, toPay: 1900 }))
      .toEqual({ saved: 100, before: 2000, show: true });
    expect(savingsHeader({ offerSaved: 54, showOfferSavings: false, discount: 0, pointsValue: 0, toPay: 1900 }).show).toBe(false);
  });

  it('nothing saved hides the line; bad numbers count as nothing', () => {
    expect(savingsHeader({ offerSaved: 0, showOfferSavings: true, discount: 0, pointsValue: 0, toPay: 500 })).toEqual({ saved: 0, before: 500, show: false });
    expect(savingsHeader({ offerSaved: Number.NaN, showOfferSavings: true, discount: -5, pointsValue: 12.345, toPay: 100 }).saved).toBe(12.35);
  });
});

describe('Orders tab badge', () => {
  it('open while an order is not delivered, cancelled or failed', () => {
    expect(isOpenOrder('PLACED')).toBe(true);
    expect(isOpenOrder('OUT_FOR_DELIVERY')).toBe(true);
    expect(isOpenOrder('CUSTOMER_UNAVAILABLE')).toBe(true);
    expect(isOpenOrder('DELIVERED')).toBe(false);
    expect(isOpenOrder('CANCELLED')).toBe(false);
    expect(isOpenOrder('FAILED')).toBe(false);
    expect(isOpenOrder(null)).toBe(false);
    expect(hasOpenOrder([{ order_status: 'DELIVERED' }, { order_status: 'PACKED' }])).toBe(true);
    expect(hasOpenOrder([])).toBe(false);
  });

  it('follows the last orders list the app loaded', () => {
    setKnownOrders([{ order_status: 'PLACED' }]);
    expect(getHasOpenOrder()).toBe(true);
    setKnownOrders([]);
    expect(getHasOpenOrder()).toBe(false);
  });
});
