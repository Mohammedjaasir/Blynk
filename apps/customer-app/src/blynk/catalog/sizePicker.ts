import type { Product } from '@/blynk/api/types';

/*
 * The size picker (bottom sheet) for a product with variants: tapping "+" on such a product
 * opens it instead of adding (migration 045). One app-wide sheet (SizePickerHost in the root
 * layout) reads this tiny store. Also keeps the last product page / picker answer per product
 * (with its variants) so the sheet opens with sizes at once and then refreshes.
 */

let open: Product | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSizePicker(p: Product) { open = p; emit(); }
export function closeSizePicker() { if (open) { open = null; emit(); } }
export const sizePickerProduct = () => open;
export function subscribeSizePicker(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const details = new Map<string, Product>();
const MAX = 30;

/** A GET /catalog/products/:id answer with its variants. */
export function rememberDetail(p: Product) {
  if (!Array.isArray(p.variants)) return;
  details.delete(p.id);
  details.set(p.id, p);
  if (details.size > MAX) details.delete(details.keys().next().value as string);
}
export const recallDetail = (id: string): Product | null => details.get(id) ?? null;
