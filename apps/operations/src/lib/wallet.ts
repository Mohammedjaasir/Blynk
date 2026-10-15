import { ApiError } from '../api/client';
import type { OrderWallet, WalletKind, WalletRefundInput, WalletRefundKind, WalletSetting } from '../api/wallet';
import { catalogErrorMessage } from './catalog';
import { formatMoney } from './orders';
import { numberText, parseNumber, parseReason } from './referralPoints';

/**
 * Blynk Wallet helpers (owner, 2026-10-15; docs/api/wallet.md). The backend
 * is the real guard; these check input with the same limits and word the
 * screens. Pure: the screens only render what these return.
 */

export const WALLET_KIND_LABEL: Record<WalletKind, string> = {
  ORDER_PAYMENT: 'Paid for order',
  ORDER_PAYMENT_RETURNED: 'Wallet payment returned',
  REFUND_ORDER_CANCELLED: 'Order cancelled refund',
  REFUND_ITEM: 'Item refund',
  REFUND_DELIVERY_FEE: 'Delivery fee refund',
  ADJUSTMENT: 'Adjustment',
  EXPIRED: 'Expired',
};

export const REFUND_KIND_OPTIONS: { kind: WalletRefundKind; label: string }[] = [
  { kind: 'REFUND_ITEM', label: 'Missing / damaged / wrong item' },
  { kind: 'REFUND_DELIVERY_FEE', label: 'Delivery fee' },
];

export const PAID_BY_WALLET = 'LKR 0 to collect - paid by wallet';
export const NOTHING_TO_REFUND = 'Nothing left to refund';
export const REASON_HINT = 'The customer sees this reason.';

/** NUMERIC columns can arrive as strings; a missing field (older API) is 0. */
const amountOf = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : 0;
  return Number.isFinite(n) ? n : 0;
};

export interface WalletPaidLike {
  total_amount: number;
  wallet_amount_used?: number | null;
}

/** What the wallet paid for this order (0 when none). */
export const walletPaid = (order: Pick<WalletPaidLike, 'wallet_amount_used'>) => amountOf(order.wallet_amount_used);

/** The wallet paid everything: there is no cash to collect. */
export const paidByWallet = (order: WalletPaidLike) => amountOf(order.total_amount) === 0 && walletPaid(order) > 0;

/** The cash to collect: "LKR 1,150", or "LKR 0 to collect - paid by wallet". */
export const cashToCollectText = (order: WalletPaidLike) => (paidByWallet(order) ? PAID_BY_WALLET : formatMoney(order.total_amount));

/** "Cash to collect: LKR 1,150", or "LKR 0 to collect - paid by wallet". */
export const cashToCollectLine = (order: WalletPaidLike) =>
  paidByWallet(order) ? PAID_BY_WALLET : `Cash to collect: ${formatMoney(order.total_amount)}`;

/** "Paid by wallet LKR 300" when the wallet paid any of it, else null. */
export const walletPaidLine = (order: Pick<WalletPaidLike, 'wallet_amount_used'>) => {
  const paid = walletPaid(order);
  return paid > 0 ? `Paid by wallet ${formatMoney(paid)}` : null;
};

/** "+LKR 120", "−LKR 300". */
export function signedMoney(n: number): string {
  if (n > 0) return `+${formatMoney(n)}`;
  if (n < 0) return `−${formatMoney(-n)}`;
  return formatMoney(0);
}

/** The most this refund kind may be: the order's refundable, and for a fee refund also what is left of the fee. */
export function refundCap(kind: WalletRefundKind, w: Pick<OrderWallet, 'refundable' | 'delivery_fee_refundable'>): number {
  const refundable = Math.max(0, amountOf(w.refundable));
  if (kind === 'REFUND_DELIVERY_FEE') return Math.min(refundable, Math.max(0, amountOf(w.delivery_fee_refundable)));
  return refundable;
}

export type RefundFormField = 'amount' | 'reason' | 'points';

export interface RefundForm {
  kind: WalletRefundKind;
  amount: string;
  reason: string;
  /** Blynk Points to give back; only offered when points.returnable > 0. */
  points: string;
}

/** Refund form -> a validated body, or the first error and its field. */
export function readRefundForm(
  form: RefundForm,
  w: Pick<OrderWallet, 'refundable' | 'delivery_fee_refundable' | 'points'>
): { value: WalletRefundInput } | { error: string; field: RefundFormField } {
  const cap = refundCap(form.kind, w);
  if (!(cap > 0)) {
    return {
      error: form.kind === 'REFUND_DELIVERY_FEE' ? 'There is no delivery fee left to refund.' : `${NOTHING_TO_REFUND}.`,
      field: 'amount',
    };
  }
  const amount = parseNumber(form.amount, 'the amount', 0, cap);
  if ('error' in amount) {
    // parseNumber says "at most 1030"; money reads better as "LKR 1,030".
    const over = /can be at most/.test(amount.error);
    return {
      error: over
        ? `The amount can be at most ${formatMoney(cap)}${form.kind === 'REFUND_DELIVERY_FEE' ? ' (the delivery fee left to refund)' : ''}.`
        : amount.error,
      field: 'amount',
    };
  }
  if (!(amount.value > 0)) return { error: 'The amount must be more than 0.', field: 'amount' };
  const reason = parseReason(form.reason);
  if ('error' in reason) return { error: reason.error, field: 'reason' };
  const returnable = Math.max(0, Math.floor(amountOf(w.points?.returnable)));
  let points = 0;
  if (returnable > 0 && form.points.trim() !== '') {
    const parsed = parseNumber(form.points, 'the points to give back', 0, returnable, 0);
    if ('error' in parsed) return { error: parsed.error, field: 'points' };
    points = parsed.value;
  }
  const value: WalletRefundInput = { amount: amount.value, kind: form.kind, reason: reason.value };
  if (points > 0) value.return_points = points;
  return { value };
}

/** The refund and wallet refusals in the operator's words. */
export function walletErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const details = (err.details ?? {}) as Record<string, unknown>;
    switch (err.code) {
      case 'NOTHING_TO_REFUND':
        return `${NOTHING_TO_REFUND}: this order has already been refunded in full.`;
      case 'REFUND_EXCEEDS_REFUNDABLE':
        return details.refundable != null
          ? `That is more than is left to refund. The most is ${formatMoney(amountOf(details.refundable))}.`
          : 'That is more than is left to refund. Showing the latest.';
      case 'REFUND_EXCEEDS_DELIVERY_FEE':
        return "That is more than is left of this order's delivery fee. Showing the latest.";
      case 'POINTS_RETURN_EXCEEDS':
        return 'That is more Blynk Points than this order used and can give back. Showing the latest.';
      case 'CANNOT_RECORD_FOR_SELF':
        return "You can't refund your own order. Please ask another staff member to do it.";
      case 'ORDER_NOT_FOUND':
        return 'This order no longer exists.';
      case 'CUSTOMER_NOT_FOUND':
        return 'This customer no longer exists.';
    }
  }
  return catalogErrorMessage(err);
}

// ----------------------------------------------------------------- settings

export type WalletFormField = 'expiry_months' | 'max_use_percent';

export type WalletForm = { enabled: boolean } & Record<WalletFormField, string>;

export function walletFormFrom(s: WalletSetting): WalletForm {
  return { enabled: s.enabled, expiry_months: String(s.expiry_months), max_use_percent: numberText(s.max_use_percent) };
}

/** Settings form -> a validated body, or the first error. */
export function readWalletForm(form: WalletForm): { value: Omit<WalletSetting, 'updated_at'> } | { error: string; field: WalletFormField } {
  const expiry = parseNumber(form.expiry_months, 'the expiry months', 0, 120, 0);
  if ('error' in expiry) return { error: expiry.error, field: 'expiry_months' };
  const percent = parseNumber(form.max_use_percent, 'the most of an order the wallet can pay', 1, 100, 0);
  if ('error' in percent) return { error: percent.error, field: 'max_use_percent' };
  return { value: { enabled: form.enabled, expiry_months: expiry.value, max_use_percent: percent.value } };
}

/** "Credits never expire." / "Credits expire 12 months after they are added." */
export function expiryText(months: number): string {
  if (!(months > 0)) return 'Credits never expire.';
  return `Credits expire ${months} ${months === 1 ? 'month' : 'months'} after they are added.`;
}

/**
 * Whether an order can have anything to refund to the wallet: the wallet paid
 * part of it, it was paid (online, or cash collected), or it was delivered.
 * Other orders (an unpaid cash order still being packed) skip the wallet
 * panel; the server's `refundable` is the real answer.
 */
export function mayRefundToWallet(order: WalletPaidLike & { payment_status?: string | null; order_status?: string | null }): boolean {
  return walletPaid(order) > 0 || order.payment_status === 'PAID' || order.order_status === 'DELIVERED';
}
