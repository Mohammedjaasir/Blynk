import { Router } from 'express';

export const pricingRouter = Router();

/**
 * Selling prices (migration 044; owner, 2026-10-13).
 *
 * Every product has one selling price, set one of two ways:
 *   FIXED  - products.fixed_selling_price, exactly.
 *   MARKUP - purchase_cost x (1 + m / 100), rounded half-up to the cent, where
 *            m = the product's custom markup, else its category's markup,
 *            else its parent category's markup, else the global default
 *            (system_configurations 'default_markup', 20% when missing).
 *
 * v_product_catalog computes the same rule in SQL (migration 044) and is what
 * the catalog, combos and offers read; resolveSellingPrice is its TypeScript
 * twin for checkout, edit-time checks and the import dry run. Both round the
 * same way: inputs carry at most 2 decimals, so the arithmetic below is done
 * on whole cents and basis points and is exact (no float drift), matching
 * Postgres ROUND(numeric, 2) (half away from zero).
 */

export const PRICING_MODES = ['MARKUP', 'FIXED'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const PRICING_SOURCES = ['FIXED', 'PRODUCT_MARKUP', 'CATEGORY_MARKUP', 'PARENT_CATEGORY_MARKUP', 'GLOBAL_MARKUP'] as const;
export type PricingSource = (typeof PRICING_SOURCES)[number];

/** The global default when system_configurations has no 'default_markup'. */
export const FALLBACK_DEFAULT_MARKUP_PERCENT = 20;
/** products.custom_markup_percent NUMERIC(5,2) / categories.markup_percent CHECK. */
export const MAX_MARKUP_PERCENT = 999.99;
/** order_items.unit_selling_price is NUMERIC(10,2). */
export const MAX_SELLING_PRICE = 99_999_999.99;

export interface PriceCalculationParams {
  purchaseCost: number;
  customMarkupPercent?: number | null;
  defaultMarkupPercent?: number;
}

export interface CalculatedPriceResult {
  purchaseCost: number;
  effectiveMarkupPercent: number;
  sellingPrice: number;
}

export interface ResolvePriceInput {
  purchaseCost: number | string;
  pricingMode?: PricingMode | string | null;
  fixedSellingPrice?: number | string | null;
  productMarkupPercent?: number | string | null;
  categoryMarkupPercent?: number | string | null;
  parentCategoryMarkupPercent?: number | string | null;
  globalMarkupPercent?: number | string | null;
}

export interface PriceWarning {
  code: 'SELLING_BELOW_COST';
  message: string;
}

export interface ResolvedPrice {
  pricingMode: PricingMode;
  pricingSource: PricingSource;
  purchaseCost: number;
  sellingPrice: number;
  /**
   * MARKUP: the markup used. FIXED: the implied markup over cost
   * ((price / cost - 1) x 100, 2 decimals, negative below cost), null when
   * the cost is 0.
   */
  effectiveMarkupPercent: number | null;
  /** Set when a FIXED price is below the purchase cost (a warning, never a block). */
  warning: PriceWarning | null;
}

const present = (v: unknown): v is number | string =>
  v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '') && Number.isFinite(Number(v));

/** Round half away from zero to 2 decimals. */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

/**
 * cost x (1 + markup / 100) to the cent, exactly: cost in cents x (10000 +
 * markup in basis points) / 10000, rounded half up on integers.
 */
export function markupPrice(purchaseCost: number, markupPercent: number): number {
  const costCents = Math.round(purchaseCost * 100);
  const markupBp = Math.round(markupPercent * 100);
  const numerator = costCents * (10000 + markupBp);
  const cents = numerator >= 0 ? Math.floor((numerator + 5000) / 10000) : -Math.floor((-numerator + 5000) / 10000);
  return cents / 100;
}

/** The implied markup of a price over a cost, 2 decimals; null when the cost is 0. */
export function impliedMarkupPercent(purchaseCost: number, sellingPrice: number): number | null {
  if (!(purchaseCost > 0)) return null;
  return round2((sellingPrice / purchaseCost - 1) * 100);
}

/** The warning for a price under cost, or null. */
export function belowCostWarning(purchaseCost: number, sellingPrice: number): PriceWarning | null {
  if (!(sellingPrice < purchaseCost)) return null;
  return {
    code: 'SELLING_BELOW_COST',
    message: `The selling price LKR ${sellingPrice.toFixed(2)} is below the purchase cost LKR ${purchaseCost.toFixed(2)}.`,
  };
}

/** The single selling-price rule (see the module comment). */
export function resolveSellingPrice(input: ResolvePriceInput): ResolvedPrice {
  const cost = Number(input.purchaseCost);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Purchase cost cannot be negative');

  if (input.pricingMode === 'FIXED') {
    if (!present(input.fixedSellingPrice) || !(Number(input.fixedSellingPrice) > 0)) {
      throw new Error('A fixed selling price above 0 is required');
    }
    const price = round2(Number(input.fixedSellingPrice));
    return {
      pricingMode: 'FIXED',
      pricingSource: 'FIXED',
      purchaseCost: cost,
      sellingPrice: price,
      effectiveMarkupPercent: impliedMarkupPercent(cost, price),
      warning: belowCostWarning(cost, price),
    };
  }

  let markup: number;
  let source: PricingSource;
  if (present(input.productMarkupPercent)) {
    markup = Number(input.productMarkupPercent);
    source = 'PRODUCT_MARKUP';
  } else if (present(input.categoryMarkupPercent)) {
    markup = Number(input.categoryMarkupPercent);
    source = 'CATEGORY_MARKUP';
  } else if (present(input.parentCategoryMarkupPercent)) {
    markup = Number(input.parentCategoryMarkupPercent);
    source = 'PARENT_CATEGORY_MARKUP';
  } else {
    markup = present(input.globalMarkupPercent) ? Number(input.globalMarkupPercent) : FALLBACK_DEFAULT_MARKUP_PERCENT;
    source = 'GLOBAL_MARKUP';
  }
  if (markup < 0) throw new Error('Markup percentage cannot be negative');

  return {
    pricingMode: 'MARKUP',
    pricingSource: source,
    purchaseCost: cost,
    sellingPrice: markupPrice(cost, markup),
    effectiveMarkupPercent: markup,
    warning: null,
  };
}

/**
 * order_items.markup_percentage_applied is NUMERIC(5,2) NOT NULL: the markup
 * to snapshot on an order line. A FIXED product's implied markup can be
 * negative, null (cost 0) or beyond 999.99 (a tiny cost), so it is clamped
 * into the column's range and null becomes 0. Reporting only; the charged
 * price is unit_selling_price.
 */
export function recordableMarkupPercent(markup: number | string | null | undefined): number {
  if (!present(markup)) return 0;
  const n = round2(Number(markup));
  return Math.min(MAX_MARKUP_PERCENT, Math.max(-MAX_MARKUP_PERCENT, n));
}

/** The global default markup from a system_configurations 'default_markup' value (20% when unusable). */
export function defaultMarkupFrom(value: unknown): number {
  if (value && typeof value === 'object') {
    const raw = (value as { markup_percent?: unknown }).markup_percent;
    if (present(raw) && Number(raw) >= 0) return Number(raw);
  }
  return FALLBACK_DEFAULT_MARKUP_PERCENT;
}

/**
 * Helper to determine effective markup percentage.
 * Uses customMarkupPercent if provided (and non-null/valid), otherwise defaults to defaultMarkupPercent (20%).
 */
export function getEffectiveMarkupPercent(
  customMarkupPercent?: number | null,
  defaultMarkupPercent: number = FALLBACK_DEFAULT_MARKUP_PERCENT
): number {
  if (
    customMarkupPercent !== undefined &&
    customMarkupPercent !== null &&
    !isNaN(Number(customMarkupPercent))
  ) {
    return Number(customMarkupPercent);
  }
  return defaultMarkupPercent;
}

/**
 * Markup-only price (product custom markup, else the given default). For
 * callers without a category in hand; it is resolveSellingPrice in MARKUP
 * mode with no category markups, so both always agree.
 */
export function calculateSellingPrice(params: PriceCalculationParams): CalculatedPriceResult {
  const { purchaseCost, customMarkupPercent, defaultMarkupPercent = FALLBACK_DEFAULT_MARKUP_PERCENT } = params;

  const cost = Number(purchaseCost);
  if (isNaN(cost) || cost < 0) {
    throw new Error('Purchase cost cannot be negative');
  }

  const effectiveMarkupPercent = getEffectiveMarkupPercent(customMarkupPercent, defaultMarkupPercent);

  if (effectiveMarkupPercent < 0) {
    throw new Error('Markup percentage cannot be negative');
  }

  return {
    purchaseCost: cost,
    effectiveMarkupPercent,
    sellingPrice: markupPrice(cost, effectiveMarkupPercent),
  };
}

pricingRouter.get('/status', (_req, res) => {
  res.json({ module: 'pricing', status: 'ready' });
});
