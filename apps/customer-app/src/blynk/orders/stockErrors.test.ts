import { expect, test } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { placeErrorCopy, stockRefusal, stockRefusalNote } from './errors';

/* Migration 045 refusals of POST /orders: the cart follows them and the server sentence names the item. */

test('OUT_OF_STOCK names the item and marks that size sold out', () => {
  const e = new ApiError('Sorry, Chilli Powder 100 g is sold out.', 409, 'OUT_OF_STOCK', { product_id: 'p1', variant_id: 'v100', name: 'Chilli Powder 100 g', available: 0, requested: 2 });
  expect(placeErrorCopy(e)).toEqual({ title: 'Sold out', message: 'Sorry, Chilli Powder 100 g is sold out.', action: 'stock' });
  expect(stockRefusal(e)).toEqual({ kind: 'sold-out', product_id: 'p1', variant_id: 'v100' });
});

test("INSUFFICIENT_STOCK: 'Only N left' and the line is lowered to N", () => {
  const e = new ApiError('Only 3 left of Chilli Powder 100 g. Please lower the quantity.', 409, 'INSUFFICIENT_STOCK', { product_id: 'p1', variant_id: 'v100', available: 3, requested: 5 });
  expect(placeErrorCopy(e).message).toBe('Only 3 left of Chilli Powder 100 g. Please lower the quantity.');
  const r = stockRefusal(e)!;
  expect(r).toEqual({ kind: 'only', product_id: 'p1', variant_id: 'v100', available: 3 });
  expect(stockRefusalNote(r)).toBe('Your cart now has 3.');
  // a product without sizes (variant_id null) and "0 left" = sold out
  expect(stockRefusal(new ApiError('x', 409, 'INSUFFICIENT_STOCK', { product_id: 'p2', variant_id: null, available: 0 }))).toEqual({ kind: 'sold-out', product_id: 'p2', variant_id: null });
});

test('VARIANT_* refusals', () => {
  expect(stockRefusal(new ApiError('x', 400, 'VARIANT_REQUIRED', { product_id: 'p1', name: 'Chilli Powder' }))).toEqual({ kind: 'needs-size', product_id: 'p1' });
  expect(stockRefusal(new ApiError('x', 400, 'VARIANT_NOT_FOUND', { product_id: 'p1', variant_id: 'v9' }))).toEqual({ kind: 'sold-out', product_id: 'p1', variant_id: 'v9' });
  expect(stockRefusal(new ApiError('x', 400, 'VARIANT_UNAVAILABLE', { product_id: 'p1', variant_id: 'v9' }))).toEqual({ kind: 'sold-out', product_id: 'p1', variant_id: 'v9' });
  expect(placeErrorCopy(new ApiError('Request failed.', 400, 'VARIANT_REQUIRED')).title).toBe('Choose a size');
  expect(placeErrorCopy(new ApiError('Request failed.', 400, 'VARIANT_REQUIRED')).message).toMatch(/size/);
});

test('lead time refusals reload the slots', () => {
  const e = new ApiError('Ribbon Cake needs 2 days, scheduled delivery is not available right now. Please remove it to order now.', 422, 'LEAD_TIME_REQUIRES_SLOT', { lead_days: 2, earliest_delivery_date: '2026-10-16', slots_enabled: false });
  expect(placeErrorCopy(e)).toMatchObject({ action: 'slot', message: e.message });
  expect(placeErrorCopy(new ApiError('x', 422, 'SLOT_BEFORE_LEAD_TIME')).action).toBe('slot');
  expect(stockRefusal(e)).toBeNull();
});

test('other errors are not stock refusals', () => {
  expect(stockRefusal(new ApiError('x', 400, 'PRODUCT_UNAVAILABLE', { product_id: 'p1' }))).toBeNull();
  expect(stockRefusal(new ApiError('x', 409, 'OUT_OF_STOCK'))).toBeNull();
  expect(stockRefusal(new Error('boom'))).toBeNull();
});
