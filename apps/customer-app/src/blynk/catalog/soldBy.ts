import type { Product } from '@/blynk/api/types';

/**
 * The quiet "Sold by <shop>" line (seller portal, 2026-10-24). The API sends `sold_by` (the seller's
 * shop name) only for an approved seller's product; Blynk's own products and an older server send
 * nothing, and then no line shows.
 */
export function soldByText(p: Pick<Product, 'sold_by'>): string | null {
  const shop = typeof p.sold_by === 'string' ? p.sold_by.trim() : '';
  return shop ? `Sold by ${shop}` : null;
}
