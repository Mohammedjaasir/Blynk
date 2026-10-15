export type PricedItem = { selling_price: number; offer_price: number | null; offer_ends_at: string | null };

export function isOfferActive(p: PricedItem, now: Date = new Date()): boolean {
  if (p.offer_price == null || !(p.offer_price < p.selling_price)) return false;
  return p.offer_ends_at == null || new Date(p.offer_ends_at).getTime() > now.getTime();
}

export function effectivePrice(p: PricedItem, now: Date = new Date()): number {
  return isOfferActive(p, now) ? (p.offer_price as number) : p.selling_price;
}

export function savingsPerUnit(p: PricedItem, now: Date = new Date()): number {
  return Math.round((p.selling_price - effectivePrice(p, now)) * 100) / 100;
}

/*
 * MRP (migration 048; owner, 2026-10-14; docs/api/catalog-mrp.md). The server sends `mrp` only
 * when it is above the price the customer pays now (else null) and has already capped the
 * selling price at it; the guards below repeat that so an odd answer never shows a struck price
 * at or under what the customer pays.
 */
export type MrpPriced = PricedItem & { mrp?: number | null };

/** The struck reference beside the price: the MRP (labelled "MRP") or the regular price on an offer. */
export type StruckPrice = { amount: number; kind: 'mrp' | 'regular' };

export type PriceDisplay = {
  /** What the customer pays for one unit now (offer-aware). */
  price: number;
  /** The price is an offer price (shown in green). */
  offer: boolean;
  /** The struck reference, or null: nothing struck. */
  struck: StruckPrice | null;
};

const validMrp = (m: unknown): m is number => typeof m === 'number' && Number.isFinite(m) && m > 0;

/**
 * The one price-display rule for tiles, the product page, the size picker and cart lines:
 *   - MRP above the price, no offer   -> price, then "MRP LKR 300" struck
 *   - price == MRP (or no MRP)         -> price only
 *   - offer, MRP at/above the selling  -> offer price, then "MRP LKR 300" struck
 *   - offer, no MRP                    -> offer price, then the regular price struck (as before)
 * `showStruck` is Admin's show_offer_savings: off = no struck price at all (the MRP follows the
 * same switch as the struck offer price).
 */
export function priceDisplay(p: MrpPriced, opts: { showStruck: boolean; now?: Date }): PriceDisplay {
  const now = opts.now ?? new Date();
  const offer = isOfferActive(p, now);
  const price = effectivePrice(p, now);
  if (!opts.showStruck) return { price, offer, struck: null };
  const mrp = validMrp(p.mrp) && p.mrp > price ? p.mrp : null;
  if (offer) {
    // the MRP is the reference when it is at least the regular price; else the regular price
    if (mrp !== null && mrp >= p.selling_price) return { price, offer, struck: { amount: mrp, kind: 'mrp' } };
    return { price, offer, struck: { amount: p.selling_price, kind: 'regular' } };
  }
  return { price, offer, struck: mrp !== null ? { amount: mrp, kind: 'mrp' } : null };
}

/** The struck reference's label: "MRP LKR 300" or "LKR 280" (money formats the amount). */
export const struckLabel = (s: StruckPrice, money: (n: number) => string): { prefix: string | null; amount: string } =>
  ({ prefix: s.kind === 'mrp' ? 'MRP' : null, amount: money(s.amount) });

/**
 * A product tile's struck reference: a sized tile's MRP is its cheapest size's, so it is not
 * struck beside a full range ("LKR 50 – 350"); there the regular price stays the reference on an
 * offer (as before the MRP), else nothing is struck.
 */
export function sizedStruck(shown: PriceDisplay, fullRange: boolean, regular: number): StruckPrice | null {
  if (!shown.struck || !fullRange || shown.struck.kind !== 'mrp') return shown.struck;
  return shown.offer ? { amount: regular, kind: 'regular' } : null;
}
