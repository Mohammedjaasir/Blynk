import { round2 } from './pricing';

/*
 * Sellers (owner, 2026-10-23/24: seller portal, consignment model). Sellers sign in to the seller
 * site; Admin approves the seller, every product they submit and the price customers pay, and
 * records payouts by hand. API contract: docs/superpowers/plans/2026-10-24-seller-portal.md.
 * Money is LKR; the seller's price is the product's purchase cost.
 */
export type SellerStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type SubmissionKind = 'NEW' | 'EDIT';
export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export const SELLER_STATUSES: readonly SellerStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

export interface AdminSeller {
  id: string;
  shop_name: string;
  contact_name: string | null;
  address: string | null;
  note: string | null;
  status: SellerStatus;
  rejection_reason: string | null;
  commission_percent: number;
  created_at: string;
  /** null for a seller who signed up with an email address. */
  phone: string | null;
  /** The seller's sign-in email (sellers who signed up with email + password), else null. */
  email: string | null;
  full_name: string | null;
  products_live: number;
  submissions_pending: number;
  due: number;
}

export interface StatementLine {
  product_id: string;
  name: string;
  units: number;
  gross: number;
}
export interface SellerPayout {
  id: string;
  amount: number;
  note: string | null;
  paid_on: string;
}
export interface SellerStatement {
  commission_percent: number;
  gross: number;
  commission: number;
  earned: number;
  paid: number;
  due: number;
  lines: StatementLine[];
  payouts: SellerPayout[];
}

export interface SubmissionPayload {
  name?: string;
  category_id?: string;
  unit?: string;
  pack_size?: string | null;
  description?: string | null;
  image_url?: string | null;
  barcode?: string | null;
}
export interface AdminSubmission {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  product_id: string | null;
  payload: SubmissionPayload;
  seller_price: number;
  approved_selling_price: number | null;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  seller: { id: string; shop_name: string; phone: string | null; email?: string | null; status: SellerStatus };
  product: { id: string; name: string; selling_price: number | null; purchase_cost: number | null } | null;
  category_name: string | null;
}

/** What the live product looks like, for the side-by-side (GET /admin/products/:id fields). */
export interface LiveProductView {
  name: string;
  category_id?: string;
  unit?: string;
  pack_size?: string | null;
  description?: string | null;
  image_url?: string | null;
  barcode?: string | null;
  purchase_cost?: number | null;
  selling_price?: number | null;
}

export const SELLER_STATUS_LABEL: Record<SellerStatus, string> = {
  PENDING: 'Waiting',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

/** The Badge tone for a seller's status. */
export const sellerStatusTone = (s: SellerStatus): 'active' | 'inactive' | 'muted' | 'offer' =>
  s === 'APPROVED' ? 'active' : s === 'PENDING' ? 'offer' : s === 'SUSPENDED' ? 'inactive' : 'muted';

/** The one status change offered for each status (a seller can always be approved again, except when already approved). */
export function sellerActions(status: SellerStatus): { approve: boolean; reject: boolean; suspend: boolean } {
  return {
    approve: status !== 'APPROVED',
    reject: status === 'PENDING',
    suspend: status === 'APPROVED',
  };
}

export const REASON_LIMITS = { min: 3, max: 300 } as const;

/** Why a reason cannot be sent (null = fine). */
export function reasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (r.length < REASON_LIMITS.min) return `Write a reason (at least ${REASON_LIMITS.min} characters).`;
  if (r.length > REASON_LIMITS.max) return `At most ${REASON_LIMITS.max} characters.`;
  return null;
}

/** Counts per status for the filter chips. */
export function statusCounts(rows: ReadonlyArray<{ status: SellerStatus }>): Record<SellerStatus, number> {
  const out: Record<SellerStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

// ---------------------------------------------------------------- money

export const MAX_MONEY = 10_000_000;

/** "1,250.5" -> 1250.5; the amount typed in a money field. */
export function parseMoney(text: string, what = 'amount'): { value: number } | { error: string } {
  const t = text.trim().replace(/,/g, '');
  if (!t) return { error: `Enter the ${what}.` };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: `The ${what} must be a number with at most 2 decimals.` };
  const value = Number(t);
  if (!(value > 0)) return { error: `The ${what} must be more than 0.` };
  if (value > MAX_MONEY) return { error: `The ${what} is too large.` };
  return { value };
}

/** A commission percent typed in the field: 0 to 100, at most 2 decimals. */
export function parseCommission(text: string): { value: number } | { error: string } {
  const t = text.trim();
  if (!t) return { error: 'Enter a percent (0 for none).' };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'Use a number like 5 or 7.5.' };
  const value = Number(t);
  if (value > 100) return { error: 'The commission cannot be more than 100%.' };
  return { value };
}

/** "LKR 1,250.00": the statement always shows its cents. */
export const lkr = (n: number | string | null | undefined): string =>
  `LKR ${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "077 123 4567" from "+94771234567". */
export function readablePhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const local = phone.startsWith('+94') ? `0${phone.slice(3)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
}

/** How to reach the seller: their phone, or their email when they signed up without a phone. */
export function sellerContact(s: { phone: string | null; email?: string | null }): string {
  if (s.phone) return readablePhone(s.phone);
  return s.email || '—';
}

// ---------------------------------------------------------------- approval

/** What Blynk keeps per unit: selling price minus the seller's price, and as a percent of the seller's price. */
export function margin(selling: number, sellerPrice: number): { amount: number; percent: number | null; belowCost: boolean } {
  const amount = round2(selling - sellerPrice);
  return {
    amount,
    percent: sellerPrice > 0 ? round2((selling / sellerPrice - 1) * 100) : null,
    belowCost: selling < sellerPrice,
  };
}

/** Did the seller change their price in this edit? (A new product always has a price to set.) */
export function sellerPriceChanged(sub: Pick<AdminSubmission, 'kind' | 'seller_price' | 'product'>): boolean {
  if (sub.kind === 'NEW') return true;
  const was = sub.product?.purchase_cost;
  return was == null ? true : round2(Number(was)) !== round2(Number(sub.seller_price));
}

/** The selling price must be typed for a new product and for an edit whose seller price changed. */
export const sellingPriceRequired = (sub: Pick<AdminSubmission, 'kind' | 'seller_price' | 'product'>): boolean =>
  sub.kind === 'NEW' || sellerPriceChanged(sub);

/** The selling price that will apply: the typed one, else (an edit that keeps its price) the live one. */
export function effectiveSelling(
  sub: Pick<AdminSubmission, 'kind' | 'seller_price' | 'product'>,
  typed: number | null
): number | null {
  if (typed != null) return typed;
  return sellingPriceRequired(sub) ? null : sub.product?.selling_price == null ? null : Number(sub.product.selling_price);
}

/** The body for POST .../approve, or what is wrong with the form. */
export function approvalBody(
  sub: Pick<AdminSubmission, 'kind' | 'seller_price' | 'product'>,
  sellingText: string,
  categoryOverride: string
): { body: { selling_price?: number; category_id?: string } } | { error: string } {
  const body: { selling_price?: number; category_id?: string } = {};
  if (sellingText.trim() || sellingPriceRequired(sub)) {
    const read = parseMoney(sellingText, 'selling price');
    if ('error' in read) {
      return {
        error:
          sub.kind === 'EDIT' && !sellingText.trim()
            ? 'The seller changed their price: enter the selling price customers will pay.'
            : read.error,
      };
    }
    body.selling_price = read.value;
  }
  if (categoryOverride) body.category_id = categoryOverride;
  return { body };
}

export interface FieldChange {
  key: keyof SubmissionPayload | 'seller_price';
  label: string;
  live: string;
  proposed: string;
}

const FIELD_LABEL: Record<keyof SubmissionPayload, string> = {
  name: 'Name',
  category_id: 'Category',
  unit: 'Unit',
  pack_size: 'Pack size',
  description: 'Description',
  image_url: 'Photo',
  barcode: 'Barcode',
};
const FIELDS = Object.keys(FIELD_LABEL) as (keyof SubmissionPayload)[];

const blank = (v: unknown): string => (v == null ? '' : String(v).trim());

/**
 * For an EDIT: the fields that differ from the live product, with both values as text. Fields the
 * payload leaves out keep the live value (nothing to show); `categoryName` turns a category id into
 * its name. Without the live product only the submission's own price comparison is possible.
 */
export function changedFields(
  sub: Pick<AdminSubmission, 'kind' | 'payload' | 'seller_price' | 'product'>,
  live: LiveProductView | null,
  categoryName: (id: string | null | undefined) => string
): FieldChange[] {
  if (sub.kind !== 'EDIT') return [];
  const out: FieldChange[] = [];
  const liveOf: Partial<LiveProductView> = live ?? (sub.product ? { name: sub.product.name } : {});
  for (const key of FIELDS) {
    if (!(key in sub.payload) || sub.payload[key] === undefined) continue;
    if (!(key in liveOf)) continue;
    const was = blank(liveOf[key]);
    const now = blank(sub.payload[key]);
    if (was === now) continue;
    const show = (v: string) => (key === 'category_id' ? categoryName(v || null) : v);
    out.push({ key, label: FIELD_LABEL[key], live: show(was), proposed: show(now) });
  }
  const wasPrice = sub.product?.purchase_cost;
  if (wasPrice != null && round2(Number(wasPrice)) !== round2(Number(sub.seller_price))) {
    out.push({ key: 'seller_price', label: "Seller's price", live: lkr(wasPrice), proposed: lkr(sub.seller_price) });
  }
  return out;
}
