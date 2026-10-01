import type { CouponDiscountType } from '../../database/types.js';

/** The coupon fields the discount depends on. */
export interface CouponTerms {
  discount_type: CouponDiscountType;
  discount_value: number | string;
  max_discount: number | string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * What a coupon takes off an order, in LKR (2 decimals).
 *
 * * FIXED: the amount, but never more than the subtotal.
 * * PERCENT: that share of the subtotal, capped by max_discount (and the subtotal).
 * * FREE_DELIVERY: the delivery fee.
 *
 * So the total (subtotal + fee - discount) is never negative.
 */
export function computeDiscount(coupon: CouponTerms, subtotal: number, deliveryFee: number): number {
  const sub = Math.max(0, Number(subtotal));
  const value = Number(coupon.discount_value);
  switch (coupon.discount_type) {
    case 'FIXED':
      return round2(Math.min(value, sub));
    case 'PERCENT': {
      let d = round2((sub * value) / 100);
      if (coupon.max_discount != null) d = Math.min(d, Number(coupon.max_discount));
      return round2(Math.min(d, sub));
    }
    case 'FREE_DELIVERY':
      return round2(Math.max(0, Number(deliveryFee)));
    default:
      return 0;
  }
}
