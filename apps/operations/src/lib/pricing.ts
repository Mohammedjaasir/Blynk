/**
 * Selling prices (backend migration 044; owner, 2026-10-13).
 *
 * Every product has one selling price, set one of two ways:
 *   FIXED  - exactly the fixed selling price typed in.
 *   MARKUP - purchase cost x (1 + m / 100), to the cent, where m = the
 *            product's own markup, else its category's, else its parent
 *            category's, else the global default markup (20% when unset).
 *
 * The server is the price authority (backend/api/src/modules/pricing); this
 * is its twin so the product form, category list and import screens can
 * PREVIEW the same number the server will save. Same rounding: inputs carry
 * at most 2 decimals, so the arithmetic is done on whole cents and basis
 * points, which is exact and matches Postgres ROUND(numeric, 2).
 */

export type PricingMode = 'MARKUP' | 'FIXED';
export type PricingSource = 'FIXED' | 'PRODUCT_MARKUP' | 'CATEGORY_MARKUP' | 'PARENT_CATEGORY_MARKUP' | 'GLOBAL_MARKUP';
export type InheritedSource = Extract<PricingSource, 'CATEGORY_MARKUP' | 'PARENT_CATEGORY_MARKUP' | 'GLOBAL_MARKUP'>;

/** The global default when none is saved (backend FALLBACK_DEFAULT_MARKUP_PERCENT). */
export const FALLBACK_DEFAULT_MARKUP_PERCENT = 20;
/** products.custom_markup_percent / categories.markup_percent / default markup limit. */
export const MAX_MARKUP_PERCENT = 999.99;
/** The highest selling price the API accepts. */
export const MAX_SELLING_PRICE = 99_999_999.99;

/** cost x (1 + markup / 100) to the cent, exactly (copied from the backend). */
export function markupPrice(cost: number, markupPercent: number): number {
  const costCents = Math.round(cost * 100);
  const markupBp = Math.round(markupPercent * 100);
  const numerator = costCents * (10000 + markupBp);
  const cents = numerator >= 0 ? Math.floor((numerator + 5000) / 10000) : -Math.floor((-numerator + 5000) / 10000);
  return cents / 100;
}

/** Round half away from zero to 2 decimals. */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

/** A fixed price's "% over cost", 2 decimals (negative below cost); null when the cost is 0. */
export function marginPercent(cost: number, price: number): number | null {
  if (!(cost > 0)) return null;
  return round2((price / cost - 1) * 100);
}

/** "25%" / "12.5%" - no trailing zeros. */
export function percentText(percent: number): string {
  return `${Number(percent.toFixed(2))}%`;
}

/** The fields of a category the markup rule reads. */
export interface MarkupCategory {
  id: string;
  name: string;
  parent_id?: string | null;
  markup_percent?: number | null;
}

export interface ResolvedMarkup {
  percent: number;
  source: Exclude<PricingSource, 'FIXED'>;
  /** The category (or parent category) the markup comes from. */
  categoryName?: string;
}

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(Number(v));

/**
 * The markup a product with no markup of its own gets in `categoryId`: the
 * category's own, else its parent's, else the global default.
 */
export function inheritedMarkup(
  categoryId: string | null | undefined,
  categories: ReadonlyArray<MarkupCategory>,
  globalPercent: number | null | undefined
): ResolvedMarkup & { source: InheritedSource } {
  const category = categoryId ? categories.find((c) => c.id === categoryId) : undefined;
  if (category && has(category.markup_percent)) {
    return { percent: Number(category.markup_percent), source: 'CATEGORY_MARKUP', categoryName: category.name };
  }
  const parent = category?.parent_id ? categories.find((c) => c.id === category.parent_id) : undefined;
  if (parent && has(parent.markup_percent)) {
    return { percent: Number(parent.markup_percent), source: 'PARENT_CATEGORY_MARKUP', categoryName: parent.name };
  }
  return { percent: has(globalPercent) ? Number(globalPercent) : FALLBACK_DEFAULT_MARKUP_PERCENT, source: 'GLOBAL_MARKUP' };
}

/** The product's own markup wins; null = inherit. */
export function resolveMarkup(customPercent: number | null, inherited: ResolvedMarkup): ResolvedMarkup {
  return customPercent === null ? inherited : { percent: customPercent, source: 'PRODUCT_MARKUP' };
}

/** "(from category 'Rice' 25%)" style explanation of where a markup comes from. */
export function markupSourceText(resolved: ResolvedMarkup): string {
  const pct = percentText(resolved.percent);
  switch (resolved.source) {
    case 'PRODUCT_MARKUP':
      return `product markup ${pct}`;
    case 'CATEGORY_MARKUP':
      return `from category '${resolved.categoryName ?? ''}' ${pct}`;
    case 'PARENT_CATEGORY_MARKUP':
      return `from parent category '${resolved.categoryName ?? ''}' ${pct}`;
    default:
      return `global markup ${pct}`;
  }
}

/** Badge text for a pricing source. */
export function pricingSourceLabel(source: PricingSource | null | undefined): string {
  switch (source) {
    case 'FIXED':
      return 'Fixed';
    case 'PRODUCT_MARKUP':
      return 'Product markup';
    case 'CATEGORY_MARKUP':
      return 'Category markup';
    case 'PARENT_CATEGORY_MARKUP':
      return 'Parent category markup';
    case 'GLOBAL_MARKUP':
      return 'Global markup';
    default:
      return '';
  }
}

/**
 * A markup % typed into a form: blank = null (inherit), else 0..999.99 with
 * at most 2 decimals. The server checks again.
 */
export function parseMarkupPercent(input: string): { value: number | null } | { error: string } {
  const s = input.trim();
  if (s === '') return { value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter a markup from 0 to 999.99, like 25 or 12.5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value > MAX_MARKUP_PERCENT) return { error: `Markup can be at most ${MAX_MARKUP_PERCENT}%.` };
  return { value };
}

/** A fixed selling price typed into the form: above 0, at most 2 decimals. */
export function parseSellingPrice(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { error: 'Enter the selling price.' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter a price, like 250 or 249.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value <= 0) return { error: 'The selling price must be more than LKR 0.' };
  if (value > MAX_SELLING_PRICE) return { error: 'The selling price is too large.' };
  return { value };
}

/** "Below purchase cost — you lose LKR 10.00 per unit", or null when not below cost. */
export function belowCostText(cost: number, price: number): string | null {
  if (!(price < cost)) return null;
  return `Below purchase cost — you lose LKR ${round2(cost - price).toFixed(2)} per unit`;
}

/**
 * The note under a category's Markup % field / row: how many products
 * follow it ("12 products use this markup"; blank markup: "12 products
 * follow the parent/global markup").
 */
export function markupProductCountText(count: number | null | undefined, hasOwnMarkup: boolean): string | null {
  if (count === null || count === undefined || !Number.isFinite(count)) return null;
  const noun = count === 1 ? 'product' : 'products';
  if (hasOwnMarkup) return `${count} ${noun} ${count === 1 ? 'uses' : 'use'} this markup`;
  return `${count} ${noun} ${count === 1 ? 'follows' : 'follow'} the parent/global markup`;
}
