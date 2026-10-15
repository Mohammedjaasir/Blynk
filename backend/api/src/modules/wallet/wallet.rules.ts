import { z } from 'zod';
import { num, round2, twoDecimals } from '../loyalty/program-settings.js';
import type { WalletEntryKind } from '../../database/types.js';

/**
 * Blynk Wallet (owner, 2026-10-15; migration 049). Pure rules, tested
 * without a database.
 *
 * - Credits come from refunds (automatic on cancel / an unavailable item on a
 *   paid order, or staff "Refund to wallet") and Admin adjustments.
 * - The balance pays for future orders: at checkout, after coupon / birthday
 *   gift / referral and Blynk Points, at most `max_use_percent` % of what is
 *   still due (delivery fee included) and never more than the balance.
 * - It is never paid out as cash or moved to another account.
 * - EXPIRY: `expiry_months` (0 = never, the default). A credit added while it
 *   is above 0 expires that many months later; spending takes the
 *   soonest-expiring credits first.
 */

export const WALLET_SETTINGS_KEY = 'wallet';
export const MAX_WALLET_EXPIRY_MONTHS = 120;
export const MAX_WALLET_ADJUST_LKR = 100000;

export interface WalletSetting {
  /** Customers may use the balance at checkout. Refunds are credited either way. */
  enabled: boolean;
  /** Months until a credit expires; 0 = never. */
  expiry_months: number;
  /** The most of an order (after discounts and points) the wallet may pay, %. */
  max_use_percent: number;
}

export const DEFAULT_WALLET_SETTING: WalletSetting = { enabled: true, expiry_months: 0, max_use_percent: 100 };

export function walletSettingFrom(value: unknown): WalletSetting {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_WALLET_SETTING;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    expiry_months: Math.trunc(num(v.expiry_months, d.expiry_months, 0, MAX_WALLET_EXPIRY_MONTHS)),
    max_use_percent: Math.trunc(num(v.max_use_percent, d.max_use_percent, 1, 100)),
  };
}

const int = (label: string, min: number, max: number) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} can be at most ${max}`);

export const updateWalletSettingSchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    expiry_months: int('expiry_months', 0, MAX_WALLET_EXPIRY_MONTHS).optional(),
    max_use_percent: int('max_use_percent', 1, 100).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Send at least one setting to change.' });

const money = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .finite()
    .refine(twoDecimals, `${label} can have at most 2 decimal places`);

const reason = z
  .string({ required_error: 'reason is required' })
  .trim()
  .min(3, 'reason must be at least 3 characters')
  .max(200, 'reason can be at most 200 characters');

export const adjustWalletSchema = z
  .object({
    amount: money('amount')
      .refine((v) => v !== 0, 'amount cannot be 0')
      .refine((v) => Math.abs(v) <= MAX_WALLET_ADJUST_LKR, `amount can be at most ${MAX_WALLET_ADJUST_LKR} either way`),
    reason,
  })
  .strict();

export const STAFF_REFUND_KINDS = ['REFUND_ITEM', 'REFUND_DELIVERY_FEE'] as const satisfies readonly WalletEntryKind[];
export type StaffRefundKind = (typeof STAFF_REFUND_KINDS)[number];

export const orderWalletRefundSchema = z
  .object({
    amount: money('amount').refine((v) => v > 0, 'amount must be more than 0').refine((v) => v <= MAX_WALLET_ADJUST_LKR, 'amount is too large'),
    kind: z.enum(STAFF_REFUND_KINDS, { errorMap: () => ({ message: 'kind must be REFUND_ITEM or REFUND_DELIVERY_FEE' }) }),
    reason,
    return_points: int('return_points', 0, 1000000).optional(),
  })
  .strict();

export const walletPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Credit kinds: money coming (back) into the wallet. */
export const CREDIT_KINDS: readonly WalletEntryKind[] = ['REFUND_ORDER_CANCELLED', 'REFUND_ITEM', 'REFUND_DELIVERY_FEE', 'ORDER_PAYMENT_RETURNED'];

/**
 * What the wallet pays for an order: nothing while it is off, not asked for or
 * empty; otherwise the least of the balance and `max_use_percent` % of `due`.
 */
export function walletUseFor(balance: number, due: number, s: Pick<WalletSetting, 'enabled' | 'max_use_percent'>): number {
  if (!s.enabled || !(balance > 0) || !(due > 0)) return 0;
  const cap = Math.floor(((due * s.max_use_percent) / 100) * 100 + 1e-6) / 100;
  return round2(Math.max(0, Math.min(balance, cap, due)));
}

/**
 * The part of the expiring credits not spent yet. Spending takes the
 * soonest-expiring credits first, so what is left of the credits whose date
 * has passed is their sum minus everything ever taken out (payments, negative
 * adjustments and earlier expiries), when that is positive.
 */
export function expiredUnspent(expiredCredits: number, debits: number): number {
  return round2(Math.max(0, expiredCredits - debits));
}

/** The customer's note on expiry. */
export function expiryNote(months: number): string {
  if (!(months > 0)) return 'Your balance never expires.';
  return `Credits expire ${months} month${months === 1 ? '' : 's'} after they are added.`;
}

/** The order's paid total and what may still be refunded (all LKR). */
export function refundableFor(p: { walletDebited: number; onlinePaid: number; cashCollected: number; credited: number }) {
  const paid = round2(p.walletDebited + p.onlinePaid + p.cashCollected);
  return { paid, refundable: round2(Math.max(0, paid - p.credited)) };
}

/**
 * Points earned on an order taken back for a refund of `amount` of its items:
 * the same share of the points as of the order's earning base (items after
 * discounts), never more than were earned less what was already taken back.
 */
export function pointsToRemove(p: { earned: number; earnBase: number; amount: number; alreadyRemoved: number }): number {
  if (!(p.earned > 0) || !(p.earnBase > 0) || !(p.amount > 0)) return 0;
  const share = Math.min(1, p.amount / p.earnBase);
  const n = Math.floor(p.earned * share + 1e-9);
  return Math.max(0, Math.min(n, p.earned - p.alreadyRemoved));
}
