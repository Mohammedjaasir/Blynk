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
  /** The seller's own rate; null = each sale uses its category's rate or the default (migration 057). */
  commission_percent: number | null;
  created_at: string;
  /** null for a seller who signed up with an email address. */
  phone: string | null;
  /** The seller's sign-in email (sellers who signed up with email + password), else null. */
  email: string | null;
  full_name: string | null;
  products_live: number;
  submissions_pending: number;
  due: number;
  /*
   * The shop pin (migration 053). Optional: an API from before it leaves them out, and until the
   * migration runs they are null / 'NONE'. latitude / longitude / location_note are the APPROVED
   * point (riders collect there, delivery is measured from it); pending_* wait for Admin.
   */
  latitude?: number | null;
  longitude?: number | null;
  location_note?: string | null;
  pending_latitude?: number | null;
  pending_longitude?: number | null;
  pending_location_note?: string | null;
  location_status?: LocationStatus;
  location_reject_reason?: string | null;
  distance_km_from_store?: number | null;
  pending_distance_km_from_store?: number | null;
}

// ---------------------------------------------------------------- shop location

export type LocationStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface MapPoint {
  lat: number;
  lng: number;
}

const point = (lat: number | null | undefined, lng: number | null | undefined): MapPoint | null =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

/** The approved shop point (what delivery uses), or null. */
export const approvedPoint = (s: Pick<AdminSeller, 'latitude' | 'longitude'>): MapPoint | null => point(s.latitude, s.longitude);

/** The point waiting for review (or the one that was rejected), or null. */
export const pendingPoint = (s: Pick<AdminSeller, 'pending_latitude' | 'pending_longitude'>): MapPoint | null =>
  point(s.pending_latitude, s.pending_longitude);

/** A pin waiting for Admin. */
export const locationWaiting = (s: Pick<AdminSeller, 'location_status' | 'pending_latitude' | 'pending_longitude'>): boolean =>
  s.location_status === 'PENDING' && pendingPoint(s) !== null;

export const googleMapsUrl = (p: MapPoint): string => `https://www.google.com/maps?q=${p.lat},${p.lng}`;

/** A small OpenStreetMap embed around the pin (about 1 km across). */
export function osmEmbedUrl(p: MapPoint, span = 0.006): string {
  const f = (n: number) => n.toFixed(6);
  const bbox = [p.lng - span, p.lat - span / 2, p.lng + span, p.lat + span / 2].map(f).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${f(p.lat)},${f(p.lng)}`;
}

/** "7.290572, 80.633728" */
export const pointText = (p: MapPoint): string => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

/** "3.2 km from the Blynk store", or null when the distance is unknown. */
export function distanceText(km: number | null | undefined): string | null {
  if (typeof km !== 'number' || !Number.isFinite(km)) return null;
  return `${km.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km from the Blynk store`;
}

export const LOCATION_REASON_MAX = 200;

/** Why a location rejection reason cannot be sent (null = fine). */
export function locationReasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (r.length < REASON_LIMITS.min) return `Write a reason (at least ${REASON_LIMITS.min} characters).`;
  if (r.length > LOCATION_REASON_MAX) return `At most ${LOCATION_REASON_MAX} characters.`;
  return null;
}

export interface StatementLine {
  product_id: string;
  name: string;
  units: number;
  gross: number;
  /** The percent Blynk keeps on this line and what that comes to (an API from before 057 leaves them out). */
  commission_percent?: number;
  commission?: number;
}
export interface SellerPayout {
  id: string;
  amount: number;
  note: string | null;
  paid_on: string;
}
export interface SellerStatement {
  /** The seller's own rate; null = category rates / the default, per line. */
  commission_percent: number | null;
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


// ---------------------------------------------------------------- adding sellers (invite-only, 2026-10-24)

export interface CreateSellerBody {
  shop_name: string;
  phone: string;
  contact_name?: string;
  address?: string;
  commission_percent?: number | null;
  status?: 'APPROVED' | 'PENDING';
}

/** "077 123 4567", "0771234567", "+94771234567" -> "+94771234567", or null when it is not a Sri Lankan mobile number. */
export function normalisePhone(text: string): string | null {
  const t = text.replace(/[\s\-()]/g, '');
  const local = t.startsWith('+94') ? t.slice(3) : t.startsWith('94') && t.length === 11 ? t.slice(2) : t.startsWith('0') ? t.slice(1) : t;
  return /^7[0-8]\d{7}$/.test(local) ? `+94${local}` : null;
}

/** An optional commission typed in a field: blank = none (null), else 0 to 100 with at most 2 decimals. */
export function parseOptionalCommission(text: string): { value: number | null } | { error: string } {
  if (!text.trim()) return { value: null };
  return parseCommission(text);
}

export interface NewSellerForm {
  shop_name: string;
  phone: string;
  contact_name: string;
  address: string;
  commission: string;
  approve: boolean;
}

/** The add-seller form, read into the POST body (or the first problem). */
export function newSellerBody(form: NewSellerForm): { body: CreateSellerBody } | { error: string; field: 'shop_name' | 'phone' | 'commission' } {
  const shop = form.shop_name.trim();
  if (shop.length < 2) return { error: 'Enter the shop name (at least 2 characters).', field: 'shop_name' };
  if (shop.length > 80) return { error: 'The shop name can be at most 80 characters.', field: 'shop_name' };
  const phone = normalisePhone(form.phone);
  if (!phone) return { error: 'Enter a Sri Lankan mobile number, like 077 123 4567.', field: 'phone' };
  const pct = parseOptionalCommission(form.commission);
  if ('error' in pct) return { error: pct.error, field: 'commission' };
  return {
    body: {
      shop_name: shop,
      phone,
      ...(form.contact_name.trim() ? { contact_name: form.contact_name.trim() } : {}),
      ...(form.address.trim() ? { address: form.address.trim() } : {}),
      ...(pct.value !== null ? { commission_percent: pct.value } : {}),
      status: form.approve ? 'APPROVED' : 'PENDING',
    },
  };
}

const ROLE_WORD: Record<string, string> = {
  CUSTOMER: 'customer',
  RIDER: 'rider',
  SELLER: 'seller',
  ADMIN: 'staff',
  OPERATIONS: 'staff',
  PACKING_STAFF: 'staff',
};

/** "This number already has a Blynk account (customer)." from a 409 PHONE_IN_USE's details.role. */
export function phoneInUseText(role: unknown): string {
  const kind = typeof role === 'string' ? ROLE_WORD[role] : undefined;
  return kind ? `This number already has a Blynk account (${kind}).` : 'This number already has a Blynk account.';
}

// ---------------------------------------------------------------- commission (migration 057)

export interface CategoryRate {
  category_id: string;
  name: string;
  parent_id: string | null;
  percent: number | null;
}
export interface CommissionSettings {
  default_percent: number;
  categories: CategoryRate[];
  /** false until migration 057 has run (category rates cannot be saved yet). */
  ready?: boolean;
}

/** Main categories, each followed by its sub-categories (a sub-category whose main one is gone counts as main). */
export function categoryTree(rows: readonly CategoryRate[]): { row: CategoryRate; depth: 0 | 1 }[] {
  const ids = new Set(rows.map((r) => r.category_id));
  const mains = rows.filter((r) => !r.parent_id || !ids.has(r.parent_id));
  const out: { row: CategoryRate; depth: 0 | 1 }[] = [];
  for (const m of mains) {
    out.push({ row: m, depth: 0 });
    for (const c of rows) if (c.parent_id === m.category_id) out.push({ row: c, depth: 1 });
  }
  return out;
}

/** The commission settings form, read into the PUT body (or the first problem). Blank category = no rate (null). */
export function commissionBody(
  defaultText: string,
  rates: Readonly<Record<string, string>>
): { body: { default_percent: number; categories: { category_id: string; percent: number | null }[] } } | { error: string } {
  const d = parseCommission(defaultText);
  if ('error' in d) return { error: `Default: ${d.error}` };
  const categories: { category_id: string; percent: number | null }[] = [];
  for (const [category_id, text] of Object.entries(rates)) {
    const r = parseOptionalCommission(text);
    if ('error' in r) return { error: r.error };
    categories.push({ category_id, percent: r.value });
  }
  return { body: { default_percent: d.value, categories } };
}

/** How a seller's rate reads: their own rate, else category rates. */
export const commissionText = (pct: number | null | undefined): string =>
  pct === null || pct === undefined ? 'Category rates' : `${Number(pct)}%`;

// ---------------------------------------------------------------- payout requests (migration 057)

export type PayoutRequestStatus = 'REQUESTED' | 'PAID' | 'DECLINED' | 'WITHDRAWN';

export interface PayoutRequest {
  id: string;
  amount: number;
  method: 'BANK' | 'CASH';
  bank_details: string | null;
  note: string | null;
  status: PayoutRequestStatus;
  decline_reason: string | null;
  payout_id: string | null;
  paid_on: string | null;
  handled_at: string | null;
  created_at: string;
  seller: { id: string; shop_name: string; phone: string | null; email: string | null };
  /** What is due to the seller right now. */
  due: number;
}

/** The ids of sellers that have a payout request waiting, for the Sellers list badge. */
export function payoutRequesters(requests: ReadonlyArray<{ seller: { id: string } }>): Set<string> {
  return new Set(requests.map((r) => r.seller.id));
}

export const METHOD_LABEL: Record<PayoutRequest['method'], string> = { BANK: 'Bank transfer', CASH: 'Cash' };

/** Is this the "database update pending" answer (503 SELLER_REQUESTS_NOT_READY)? */
export const notReady = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'SELLER_REQUESTS_NOT_READY';
