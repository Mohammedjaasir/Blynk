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
