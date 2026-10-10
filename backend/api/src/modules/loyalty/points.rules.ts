import { DateTime } from 'luxon';
import { z } from 'zod';
import { num, round2, twoDecimals } from './program-settings.js';

/**
 * Blynk Points (owner, 2026-10-10; migration 037): "admin and ops will
 * decide that" - every number below is set in Admin/Operations. Pure rules,
 * tested without a database.
 *
 * - EARN: `earn_points` points for every full LKR `earn_per_lkr` of a
 *   DELIVERED order's item subtotal after discounts (coupon, birthday gift,
 *   referral reward, and offer prices already in the item prices). The
 *   delivery fee never earns, and neither does the part paid with points.
 * - REDEEM: at checkout, when the customer turns "Use points" on and holds at
 *   least `min_redeem_points`: as many points as fit in `max_redeem_percent`
 *   of the amount due after discounts (items + delivery - discount), each
 *   worth LKR `lkr_per_point`. Points act like a payment applied after every
 *   discount, so they DO combine with a coupon, birthday gift or referral.
 * - EXPIRY: points earned (or given back) expire `expiry_months` after they
 *   were added (0 = never); spending uses the soonest-expiring points first.
 */

export const POINTS_PROGRAM_KEY = 'points_program';
export const MAX_EARN_POINTS = 1000;
export const MAX_EARN_PER_LKR = 100000;
export const MAX_LKR_PER_POINT = 1000;
export const MAX_MIN_REDEEM_POINTS = 1000000;
export const MAX_EXPIRY_MONTHS = 120;
export const MAX_ADJUST_POINTS = 1000000;

export interface PointsProgramSetting {
  enabled: boolean;
  /** Points given ... */
  earn_points: number;
  /** ... for every full LKR this much spent. */
  earn_per_lkr: number;
  /** What one point is worth at checkout, LKR. */
  lkr_per_point: number;
  /** The fewest points a customer must hold to use any. */
  min_redeem_points: number;
  /** The most of an order (after discounts) that points may pay, %. */
  max_redeem_percent: number;
  /** Months until points expire; 0 = never. */
  expiry_months: number;
}

export const DEFAULT_POINTS_PROGRAM: PointsProgramSetting = {
  enabled: false,
  earn_points: 1,
  earn_per_lkr: 100,
  lkr_per_point: 1,
  min_redeem_points: 100,
  max_redeem_percent: 20,
  expiry_months: 12,
};

export function pointsProgramFrom(value: unknown): PointsProgramSetting {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_POINTS_PROGRAM;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    earn_points: Math.trunc(num(v.earn_points, d.earn_points, 1, MAX_EARN_POINTS)),
    earn_per_lkr: num(v.earn_per_lkr, d.earn_per_lkr, 1, MAX_EARN_PER_LKR),
    lkr_per_point: num(v.lkr_per_point, d.lkr_per_point, 0.01, MAX_LKR_PER_POINT),
    min_redeem_points: Math.trunc(num(v.min_redeem_points, d.min_redeem_points, 0, MAX_MIN_REDEEM_POINTS)),
    max_redeem_percent: num(v.max_redeem_percent, d.max_redeem_percent, 1, 100),
    expiry_months: Math.trunc(num(v.expiry_months, d.expiry_months, 0, MAX_EXPIRY_MONTHS)),
  };
}

const int = (label: string, min: number, max: number) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} can be at most ${max}`);

export const updatePointsProgramSchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    earn_points: int('earn_points', 1, MAX_EARN_POINTS).optional(),
    earn_per_lkr: z
      .number({ invalid_type_error: 'earn_per_lkr must be a number' })
      .min(1, 'earn_per_lkr must be at least LKR 1')
      .max(MAX_EARN_PER_LKR, `earn_per_lkr can be at most LKR ${MAX_EARN_PER_LKR}`)
      .refine(twoDecimals, 'earn_per_lkr can have at most 2 decimals')
      .optional(),
    lkr_per_point: z
      .number({ invalid_type_error: 'lkr_per_point must be a number' })
      .min(0.01, 'lkr_per_point must be at least LKR 0.01')
      .max(MAX_LKR_PER_POINT, `lkr_per_point can be at most LKR ${MAX_LKR_PER_POINT}`)
      .refine(twoDecimals, 'lkr_per_point can have at most 2 decimals')
      .optional(),
    min_redeem_points: int('min_redeem_points', 0, MAX_MIN_REDEEM_POINTS).optional(),
    max_redeem_percent: z
      .number({ invalid_type_error: 'max_redeem_percent must be a number' })
      .min(1, 'max_redeem_percent must be at least 1')
      .max(100, 'max_redeem_percent can be at most 100')
      .refine(twoDecimals, 'max_redeem_percent can have at most 2 decimals')
      .optional(),
    expiry_months: int('expiry_months', 0, MAX_EXPIRY_MONTHS).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Send at least one setting to change' });

export type UpdatePointsProgramInput = z.infer<typeof updatePointsProgramSchema>;

export const adjustPointsSchema = z
  .object({
    points: int('points', -MAX_ADJUST_POINTS, MAX_ADJUST_POINTS).refine((v) => v !== 0, 'points cannot be 0'),
    reason: z
      .string({ required_error: 'Write a reason', invalid_type_error: 'Write a reason' })
      .trim()
      .min(3, 'Write a reason (at least 3 characters)')
      .max(200, 'The reason can be at most 200 characters'),
  })
  .strict();

export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;

/** Points a delivered order earns on `base` LKR (item subtotal after discounts). */
export function pointsEarned(base: number, s: Pick<PointsProgramSetting, 'earn_points' | 'earn_per_lkr'>): number {
  if (!(base > 0) || !(s.earn_per_lkr > 0)) return 0;
  return Math.floor(round2(base) / s.earn_per_lkr + 1e-9) * s.earn_points;
}

/** What `points` are worth, LKR. */
export const pointsValue = (points: number, lkrPerPoint: number) => round2(points * lkrPerPoint);

/**
 * How many points an order may use: none below the minimum balance, else as
 * many as fit in max_redeem_percent of `due` (and never more than `due`).
 */
export function redeemablePoints(balance: number, due: number, s: PointsProgramSetting): number {
  if (!s.enabled || balance <= 0 || balance < s.min_redeem_points || !(due > 0)) return 0;
  const cap = round2((due * s.max_redeem_percent) / 100);
  let points = Math.min(balance, Math.floor(cap / s.lkr_per_point + 1e-9));
  while (points > 0 && pointsValue(points, s.lkr_per_point) > due) points--;
  return Math.max(points, 0);
}

/** When points added now expire (null = never). */
export function expiryFor(now: Date, months: number): Date | null {
  if (!(months > 0)) return null;
  return DateTime.fromJSDate(now).plus({ months }).toJSDate();
}

/**
 * The part of an order that earns: items after discounts. A discount that was
 * a free delivery (coupon or referral FREE_DELIVERY) was off the fee, not the
 * items; points used are a payment and never earn.
 */
export function earnBase(order: {
  subtotal_amount: number;
  discount_amount: number;
  points_discount_amount: number;
  discountWasDeliveryFee: boolean;
}): number {
  const offer = Math.max(0, order.discount_amount - order.points_discount_amount);
  const itemsOff = order.discountWasDeliveryFee ? 0 : offer;
  return round2(Math.max(0, order.subtotal_amount - itemsOff - order.points_discount_amount));
}
