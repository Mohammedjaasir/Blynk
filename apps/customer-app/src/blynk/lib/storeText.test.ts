import { expect, test } from 'vitest';
import { deliveryFeeText, flatFee, formatClock, formatHours, freeDeliveryCount, radiusText, reopensText } from './storeText';
import { formatLkr } from './money';
import { store } from '../test/fixtures';

test('formats clock times', () => {
  expect(formatClock('08:00')).toBe('8 AM');
  expect(formatClock('21:30')).toBe('9:30 PM');
  expect(formatClock('00:00')).toBe('12 AM');
  expect(formatClock('12:00')).toBe('12 PM');
  expect(formatClock('nope')).toBeNull();
});

test('hours and radius hide when the store is missing', () => {
  expect(formatHours(null)).toBeNull();
  expect(radiusText(null)).toBeNull();
  expect(formatHours(store)).toBe('8 AM – 9 PM');
  expect(radiusText({ ...store, radius_km: 5 })).toBe('Groceries delivered within 5 km');
});

test('delivery fee text: free deliveries, flat fee, or calculated at checkout', () => {
  expect(deliveryFeeText(store, formatLkr)).toBe('FREE · first 2 deliveries');
  const off = { ...store, new_customer_free_deliveries: { ...store.new_customer_free_deliveries, enabled: false } };
  expect(freeDeliveryCount(off)).toBe(0);
  expect(deliveryFeeText(off, formatLkr)).toBe('Calculated at checkout');
  const flat = { ...off, delivery_fee_mode: 'FLAT' as const, delivery_fee_lkr: 100 };
  expect(flatFee(flat)).toBe(100);
  expect(deliveryFeeText(flat, formatLkr)).toBe('LKR 100');
  expect(deliveryFeeText(null, formatLkr)).toBe('Calculated at checkout');
});

test('reopens text uses Sri Lanka time and hides when unknown', () => {
  expect(reopensText(store)).toBeNull();
  const now = new Date('2026-10-13T16:00:00Z'); // 21:30 in Colombo, a Tuesday
  expect(reopensText({ ...store, next_open_at: '2026-10-14T02:30:00Z' }, now)).toBe('Reopens Wed, 8 AM');
  expect(reopensText({ ...store, next_open_at: '2026-10-13T16:30:00Z' }, now)).toBe('Reopens today, 10 PM');
  expect(reopensText({ ...store, next_open_at: 'garbage' }, now)).toBeNull();
});
