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

/** The customer-facing pair: both null unless the offer is active. */
export function publicOffer(product: OfferFields, sellingPrice: number, now: Date = new Date()) {
  const offer = activeOfferPrice(product, sellingPrice, now);
  if (offer === null) return { offer_price: null, offer_ends_at: null };
  return {
    offer_price: offer,
    offer_ends_at: product.offer_ends_at ? new Date(product.offer_ends_at).toISOString() : null,
  };
}

/** SQL twin of activeOfferPrice for v_product_catalog (GET /products?on_offer=true). */
export function activeOfferWhere(eb: ExpressionBuilder<Database, 'v_product_catalog'>) {
  return eb.and([
    eb('offer_price', 'is not', null),
    eb.or([eb('offer_ends_at', 'is', null), eb('offer_ends_at', '>', sql<Date>`now()`)]),
    eb(sql`offer_price`, '<', sql`calculated_selling_price`),
  ]);
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
