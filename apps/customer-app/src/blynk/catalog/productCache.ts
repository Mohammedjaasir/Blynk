import type { Product } from '@/blynk/api/types';

/*
 * The listing copy the customer tapped, so the product page renders at once and then refreshes
 * (the Flutter '/product' route's initialProduct). Kept small: the last few taps only.
 */
const recent = new Map<string, Product>();
const MAX = 20;

export function rememberProduct(p: Product) {
  recent.delete(p.id);
  recent.set(p.id, p);
  if (recent.size > MAX) recent.delete(recent.keys().next().value as string);
}

export const recallProduct = (id: string): Product | null => recent.get(id) ?? null;
