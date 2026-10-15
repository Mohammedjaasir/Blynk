import { formatLkr } from '@/blynk/lib/money';
import { WALLET_COPY } from './copy';

/*
 * Blynk Wallet (docs/api/wallet.md, migration 049). Refunds are credited to the wallet; the
 * balance pays for later orders and is never paid out as cash. The server decides every amount;
 * the app parses what GET /me/wallet, checkout-info's `wallet` block and the order payloads say,
 * and previews the checkout deduction (coupon -> points -> wallet, capped by max_use_percent).
 */

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { const x = Number(v.trim()); return Number.isFinite(x) ? x : 0; }
  return 0;
};
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
/** Down to the cent (a wallet amount is never more than allowed). */
const floor2 = (x: number) => Math.floor(x * 100 + 1e-6) / 100;

// ---------------------------------------------------------------- GET /me/wallet

export type WalletEntryKind =
  | 'ORDER_PAYMENT' | 'ORDER_PAYMENT_RETURNED' | 'REFUND_ORDER_CANCELLED' | 'REFUND_ITEM' | 'REFUND_DELIVERY_FEE'
  | 'ADJUSTMENT' | 'EXPIRED';

export interface WalletEntry {
  id: string;
  /** The ledger kind as sent (an unknown one still shows, under a plain label). */
  kind: string;
  /** Signed: + credit, - debit. */
  amount: number;
  orderId: string | null;
  orderNumber: string | null;
  /** Always customer-safe text (the server's own sentence). */
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date | null;
}

export interface WalletPage { page: number; limit: number; total: number; totalPages: number }

export interface WalletInfo {
  enabled: boolean;
  balance: number;
  expiryMonths: number;
  expiryNote: string | null;
  maxUsePercent: number;
  entries: WalletEntry[];
  pagination: WalletPage;
}

export function parseWalletEntry(raw: unknown): WalletEntry | null {
  const o = obj(raw);
  if (!o) return null;
  const amount = round2(num(o.amount));
  if (amount === 0) return null;
  return {
    id: String(o.id ?? ''),
    kind: String(o.kind ?? '').toUpperCase(),
    amount,
    orderId: text(o.order_id),
    orderNumber: text(o.order_number),
    reason: text(o.reason),
    expiresAt: date(o.expires_at),
    createdAt: date(o.created_at),
  };
}

/** GET /me/wallet's data, or null when it is not one. */
export function parseWallet(raw: unknown): WalletInfo | null {
  const r = obj(raw);
  if (!r || typeof r.enabled !== 'boolean') return null;
  const entries = (Array.isArray(r.entries) ? r.entries : []).flatMap((e) => {
    const x = parseWalletEntry(e);
    return x ? [x] : [];
  });
  const p = obj(r.pagination);
  const limit = Math.max(1, Math.trunc(num(p?.limit)) || entries.length || 1);
  return {
    enabled: r.enabled,
    balance: Math.max(0, round2(num(r.balance))),
    expiryMonths: Math.max(0, Math.trunc(num(r.expiry_months))),
    expiryNote: text(r.expiry_note),
    maxUsePercent: clampPercent(r.max_use_percent),
    entries,
    pagination: {
      page: Math.max(1, Math.trunc(num(p?.page)) || 1),
      limit,
      total: Math.max(0, Math.trunc(num(p?.total)) || entries.length),
      totalPages: Math.max(1, Math.trunc(num(p?.total_pages)) || 1),
    },
  };
}

/** 1-100; a missing or broken value reads as 100 (the server's default). */
function clampPercent(v: unknown): number {
  const x = num(v);
  if (!(x > 0)) return 100;
  return Math.min(100, x);
}

/** Whether the wallet screen has a next page to ask for. */
export const hasMore = (w: Pick<WalletInfo, 'pagination'>) => w.pagination.page < w.pagination.totalPages;

/** The next page appended to what is shown (an entry already shown is never listed twice). */
export function mergeWalletPage(shown: WalletInfo, next: WalletInfo): WalletInfo {
  const seen = new Set(shown.entries.map((e) => e.id));
  return { ...next, entries: [...shown.entries, ...next.entries.filter((e) => !seen.has(e.id))] };
}

/** Show the Profile row while the wallet is on, or while there is money in it (refunds still land when off). */
export const showWalletRow = (w: Pick<WalletInfo, 'enabled' | 'balance'> | null | undefined) => !!w && (w.enabled || w.balance > 0);

/** A screen worth showing: on, or a balance / history to see while it is off. */
export const walletVisible = (w: Pick<WalletInfo, 'enabled' | 'balance' | 'entries'>) => w.enabled || w.balance > 0 || w.entries.length > 0;

// ---------------------------------------------------------------- wording

export const kindLabel = (kind: string) => WALLET_COPY.kinds[kind] ?? WALLET_COPY.kindOther;

/** "+LKR 450" / "−LKR 300". */
export const entryAmount = (amount: number) => `${amount > 0 ? '+' : '−'}${formatLkr(Math.abs(amount))}`;

const percentText = (v: number) => `${v.toFixed(2).replace(/\.?0+$/, '')}%`;

/** The rules under the balance: the fixed lines, the expiry note, and a cap below 100%. */
export function walletRules(w: Pick<WalletInfo, 'expiryNote' | 'maxUsePercent'>): string[] {
  const out = [...WALLET_COPY.rules];
  if (w.expiryNote) out.push(w.expiryNote);
  if (w.maxUsePercent < 100) out.push(WALLET_COPY.maxUse(percentText(w.maxUsePercent)));
  return out;
}

// ---------------------------------------------------------------- checkout

export interface CheckoutWallet { enabled: boolean; balance: number; maxUsePercent: number }

/** checkout-info's `wallet` block; null on an older server (no wallet offered). */
export function checkoutWalletOf(raw: unknown): CheckoutWallet | null {
  const w = obj(raw);
  if (!w || typeof w.enabled !== 'boolean') return null;
  return { enabled: w.enabled, balance: Math.max(0, round2(num(w.balance))), maxUsePercent: clampPercent(w.max_use_percent) };
}

/** "Use wallet balance" is offered only while the wallet is on and has money in it. */
export const canUseWallet = (w: CheckoutWallet | null | undefined): w is CheckoutWallet => !!w && w.enabled && w.balance > 0;

/**
 * What the wallet would pay on an order that still has `due` to pay after the coupon / gift /
 * referral and the points (delivery fee included): at most max_use_percent of it and never
 * more than the balance. The server works it out again when the order is placed.
 */
export function walletPreview(w: CheckoutWallet | null | undefined, due: number): number {
  if (!canUseWallet(w) || !(due > 0)) return 0;
  const cap = floor2((due * w.maxUsePercent) / 100);
  return Math.max(0, Math.min(w.balance, cap));
}

/** The line under the switch while it is on. */
export function walletUseLine(w: CheckoutWallet, used: number, due: number): string {
  if (used <= 0) return WALLET_COPY.cannotUse;
  if (w.maxUsePercent < 100 && used < w.balance && used < due) return `${WALLET_COPY.payNote(used)} ${WALLET_COPY.capNote(percentText(w.maxUsePercent))}`;
  return WALLET_COPY.payNote(used);
}

// ---------------------------------------------------------------- orders

export interface OrderWalletEntry { id: string; kind: string; amount: number; reason: string | null; createdAt: Date | null }
export interface OrderWallet { used: number; refundedTotal: number; entries: OrderWalletEntry[] }

/** GET /orders/:id and POST /orders/:id/cancel `wallet` block; null when absent. */
export function parseOrderWallet(raw: unknown): OrderWallet | null {
  const w = obj(raw);
  if (!w) return null;
  return {
    used: Math.max(0, round2(num(w.used))),
    refundedTotal: Math.max(0, round2(num(w.refunded_total))),
    entries: (Array.isArray(w.entries) ? w.entries : []).flatMap((e) => {
      const o = obj(e);
      const amount = round2(num(o?.amount));
      if (!o || amount <= 0) return [];
      return [{ id: String(o.id ?? ''), kind: String(o.kind ?? '').toUpperCase(), amount, reason: text(o.reason), createdAt: date(o.created_at) }];
    }),
  };
}

/** The wallet refunded something for this order: "Refund of LKR X added to your Blynk Wallet". */
export function refundNotice(w: OrderWallet | null | undefined): string | null {
  return w && w.refundedTotal > 0 ? WALLET_COPY.refundAdded(w.refundedTotal) : null;
}

/** An order the wallet paid in full: nothing to collect, nothing to pay online. */
export const paidByWallet = (o: { total_amount: number; wallet_amount_used?: number }) =>
  (o.wallet_amount_used ?? 0) > 0 && o.total_amount <= 0;
