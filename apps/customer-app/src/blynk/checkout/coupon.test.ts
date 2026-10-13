import { expect, test } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { couponAppliedNote, couponErrorText, couponInputError, discountLabel, normalizeCoupon } from './coupon';

const preview = { code: 'SAVE10', discount_type: 'PERCENT', description: null, subtotal: 1000, delivery_fee: 150, discount_amount: 100, birthday_discount_amount: 0, referral_discount_amount: 0, applied_discount: 'COUPON' as const, total: 1050 };

test('codes are checked locally before the server is asked', () => {
  expect(normalizeCoupon(' save 10 ')).toBe('SAVE10');
  expect(couponInputError('')).toBe('Enter a code.');
  expect(couponInputError('ab')).toBe('Codes are 4 to 20 letters or numbers.');
  expect(couponInputError('save10')).toBeNull();
});

test('refusals use the Flutter wording', () => {
  expect(couponErrorText(new ApiError('x', 404, 'COUPON_NOT_FOUND'))).toBe("That code doesn't exist. Check it and try again.");
  expect(couponErrorText(new ApiError('x', 422, 'COUPON_LIMIT_REACHED', { scope: 'CUSTOMER' }))).toBe("You've already used this code.");
  expect(couponErrorText(new ApiError('x', 422, 'COUPON_LIMIT_REACHED', { scope: 'GLOBAL' }))).toBe('This code has been fully used.');
  expect(couponErrorText(new ApiError('x', 422, 'COUPON_MIN_SUBTOTAL', { min_subtotal: '2000.00' }))).toBe('Add items worth LKR 2,000 or more to use this code.');
  expect(couponErrorText(new ApiError('x', 422, 'COUPON_MIN_SUBTOTAL'))).toBe("Your cart is below this code's minimum.");
  expect(couponErrorText(new ApiError('x', 0, 'NETWORK_ERROR'))).toContain("couldn't reach Blynk");
});

test('the applied note says which discount is used', () => {
  expect(couponAppliedNote(preview)).toEqual({ text: 'You save LKR 100', muted: false });
  expect(couponAppliedNote({ ...preview, applied_discount: 'BIRTHDAY' }).text).toBe("Your birthday gift saves more, so it's used instead of this code.");
  expect(couponAppliedNote({ ...preview, applied_discount: 'REFERRAL' }).muted).toBe(true);
  expect(couponAppliedNote({ ...preview, discount_type: 'FREE_DELIVERY' }).text).toBe('Free delivery on this order');
  expect(discountLabel('COUPON', 'SAVE10')).toBe('Coupon (SAVE10)');
  expect(discountLabel('BIRTHDAY')).toBe('Birthday gift');
});
