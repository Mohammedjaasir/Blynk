import { ApiError } from '@/blynk/api/client';
import { formatLkr } from '@/blynk/lib/money';
import { placeErrorCopy } from '@/blynk/orders/errors';
import type { CouponPreview } from '@/blynk/orders/types';

/*
 * "Have a coupon code?" (backend migration 018; the Flutter shop's checkout_coupon_field.dart
 * and coupon_model.dart). Apply asks POST /orders/validate-coupon what the code takes off this
 * cart; the order re-checks it. A refusal is shown under the field in plain words.
 */

export const COUPON_PATTERN = /^[A-Z0-9]{4,20}$/;

/** Upper-case, no spaces (the server stores codes upper-case). */
export const normalizeCoupon = (raw: string) => raw.replace(/\s+/g, '').toUpperCase();

/** A local check before asking the server; null when the code may be sent. */
export function couponInputError(raw: string): string | null {
  const code = normalizeCoupon(raw);
  if (!code) return 'Enter a code.';
  return COUPON_PATTERN.test(code) ? null : 'Codes are 4 to 20 letters or numbers.';
}

/** The Flutter shop's refusal wording, keyed on the server's code. */
export function couponErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = (e.details ?? {}) as { scope?: unknown; min_subtotal?: unknown };
    switch (e.code) {
      case 'COUPON_NOT_FOUND': return "That code doesn't exist. Check it and try again.";
      case 'COUPON_INACTIVE': return 'This code is no longer available.';
      case 'COUPON_NOT_STARTED': return "This code isn't active yet.";
      case 'COUPON_EXPIRED': return 'This code has expired.';
      case 'COUPON_FIRST_ORDER_ONLY': return 'This code is only for your first order.';
      case 'COUPON_LIMIT_REACHED': return d.scope === 'CUSTOMER' ? "You've already used this code." : 'This code has been fully used.';
      case 'COUPON_MIN_SUBTOTAL': {
        const min = Number(d.min_subtotal);
        return Number.isFinite(min) && min > 0 ? `Add items worth ${formatLkr(min)} or more to use this code.` : "Your cart is below this code's minimum.";
      }
      case 'COUPONS_DISABLED': return 'Coupon codes are not available right now.';
      case 'VALIDATION_ERROR': return 'Codes are 4 to 20 letters or numbers.';
      default: break;
    }
  }
  return placeErrorCopy(e).message;
}

/** The line under "CODE applied": the gift or reward that wins, a free delivery, or the saving. */
export function couponAppliedNote(c: CouponPreview): { text: string; muted: boolean } {
  if (c.applied_discount === 'BIRTHDAY') return { text: "Your birthday gift saves more, so it's used instead of this code.", muted: true };
  if (c.applied_discount === 'REFERRAL') return { text: "Your referral reward saves more, so it's used instead of this code.", muted: true };
  if (c.discount_type === 'FREE_DELIVERY') return { text: 'Free delivery on this order', muted: false };
  return { text: `You save ${formatLkr(c.discount_amount)}`, muted: false };
}

/** The bill's discount label for the one discount used. */
export function discountLabel(kind: 'COUPON' | 'BIRTHDAY' | 'REFERRAL' | null, code?: string | null): string {
  if (kind === 'BIRTHDAY') return 'Birthday gift';
  if (kind === 'REFERRAL') return 'Referral reward';
  return code ? `Coupon (${code})` : 'Discount';
}
