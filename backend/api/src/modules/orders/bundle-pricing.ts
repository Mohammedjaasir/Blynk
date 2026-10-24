import type { BundleOffer, BuyGetOffer, SpendGiftOffer } from '../configuration/bundle-offers.js';

/**
 * Bundle offers, the pricing rules (owner, 2026-10-25). Pure functions: priceCart (order.service)
 * feeds them the cart's lines AFTER product / category offers, and the cart quote, the coupon preview
 * and createOrder all call priceCart, so they cannot disagree.
 *
 * The rules, in the order the staff list the offers:
 *   1. BUY_X_GET_Y, each offer in turn. The cart's matching units (minus the units an EARLIER offer
 *      already made free - a unit is never free twice) are counted: N units make
 *      floor(N / (buy_qty + get_qty)) groups, and get_qty x groups of them are free. The free ones are
 *      the CHEAPEST matching units (ties: the earlier cart line), so the customer never gets more free
 *      than they bought. Free units are split off their line (a separate line at price 0).
 *   2. SPEND_GET_GIFT, each offer in turn: when the subtotal after step 1 (before delivery, coupons,
 *      points and wallet) reaches min_subtotal and the gift is orderable and in stock, gift_qty of the
 *      gift are added at price 0 - once per order per offer.
 */

export interface BundleLine {
  /** Index of the cart line (priceCart's items order); combo items are not passed in. */
  index: number;
  product_id: string;
  category_id: string;
  parent_category_id: string | null;
  name: string;
  /** Price per unit AFTER product / category offers. */
  unit_price: number;
  quantity: number;
}

/** What priceCart found out about a SPEND_GET_GIFT offer's gift (keyed by offer id). */
export interface GiftInfo {
  product_id: string;
  name: string;
  /** The regular unit price (the value of one gift). */
  unit_price: number;
  /** Orderable now (on sale, in its hours, no variants) AND enough in stock for gift_qty on top of the cart. */
  available: boolean;
}

export interface FreeUnits {
  offer: BuyGetOffer;
  line_index: number;
  quantity: number;
  /** What these units would have cost. */
  value: number;
}

export interface GiftGiven {
  offer: SpendGiftOffer;
  gift: GiftInfo;
  quantity: number;
  value: number;
}

export interface BundleApplied {
  offer_id: string;
  title: string;
  type: BundleOffer['type'];
  savings_lkr: number;
  free_units?: number;
  gift?: { product_id: string; name: string; quantity: number; value_lkr: number };
}

export interface BundleProgress {
  offer_id: string;
  title: string;
  type: BundleOffer['type'];
  remaining_units?: number;
  remaining_lkr?: number;
  buy_qty?: number;
  get_qty?: number;
  product_ids?: string[] | null;
  category_id?: string | null;
  gift_product_id?: string;
  gift_product_name?: string;
  gift_qty?: number;
}

export interface BundleOutcome {
  free: FreeUnits[];
  gifts: GiftGiven[];
  applied: BundleApplied[];
  /** Total value of the free units and the gifts. */
  savings: number;
  /** The nearest offer still to unlock, or null. */
  progress: BundleProgress | null;
}

const round2 = (n: number) => Number(n.toFixed(2));

/** Does the line's product match a BUY_X_GET_Y offer (its products, or its category / a sub-category of it)? */
export function matchesOffer(offer: BuyGetOffer, line: Pick<BundleLine, 'product_id' | 'category_id' | 'parent_category_id'>): boolean {
  if (offer.product_ids) return offer.product_ids.includes(line.product_id);
  return offer.category_id !== null && (line.category_id === offer.category_id || line.parent_category_id === offer.category_id);
}

/** The matching free quantity for `units` matching units: get_qty per full group of buy_qty + get_qty. */
export function freeUnitsFor(units: number, offer: Pick<BuyGetOffer, 'buy_qty' | 'get_qty'>): number {
  return Math.floor(units / (offer.buy_qty + offer.get_qty)) * offer.get_qty;
}

export function computeBundles(
  lines: readonly BundleLine[],
  subtotalBefore: number,
  offers: readonly BundleOffer[],
  gifts: ReadonlyMap<string, GiftInfo>
): BundleOutcome {
  const left = new Map(lines.map((l) => [l.index, l.quantity]));
  const free: FreeUnits[] = [];
  const applied: BundleApplied[] = [];
  const candidates: Array<{ offer: BundleOffer; closeness: number; progress: BundleProgress; order: number }> = [];
  let subtotal = subtotalBefore;
  let savings = 0;

  offers.forEach((offer, order) => {
    if (offer.type !== 'BUY_X_GET_Y') return;
    const matching = lines.filter((l) => matchesOffer(offer, l));
    const units: Array<{ index: number; price: number }> = [];
    for (const l of matching) for (let i = 0; i < (left.get(l.index) ?? 0); i++) units.push({ index: l.index, price: l.unit_price });
    const size = offer.buy_qty + offer.get_qty;
    const count = freeUnitsFor(units.length, offer);
    if (count > 0) {
      // The cheapest units first; the earlier cart line wins a tie, so the result is deterministic.
      units.sort((a, b) => a.price - b.price || a.index - b.index);
      const byLine = new Map<number, { quantity: number; value: number }>();
      for (const u of units.slice(0, count)) {
        const prev = byLine.get(u.index) ?? { quantity: 0, value: 0 };
        byLine.set(u.index, { quantity: prev.quantity + 1, value: round2(prev.value + u.price) });
      }
      let offerSavings = 0;
      let offerUnits = 0;
      for (const [index, f] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
        free.push({ offer, line_index: index, quantity: f.quantity, value: f.value });
        left.set(index, (left.get(index) ?? 0) - f.quantity);
        offerSavings = round2(offerSavings + f.value);
        offerUnits += f.quantity;
      }
      subtotal = round2(subtotal - offerSavings);
      savings = round2(savings + offerSavings);
      applied.push({ offer_id: offer.id, title: offer.title, type: offer.type, savings_lkr: offerSavings, free_units: offerUnits });
    }
    // Progress: some matching units, but not a whole group yet (a full group is unlocked already).
    const rest = units.length % size;
    if (units.length > 0 && rest !== 0) {
      candidates.push({
        offer,
        order,
        closeness: (size - rest) / size,
        progress: {
          offer_id: offer.id,
          title: offer.title,
          type: offer.type,
          remaining_units: size - rest,
          buy_qty: offer.buy_qty,
          get_qty: offer.get_qty,
          product_ids: offer.product_ids,
          category_id: offer.category_id,
        },
      });
    }
  });

  const given: GiftGiven[] = [];
  offers.forEach((offer, order) => {
    if (offer.type !== 'SPEND_GET_GIFT') return;
    const gift = gifts.get(offer.id);
    if (!gift || !gift.available) return;
    if (subtotal >= offer.min_subtotal) {
      const value = round2(gift.unit_price * offer.gift_qty);
      given.push({ offer, gift, quantity: offer.gift_qty, value });
      savings = round2(savings + value);
      applied.push({
        offer_id: offer.id,
        title: offer.title,
        type: offer.type,
        savings_lkr: value,
        gift: { product_id: gift.product_id, name: gift.name, quantity: offer.gift_qty, value_lkr: value },
      });
    } else if (subtotal > 0) {
      candidates.push({
        offer,
        order,
        closeness: (offer.min_subtotal - subtotal) / offer.min_subtotal,
        progress: {
          offer_id: offer.id,
          title: offer.title,
          type: offer.type,
          remaining_lkr: round2(offer.min_subtotal - subtotal),
          gift_product_id: gift.product_id,
          gift_product_name: gift.name,
          gift_qty: offer.gift_qty,
        },
      });
    }
  });

  candidates.sort((a, b) => a.closeness - b.closeness || a.order - b.order);
  return { free, gifts: given, applied, savings, progress: candidates[0]?.progress ?? null };
}

/**
 * RESOLVE_ITEM recompute: how many free units an offer still earns once some paid units were removed.
 * `paidUnits` = the matching, not removed, paid units left; `freeUnits` = what was free before.
 * Never more than before, and never more than the remaining paid units earn on their own
 * (floor(paid / buy_qty) x get_qty).
 */
export function freeUnitsAfterRemoval(paidUnits: number, freeUnits: number, rule: Pick<BuyGetOffer, 'buy_qty' | 'get_qty'>): number {
  return Math.max(0, Math.min(freeUnits, Math.floor(paidUnits / rule.buy_qty) * rule.get_qty));
}
