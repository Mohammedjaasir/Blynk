import type { Category, SellerProduct } from '../api/types';

export type ChipTone = 'ok' | 'wait' | 'bad' | 'off';

export interface ProductState {
  /** The main chip: Live / Waiting for approval / Not approved / Off. */
  chip: { label: string; tone: ChipTone };
  /** An extra chip when a live product has a change waiting. */
  extra: { label: string; tone: ChipTone } | null;
}

/** A product that exists only as a submission has an id like `submission:<uuid>`. */
export function isSubmissionOnly(product: SellerProduct): boolean {
  return product.id.startsWith('submission:');
}

/** Whether the seller can pause / resume this product: a real, live product Blynk has switched on. */
export function canPause(product: SellerProduct): boolean {
  return !isSubmissionOnly(product) && product.live && product.is_active;
}

/**
 * What a seller sees for one product:
 *  - not live yet: Waiting for approval (a NEW submission waits), Not approved (rejected), else Off;
 *  - live and on: Live (plus "Change waiting for approval" while an edit waits);
 *  - live but paused by the seller: Paused;
 *  - live but switched off by Blynk: Off.
 */
export function productState(product: SellerProduct): ProductState {
  if (!product.live) {
    if (product.pending) return { chip: { label: 'Waiting for approval', tone: 'wait' }, extra: null };
    if (product.last_rejected) return { chip: { label: 'Not approved', tone: 'bad' }, extra: null };
    return { chip: { label: 'Off', tone: 'off' }, extra: null };
  }
  // Live but paused by the seller (is_available false): customers see it as unavailable.
  const chip: ProductState['chip'] = !product.is_active
    ? { label: 'Off', tone: 'off' }
    : product.is_available === false
      ? { label: 'Paused', tone: 'off' }
      : { label: 'Live', tone: 'ok' };
  return {
    chip,
    extra: product.pending ? { label: 'Change waiting for approval', tone: 'wait' } : null,
  };
}

export interface CategoryGroup {
  main: Category;
  /** Sub-categories; empty when the main category has none (then the main itself is the choice). */
  children: Category[];
}

/** Main categories with their sub-categories underneath, A-Z. */
export function groupCategories(categories: Category[]): CategoryGroup[] {
  const byName = (a: Category, b: Category) => a.name.localeCompare(b.name);
  const ids = new Set(categories.map((c) => c.id));
  // A category whose parent is missing from the list is treated as a main one.
  const mains = categories.filter((c) => !c.parent_id || !ids.has(c.parent_id)).sort(byName);
  return mains.map((main) => ({
    main,
    children: categories.filter((c) => c.parent_id === main.id).sort(byName),
  }));
}
