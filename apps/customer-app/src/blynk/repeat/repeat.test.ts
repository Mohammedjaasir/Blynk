import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import type { StoreInfo } from '@/blynk/api/types';
import { effectivePrice } from '@/blynk/lib/pricing';
import { MemoryStorage, milk, store, sugar } from '../test/fixtures';
import { boughtText, buyAgainView, joinBuyAgain } from './buyAgain';
import { parseBasket, parseBasketList, parseBuyAgain, type RepeatBasket } from './models';
import {
  canRepeatOrder, createBody, estimate, isNotReady, itemsFromCart, itemsFromOrder, matchAddress, normaliseItems, patchBody, repeatErrorText, repeatOn,
} from './payload';
import {
  colombo, countdownText, dayHours, defaultTime, firstRun, hourGroups, nextLine, nextRunText, scheduleText, startDates, suggestName,
  timeLabel, timeOptions, whenText,
} from './schedule';

// Saturday 24 Oct 2026, 10:00 am in Colombo
const NOW = new Date('2026-10-24T04:30:00Z');
const day = (open: string, close: string, closed = false) => ({ open, close, closed });

describe('buy again', () => {
  test('parses the answer leniently', () => {
    expect(parseBuyAgain(null)).toEqual([]);
    expect(parseBuyAgain({ items: [
      { product_id: 'p-milk', variant_id: null, times_bought: '5', last_bought_at: '2026-10-20T10:00:00Z', last_quantity: 2 },
      { variant_id: 'v1' },
      { product_id: 'p-sugar', times_bought: 0, last_quantity: null },
    ] })).toEqual([
      { productId: 'p-milk', variantId: null, timesBought: 5, lastBoughtAt: '2026-10-20T10:00:00Z', lastQuantity: 2 },
      { productId: 'p-sugar', variantId: null, timesBought: 1, lastBoughtAt: null, lastQuantity: 1 },
    ]);
  });

  test('joins with the catalogue: orderable first in server order, sold out last, gone left out, one card per product', () => {
    const soldOut = { ...sugar, is_available: false };
    const bread = { ...milk, id: 'p-bread', name: 'Bread' };
    const entries = parseBuyAgain({ items: [
      { product_id: 'p-sugar', times_bought: 9 },
      { product_id: 'p-gone', times_bought: 8 },
      { product_id: 'p-milk', variant_id: 'v-1l', times_bought: 7 },
      { product_id: 'p-milk', variant_id: 'v-500', times_bought: 3 },
      { product_id: 'p-bread', times_bought: 2 },
    ] });
    const cards = joinBuyAgain(entries, [soldOut, milk, bread]);
    expect(cards.map((c) => c.product.id)).toEqual(['p-milk', 'p-bread', 'p-sugar']);
    expect(cards[0]).toMatchObject({ timesBought: 7, variantId: 'v-1l' });
    expect(joinBuyAgain(entries, [soldOut, milk, bread], 2)).toHaveLength(2);
  });

  test('what the rail shows', () => {
    const entries = parseBuyAgain({ items: [{ product_id: 'p-milk' }] });
    expect(buyAgainView({ demo: true, signedIn: true, entries, products: [milk] })).toEqual({ kind: 'hidden' });
    expect(buyAgainView({ demo: false, signedIn: false, entries: null, products: null })).toEqual({ kind: 'empty' });
    expect(buyAgainView({ demo: false, signedIn: true, entries: null, products: [milk] })).toEqual({ kind: 'hidden' });
    expect(buyAgainView({ demo: false, signedIn: true, entries: 'failed', products: [milk] })).toEqual({ kind: 'hidden' });
    expect(buyAgainView({ demo: false, signedIn: true, entries: [], products: [milk] })).toEqual({ kind: 'empty' });
    expect(buyAgainView({ demo: false, signedIn: true, entries: parseBuyAgain({ items: [{ product_id: 'x' }] }), products: [milk] })).toEqual({ kind: 'empty' });
    const v = buyAgainView({ demo: false, signedIn: true, entries, products: [milk] });
    expect(v.kind === 'cards' && v.cards[0].product.id).toBe('p-milk');
    expect([boughtText(1), boughtText(2), boughtText(6)]).toEqual(['Bought once', 'Bought twice', 'Bought 6 times']);
  });
});

describe('schedule words', () => {
  test('clock and schedule', () => {
    expect(timeLabel('08:00')).toBe('8:00 am');
    expect(timeLabel('12:15')).toBe('12:15 pm');
    expect(timeLabel('00:30')).toBe('12:30 am');
    expect(timeLabel('21:45')).toBe('9:45 pm');
    expect(scheduleText('DAILY', null, '07:30')).toBe('Every day at 7:30 am');
    expect(scheduleText('WEEKLY', 1, '08:00')).toBe('Every Monday at 8:00 am');
    expect(scheduleText('BIWEEKLY', 0, '18:00')).toBe('Every 2 weeks on Sunday at 6:00 pm');
    expect(suggestName('WEEKLY', 1)).toBe('Monday basket');
    expect(suggestName('DAILY', 3)).toBe('Daily basket');
    expect(suggestName('BIWEEKLY', 5)).toBe('Every other Friday');
  });

  test('colombo calendar', () => {
    expect(colombo(NOW)).toMatchObject({ ymd: '2026-10-24', weekday: 6, minutes: 600 });
    // 11 pm UTC is already the next morning in Colombo
    expect(colombo(new Date('2026-10-24T23:00:00Z'))).toMatchObject({ ymd: '2026-10-25', weekday: 0, minutes: 270 });
  });

  test('next run and countdown', () => {
    expect(nextRunText('2026-10-26T02:30:00Z', NOW)).toBe('Next: Mon 8:00 am');
    expect(whenText(new Date('2026-10-24T12:30:00Z'), NOW)).toBe('Today 6:00 pm');
    expect(whenText(new Date('2026-10-25T02:30:00Z'), NOW)).toBe('Tomorrow 8:00 am');
    expect(whenText(new Date('2026-11-02T02:30:00Z'), NOW)).toBe('Mon 2 Nov, 8:00 am');
    expect(nextRunText(null, NOW)).toBeNull();
    expect(countdownText('2026-10-24T04:55:00Z', NOW)).toBe('in 25 min');
    expect(countdownText('2026-10-24T09:30:00Z', NOW)).toBe('in 5 h');
    expect(countdownText('2026-10-26T02:30:00Z', NOW)).toBe('in 2 days');
    expect(countdownText('2026-10-24T04:00:00Z', NOW)).toBeNull();
  });

  test('card headline: active, skipped, paused', () => {
    const b = { status: 'ACTIVE' as const, skipNext: false, nextRunAt: '2026-10-26T02:30:00Z', frequency: 'WEEKLY' as const };
    expect(nextLine(b, NOW)).toEqual({ title: 'Next: Mon 8:00 am', sub: 'in 2 days', tone: 'active' });
    expect(nextLine({ ...b, skipNext: true }, NOW)).toEqual({ title: 'Next: Mon 2 Nov, 8:00 am', sub: 'Skipping Mon 8:00 am', tone: 'skip' });
    expect(nextLine({ ...b, status: 'PAUSED' }, NOW).tone).toBe('paused');
  });
});

describe('times from the opening hours', () => {
  const week = (f: (k: string) => ReturnType<typeof day>) =>
    Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, f(k)]));
  const weekly: StoreInfo = { ...store, hours: { same_every_day: false, days: week((k) => (k === 'sun' ? day('09:00', '13:00', true) : k === 'sat' ? day('09:30', '14:00') : day('08:00', '21:00'))) } };

  test('a weekday uses its own hours in quarter hours; a closed day has none', () => {
    const sat = timeOptions(weekly, 'WEEKLY', 6);
    expect(sat[0]).toBe('09:30');
    expect(sat[sat.length - 1]).toBe('13:45');
    expect(sat).toHaveLength(18);
    expect(timeOptions(weekly, 'BIWEEKLY', 0)).toEqual([]);
    expect(timeOptions(weekly, 'WEEKLY', null)).toEqual([]);
    expect(dayHours(weekly, 0)).toBeNull();
  });

  test('every day keeps the times open on every open day', () => {
    const all = timeOptions(weekly, 'DAILY', null);
    expect(all[0]).toBe('09:30');
    expect(all[all.length - 1]).toBe('13:45');
  });

  test('without weekly hours, the delivery hours', () => {
    const t = timeOptions(store, 'DAILY', null);
    expect(t[0]).toBe('08:00');
    expect(t[t.length - 1]).toBe('20:45');
    expect(timeOptions(null, 'DAILY', null)).toEqual([]);
    // odd minutes round up to the next quarter
    expect(timeOptions({ ...store, delivery_hours: { start: '07:10', end: '08:00', timezone: 'Asia/Colombo' } }, 'WEEKLY', 2)).toEqual(['07:15', '07:30', '07:45']);
  });

  test('hour groups and the default time', () => {
    expect(hourGroups(['09:30', '09:45', '10:00'])).toEqual([{ hour: 9, minutes: ['30', '45'] }, { hour: 10, minutes: ['00'] }]);
    expect(defaultTime([])).toBeNull();
    expect(defaultTime(['07:00', '08:00', '09:00'])).toBe('08:00');
    expect(defaultTime(['07:00', '08:00'], '07:00')).toBe('07:00');
    expect(defaultTime(['09:30', '10:00'], '07:00')).toBe('09:30');
    expect(defaultTime(['06:00', '06:15'])).toBe('06:00');
  });

  test('start dates and the first run', () => {
    const d = startDates(NOW, 3);
    expect(d).toEqual([{ ymd: '2026-10-24', label: 'Today' }, { ymd: '2026-10-25', label: 'Tomorrow' }, { ymd: '2026-10-26', label: 'Mon 26' }]);
    // today 8:00 am has passed: tomorrow
    expect(firstRun({ frequency: 'DAILY', weekday: null, placeAt: '08:00', startDate: '2026-10-24', now: NOW }).toISOString()).toBe('2026-10-25T02:30:00.000Z');
    expect(firstRun({ frequency: 'DAILY', weekday: null, placeAt: '18:00', startDate: '2026-10-24', now: NOW }).toISOString()).toBe('2026-10-24T12:30:00.000Z');
    // the first Monday on or after the start
    expect(firstRun({ frequency: 'WEEKLY', weekday: 1, placeAt: '08:00', startDate: '2026-10-24', now: NOW }).toISOString()).toBe('2026-10-26T02:30:00.000Z');
    // a Saturday start at a time already gone: next Saturday
    expect(firstRun({ frequency: 'BIWEEKLY', weekday: 6, placeAt: '09:00', startDate: '2026-10-24', now: NOW }).toISOString()).toBe('2026-10-31T03:30:00.000Z');
  });
});

describe('baskets and payloads', () => {
  const raw = {
    id: 'b1', name: 'Monday basket', frequency: 'WEEKLY', weekday: 1, place_at: '08:00:00', address_id: 'a1', notes: null,
    status: 'ACTIVE', skip_next: false, next_run_at: '2026-10-26T02:30:00Z', last_run_at: null, last_order_id: null,
    items: [{ product_id: 'p-milk', variant_id: null, quantity: 2 }, { product_id: 'p-sugar', quantity: 99 }, { quantity: 1 }],
    last_run: { run_at: '2026-10-19T02:30:00Z', status: 'PLACED', order_id: 'o1', reason: null },
    estimate: { items_total: '1240.50', available_lines: 2, unavailable_lines: 0 },
  };

  test('parses a basket and drops cancelled / broken rows', () => {
    const b = parseBasket(raw)!;
    expect(b).toMatchObject({ id: 'b1', weekday: 1, placeAt: '08:00', addressId: 'a1', status: 'ACTIVE' });
    expect(b.items).toEqual([{ product_id: 'p-milk', variant_id: null, quantity: 2 }, { product_id: 'p-sugar', variant_id: null, quantity: 20 }]);
    expect(b.lastRun).toEqual({ runAt: '2026-10-19T02:30:00Z', status: 'PLACED', orderId: 'o1', reason: null });
    expect(b.estimate).toEqual({ itemsTotal: 1240.5, availableLines: 2, unavailableLines: 0 });
    expect(parseBasket({ ...raw, frequency: 'MONTHLY' })).toBeNull();
    expect(parseBasketList({ baskets: [raw, { ...raw, id: 'b2', status: 'CANCELLED' }, { nope: 1 }] }).map((x) => x.id)).toEqual(['b1']);
    expect(parseBasketList(undefined)).toEqual([]);
  });

  test('items from the cart and from a delivered order', () => {
    expect(itemsFromCart([
      { product: { id: 'p-milk' }, quantity: 2 },
      { product: { id: 'p-milk' }, quantity: 25 },
      { product: { id: 'p-tea' }, quantity: 1, variant: { id: 'v-100' } },
      { product: { id: 'demo-1' }, quantity: 1 },
    ])).toEqual([{ product_id: 'p-milk', variant_id: null, quantity: 20 }, { product_id: 'p-tea', variant_id: 'v-100', quantity: 1 }]);
    const items = [
      { product_id: 'p-milk', variant_id: null, quantity: 2, item_status: 'PACKED', order_combo_id: null },
      { product_id: 'p-x', variant_id: null, quantity: 1, item_status: 'UNAVAILABLE', order_combo_id: null },
      { product_id: 'p-y', variant_id: null, quantity: 1, item_status: 'SUBSTITUTED', order_combo_id: null },
      { product_id: 'p-z', variant_id: null, quantity: 1, item_status: 'PACKED', order_combo_id: 'oc1' },
    ];
    expect(itemsFromOrder(items)).toEqual([{ product_id: 'p-milk', variant_id: null, quantity: 2 }]);
    expect(canRepeatOrder({ order_status: 'DELIVERED', items })).toBe(true);
    expect(canRepeatOrder({ order_status: 'PACKED', items })).toBe(false);
    expect(canRepeatOrder({ order_status: 'DELIVERED', items: items.slice(1) })).toBe(false);
    expect(normaliseItems(Array.from({ length: 40 }, (_, i) => ({ product_id: `p${i}`, variant_id: null, quantity: 1 })))).toHaveLength(30);
  });

  test('estimate at today\'s prices', () => {
    const e = estimate(
      [{ product_id: 'p-milk', variant_id: null, quantity: 2 }, { product_id: 'p-sugar', variant_id: 'v1', quantity: 1 }, { product_id: 'p-gone', variant_id: null, quantity: 1 }],
      [milk, sugar],
      () => 300,
      NOW,
    );
    expect(e).toEqual({ total: effectivePrice(milk, NOW) * 2 + 300, available: 2, unavailable: 1, units: 3 });
  });

  test('create and patch bodies', () => {
    const items = [{ product_id: 'p-milk', variant_id: null, quantity: 2 }];
    expect(createBody(items, { frequency: 'DAILY', weekday: 3, placeAt: '07:30', addressId: 'a1', startDate: '2026-10-25', name: '  Milk   and bread ' })).toEqual({
      items, frequency: 'DAILY', place_at: '07:30', address_id: 'a1', start_date: '2026-10-25', name: 'Milk and bread',
    });
    expect(createBody(items, { frequency: 'WEEKLY', weekday: 1, placeAt: '08:00', addressId: 'a1', startDate: 'soon' })).toEqual({
      items, frequency: 'WEEKLY', weekday: 1, place_at: '08:00', address_id: 'a1',
    });
    const b = parseBasket(raw) as RepeatBasket;
    expect(patchBody(b, { placeAt: '08:00', weekday: 1 })).toBeNull();
    expect(patchBody(b, { placeAt: '09:15' })).toEqual({ place_at: '09:15' });
    expect(patchBody(b, { frequency: 'DAILY' })).toEqual({ frequency: 'DAILY' });
    expect(patchBody(b, { frequency: 'BIWEEKLY', weekday: 1 })).toEqual({ frequency: 'BIWEEKLY', weekday: 1 });
    expect(patchBody(b, { items: b.items })).toBeNull();
    expect(patchBody(b, { items: [{ product_id: 'p-milk', variant_id: null, quantity: 3 }] })).toEqual({ items: [{ product_id: 'p-milk', variant_id: null, quantity: 3 }] });
    expect(patchBody(b, { addressId: 'a2' })).toEqual({ address_id: 'a2' });
  });

  test('address match, gate and error words', () => {
    const a = (id: string, line: string, lat: number, def = false) => ({ id, address_line1: line, city: 'Dharga Town', latitude: lat, longitude: 80, is_default: def });
    const list = [a('a1', '1 Main St', 6.1), a('a2', '22 Lake Rd', 6.2, true)];
    expect(matchAddress(list, { line1: '1  main st', city: 'dharga town' })?.id).toBe('a1');
    expect(matchAddress(list, { line1: 'other', city: 'x', lat: '6.10001', lng: 80 })?.id).toBe('a1');
    expect(matchAddress(list, { line1: 'other', city: 'x' })?.id).toBe('a2');
    expect(matchAddress([], null)).toBeNull();
    expect(repeatOn({ repeat_baskets_enabled: true }, false)).toBe(true);
    expect(repeatOn({ repeat_baskets_enabled: true }, true)).toBe(false);
    expect(repeatOn({}, false)).toBe(false);
    expect(repeatOn({ repeat_baskets_enabled: true }, false, true)).toBe(false);
    const notReady = new ApiError('x', 503, 'REPEAT_NOT_READY');
    expect(isNotReady(notReady)).toBe(true);
    expect(isNotReady(new ApiError('x', 503))).toBe(false);
    expect(repeatErrorText(new ApiError('x', 409, 'BASKET_LIMIT'))).toMatch(/up to 5/);
    expect(repeatErrorText(new Error('x'))).toMatch(/Something went wrong/);
  });
});

describe('repeat basket calls', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  async function load() {
    vi.resetModules();
    const session = await import('@/blynk/auth/session');
    session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
    return import('./api');
  }

  test('a 503 REPEAT_NOT_READY tells the gate once, and the error goes on to the caller', async () => {
    const api = await load();
    const seen = vi.fn();
    api.onRepeatNotReady(seen);
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { success: false, error: { code: 'REPEAT_NOT_READY', message: 'not yet' } })));
    await expect(api.listBaskets()).rejects.toMatchObject({ status: 503, code: 'REPEAT_NOT_READY' });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test('create posts the body with the token and parses the basket', async () => {
    const api = await load();
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json(201, { success: true, data: { basket: { id: 'b9', frequency: 'DAILY', place_at: '07:00', items: [] } } }));
    vi.stubGlobal('fetch', fetchMock);
    const b = await api.createBasket({ frequency: 'DAILY' });
    expect(b.id).toBe('b9');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/me\/repeat-baskets$/);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer a1');
  });

  test('buy again reads the items', async () => {
    const api = await load();
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { success: true, data: { items: [{ product_id: 'p-milk', times_bought: 3 }] } })));
    expect((await api.fetchBuyAgain())[0]).toMatchObject({ productId: 'p-milk', timesBought: 3 });
  });
});
