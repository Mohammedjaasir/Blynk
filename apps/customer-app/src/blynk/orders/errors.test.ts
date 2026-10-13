import { expect, test } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { cancelErrorText, placeErrorCopy, refusedProduct } from './errors';

test('store closed shows the server sentence (it says when the store opens)', () => {
  const e = new ApiError("We're closed now. We open at 8:00 AM.", 422, 'STORE_CLOSED');
  expect(placeErrorCopy(e)).toEqual({ title: "We're closed right now", message: "We're closed now. We open at 8:00 AM.", action: 'closed' });
});

test('out of area, unavailable item, coupon and validation have their own copy and action', () => {
  expect(placeErrorCopy(new ApiError('x', 422, 'DELIVERY_OUTSIDE_RADIUS')).action).toBe('address');
  expect(placeErrorCopy(new ApiError('x', 404, 'ADDRESS_NOT_FOUND')).action).toBe('address');
  expect(placeErrorCopy(new ApiError('x', 400, 'PRODUCT_UNAVAILABLE')).action).toBe('reconcile');
  expect(placeErrorCopy(new ApiError('x', 422, 'COUPON_EXPIRED'))).toEqual({ title: 'Coupon expired', message: 'That coupon has expired.', action: 'coupon' });
  expect(placeErrorCopy(new ApiError('Request validation failed', 400, 'VALIDATION_ERROR')).action).toBe('reconcile');
});

test('network and server failures ask for a retry and never show server text', () => {
  expect(placeErrorCopy(new ApiError('x', 0, 'NETWORK_ERROR')).action).toBe('retry');
  const s = placeErrorCopy(new ApiError('stack', 500, 'INTERNAL_SERVER_ERROR'));
  expect(s.action).toBe('retry');
  expect(s.message).not.toContain('stack');
  expect(placeErrorCopy(new ApiError('x', 401, 'UNAUTHENTICATED')).action).toBe('signin');
  expect(placeErrorCopy(new Error('boom')).action).toBe('retry');
});

test('the refused product comes from the error details', () => {
  expect(refusedProduct(new ApiError('x', 400, 'PRODUCT_UNAVAILABLE', { product_id: 'p1', name: 'Milk' }))).toEqual({ product_id: 'p1', name: 'Milk' });
  expect(refusedProduct(new ApiError('x', 400, 'PRODUCT_NOT_FOUND'))).toBeNull();
});

test('cancel refusals', () => {
  expect(cancelErrorText(new ApiError('x', 400, 'ORDER_CANNOT_BE_CANCELLED'))).toBe("This order can't be cancelled now.");
  expect(cancelErrorText(new ApiError('x', 400, 'ORDER_ALREADY_CANCELLED'))).toBe('This order is already cancelled.');
});
