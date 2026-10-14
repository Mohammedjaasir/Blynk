import type { Category } from '../api/types';

/**
 * Category pickers (owner, 2026-10-14: "we must be able to select sidebar
 * (sub categories as well)"). Categories have one level of children: a
 * top-level Category (a tile) and its Sub-categories (the sidebar inside it).
 * A flat list of names made "Rice" under two parents indistinguishable, so
 * every picker lists each Category followed by its Sub-categories, labelled
 * "Category › Sub-category".
 */
export interface CategoryOption {
  category: Category;
  parent: Category | null;
  /** "Rice & Flour" or "Rice & Flour › Rice". */
  label: string;
}

export const SUB_CATEGORY_SEPARATOR = ' › ';

/** The Arrange rule: display_order, then name. */
export function byDisplayOrder(a: Pick<Category, 'display_order' | 'name'>, b: Pick<Category, 'display_order' | 'name'>) {
  const order = (a.display_order ?? 0) - (b.display_order ?? 0);
  return order !== 0 ? order : a.name.localeCompare(b.name);
}

/**
 * Top-level categories (display_order, name), each followed by its
 * sub-categories in the same order. A child whose parent is not in the list
 * is shown as top level.
 */
export function categoryOptions(rows: ReadonlyArray<Category>): CategoryOption[] {
  const byId = new Map(rows.map((c) => [c.id, c]));
  const sorted = [...rows].sort(byDisplayOrder);
  const out: CategoryOption[] = [];
  for (const category of sorted) {
    if (category.parent_id && byId.has(category.parent_id)) continue;
    out.push({ category, parent: null, label: category.name });
    for (const child of sorted) {
      if (child.parent_id === category.id) {
        out.push({ category: child, parent: category, label: `${category.name}${SUB_CATEGORY_SEPARATOR}${child.name}` });
      }
    }
  }
  return out;
}
