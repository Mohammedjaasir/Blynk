import { randomInt } from 'crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import type { ReferralRewardMode } from '../../database/types.js';
import { num, round2, twoDecimals } from '../loyalty/program-settings.js';

/**
 * Refer a friend (owner, 2026-10-10; migration 037) - the setting and the
 * pure rules, tested without a database.
 *
 * - Each customer has one personal code; a NEW customer (no order yet, other
 *   than cancelled ones) may enter one code, once, never their own.
 * - The friend's reward applies to their FIRST order (server-decided at
 *   checkout). When the friend's first order is DELIVERED the inviter gets a
 *   credit, used automatically on their next order. If the friend's first
 *   order could not take their reward (it already went out free, or a bigger
 *   coupon/gift won), the friend gets it then as a credit too - unless
 *   Admin/Operations switched `friend_unused_to_credit` off (owner,
 *   2026-10-10), then that unused friend reward lapses.
 * - Reward type is chosen by Admin/Operations: LKR_OFF (an amount off the
 *   items - the friend's and the inviter's amounts set separately) or
 *   FREE_DELIVERY (one delivery fee off, each).
 * - At most `monthly_cap` inviter rewards per inviter per calendar month
 *   (Asia/Colombo); a referral over the cap is recorded as CAPPED.
 * - Stacking: a referral reward, a coupon and the birthday gift never stack;
 *   the single largest discount is used. On a tie the coupon, then the
 *   birthday gift, is kept - so the referral reward stays for later.
 */

export const REFERRAL_PROGRAM_KEY = 'referral_program';
export const REFERRAL_MODES = ['LKR_OFF', 'FREE_DELIVERY'] as const;
export const MAX_REFERRAL_AMOUNT_LKR = 10000;
export const MAX_REFERRAL_MONTHLY_CAP = 1000;
export const REFERRAL_ZONE = 'Asia/Colombo';

export interface ReferralProgramSetting {
  enabled: boolean;
  mode: ReferralRewardMode;
  /** LKR off the friend's first order (LKR_OFF). */
  friend_amount_lkr: number;
  /** LKR off the inviter's next order (LKR_OFF). */
  inviter_amount_lkr: number;
  /** Inviter rewards per inviter per calendar month. */
  monthly_cap: number;
  /**
   * (owner, 2026-10-10) When the friend's first order could not use their
   * reward (it already went out free, or a bigger coupon/birthday gift won):
   * true = they get it as a credit when that order is delivered; false = the
   * unused friend reward lapses.
   */
  friend_unused_to_credit: boolean;
}

export const DEFAULT_REFERRAL_PROGRAM: ReferralProgramSetting = {
  enabled: false,
  mode: 'LKR_OFF',
  friend_amount_lkr: 200,
  inviter_amount_lkr: 200,
  monthly_cap: 10,
  friend_unused_to_credit: true,
};

export function referralProgramFrom(value: unknown): ReferralProgramSetting {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_REFERRAL_PROGRAM;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    mode: v.mode === 'LKR_OFF' || v.mode === 'FREE_DELIVERY' ? v.mode : d.mode,
    friend_amount_lkr: num(v.friend_amount_lkr, d.friend_amount_lkr, 0, MAX_REFERRAL_AMOUNT_LKR),
    inviter_amount_lkr: num(v.inviter_amount_lkr, d.inviter_amount_lkr, 0, MAX_REFERRAL_AMOUNT_LKR),
    monthly_cap: Math.trunc(num(v.monthly_cap, d.monthly_cap, 1, MAX_REFERRAL_MONTHLY_CAP)),
    friend_unused_to_credit: typeof v.friend_unused_to_credit === 'boolean' ? v.friend_unused_to_credit : d.friend_unused_to_credit,
  };
}

const amount = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .min(0, `${label} cannot be negative`)
    .max(MAX_REFERRAL_AMOUNT_LKR, `${label} can be at most LKR ${MAX_REFERRAL_AMOUNT_LKR}`)
    .refine(twoDecimals, `${label} can have at most 2 decimals`);

export const updateReferralProgramSchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    mode: z.enum(REFERRAL_MODES, { errorMap: () => ({ message: 'mode must be LKR_OFF or FREE_DELIVERY' }) }).optional(),
    friend_amount_lkr: amount("The friend's amount").optional(),
    inviter_amount_lkr: amount("The inviter's amount").optional(),
    monthly_cap: z
      .number({ invalid_type_error: 'monthly_cap must be a number' })
      .int('monthly_cap must be a whole number')
      .min(1, 'monthly_cap must be at least 1')
      .max(MAX_REFERRAL_MONTHLY_CAP, `monthly_cap can be at most ${MAX_REFERRAL_MONTHLY_CAP}`)
      .optional(),
    friend_unused_to_credit: z.boolean({ invalid_type_error: 'friend_unused_to_credit must be true or false' }).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Send at least one setting to change' });

export type UpdateReferralProgramInput = z.infer<typeof updateReferralProgramSchema>;

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** No 0/O, 1/I/L: codes are read out and typed by hand. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 7;

export function generateReferralCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** What the customer typed or the link carried, as stored: upper case, no spaces or dashes. */
export function normalizeReferralCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

export const applyReferralSchema = z
  .object({
    code: z
      .string({ required_error: 'Enter a referral code', invalid_type_error: 'Enter a referral code' })
      .transform(normalizeReferralCode)
      .pipe(z.string().regex(/^[A-Z0-9]{4,16}$/, 'Referral codes are 4-16 letters or digits')),
  })
  .strict();

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/**
 * What a reward takes off this order: LKR_OFF never more than the items,
 * FREE_DELIVERY the delivery fee being charged (0 when the order already
 * goes out free, so the reward is kept for another order).
 */
export function referralRewardValue(mode: ReferralRewardMode, amountLkr: number, subtotal: number, deliveryFee: number): number {
  if (mode === 'FREE_DELIVERY') return round2(Math.max(0, deliveryFee));
  return round2(Math.max(0, Math.min(amountLkr, subtotal)));
}

/** The stacking rule: the referral reward only when strictly larger than the coupon/birthday discount chosen so far. */
export function referralBeatsOther(referralDiscount: number, otherDiscount: number | null): boolean {
  if (!(referralDiscount > 0)) return false;
  return otherDiscount === null || referralDiscount > otherDiscount;
}

/** Start of the calendar month `now` is in, Asia/Colombo (the monthly cap). */
export function colomboMonthStart(now: Date): Date {
  return DateTime.fromJSDate(now, { zone: REFERRAL_ZONE }).startOf('month').toJSDate();
}
