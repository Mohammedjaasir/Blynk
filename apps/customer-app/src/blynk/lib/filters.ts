import type { Product } from '../api/types';
import { effectivePrice, isOfferActive } from './pricing';

/** Filter chips that really filter the products on screen. */
export type FilterId = 'offer' | 'under300' | 'instock';
export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'offer', label: 'On offer' },
  { id: 'under300', label: 'Under LKR 300' },
  { id: 'instock', label: 'In stock' },
];

export function applyFilters(products: Product[], on: FilterId[], now: Date = new Date()): Product[] {
  if (!on.length) return products;
  return products.filter((p) =>
    (!on.includes('offer') || isOfferActive(p, now))
    && (!on.includes('under300') || effectivePrice(p, now) <= 300)
    && (!on.includes('instock') || p.is_available));
}

export const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
