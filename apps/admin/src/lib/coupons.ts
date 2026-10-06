import type { Coupon, CouponInput, CouponType } from '../api/types';
import { formatMoney } from './orders';

/**
 * Coupon rules the form checks before sending. They mirror the API
 * (backend/api/src/modules/coupons/coupon.schema.ts), which re-checks all of
 * them; the database CHECKs are the last word.
 */
export const CODE_PATTERN = /^[A-Z0-9]{4,20}$/;

export const TYPE_LABEL: Record<CouponType, string> = {
  FIXED: 'Amount off (LKR)',
  PERCENT: 'Percentage off',
  FREE_DELIVERY: 'Free delivery',
};

/** "LKR 50 off", "10% off, up to LKR 75", "Free delivery". */
export function describeDiscount(c: Pick<Coupon, 'discount_type' | 'discount_value' | 'max_discount'>): string {
  switch (c.discount_type) {
    case 'FIXED':
      return `${formatMoney(c.discount_value)} off`;
    case 'PERCENT':
      return c.max_discount != null
        ? `${c.discount_value}% off, up to ${formatMoney(c.max_discount)}`
        : `${c.discount_value}% off`;
    case 'FREE_DELIVERY':
      return 'Free delivery';
  }
}

/** Store days are Asia/Colombo (UTC+05:30 all year). */
const COLOMBO_OFFSET_MIN = 330;

/** YYYY-MM-DD in Colombo for an instant. */
export function colomboDate(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Date(d.getTime() + COLOMBO_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Colombo midnight at the start of a date, as an ISO instant. */
export function colomboStartOf(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - COLOMBO_OFFSET_MIN * 60_000).toISOString();
}

/** The instant a coupon "valid until <date>" stops: the next Colombo midnight. */
export function colomboEndOf(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (24 * 60 - COLOMBO_OFFSET_MIN) * 60_000).toISOString();
}

/** The inclusive last day of a coupon whose ends_at is an exclusive midnight. */
export function lastValidDay(endsAt: string): string {
  return colomboDate(new Date(Date.parse(endsAt) - 1));
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' });
export const formatDay = (iso: string) => dateFmt.format(new Date(iso));

/** "Any time", "From 1 Oct 2026", "Until 31 Oct 2026", "1 Oct 2026 - 31 Oct 2026". */
export function describeWindow(c: Pick<Coupon, 'starts_at' | 'ends_at'>): string {
  const from = c.starts_at ? formatDay(c.starts_at) : null;
  const to = c.ends_at ? formatDay(new Date(Date.parse(c.ends_at) - 1).toISOString()) : null;
  if (from && to) return `${from} – ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return 'Any time';
}

/** Whether a customer could use it right now (active and inside its dates). */
export function couponState(c: Coupon, now = new Date()): 'live' | 'off' | 'scheduled' | 'ended' | 'used-up' {
  if (!c.is_active) return 'off';
  if (c.starts_at && now < new Date(c.starts_at)) return 'scheduled';
  if (c.ends_at && now >= new Date(c.ends_at)) return 'ended';
  if (c.usage_limit != null && c.usage_count >= c.usage_limit) return 'used-up';
  return 'live';
}

export const STATE_LABEL: Record<ReturnType<typeof couponState>, string> = {
  live: 'Live',
  off: 'Switched off',
  scheduled: 'Scheduled',
  ended: 'Ended',
  'used-up': 'Used up',
};

export interface CouponForm {
  code: string;
  description: string;
  discount_type: CouponType;
  discount_value: string;
  max_discount: string;
  min_subtotal: string;
  first_order_only: boolean;
  starts_on: string;
  ends_on: string;
  usage_limit: string;
  per_customer_limit: string;
  is_active: boolean;
}

export type CouponFormErrors = Partial<Record<keyof CouponForm | 'form', string>>;

export function emptyForm(): CouponForm {
  return {
    code: '',
    description: '',
    discount_type: 'FIXED',
    discount_value: '',
    max_discount: '',
    min_subtotal: '',
    first_order_only: false,
    starts_on: '',
    ends_on: '',
    usage_limit: '',
    per_customer_limit: '1',
    is_active: true,
  };
}

export function formFromCoupon(c: Coupon): CouponForm {
  return {
    code: c.code,
    description: c.description ?? '',
    discount_type: c.discount_type,
    discount_value: c.discount_type === 'FREE_DELIVERY' ? '' : String(c.discount_value),
    max_discount: c.max_discount != null ? String(c.max_discount) : '',
    min_subtotal: c.min_subtotal != null ? String(c.min_subtotal) : '',
    first_order_only: c.first_order_only,
    starts_on: c.starts_at ? colomboDate(c.starts_at) : '',
    ends_on: c.ends_at ? lastValidDay(c.ends_at) : '',
    usage_limit: c.usage_limit != null ? String(c.usage_limit) : '',
    per_customer_limit: String(c.per_customer_limit),
    is_active: c.is_active,
  };
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

/**
 * `usageCount`: times the coupon has already been used. A total-uses limit
 * below that would describe a coupon that was over-used, so it is refused.
 */
export function validateForm(f: CouponForm, isNew: boolean, usageCount = 0): CouponFormErrors {
  const e: CouponFormErrors = {};
  if (isNew && !CODE_PATTERN.test(f.code.trim().toUpperCase())) e.code = 'Use 4-20 letters or digits, no spaces.';
  const value = num(f.discount_value);
  if (f.discount_type === 'FIXED' && !(value != null && value > 0)) e.discount_value = 'Enter an amount above 0.';
  if (f.discount_type === 'PERCENT' && !(value != null && value >= 1 && value <= 100)) {
    e.discount_value = 'Enter a percentage from 1 to 100.';
  }
  const max = num(f.max_discount);
  if (f.discount_type === 'PERCENT' && max != null && !(max > 0)) e.max_discount = 'Enter an amount above 0, or leave it empty.';
  const min = num(f.min_subtotal);
  if (min != null && !(min >= 0)) e.min_subtotal = 'Enter an amount, or leave it empty.';
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) e.ends_on = 'The last day must be on or after the first day.';
  const limit = num(f.usage_limit);
  if (limit != null && !(Number.isInteger(limit) && limit >= 1)) e.usage_limit = 'Enter a whole number, or leave it empty.';
  else if (limit != null && limit < usageCount) {
    e.usage_limit = `Already used ${usageCount} ${usageCount === 1 ? 'time' : 'times'}; the limit cannot be lower than that.`;
  }
  const per = num(f.per_customer_limit);
  if (!(per != null && Number.isInteger(per) && per >= 1)) e.per_customer_limit = 'Enter a whole number, at least 1.';
  return e;
}

/** The API body for the form (the code only when creating). */
export function toInput(f: CouponForm, isNew: boolean): CouponInput {
  return {
    ...(isNew ? { code: f.code.trim().toUpperCase() } : {}),
    description: f.description.trim() || null,
    discount_type: f.discount_type,
    discount_value: f.discount_type === 'FREE_DELIVERY' ? 0 : Number(f.discount_value),
    max_discount: f.discount_type === 'PERCENT' ? num(f.max_discount) : null,
    min_subtotal: num(f.min_subtotal),
    first_order_only: f.first_order_only,
    starts_at: f.starts_on ? colomboStartOf(f.starts_on) : null,
    ends_at: f.ends_on ? colomboEndOf(f.ends_on) : null,
    usage_limit: num(f.usage_limit),
    per_customer_limit: Number(f.per_customer_limit),
    is_active: f.is_active,
  };
}

/** What COUPON_IN_USE means, for any action the API refuses with it. */
export function couponInUseMessage(code: string): string {
  return `${code} has already been used on orders, so it cannot be deleted. Switch it off instead to stop new uses; past orders keep their discount.`;
}

/** API field -> form field, for showing server validation details inline. */
export const COUPON_FIELD_FOR: Record<string, keyof CouponForm> = {
  code: 'code',
  description: 'description',
  discount_type: 'discount_type',
  discount_value: 'discount_value',
  max_discount: 'max_discount',
  min_subtotal: 'min_subtotal',
  starts_at: 'starts_on',
  ends_at: 'ends_on',
  usage_limit: 'usage_limit',
  per_customer_limit: 'per_customer_limit',
};
