import type { Category, PricingMode, PricingSource } from '../api/types';

/**
 * Selling-price modes and category markup (migration 044; owner, 2026-10-13).
 * The server is the authority (backend pricing/index.ts resolveSellingPrice
 * and its SQL twin v_product_catalog); these are the same rules for the
 * live previews in the product form, the category list and the import page.
 *
 *   FIXED  - the fixed selling price, exactly.
 *   MARKUP - cost x (1 + m / 100) to the cent, m = the product's custom
 *            markup, else its category's, else the parent category's, else
 *            the global default markup (20% when unknown).
 */

/** The server's global default when the setting is missing. */
export const FALLBACK_GLOBAL_MARKUP = 20;
/** products.custom_markup_percent / categories.markup_percent limit. */
export const MAX_MARKUP_PERCENT = 999.99;
/** The largest selling price the API takes (NUMERIC(10,2)). */
export const MAX_SELLING_PRICE = 99_999_999.99;

/**
 * cost x (1 + markup / 100) to the cent, exactly as the server: whole cents
 * x (10000 + basis points) / 10000, rounded half away from zero on integers
 * (equals Postgres ROUND(numeric, 2)).
 */
export function markupPrice(cost: number, markupPercent: number): number {
  const costCents = Math.round(cost * 100);
  const markupBp = Math.round(markupPercent * 100);
  const numerator = costCents * (10000 + markupBp);
  const cents = numerator >= 0 ? Math.floor((numerator + 5000) / 10000) : -Math.floor((-numerator + 5000) / 10000);
  return cents / 100;
}

/** Round half away from zero to 2 decimals (the server's round2). */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

/** A fixed price's "% over cost", 2 decimals; null when the cost is 0. Negative below cost. */
export function marginPercent(cost: number, price: number): number | null {
  if (!(cost > 0)) return null;
  return round2((price / cost - 1) * 100);
}

/** 25 -> "25", 12.5 -> "12.5", 12.25 -> "12.25". */
export function formatPercent(n: number): string {
  return String(round2(n));
}

/** "LKR 1,250.00": every price on the pricing screens shows its cents. */
export function formatLkr(n: number): string {
  return `LKR ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PRICING_SOURCE_LABEL: Record<PricingSource, string> = {
  FIXED: 'Fixed',
  PRODUCT_MARKUP: 'Product markup',
  CATEGORY_MARKUP: 'Category markup',
  PARENT_CATEGORY_MARKUP: 'Parent category markup',
  GLOBAL_MARKUP: 'Global markup',
};

/** The markup a MARKUP product would inherit, and where it comes from. */
export interface InheritedMarkup {
  markup: number;
  source: Exclude<PricingSource, 'FIXED' | 'PRODUCT_MARKUP'>;
  /** The category (own or parent) the markup comes from; null for global. */
  categoryName: string | null;
}

const present = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(Number(n));

/**
 * The markup a product in `categoryId` inherits: the category's own, else
 * its parent's, else the global default (`globalMarkup`, else 20).
 */
export function inheritedMarkup(
  categoryId: string | null | undefined,
  categories: Array<Pick<Category, 'id' | 'name' | 'parent_id' | 'markup_percent'>>,
  globalMarkup: number | null | undefined
): InheritedMarkup {
  const category = categoryId ? categories.find((c) => c.id === categoryId) : undefined;
  if (category && present(category.markup_percent)) {
    return { markup: Number(category.markup_percent), source: 'CATEGORY_MARKUP', categoryName: category.name };
  }
  const parent = category?.parent_id ? categories.find((c) => c.id === category.parent_id) : undefined;
  if (parent && present(parent.markup_percent)) {
    return { markup: Number(parent.markup_percent), source: 'PARENT_CATEGORY_MARKUP', categoryName: parent.name };
  }
  return {
    markup: present(globalMarkup) ? Number(globalMarkup) : FALLBACK_GLOBAL_MARKUP,
    source: 'GLOBAL_MARKUP',
    categoryName: null,
  };
}

export interface PricePreview {
  mode: PricingMode;
  source: PricingSource;
  price: number;
  /** MARKUP: the markup used. FIXED: the % over cost (null when the cost is 0). */
  markup: number | null;
  categoryName: string | null;
  /** FIXED below cost: LKR lost per unit; else null. */
  lossPerUnit: number | null;
}

/**
 * The selling price a product will get. Null while the inputs cannot give
 * one (no valid cost, or a FIXED price that is not above 0).
 */
export function previewPrice(input: {
  cost: number;
  mode: PricingMode;
  fixedPrice?: number | null;
  customMarkup?: number | null;
  inherited: InheritedMarkup;
}): PricePreview | null {
  const { cost, mode } = input;
  if (!Number.isFinite(cost) || cost < 0) return null;
  if (mode === 'FIXED') {
    const fixed = input.fixedPrice;
    if (!present(fixed) || !(fixed > 0)) return null;
    const price = round2(fixed);
    return {
      mode,
      source: 'FIXED',
      price,
      markup: marginPercent(cost, price),
      categoryName: null,
      lossPerUnit: price < cost ? round2(cost - price) : null,
    };
  }
  if (present(input.customMarkup)) {
    if (input.customMarkup < 0) return null;
    return {
      mode,
      source: 'PRODUCT_MARKUP',
      price: markupPrice(cost, input.customMarkup),
      markup: input.customMarkup,
      categoryName: null,
      lossPerUnit: null,
    };
  }
  const { markup, source, categoryName } = input.inherited;
  return { mode, source, price: markupPrice(cost, markup), markup, categoryName, lossPerUnit: null };
}

/**
 * Where a markup price comes from, for the form's preview line:
 * "product markup 30%", "from category 'Rice' 25%",
 * "from parent category 'Grocery' 15%", "global markup 20%".
 */
export function markupSourceText(source: PricingSource, markup: number | null, categoryName: string | null): string {
  const pct = markup === null ? '' : ` ${formatPercent(markup)}%`;
  switch (source) {
    case 'PRODUCT_MARKUP':
      return `product markup${pct}`;
    case 'CATEGORY_MARKUP':
      return categoryName ? `from category '${categoryName}'${pct}` : `category markup${pct}`;
    case 'PARENT_CATEGORY_MARKUP':
      return categoryName ? `from parent category '${categoryName}'${pct}` : `parent category markup${pct}`;
    case 'GLOBAL_MARKUP':
      return `global markup${pct}`;
    default:
      return 'fixed price';
  }
}

/**
 * A markup % typed into a form: '' = none (inherit), else 0..999.99 with at
 * most 2 decimals.
 */
export function parseMarkupInput(text: string): { value: number | null } | { error: string } {
  const raw = text.trim();
  if (raw === '') return { value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: 'Markup must be a number from 0 to 999.99, at most 2 decimals' };
  const value = Number(raw);
  if (value > MAX_MARKUP_PERCENT) return { error: 'Markup must be between 0 and 999.99' };
  return { value };
}
