import { ApiError } from '@/blynk/api/client';
import { formatLkr } from '@/blynk/lib/money';
import { placeErrorCopy } from '@/blynk/orders/errors';
import type { CouponPreview } from '@/blynk/orders/types';
import { COUPON_WORDS as W } from './words';

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
  if (!code) return W.inputEmpty;
  return COUPON_PATTERN.test(code) ? null : W.inputBad;
}

/** The Flutter shop's refusal wording, keyed on the server's code. */
export function couponErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = (e.details ?? {}) as { scope?: unknown; min_subtotal?: unknown };
    switch (e.code) {
      case 'COUPON_NOT_FOUND': return W.notFound;
      case 'COUPON_INACTIVE': return W.inactive;
      case 'COUPON_NOT_STARTED': return W.notStarted;
      case 'COUPON_EXPIRED': return W.expired;
      case 'COUPON_FIRST_ORDER_ONLY': return W.firstOrderOnly;
      case 'COUPON_LIMIT_REACHED': return d.scope === 'CUSTOMER' ? W.alreadyUsed : W.fullyUsed;
      case 'COUPON_MIN_SUBTOTAL': {
        const min = Number(d.min_subtotal);
        return Number.isFinite(min) && min > 0 ? W.minSubtotal(formatLkr(min)) : W.minBelow;
      }
      case 'COUPONS_DISABLED': return W.disabled;
      case 'VALIDATION_ERROR': return W.inputBad;
      default: break;
    }
  }
  return placeErrorCopy(e).message;
}

/** The line under "CODE applied": the gift or reward that wins, a free delivery, or the saving. */
export function couponAppliedNote(c: CouponPreview): { text: string; muted: boolean } {
  if (c.applied_discount === 'BIRTHDAY') return { text: W.birthdayWins, muted: true };
  if (c.applied_discount === 'REFERRAL') return { text: W.referralWins, muted: true };
  if (c.discount_type === 'FREE_DELIVERY') return { text: W.freeDelivery, muted: false };
  return { text: W.youSave(formatLkr(c.discount_amount)), muted: false };
}

/** The bill's discount label for the one discount used. */
export function discountLabel(kind: 'COUPON' | 'BIRTHDAY' | 'REFERRAL' | null, code?: string | null): string {
  if (kind === 'BIRTHDAY') return W.labelBirthday;
  if (kind === 'REFERRAL') return W.labelReferral;
  return code ? W.labelCoupon(code) : W.labelDiscount;
}
