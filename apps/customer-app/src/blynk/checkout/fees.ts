import type { StoreInfo } from '@/blynk/api/types';
import { formatLkr } from '@/blynk/lib/money';
import type { CheckoutInfo } from '@/blynk/orders/types';
import { FEE_WORDS as W } from './feeWords';

/*
 * The delivery-fee explanation and the small-order fee (contract:
 * docs/superpowers/plans/2026-10-25-fees.md). No React in here.
 *
 * The small-order fee is charged when the item total (after offers and bundle prices, before
 * coupons and points) is UNDER the minimum. Free delivery does not waive it. It follows the same
 * refresh as the delivery fee: the checkout quote (GET /orders/checkout-info?subtotal=) once an
 * address is chosen, GET /store before that. The amount is worked out from this basket (the quote
 * may lag a quantity change by a moment) and the server prices the order again when it is placed.
 */

const round2 = (x: number) => Math.round(x * 100) / 100;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface SmallOrderFeeRule { enabled: boolean; min_subtotal_lkr: number; fee_lkr: number }

export interface SmallFee {
  /** The switch is on (and the rule is usable). */
  enabled: boolean;
  min: number;
  fee: number;
  /** The fee is charged on this basket. */
  applies: boolean;
  /** LKR added to the bill (0 when it does not apply). */
  charged: number;
  /** LKR still to add to avoid it; null when it is off or already avoided. */
  remaining: number | null;
}

export const NO_SMALL_FEE: SmallFee = { enabled: false, min: 0, fee: 0, applies: false, charged: 0, remaining: null };

/** The rule to use: the checkout quote's when it has one (an address is chosen), else the store's. */
export function smallFeeRule(store: StoreInfo | null | undefined, quote?: CheckoutInfo | null): SmallOrderFeeRule | null {
  return quote?.small_order_fee ?? store?.small_order_fee ?? null;
}

/** What the small-order fee does to a basket whose items total `itemTotal` (as charged, after bundles). */
export function smallFeeFor(rule: SmallOrderFeeRule | null | undefined, itemTotal: number): SmallFee {
  if (!rule || rule.enabled !== true || !finite(rule.min_subtotal_lkr) || !finite(rule.fee_lkr) || rule.min_subtotal_lkr <= 0 || rule.fee_lkr <= 0) return NO_SMALL_FEE;
  const min = rule.min_subtotal_lkr;
  const fee = round2(rule.fee_lkr);
  const applies = itemTotal > 0 && round2(itemTotal) < min;
  return { enabled: true, min, fee, applies, charged: applies ? fee : 0, remaining: applies ? round2(min - itemTotal) : null };
}

/** "Add LKR 150 more to avoid the small-order fee." while the fee applies and something is still to add; else null. */
export function smallFeeNote(s: SmallFee): string | null {
  return s.applies && s.remaining !== null && s.remaining > 0 ? W.addMore(formatLkr(s.remaining)) : null;
}

const kmText = (km: number) => `${Math.round(km * 10) / 10}`;

/**
 * "LKR 120 up to 2 km, then LKR 40 for each extra km" (plus "Never more than LKR 300." when a cap is
 * set), from GET /store `delivery_fee_formula`; null for a flat or tiered fee or an older server.
 */
export function deliveryFormulaText(store: StoreInfo | null | undefined): string | null {
  const f = store?.delivery_fee_formula;
  if (!f || !finite(f.base_lkr) || !finite(f.base_km) || !finite(f.per_km_lkr)) return null;
  const line = W.formula(formatLkr(f.base_lkr), kmText(f.base_km), formatLkr(f.per_km_lkr));
  return finite(f.max_fee_lkr) && f.max_fee_lkr > 0 ? `${line}. ${W.formulaCap(formatLkr(f.max_fee_lkr))}` : line;
}
