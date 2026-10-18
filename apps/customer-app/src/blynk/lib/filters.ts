import type { Product } from '../api/types';
import { effectivePrice, isOfferActive } from './pricing';

/** Filter chips that really filter the products on screen. */
export type FilterId = 'offer' | 'under300' | 'instock';
/** The chips; "Under LKR n" follows Admin / Ops' amount (app_texts.home_under_amount, default 300). */
export const filterChips = (under = 300): { id: FilterId; label: string }[] => [
  { id: 'offer', label: 'On offer' },
  { id: 'under300', label: `Under LKR ${under.toLocaleString('en-US')}` },
  { id: 'instock', label: 'In stock' },
];
export const FILTERS = filterChips();

export function applyFilters(products: Product[], on: FilterId[], now: Date = new Date(), under = 300): Product[] {
  if (!on.length) return products;
  return products.filter((p) =>
    (!on.includes('offer') || isOfferActive(p, now))
    && (!on.includes('under300') || effectivePrice(p, now) <= under)
    && (!on.includes('instock') || p.is_available));
}

export const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
