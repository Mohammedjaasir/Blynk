import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { milk, sugar, MemoryStorage } from '../test/fixtures';
import { checkoutBill, checkoutKeyFor, checkoutSignature, forgetCheckoutKey, newIdempotencyKey, orderItems } from './checkout';
import type { CheckoutInfo, CouponPreview } from './types';

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => vi.unstubAllGlobals());

const quote = (over: Partial<CheckoutInfo> = {}): CheckoutInfo => ({
  delivery_fee_lkr: 150,
  standard_delivery_fee_lkr: 150,
  delivery_fee_mode: 'FLAT',
  delivery_distance_km: 2.4,
  delivery_distance_estimated: false,
  delivery_fee_address_id: 'a1',
  coupons_enabled: false,
  free_delivery: { enabled: false, count: 0, since: '2026-10-08T18:30:00.000Z', used: 0, remaining: 0, applies: false },
  basket_free_delivery: { enabled: false, min_subtotal_lkr: 0, applies: false, remaining_lkr: null },
  ...over,
});

test('orderItems sends available Blynk lines only', () => {
  const lines = [
    { product: milk, quantity: 2 },
    { product: { ...sugar, is_available: false }, quantity: 1 },
    { product: { ...sugar, id: 'demo-1' }, quantity: 3 },
  ];
  expect(orderItems(lines)).toEqual([{ product_id: 'p-milk', quantity: 2 }]);
});

test('signature ignores line order but not quantity, address, coupon or note', () => {
  const a = checkoutSignature({ items: [{ product_id: 'x', quantity: 1 }, { product_id: 'y', quantity: 2 }], addressId: 'a1' });
  const b = checkoutSignature({ items: [{ product_id: 'y', quantity: 2 }, { product_id: 'x', quantity: 1 }], addressId: 'a1' });
  expect(a).toBe(b);
  expect(checkoutSignature({ items: [{ product_id: 'x', quantity: 2 }, { product_id: 'y', quantity: 2 }], addressId: 'a1' })).not.toBe(a);
  expect(checkoutSignature({ items: [{ product_id: 'x', quantity: 1 }, { product_id: 'y', quantity: 2 }], addressId: 'a2' })).not.toBe(a);
  expect(checkoutSignature({ items: [{ product_id: 'x', quantity: 1 }, { product_id: 'y', quantity: 2 }], addressId: 'a1', coupon: 'SAVE10' })).not.toBe(a);
  expect(checkoutSignature({ items: [{ product_id: 'x', quantity: 1 }, { product_id: 'y', quantity: 2 }], addressId: 'a1', note: 'Leave at door' })).not.toBe(a);
});

test('idempotency keys are random hex within the server limit', () => {
  const k = newIdempotencyKey();
  expect(k).toMatch(/^app_[0-9a-f]{32}$/);
  expect(k.length).toBeLessThanOrEqual(128);
  expect(newIdempotencyKey()).not.toBe(k);
});

test('the same checkout keeps its key (double tap, retry, reload); a changed one gets a new key', () => {
  let n = 0;
  const make = () => `k${++n}`;
  expect(checkoutKeyFor('sig-1', make)).toBe('k1');
  expect(checkoutKeyFor('sig-1', make)).toBe('k1');
  expect(checkoutKeyFor('sig-2', make)).toBe('k2');
  forgetCheckoutKey();
  expect(checkoutKeyFor('sig-2', make)).toBe('k3');
});

test('bill: fee unknown until the quote arrives', () => {
  const b = checkoutBill(1000, null);
  expect(b.deliveryFee).toBeNull();
  expect(b.toPay).toBeNull();
});

test('bill: charged fee from the quote', () => {
  const b = checkoutBill(1026, quote());
  expect(b).toMatchObject({ itemTotal: 1026, deliveryFee: 150, standardFee: 150, freeReason: null, toPay: 1176, distanceKm: null });
});

test('bill: per-km tiers show the distance', () => {
  const b = checkoutBill(500, quote({ delivery_fee_mode: 'DISTANCE_TIERS', delivery_distance_km: 3.1, delivery_distance_estimated: true }));
  expect(b.distanceKm).toBe(3.1);
  expect(b.distanceEstimated).toBe(true);
});

test('bill: new-customer free delivery', () => {
  const b = checkoutBill(800, quote({
    delivery_fee_lkr: 0,
    free_delivery: { enabled: true, count: 2, since: 'x', used: 0, remaining: 2, applies: true },
  }));
  expect(b).toMatchObject({ deliveryFee: 0, standardFee: 150, freeReason: 'NEW_CUSTOMER', freeRemaining: 2, toPay: 800 });
});

test('bill: basket free delivery wins over the new-customer one, and "add more" when short', () => {
  const free = checkoutBill(5200, quote({
    delivery_fee_lkr: 0,
    free_delivery: { enabled: true, count: 2, since: 'x', used: 0, remaining: 2, applies: true },
    basket_free_delivery: { enabled: true, min_subtotal_lkr: 5000, applies: true, remaining_lkr: 0 },
  }));
  expect(free.freeReason).toBe('BASKET');
  expect(free.basketRemaining).toBeNull();
  const short = checkoutBill(4200, quote({ basket_free_delivery: { enabled: true, min_subtotal_lkr: 5000, applies: false, remaining_lkr: 800 } }));
  expect(short.basketRemaining).toBe(800);
  expect(short.basketMin).toBe(5000);
  expect(short.freeReason).toBeNull();
});

test('bill: an applied coupon preview takes its discount off', () => {
  const coupon: CouponPreview = {
    code: 'SAVE10', discount_type: 'PERCENT', description: null, subtotal: 1000, delivery_fee: 150,
    discount_amount: 100, birthday_discount_amount: 0, referral_discount_amount: 0, applied_discount: 'COUPON', total: 1050,
  };
  const b = checkoutBill(1000, quote({ coupons_enabled: true }), coupon);
  expect(b.discount).toBe(100);
  expect(b.toPay).toBe(1050);
});
