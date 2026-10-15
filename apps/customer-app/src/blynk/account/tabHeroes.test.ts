import { describe, expect, test } from 'vitest';
import type { StoreInfo } from '../api/types';
import { countUpAt, ENTER, enterDelay, firstName, initialOf, openStatus } from './tabHeroes';

const store = (over: Partial<StoreInfo> = {}): StoreInfo => ({
  delivery_fee_lkr: 150, delivery_fee_mode: 'FLAT', radius_km: 4, coupons_enabled: true, show_offer_savings: true,
  new_customer_free_deliveries: { enabled: false, count: 0, since: '' },
  delivery_hours: { start: '08:00', end: '21:00', timezone: 'Asia/Colombo' },
  is_open_now: true, closed_kind: 'OPEN', closed_reason: null, next_open_at: null, delivery_slots_enabled: false,
  doctors_require_sign_in: false, ...over,
});
// 2026-10-15 10:00 in Colombo (UTC+5:30) = 04:30Z
const MORNING = new Date('2026-10-15T04:30:00Z');
const NIGHT = new Date('2026-10-15T17:00:00Z'); // 22:30 Colombo
const EARLY = new Date('2026-10-15T01:00:00Z'); // 06:30 Colombo

describe('openStatus', () => {
  test('nothing until the store has loaded', () => {
    expect(openStatus(null, MORNING)).toBeNull();
  });
  test('open: the hours ride along', () => {
    expect(openStatus(store(), MORNING)).toEqual({ open: true, label: "We're open now · 8 AM – 9 PM" });
  });
  test('closed with no reopening time: the opening hour', () => {
    expect(openStatus(store({ is_open_now: false, closed_kind: 'OUTSIDE_HOURS' }), NIGHT)).toEqual({ open: false, label: 'Opens at 8 AM' });
  });
  test('closed, reopening later today', () => {
    const s = store({ is_open_now: false, next_open_at: '2026-10-15T02:30:00Z' }); // 08:00 Colombo
    expect(openStatus(s, EARLY)?.label).toBe('Opens at 8 AM');
  });
  test('closed, reopening tomorrow', () => {
    const s = store({ is_open_now: false, next_open_at: '2026-10-16T02:30:00Z' });
    expect(openStatus(s, NIGHT)?.label).toBe('Opens tomorrow at 8 AM');
  });
  test('closed for days (a holiday): the weekday', () => {
    const s = store({ is_open_now: false, closed_kind: 'HOLIDAY', reopens_at: '2026-10-18T03:00:00Z' }); // Sun 08:30
    expect(openStatus(s, MORNING)?.label).toBe('Opens Sun at 8:30 AM');
  });
  test('the server decides over the clock (a holiday inside the hours)', () => {
    expect(openStatus(store({ is_open_now: false }), MORNING)?.open).toBe(false);
  });
  test('without is_open_now the hours decide, in Sri Lanka time', () => {
    const s = store({ is_open_now: undefined as unknown as boolean });
    expect(openStatus(s, MORNING)?.open).toBe(true);
    expect(openStatus(s, NIGHT)).toEqual({ open: false, label: 'Opens at 8 AM' });
    expect(openStatus(s, EARLY)?.open).toBe(false);
  });
  test('the label never carries a phone number', () => {
    for (const s of [store(), store({ is_open_now: false })]) expect(openStatus(s, MORNING)?.label).not.toMatch(/\d{3}\s?\d{4}/);
  });
});

test('first name and initial', () => {
  expect(firstName('  Fathima   Rizna ')).toBe('Fathima');
  expect(firstName('')).toBeNull();
  expect(firstName(null)).toBeNull();
  expect(initialOf('rizna')).toBe('R');
  expect(initialOf('   ')).toBeNull();
});

test('points count up from 0 and land exactly', () => {
  expect(countUpAt(120, 0)).toBe(0);
  expect(countUpAt(120, 1)).toBe(120);
  expect(countUpAt(120, 1.4)).toBe(120);
  const mid = countUpAt(120, 0.5);
  expect(mid).toBeGreaterThan(60); // eases out: past half by half time
  expect(mid).toBeLessThan(120);
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) { const v = countUpAt(120, t); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
  expect(countUpAt(0, 0.5)).toBe(0);
  expect(countUpAt(Number.NaN, 0.5)).toBe(0);
});

test('row entrance: ≤ 40 ms apart and every row in before 600 ms', () => {
  expect(ENTER.stepMs).toBeLessThanOrEqual(40);
  expect(enterDelay(0)).toBe(0);
  expect(enterDelay(1)).toBe(ENTER.stepMs);
  expect(enterDelay(50) + ENTER.durationMs).toBeLessThan(600);
  expect(enterDelay(-3)).toBe(0);
});
