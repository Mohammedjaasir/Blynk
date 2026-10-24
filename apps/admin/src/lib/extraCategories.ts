import type { Category } from '../api/types';
import { categoryOptions } from './categoryTree';

/**
 * "Also show in" on the product form (migration 060, owner 2026-10-25): a product has ONE main
 * category (offers, hours, markup and sellers' commission follow it) and up to 5 extra ones that
 * only decide where customers find it. Pure helpers for the picker; the API re-checks everything.
 */
export const MAX_EXTRA_CATEGORIES = 5;

/** The categories can be picked once the API reports migration 060 (extra_product_count is a number, not null/absent). */
export function extraCategoriesReady(categories: ReadonlyArray<Category>): boolean {
  return categories.length > 0 && categories.every((c) => typeof c.extra_product_count === 'number');
}

/** Categories the picker may add: active, not the main one, not already chosen; each with its path ("Rice & Flour › Rice"). */
export function extraCategoryChoices(
  categories: ReadonlyArray<Category>,
  primaryId: string,
  chosen: ReadonlyArray<string>
): Array<{ id: string; label: string }> {
  return categoryOptions(categories)
    .filter(({ category }) => category.is_active && category.id !== primaryId && !chosen.includes(category.id))
    .map(({ category, label }) => ({ id: category.id, label }));
}

/** The chosen ids with their paths, in the order chosen; an unknown id (a deleted category) keeps its id as the label. */
export function extraCategoryLabels(categories: ReadonlyArray<Category>, chosen: ReadonlyArray<string>) {
  const labels = new Map(categoryOptions(categories).map(({ category, label }) => [category.id, label]));
  return chosen.map((id) => ({ id, label: labels.get(id) ?? id }));
}

/** The set after the main category changed: the new main category cannot also be an extra one. */
export function withoutPrimary(chosen: ReadonlyArray<string>, primaryId: string): string[] {
  return chosen.filter((id) => id !== primaryId);
}

/** Whether two sets hold the same categories (order does not matter). */
export function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
