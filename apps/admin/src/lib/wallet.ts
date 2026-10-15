import { ApiError } from '../api/client';
import type { WalletKind, WalletRefundKind, WalletSetting } from '../api/wallet';
import { CANNOT_RECORD_FOR_SELF_MESSAGE, errorMessage } from './apiErrors';
import { groupNumber, lkr, numberText, parseNumber, type Parsed } from './referralPoints';

/**
 * Blynk Wallet helpers (owner, 2026-10-15; docs/api/wallet.md). The backend
 * is the real guard; these check input with the same limits and word the
 * screens.
 */

/** |amount| of one Admin adjustment. */
export const MAX_WALLET_ADJUST = 100000;
export const MAX_WALLET_EXPIRY_MONTHS = 120;

export const WALLET_KIND_LABEL: Record<WalletKind, string> = {
  ORDER_PAYMENT: 'Paid for order',
  ORDER_PAYMENT_RETURNED: 'Wallet payment returned',
  REFUND_ORDER_CANCELLED: 'Order cancelled refund',
  REFUND_ITEM: 'Item refund',
  REFUND_DELIVERY_FEE: 'Delivery fee refund',
  ADJUSTMENT: 'Adjustment',
  EXPIRED: 'Expired',
};

export const walletKindLabel = (kind: string) => WALLET_KIND_LABEL[kind as WalletKind] ?? kind;

export const WALLET_REFUND_KINDS: WalletRefundKind[] = ['REFUND_ITEM', 'REFUND_DELIVERY_FEE'];

export const WALLET_REFUND_KIND_LABEL: Record<WalletRefundKind, string> = {
  REFUND_ITEM: 'Missing, damaged or wrong item',
  REFUND_DELIVERY_FEE: 'Delivery fee',
};

/** Shown on the settings card. */
export const WALLET_SETTINGS_NOTE =
  "Refunds are always credited; switching off hides 'Use wallet balance' at checkout.";

/** The bill line for an order the wallet paid in full (COD, total 0). */
export const WALLET_ONLY_TEXT = 'LKR 0 to collect - paid by wallet';

/** "+LKR 120", "−LKR 50". */
export const signedLkr = (n: number) => (n > 0 ? `+${lkr(n)}` : n < 0 ? `−${lkr(-n)}` : lkr(0));

/** What the wallet paid for an order (absent on an older API = 0). */
export const walletUsed = (order: { wallet_amount_used?: number | string | null }) => {
  const n = Number(order.wallet_amount_used ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The order's full value: what is still to pay plus what the wallet paid. */
export const orderValue = (order: { total_amount: number; wallet_amount_used?: number | string | null }) =>
  Number(order.total_amount) + walletUsed(order);

/** True when the wallet paid everything: nothing to collect. */
export const paidByWalletOnly = (order: { total_amount: number; wallet_amount_used?: number | string | null }) =>
  Number(order.total_amount) === 0 && walletUsed(order) > 0;

/** "120", "12.5" with at most 2 decimals; null when the text is not a number like that. */
function money(s: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

/** An Admin adjustment: non-zero LKR, + or -, at most 2 decimals, |amount| <= 100,000. */
export function parseWalletAdjust(input: string): Parsed {
  const s = input.trim().replace(/[\s,]/g, '').replace(/^\+/, '').replace(/^−/, '-').replace(/^LKR/i, '');
  if (s === '' || s === '-') return { error: 'Enter the LKR to add (like 500) or take away (like -500).' };
  const negative = s.startsWith('-');
  const abs = money(negative ? s.slice(1) : s);
  if (abs === null) {
    return /^-?\d+\.\d{3,}$/.test(s)
      ? { error: 'The amount can have at most 2 decimals.' }
      : { error: 'The amount must be a number, like 500 or -500.' };
  }
  if (abs === 0) return { error: 'The amount cannot be 0.' };
  if (abs > MAX_WALLET_ADJUST) return { error: `The amount can be at most ${lkr(MAX_WALLET_ADJUST)} either way.` };
  return { value: negative ? -abs : abs };
}

/**
 * A staff refund: more than 0, at most 2 decimals, no more than what is still
 * refundable - and for a delivery fee refund, no more than the fee left.
 */
export function parseWalletRefund(
  input: string,
  limits: { kind: WalletRefundKind; refundable: number; deliveryFeeRefundable: number }
): Parsed {
  const s = input.trim().replace(/[\s,]/g, '').replace(/^LKR/i, '');
  if (s === '') return { error: 'Enter the amount to refund.' };
  const value = money(s);
  if (value === null) {
    return /^\d+\.\d{3,}$/.test(s) ? { error: 'The amount can have at most 2 decimals.' } : { error: 'The amount must be a number, like 120.' };
  }
  if (value <= 0) return { error: 'The amount must be more than 0.' };
  if (value > limits.refundable + 1e-9) return { error: `Only ${lkr(limits.refundable)} is left to refund on this order.` };
  if (limits.kind === 'REFUND_DELIVERY_FEE' && value > limits.deliveryFeeRefundable + 1e-9) {
    return { error: `Only ${lkr(limits.deliveryFeeRefundable)} of the delivery fee is left to refund.` };
  }
  return { value };
}

/** Optional points to give back: blank = 0, else a whole number up to `returnable`. */
export function parseReturnPoints(input: string, returnable: number): Parsed {
  const s = input.trim().replace(/,/g, '');
  if (s === '') return { value: 0 };
  if (!/^\d+$/.test(s)) return { error: 'Points must be a whole number.' };
  const value = Number(s);
  if (value > returnable) return { error: `At most ${groupNumber(returnable)} points can be given back on this order.` };
  return { value };
}

export type WalletFormField = 'expiry_months' | 'max_use_percent';
export type WalletForm = { enabled: boolean } & Record<WalletFormField, string>;

/** Text inputs for a saved wallet setting. */
export function walletFormFrom(s: WalletSetting): WalletForm {
  return { enabled: s.enabled, expiry_months: String(s.expiry_months), max_use_percent: numberText(s.max_use_percent) };
}

/** Wallet settings form -> a validated body, or the first error. */
export function readWalletForm(form: WalletForm): { value: Omit<WalletSetting, 'updated_at'> } | { error: string; field: WalletFormField } {
  const expiry = parseNumber(form.expiry_months, 'the expiry months', 0, MAX_WALLET_EXPIRY_MONTHS, 0);
  if ('error' in expiry) return { error: expiry.error, field: 'expiry_months' };
  const max = parseNumber(form.max_use_percent, 'the most of an order the wallet can pay', 1, 100, 0);
  if ('error' in max) return { error: max.error, field: 'max_use_percent' };
  return { value: { enabled: form.enabled, expiry_months: expiry.value, max_use_percent: max.value } };
}

/** "Balance never expires." / "Credits expire 12 months after they are added." */
export function walletExpiryText(months: number): string {
  if (!(months > 0)) return 'Credits never expire.';
  return `Credits added from now expire ${months} ${months === 1 ? 'month' : 'months'} after they are added; the soonest-expiring credit is spent first.`;
}

const detail = (err: ApiError, key: string): number | undefined => {
  const v = (err.details as Record<string, unknown> | undefined)?.[key];
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** The documented wallet refusals in staff words; anything else falls back. */
export function walletErrorMessage(err: unknown, fallback: string, known: { balance?: number } = {}): string {
  if (!(err instanceof ApiError)) return errorMessage(err, fallback);
  switch (err.code) {
    case 'WALLET_INSUFFICIENT': {
      const balance = detail(err, 'balance') ?? known.balance;
      return balance === undefined
        ? 'That would take the wallet below LKR 0.'
        : `That would take the wallet below LKR 0 - the balance is ${lkr(balance)}.`;
    }
    case 'NOTHING_TO_REFUND':
      return 'Nothing left to refund on this order.';
    case 'REFUND_EXCEEDS_REFUNDABLE': {
      const refundable = detail(err, 'refundable');
      return refundable === undefined
        ? 'That is more than is left to refund on this order.'
        : `That is more than is left to refund - only ${lkr(refundable)} can still be refunded.`;
    }
    case 'REFUND_EXCEEDS_DELIVERY_FEE':
      return 'That is more than the delivery fee left to refund on this order.';
    case 'POINTS_RETURN_EXCEEDS':
      return 'That is more points than were used on this order and can be given back.';
    case 'CANNOT_RECORD_FOR_SELF':
      return CANNOT_RECORD_FOR_SELF_MESSAGE;
    case 'ORDER_NOT_FOUND':
      return 'This order was not found.';
    case 'CUSTOMER_NOT_FOUND':
      return 'This customer was not found.';
    default:
      return errorMessage(err, fallback);
  }
}
