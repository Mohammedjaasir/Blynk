import type { Product } from '../api/types';

/*
 * Multi-category products (migration 060, owner 2026-10-25). A product has ONE main category
 * (`category_id`: its offers, hours and the name on its card follow that) plus up to 5 extra ones
 * (`extra_category_ids`, absent on an older server) that only decide where it is LISTED.
 * "In a category" therefore means: the main OR an extra category is that category or one of its
 * sub-categories (`chainOf` is the ancestor chain, nearest first). Pure functions, no React.
 */

type Chain = (categoryId: string) => string[];
type Listed = Pick<Product, 'category_id'> & { extra_category_ids?: string[] | null };

/** Whether the product is listed in `categoryId` (a category counts its sub-categories' products). */
export function inCategory(p: Listed, chainOf: Chain, categoryId: string): boolean {
  if (chainOf(p.category_id).includes(categoryId)) return true;
  const extra = p.extra_category_ids;
  return Array.isArray(extra) && extra.some((id) => chainOf(id).includes(categoryId));
}

/** Whether the product is listed in `categoryId` through its MAIN category. */
export function isMainIn(p: Pick<Product, 'category_id'>, chainOf: Chain, categoryId: string): boolean {
  return chainOf(p.category_id).includes(categoryId);
}

/**
 * The products listed in a category, each once, in the given order with those that are listed
 * there only through an extra category after the main ones (the API's own order, see
 * catalog.repository.ts: Arrange orders the main members).
 */
export function productsInCategory<T extends Listed>(products: T[], chainOf: Chain, categoryId: string): T[] {
  const main: T[] = [];
  const extra: T[] = [];
  for (const p of products) {
    if (isMainIn(p, chainOf, categoryId)) main.push(p);
    else if (inCategory(p, chainOf, categoryId)) extra.push(p);
  }
  return extra.length ? [...main, ...extra] : main;
}

/** Products per category id (a category counts its sub-categories; a product counts once per category). */
export function categoryCounts(products: Listed[], chainOf: Chain): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of products) {
    const ids = new Set(chainOf(p.category_id));
    for (const extra of p.extra_category_ids ?? []) for (const id of chainOf(extra)) ids.add(id);
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}
