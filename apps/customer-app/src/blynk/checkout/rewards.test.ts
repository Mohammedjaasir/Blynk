import { expect, test } from 'vitest';
import type { CheckoutInfo, CouponPreview } from '@/blynk/orders/types';
import {
  balanceLine, birthdayBanner, birthdayOf, earnEstimate, estimateDiscount, pointsOf, pointsRedeem, redeemLine, referralLine, referralOf, rewardsSummary,
} from './rewards';

const quote = (over: Partial<CheckoutInfo> = {}): CheckoutInfo => ({
  delivery_fee_lkr: 150, standard_delivery_fee_lkr: 150, delivery_fee_mode: 'FLAT', delivery_distance_km: null,
  delivery_distance_estimated: false, delivery_fee_address_id: 'a1', coupons_enabled: true,
  free_delivery: { enabled: false, count: 0, since: 'x', used: 0, remaining: 0, applies: false },
  ...over,
});
const points = { enabled: true, balance: 120, value_lkr: 120, earn_points: 1, earn_per_lkr: 100, lkr_per_point: 1, min_redeem_points: 50, max_redeem_percent: 20 };
const coupon = (over: Partial<CouponPreview> = {}): CouponPreview => ({
  code: 'SAVE10', discount_type: 'PERCENT', description: null, subtotal: 1000, delivery_fee: 150, discount_amount: 100,
  birthday_discount_amount: 0, referral_discount_amount: 0, applied_discount: 'COUPON', total: 1050, ...over,
});

test('birthday: eligible with a wordable percent only', () => {
  expect(birthdayOf(quote({ birthday_offer: { eligible: true, percent: 10 } }))).toEqual({ eligible: true, percent: 10 });
  expect(birthdayOf(quote({ birthday_offer: { eligible: true, percent: 150 } }))!.eligible).toBe(false);
  expect(birthdayOf(quote())).toBeNull();
  expect(birthdayBanner({ eligible: true, percent: 12.5 })).toBe('Happy birthday! 12.5% off one order this week');
});

test('referral: the line names LKR off or a free delivery', () => {
  const r = referralOf(quote({ referral_reward: { available: true, side: 'REFERRED', mode: 'LKR_OFF', amount_lkr: 150 } }))!;
  expect(referralLine(r)).toBe('Referral reward: LKR 150 off this order');
  const fd = referralOf(quote({ referral_reward: { available: true, side: 'REFERRER', mode: 'FREE_DELIVERY', amount_lkr: 0 } }))!;
  expect(referralLine(fd)).toBe('Referral reward: free delivery on this order');
  expect(referralOf(quote({ referral_reward: { available: true, side: null, mode: 'LKR_OFF', amount_lkr: 0 } }))!.available).toBe(false);
});

test('one discount: the larger of gift and reward; reward only when strictly larger', () => {
  const birthday = { eligible: true, percent: 10 };
  const ref150 = { available: true, mode: 'LKR_OFF' as const, amount: 150 };
  const ref100 = { available: true, mode: 'LKR_OFF' as const, amount: 100 };
  expect(estimateDiscount({ subtotal: 1000, deliveryFee: 150, birthday, referral: ref150 })).toEqual({ kind: 'REFERRAL', amount: 150, onItems: 150 });
  expect(estimateDiscount({ subtotal: 1000, deliveryFee: 150, birthday, referral: ref100 })).toEqual({ kind: 'BIRTHDAY', amount: 100, onItems: 100 });
  // a free-delivery reward is worth the charged fee, not off the items
  expect(estimateDiscount({ subtotal: 500, deliveryFee: 150, birthday: null, referral: { available: true, mode: 'FREE_DELIVERY', amount: 0 } }))
    .toEqual({ kind: 'REFERRAL', amount: 150, onItems: 0 });
  expect(estimateDiscount({ subtotal: 500, deliveryFee: 0, birthday: null, referral: { available: true, mode: 'FREE_DELIVERY', amount: 0 } }).kind).toBeNull();
});

test('a coupon preview carries the server choice', () => {
  expect(estimateDiscount({ subtotal: 1000, deliveryFee: 150, coupon: coupon(), birthday: null, referral: null })).toEqual({ kind: 'COUPON', amount: 100, onItems: 100 });
  expect(estimateDiscount({ subtotal: 1000, deliveryFee: 150, coupon: coupon({ applied_discount: 'BIRTHDAY', birthday_discount_amount: 120 }), birthday: null, referral: null }).amount).toBe(120);
  expect(estimateDiscount({ subtotal: 1000, deliveryFee: 150, coupon: coupon({ discount_type: 'FREE_DELIVERY', discount_amount: 150 }), birthday: null, referral: null }).onItems).toBe(0);
});

test('points: min balance, percent cap, value to the cent', () => {
  const p = pointsOf(quote({ points }))!;
  expect(balanceLine(p)).toBe('You have 120 points = LKR 120');
  // 20% of 1150 = 230 → capped by the balance 120
  expect(pointsRedeem(p, 1150)).toEqual({ points: 120, value: 120 });
  // 20% of 300 = 60
  expect(pointsRedeem(p, 300)).toEqual({ points: 60, value: 60 });
  expect(pointsRedeem({ ...p, balance: 40 }, 1000).points).toBe(0);
  expect(redeemLine({ points: 0, value: 0 })).toBe("Points can't be used on this order.");
  expect(earnEstimate(p, 1050)).toBe(10);
});

test('summary: discount, then points on what is due', () => {
  const q = quote({ points, birthday_offer: { eligible: true, percent: 10 } });
  const off = rewardsSummary({ subtotal: 1000, deliveryFee: 150, quote: q, usePoints: false });
  expect(off).toMatchObject({ toPay: 1050, points: { points: 0 }, earn: 9 });
  const on = rewardsSummary({ subtotal: 1000, deliveryFee: 150, quote: q, usePoints: true });
  // due 1050, 20% = 210 → 120 (balance)
  expect(on.toPay).toBe(930);
});
