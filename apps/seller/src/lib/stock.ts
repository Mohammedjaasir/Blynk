import type { SellerProduct } from '../api/types';
import { isSubmissionOnly } from './products';

/** PUT /seller/products/:id/stock accepts 0 to 100000. */
export const STOCK_MAX = 100_000;
/** 1 to this many left shows the "Low" badge. */
export const LOW_STOCK = 5;

/** The products with a stock number to manage: real products that are live on Blynk. */
export function stockable(products: SellerProduct[]): SellerProduct[] {
  return products.filter((p) => !isSubmissionOnly(p) && p.live);
}

/** Products the seller sent that are still waiting for Blynk (or were not approved): no stock input yet. */
export function notStockable(products: SellerProduct[]): SellerProduct[] {
  return products.filter((p) => isSubmissionOnly(p) || !p.live);
}

export type StockBadge = { label: 'Out of stock' | 'Low'; tone: 'bad' | 'wait' } | null;

/** "Out of stock" at 0, "Low" for 1 to 5, nothing otherwise (or when there is no number). */
export function stockBadge(quantity: number | null | undefined): StockBadge {
  if (quantity === null || quantity === undefined || !Number.isFinite(Number(quantity))) return null;
  if (quantity <= 0) return { label: 'Out of stock', tone: 'bad' };
  if (quantity <= LOW_STOCK) return { label: 'Low', tone: 'wait' };
  return null;
}

/** What the seller typed as a whole number from 0 to STOCK_MAX; null when it is not one. */
export function parseStock(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const n = Number(text);
  return n <= STOCK_MAX ? n : null;
}

/** The box accepts digits only, at most six of them. */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

/** One more or one less, kept inside 0 to STOCK_MAX. A box that is empty or not a number counts as 0. */
export function stepStock(raw: string, by: number): string {
  const now = parseStock(raw) ?? 0;
  return String(Math.min(STOCK_MAX, Math.max(0, now + by)));
}

/** Whether the product's stock is counted by Blynk's system (the API says; an older API says nothing = yes). */
export function isTracked(product: SellerProduct): boolean {
  return product.stock_tracked !== false;
}
