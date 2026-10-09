import { sql, type ExpressionBuilder } from 'kysely';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { db } from '../../database/connection.js';
import { calculateSellingPrice } from '../pricing/index.js';

/**
 * Product offers (migration 031; owner, 2026-10-09): a product on offer at a
 * reduced price, e.g. Rice LKR 250 -> LKR 220, optionally until a date.
 *
 * An offer is ACTIVE while
 *   offer_price IS NOT NULL
 *   AND (offer_ends_at IS NULL OR offer_ends_at > now())
 *   AND offer_price < the selling price.
 * The last condition matters when the default markup or the cost drops below
 * the offer after it was set: the customer then simply pays the (lower)
 * regular price, never more. The same rule decides what the catalog shows
 * (catalog.service), the on_offer filter (catalog.repository) and what an
 * order charges (order.service priceCart).
 *
 * Migration 033 adds category offers; bestOffer() below picks the lower of a
 * product's own offer and its category's, and is what every reader uses.
 */
export interface OfferFields {
  offer_price: number | string | null;
  offer_ends_at: Date | string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The offer price to charge right now, or null when there is no active offer. */
export function activeOfferPrice(product: OfferFields, sellingPrice: number, now: Date = new Date()): number | null {
  if (product.offer_price === null || product.offer_price === undefined) return null;
  const offer = round2(Number(product.offer_price));
  if (!Number.isFinite(offer) || offer <= 0) return null;
  if (product.offer_ends_at !== null && product.offer_ends_at !== undefined) {
    const ends = new Date(product.offer_ends_at).getTime();
    if (!Number.isFinite(ends) || ends <= now.getTime()) return null;
  }
  return offer < sellingPrice ? offer : null;
}

/**
 * Category offers (migration 033; owner, 2026-10-09): a % off everything in a
 * category and its sub-categories, optionally until a date. v_product_catalog
 * carries the best ACTIVE one of the product's own category and its parent
 * (category_offer_percent / category_offer_ends_at); the end date is checked
 * again here so a value read a moment before it ended never applies.
 */
export interface CategoryOfferFields {
  category_offer_percent?: number | string | null;
  category_offer_ends_at?: Date | string | null;
}

/** The category price right now (selling x (1 - percent)), or null when none applies. */
export function categoryOfferPrice(product: CategoryOfferFields, sellingPrice: number, now: Date = new Date()): number | null {
  const raw = product.category_offer_percent;
  if (raw === null || raw === undefined) return null;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
  if (product.category_offer_ends_at !== null && product.category_offer_ends_at !== undefined) {
    const ends = new Date(product.category_offer_ends_at).getTime();
    if (!Number.isFinite(ends) || ends <= now.getTime()) return null;
  }
  const price = round2(sellingPrice * (1 - percent / 100));
  return price > 0 && price < sellingPrice ? price : null;
}

export interface BestOffer {
  price: number;
  ends_at: string | null;
  /** Which offer won: the product's own price (031) or its category's % (033). */
  kind: 'PRODUCT' | 'CATEGORY';
}

/**
 * The single rule (owner, 2026-10-09): when a product has its own offer AND
 * its category is on offer, the customer pays the LOWER of the two (a tie
 * goes to the product's own offer). Null when neither applies.
 */
export function bestOffer(product: OfferFields & CategoryOfferFields, sellingPrice: number, now: Date = new Date()): BestOffer | null {
  const own = activeOfferPrice(product, sellingPrice, now);
  const category = categoryOfferPrice(product, sellingPrice, now);
  if (own !== null && (category === null || own <= category)) {
    return { price: own, ends_at: product.offer_ends_at ? new Date(product.offer_ends_at).toISOString() : null, kind: 'PRODUCT' };
  }
  if (category === null) return null;
  return {
    price: category,
    ends_at: product.category_offer_ends_at ? new Date(product.category_offer_ends_at).toISOString() : null,
    kind: 'CATEGORY',
  };
}

/** What a product costs right now: the best active offer, else the selling price. */
export function effectivePrice(product: OfferFields & CategoryOfferFields, sellingPrice: number, now: Date = new Date()): number {
  return bestOffer(product, sellingPrice, now)?.price ?? sellingPrice;
}

/**
 * The customer-facing fields: all null unless an offer is active. A category
 * offer comes through the same offer_price / offer_ends_at, so the app shows
 * it like a product offer; offer_kind says which one won.
 */
export function publicOffer(product: OfferFields & CategoryOfferFields, sellingPrice: number, now: Date = new Date()) {
  const best = bestOffer(product, sellingPrice, now);
  if (best === null) return { offer_price: null, offer_ends_at: null, offer_kind: null };
  return { offer_price: best.price, offer_ends_at: best.ends_at, offer_kind: best.kind };
}

/**
 * SQL twin of bestOffer for v_product_catalog (GET /products?on_offer=true):
 * an active product offer, or an active category offer (the view lists only
 * running ones) that takes at least a cent off.
 */
export function activeOfferWhere(eb: ExpressionBuilder<Database, 'v_product_catalog'>) {
  return eb.or([
    eb.and([
      eb('offer_price', 'is not', null),
      eb.or([eb('offer_ends_at', 'is', null), eb('offer_ends_at', '>', sql<Date>`now()`)]),
      eb(sql`offer_price`, '<', sql`calculated_selling_price`),
    ]),
    eb.and([
      eb('category_offer_percent', 'is not', null),
      eb(sql`round(calculated_selling_price * (1 - category_offer_percent / 100.0), 2)`, '<', sql`calculated_selling_price`),
    ]),
  ]);
}

/**
 * Admin/Operations category offer checks (migration 033): strictly between 0
 * and 100 percent (the schema also says so), and a changed end date in the
 * future.
 */
export function assertCategoryOfferAllowed(args: { percent: number; endsAt: string | null; endsAtChanged: boolean; now?: Date }) {
  const { percent, endsAt, endsAtChanged, now = new Date() } = args;
  if (!(percent > 0 && percent < 100)) {
    throw new AppError('The category offer must be more than 0% and less than 100%.', 400, 'CATEGORY_OFFER_PERCENT_INVALID', {
      offer_percent: percent,
    });
  }
  if (endsAt !== null && endsAtChanged && new Date(endsAt).getTime() <= now.getTime()) {
    throw new AppError('The offer end date must be in the future.', 400, 'OFFER_END_IN_PAST', { offer_ends_at: endsAt });
  }
}

/**
 * Admin/Operations edit checks. `sellingPrice` is the product's price after
 * this edit; the offer must be strictly below it. A changed end date must be
 * in the future (an unchanged one may already have passed - the form sends
 * it back as it was).
 */
export function assertOfferAllowed(args: {
  offerPrice: number | null;
  sellingPrice: number;
  endsAt: string | null;
  endsAtChanged: boolean;
  now?: Date;
}) {
  const { offerPrice, sellingPrice, endsAt, endsAtChanged, now = new Date() } = args;
  if (offerPrice === null) return;
  if (!(offerPrice < sellingPrice)) {
    throw new AppError(
      `The offer price must be lower than the selling price (LKR ${sellingPrice.toFixed(2)}).`,
      400,
      'OFFER_PRICE_NOT_LOWER',
      { offer_price: offerPrice, selling_price: sellingPrice }
    );
  }
  if (endsAt !== null && endsAtChanged && new Date(endsAt).getTime() <= now.getTime()) {
    throw new AppError('The offer end date must be in the future.', 400, 'OFFER_END_IN_PAST', { offer_ends_at: endsAt });
  }
}

/**
 * The selling price a product will have with this cost and markup - the same
 * rule order placement uses (pricing calculateSellingPrice, default markup
 * from system_configurations.default_markup, 20% when missing).
 */
export async function sellingPriceFor(purchaseCost: number, customMarkupPercent: number | null): Promise<number> {
  const row = await db.selectFrom('system_configurations').select('value').where('key', '=', 'default_markup').executeTakeFirst();
  const configured = row && typeof row.value === 'object' && row.value !== null ? (row.value as { markup_percent?: unknown }).markup_percent : undefined;
  return calculateSellingPrice({
    purchaseCost,
    customMarkupPercent,
    defaultMarkupPercent: typeof configured === 'number' ? configured : 20.0,
  }).sellingPrice;
}

/**
 * A category's own offer for customers (migration 033): the percent and end
 * date while it runs, both null otherwise.
 */
export function activeCategoryOffer(
  category: { offer_percent: number | string | null; offer_ends_at: Date | string | null },
  now: Date = new Date()
): { offer_percent: number | null; offer_ends_at: string | null } {
  if (category.offer_percent === null || category.offer_percent === undefined) return { offer_percent: null, offer_ends_at: null };
  const percent = Number(category.offer_percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return { offer_percent: null, offer_ends_at: null };
  if (category.offer_ends_at) {
    const ends = new Date(category.offer_ends_at).getTime();
    if (!Number.isFinite(ends) || ends <= now.getTime()) return { offer_percent: null, offer_ends_at: null };
  }
  return { offer_percent: percent, offer_ends_at: category.offer_ends_at ? new Date(category.offer_ends_at).toISOString() : null };
}
