import { ApiError } from '../api/client';
import type { Promotion } from '../api/types';

/**
 * The API's refusals in the operator's words, for Products/Categories/
 * Promotions (task F5). Mirrors `lib/orders.ts`'s `orderErrorMessage` shape
 * (a small, per-domain code→copy table, never swallowing a rejection - task
 * F3 established this pattern), but this domain has no lifecycle state
 * machine, so most of what the backend returns is already a clean, specific
 * message (`AppError`'s own `message`, e.g. "Product with SKU 'X' already
 * exists.") - this function's job is mostly to pick the *best available*
 * message, not to invent new copy.
 *
 * `VALIDATION_ERROR` is the one case worth special-casing: the backend's
 * `validate` middleware (backend/api/src/middleware/validate.middleware.ts)
 * always sends the generic "Request validation failed" as `message`, with
 * the real, field-specific reason in `details[0].message` - using the
 * generic one would be strictly less useful to the operator.
 */
export function catalogErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Nothing was saved.';
  if (err.code === 'NETWORK') return 'Could not reach the Blynk API. Nothing was saved.';
  if (err.code === 'TIMEOUT') return 'The Blynk API did not answer in time. Nothing was saved.';
  if (err.code === 'VALIDATION_ERROR') {
    const details = err.details as Array<{ field?: string; message?: string }> | undefined;
    const first = details?.[0]?.message;
    return first ?? err.message;
  }
  if (err.code === 'FILE_TOO_LARGE') return 'That image is larger than 2 MB. Choose a smaller one.';
  if (err.code === 'PAYLOAD_TOO_LARGE' || err.status === 413) {
    return 'That is too much to send at once (over 1 MB). Split it into smaller files and try again. Nothing was saved.';
  }
  if (err.status >= 500) return 'The Blynk API had a problem. Try again in a moment.';
  return err.message;
}

/**
 * The server's reason for one field of a VALIDATION_ERROR (details[].field),
 * or null - so a form can show it under that field (e.g. 'mrp', migration 048).
 */
export function serverFieldError(err: unknown, field: string): string | null {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return null;
  const details = err.details as Array<{ field?: string; message?: string }> | undefined;
  if (!Array.isArray(details)) return null;
  return details.find((d) => d.field === field && d.message)?.message ?? null;
}

/** The delivery fee the API accepts: LKR 0-1000, at most 2 decimals. */
export const MAX_DELIVERY_FEE_LKR = 1000;

/** Client-side check for the Delivery fee setting (the server checks again). */
export function parseDeliveryFee(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { error: 'Enter a fee in LKR (0 for free delivery).' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter a number, like 250 or 199.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value > MAX_DELIVERY_FEE_LKR) return { error: `The fee can be at most LKR ${MAX_DELIVERY_FEE_LKR}.` };
  return { value };
}

/**
 * Free deliveries per customer (owner, 2026-10-08; every customer since 2026-10-09): a whole number
 * 0..MAX_FREE_DELIVERIES, as PATCH /admin/settings/checkout accepts.
 */
export const MAX_FREE_DELIVERIES = 10;
export function parseFreeDeliveryCount(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (!/^\d+$/.test(s) || Number(s) > MAX_FREE_DELIVERIES) {
    return { error: `Enter a whole number from 0 to ${MAX_FREE_DELIVERIES}.` };
  }
  return { value: Number(s) };
}

// ------------------------------------------------- Colombo calendar dates
// Sri Lanka is UTC+05:30 all year (no daylight saving), the same fixed
// offset `pages/Cash.tsx`'s `colomboToday` and `lib/dental.ts` rely on.
const COLOMBO_OFFSET_MS = 330 * 60_000;

const colomboDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Colombo',
});

/** "9 Oct 2026" - the calendar day an instant falls on in Colombo. */
export function formatColomboDate(iso: string): string {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? iso : colomboDate.format(instant);
}

/** The Colombo calendar day of an instant, as YYYY-MM-DD (a date input's value). */
export function colomboDay(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  return new Date(instant.getTime() + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today in Colombo, YYYY-MM-DD. */
export function colomboTodayDay(now = new Date()): string {
  return colomboDay(now.toISOString());
}

/**
 * An offer's end for a picked day (owner, 2026-10-09): the last second of
 * that day in Colombo, with the offset the API requires.
 */
export function offerEndForDay(day: string): string {
  return `${day}T23:59:59+05:30`;
}

/**
 * An offer price typed into the product form (owner, 2026-10-09): above
 * zero, at most 2 decimals and strictly lower than the selling price the
 * form shows (`sellingPrice` null = not known yet; the server checks again
 * against the price it calculates).
 */
export function parseOfferPrice(input: string, sellingPrice: number | null): { value: number } | { error: string } {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter the offer price, like 220 or 219.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value <= 0) return { error: 'The offer price must be more than LKR 0.' };
  if (sellingPrice !== null && value >= sellingPrice) {
    return { error: `The offer price must be lower than the selling price (LKR ${sellingPrice.toFixed(2)}).` };
  }
  return { value };
}

/**
 * "LKR off" (owner, 2026-10-10): the operator types how much comes off the
 * selling price the form shows (e.g. 50) and the offer price sent is
 * selling price - amount, to 2 decimals. Only the resulting offer_price is
 * stored, so a later cost or markup change keeps that stored price (as an
 * offer typed as a new price does) - it is not re-derived from the amount.
 */
export function parseOfferAmountOff(input: string, sellingPrice: number | null): { value: number } | { error: string } {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter the amount off, like 50 or 49.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const amount = Number(s);
  if (amount <= 0) return { error: 'The amount off must be more than LKR 0.' };
  if (sellingPrice === null) return { error: 'Enter a valid purchase cost first, so the selling price is known.' };
  const value = Math.round((sellingPrice - amount) * 100) / 100;
  if (value <= 0) return { error: 'The offer price must be more than LKR 0.' };
  return { value };
}

/** Whole percent off, e.g. 250 -> 220 is 12% off. */
export function percentOff(offer: number, selling: number): number {
  return selling > 0 ? Math.round(((selling - offer) / selling) * 100) : 0;
}

/** The API's display_order range for promotions (promotion.schema.ts). */
export const MAX_PROMOTION_ORDER = 1000;

/**
 * A display order typed into a form: a whole number within [0, max] (max
 * omitted = no upper bound, e.g. categories). Empty means 0, the API default.
 */
export function parseDisplayOrder(input: string, max?: number): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { value: 0 };
  if (!/^\d+$/.test(s)) {
    return { error: max === undefined ? 'Order must be a whole number, 0 or more.' : `Order must be a whole number from 0 to ${max}.` };
  }
  const value = Number(s);
  if (max !== undefined && value > max) return { error: `Order must be a whole number from 0 to ${max}.` };
  return { value };
}

/**
 * The `{id, display_order}` updates that move one row up (-1) or down (+1)
 * in a list already sorted by display_order. Distinct neighbours just swap
 * their values. When they are EQUAL (two promotions saved with the same
 * order, the default 0 included) a swap would change nothing, so the whole
 * list is renumbered 10, 20, 30... in the new order (staying within the
 * API's 0-1000 range) and every row whose number changed is sent. Returns
 * [] when there is nowhere to move.
 */
export function planReorder(
  rows: ReadonlyArray<{ id: string; display_order: number }>,
  id: string,
  direction: -1 | 1,
  max = MAX_PROMOTION_ORDER
): { id: string; display_order: number }[] {
  const index = rows.findIndex((row) => row.id === id);
  const neighbour = index < 0 ? undefined : rows[index + direction];
  if (index < 0 || !neighbour) return [];
  const row = rows[index]!;
  if (row.display_order !== neighbour.display_order) {
    return [
      { id: row.id, display_order: neighbour.display_order },
      { id: neighbour.id, display_order: row.display_order },
    ];
  }
  const order = [...rows];
  order[index] = neighbour;
  order[index + direction] = row;
  const step = Math.max(1, Math.min(10, Math.floor(max / Math.max(1, order.length))));
  return order
    .map((r, i) => ({ id: r.id, display_order: Math.min(max, (i + 1) * step), before: r.display_order }))
    .filter((r) => r.display_order !== r.before)
    .map(({ id: rowId, display_order }) => ({ id: rowId, display_order }));
}

// ------------------------------------------------ category offers (033)

/**
 * A category offer % typed into the category dialog (owner, 2026-10-09),
 * mirroring PUT /admin/categories/:id/offer: more than 0, less than 100, at
 * most 2 decimals. The server checks again.
 */
export function parseOfferPercent(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter the % off, like 10 or 12.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value <= 0) return { error: 'The offer must be more than 0%.' };
  if (value >= 100) return { error: 'The offer must be less than 100%.' };
  return { value };
}

/** "10% off" / "12.5% off" - no trailing zeros. */
export function offerPercentLabel(percent: number): string {
  return `${Number(percent.toFixed(2))}% off`;
}

// ------------------------------------------------------ combo packs (033)

/** Most units of one product in a combo (combo schema). */
export const MAX_COMBO_ITEM_QTY = 100;

/** What a customer pays for a product right now (owner, 2026-10-09): the
 * backend's `customer_price` (best active offer) when the API sends it, else
 * the calculated selling price. Null when neither is known. */
export function productCustomerPrice(product: {
  customer_price?: number | null;
  calculated_selling_price?: number | null;
  selling_price?: number | null;
}): number | null {
  for (const v of [product.customer_price, product.calculated_selling_price, product.selling_price]) {
    if (v !== null && v !== undefined && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** A combo price typed into the form: above zero, at most 2 decimals. */
export function parseComboPrice(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter the combo price, like 980 or 979.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value <= 0) return { error: 'The combo price must be more than LKR 0.' };
  return { value };
}

/**
 * The combo rules the server enforces (owner, 2026-10-09), in the
 * operator's words: at least 2 different products, or 1 product with 2 or
 * more; and the combo price lower than buying the items separately.
 * Returns the first broken rule, or null.
 */
export function comboRuleError(
  items: ReadonlyArray<{ quantity: number }>,
  price: number | null,
  itemsTotal: number | null
): string | null {
  if (items.length === 0) return 'Add the products in this combo.';
  if (items.length === 1 && items[0]!.quantity < 2) {
    return 'A combo needs at least 2 products, or 2 or more of one product.';
  }
  if (price !== null && itemsTotal !== null && !(price < itemsTotal)) {
    return 'The combo price must be lower than buying the items separately.';
  }
  return null;
}

/** Why a combo is not on sale, in plain words (owner, 2026-10-09). */
export function comboNotLiveLabel(reason: string | null): string {
  switch (reason) {
    case 'INACTIVE':
      return 'Switched off';
    case 'ENDED':
      return 'Ended';
    case 'ITEM_INACTIVE':
      return 'A product is switched off';
    case 'NOT_CHEAPER':
      return 'Hidden: items are now cheaper than the combo';
    default:
      return 'Not on sale';
  }
}

/** One entry of a category picker (product form, promotion target). */
export interface CategoryOption {
  id: string;
  slug: string;
  /** "Rice & Flour" for a category, "Rice & Flour › Rice" for a sub-category. */
  label: string;
  /** Null for a top-level category. */
  parentId: string | null;
  isActive: boolean;
}

const byArrangeOrder = (a: { display_order: number; name: string }, b: { display_order: number; name: string }) =>
  a.display_order - b.display_order || a.name.localeCompare(b.name);

/**
 * Categories in customer order for a picker: each top-level category
 * (display_order, then name - the Arrange rule) followed by its
 * sub-categories in the same order, labelled "Category › Sub-category" so a
 * sub-category named like another category is never ambiguous. A child whose
 * parent is missing from the list is shown on its own at the end.
 */
export function categoryOptions(
  rows: Array<{ id: string; name: string; slug: string; display_order: number; is_active: boolean; parent_id?: string | null }>
): CategoryOption[] {
  const ids = new Set(rows.map((c) => c.id));
  const isOrphan = (c: { parent_id?: string | null }) => Boolean(c.parent_id) && !ids.has(c.parent_id!);
  const top = [
    ...rows.filter((c) => !c.parent_id).sort(byArrangeOrder),
    ...rows.filter(isOrphan).sort(byArrangeOrder),
  ];
  const out: CategoryOption[] = [];
  for (const parent of top) {
    const orphan = Boolean(parent.parent_id);
    out.push({ id: parent.id, slug: parent.slug, label: parent.name, parentId: orphan ? parent.parent_id! : null, isActive: parent.is_active });
    if (orphan) continue;
    for (const child of rows.filter((c) => c.parent_id === parent.id).sort(byArrangeOrder)) {
      out.push({
        id: child.id,
        slug: child.slug,
        label: `${parent.name} › ${child.name}`,
        parentId: parent.id,
        isActive: child.is_active,
      });
    }
  }
  return out;
}

/**
 * Where a promotion's button / card leads, in staff words, from the server's
 * resolved `cta_target` (2026-10-14): "Main: Grocery", "Category: Rice &
 * Flour", "Sub-category: Rice & Flour › Rice", "Product: Samba 5kg", "all
 * products"; "(off)" when the target is switched off; "Target missing" when a
 * destination is set but points at nothing any more. An older API without
 * `cta_target` falls back to the stored type and value.
 */
export function describePromotionTarget(
  promotion: Pick<Promotion, 'cta_destination_type' | 'cta_destination_value' | 'cta_target'>
): string {
  const target = promotion.cta_target;
  if (target === undefined) {
    switch (promotion.cta_destination_type) {
      case 'CATEGORY':
        return `category "${promotion.cta_destination_value}"`;
      case 'PRODUCT':
        return 'a product';
      case 'CATALOG':
        return 'all products';
      default:
        return 'nothing';
    }
  }
  if (target === null) return promotion.cta_destination_type ? 'Target missing' : 'nothing';
  const off = target.is_active === false ? ' (off)' : '';
  switch (target.level) {
    case 'MAIN':
      return `Main: ${target.name ?? '?'}${off}`;
    case 'CATEGORY':
      return `Category: ${target.name ?? target.slug ?? '?'}${off}`;
    case 'SUB_CATEGORY':
      return `Sub-category: ${target.parent_name ? `${target.parent_name} › ` : ''}${target.name ?? target.slug ?? '?'}${off}`;
    case 'PRODUCT':
      return `Product: ${target.name ?? '?'}${off}`;
    default:
      return 'all products';
  }
}

// ------------------------------------- variants, lead time (migration 045)

/** The longest delivery lead time the API accepts, in whole days. */
export const MAX_DELIVERY_LEAD_DAYS = 30;

/** A delivery lead time typed into the product form: blank = 0, else a whole number 0-30. */
export function parseLeadDays(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { value: 0 };
  if (!/^\d+$/.test(s) || Number(s) > MAX_DELIVERY_LEAD_DAYS) {
    return { error: `Enter whole days from 0 to ${MAX_DELIVERY_LEAD_DAYS} (0 = same day).` };
  }
  return { value: Number(s) };
}

/** "Delivered after 2 days" chip text; null for same day. */
export function leadTimeLabel(days: number | null | undefined): string | null {
  const n = Number(days ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `Delivered after ${n} ${n === 1 ? 'day' : 'days'}`;
}

const lkr = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * The price a product row shows: "LKR 50 - 350" for a product with variants
 * whose prices differ, else the one price ("LKR 125.00"). Null when unknown.
 */
export function productPriceText(product: {
  has_variants?: boolean;
  price_min?: number | null;
  price_max?: number | null;
  calculated_selling_price?: number | null;
}): string | null {
  if (product.has_variants && product.price_min != null && product.price_max != null) {
    const min = Number(product.price_min);
    const max = Number(product.price_max);
    return min === max ? `LKR ${lkr(min)}` : `LKR ${lkr(min)} - ${lkr(max)}`;
  }
  if (product.calculated_selling_price == null) return null;
  return `LKR ${Number(product.calculated_selling_price).toFixed(2)}`;
}

/** A whole stock number typed into a form (0-100000); blank = null. */
export function parseStockNumber(input: string, label: string): { value: number | null } | { error: string } {
  const s = input.trim();
  if (s === '') return { value: null };
  if (!/^\d+$/.test(s) || Number(s) > 100_000) return { error: `${label} must be a whole number from 0 to 100000.` };
  return { value: Number(s) };
}
