import type { Category, HomeGroup, Product } from '../api/types';
import { localized } from '../i18n/localized';
import { CATEGORIES } from '../ui/strings';
import { productsInCategory } from './membership';

/*
 * The owner's catalogue model (docs/api/catalog-tools.md, 2026-10-14):
 *
 *   Main          a category group (GET /catalog/home-groups)   a section on Home / the categories screen
 *   Category      a top-level category (parent_id null)         a tile in that section
 *   Sub-category  a child category (parent_id = the category)   the sidebar inside the category screen
 *
 * Pure functions over the API data, no React.
 */

/** The closing group's name when the app makes it ("More"): read when shown, so it follows the language. */
const MAIN_WORDS = localized(
  { more: 'More' } as const,
  { si: { more: 'තවත්' }, ta: { more: 'மேலும்' } },
  'catalog.MAIN_WORDS',
);

/** A Main whose name is looked up each time it is read (the app's own group names change with the language). */
const withName = (m: Omit<MainNode, 'name'>, name: () => string): MainNode =>
  Object.defineProperty({ ...m }, 'name', { get: name, enumerable: true, configurable: true }) as MainNode;

export interface CategoryNode {
  category: Category;
  /** Its sub-categories in display order (empty when it has none). */
  subs: Category[];
}

export interface MainNode {
  /** The group id, or null for the backend's closing "More" group (ungrouped categories). */
  id: string | null;
  /** Stable key for lists and scroll anchors. */
  key: string;
  name: string;
  categories: CategoryNode[];
}

/** The Arrange rule: display_order, then name. */
export function byDisplayOrder(a: Category, b: Category): number {
  return (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name);
}

/** A category's sub-categories (parent_id = its id), in display order. */
export function subCategoriesOf(categories: Category[], parentId: string): Category[] {
  return categories.filter((c) => c.parent_id === parentId).sort(byDisplayOrder);
}

/**
 * Mains in the backend's order, each with its Category tiles and their sub-categories.
 * - A tile is listed once (the first group that has it).
 * - Groups with no tiles are dropped (nothing to show under the heading).
 * - Top-level categories that no group lists (an older backend, or a moment between two
 *   reads) close the list in "More", so nothing a customer can buy is unreachable.
 * - The catch-all group as the only group is titled "Shop by category".
 */
export function buildCategoryTree(groups: HomeGroup[], categories: Category[]): MainNode[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const node = (c: Category): CategoryNode => ({ category: byId.get(c.id) ?? c, subs: subCategoriesOf(categories, c.id) });
  const mains: MainNode[] = [];
  groups.forEach((g, i) => {
    const tiles = g.categories.filter((c) => c.parent_id == null && !seen.has(c.id));
    tiles.forEach((c) => seen.add(c.id));
    if (tiles.length) mains.push({ id: g.id, key: g.id ?? `more-${i}`, name: g.name, categories: tiles.map(node) });
  });
  const rest = categories.filter((c) => c.parent_id == null && !seen.has(c.id)).sort(byDisplayOrder);
  if (rest.length) {
    const more = mains.find((m) => m.id === null);
    if (more) more.categories.push(...rest.map(node));
    else mains.push(withName({ id: null, key: 'more', categories: rest.map(node) }, () => MAIN_WORDS.more));
  }
  if (mains.length === 1 && mains[0].id === null) mains[0] = withName(mains[0], () => CATEGORIES.onlyGroupTitle);
  return mains;
}

/** What a category screen shows: the Category, its sidebar, and the row that is selected. */
export interface CategoryView {
  root: Category;
  subs: Category[];
  /** The selected sub-category; null is the "All" row (everything in the category). */
  selected: Category | null;
}

/**
 * Resolves a route's `slug` (a category's slug or id) and optional `sub`. A sub-category's own
 * slug opens its parent's screen with that sub-category selected (promotion SUB_CATEGORY
 * targets, shared links). An unknown `sub` falls back to "All". Null when the slug is unknown
 * (switched off, deleted).
 */
export function resolveCategory(categories: Category[], slug: string | undefined, sub?: string | null): CategoryView | null {
  if (!slug) return null;
  const hit = categories.find((c) => c.slug === slug) ?? categories.find((c) => c.id === slug);
  if (!hit) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  // the chain from the hit up to its top-level category (cycle-safe)
  const chain: Category[] = [hit];
  for (let cur = hit; cur.parent_id && byId.has(cur.parent_id) && chain.length < 10;) {
    const p = byId.get(cur.parent_id) as Category;
    if (chain.includes(p)) break;
    chain.push(p);
    cur = p;
  }
  const root = chain[chain.length - 1];
  const subs = subCategoriesOf(categories, root.id);
  if (chain.length > 1) return { root, subs, selected: chain[chain.length - 2] };
  const picked = sub ? subs.find((s) => s.slug === sub) ?? subs.find((s) => s.id === sub) ?? null : null;
  return { root, subs, selected: picked };
}

/** One row of the category screen's left rail. */
export interface RailRow {
  key: string;
  /** The category whose picture (or initial) the row shows. */
  art: Category;
  label: string;
  a11y: string;
  active: boolean;
  /** The route params the row opens: a top-level category's slug, plus a sub-category's slug or none. */
  slug: string;
  sub?: string;
}

export interface CategoryRail {
  /** "subs": "All" + the opened category's sub-categories. "siblings": the top-level categories beside it. */
  kind: 'subs' | 'siblings';
  rows: RailRow[];
}

/**
 * The category screen's left rail, always shown as in the Flutter shop (owner 2026-10-14:
 * "when we click a category it opens like a sidebar"):
 * - a category with sub-categories: "All" (the category itself), then each sub-category;
 * - a category without: the top-level categories beside it, the opened one selected. Those are
 *   the categories of the Home group (Main) that lists it; when that group holds only it, every
 *   top-level category in Home's order.
 * No rows for an unknown category (view null).
 */
export function categoryRail(tree: MainNode[], categories: Category[], view: CategoryView | null): CategoryRail {
  if (!view) return { kind: 'siblings', rows: [] };
  const { root, subs, selected } = view;
  if (subs.length) {
    return {
      kind: 'subs',
      rows: [
        { key: `all-${root.id}`, art: root, label: CATEGORIES.all, a11y: CATEGORIES.allIn(root.name), active: selected === null, slug: root.slug },
        ...subs.map((s) => ({ key: s.id, art: s, label: s.name, a11y: s.name, active: selected?.id === s.id, slug: root.slug, sub: s.slug })),
      ],
    };
  }
  const group = tree.find((m) => m.categories.some((n) => n.category.id === root.id));
  let siblings = group && group.categories.length > 1 ? group.categories.map((n) => n.category) : [];
  if (!siblings.length) {
    // every top-level category: Home's order first, then any the tree does not list
    const seen = new Set<string>();
    for (const c of tree.flatMap((m) => m.categories.map((n) => n.category))) if (!seen.has(c.id)) { seen.add(c.id); siblings.push(c); }
    for (const c of categories.filter((x) => x.parent_id == null).sort(byDisplayOrder)) if (!seen.has(c.id)) { seen.add(c.id); siblings.push(c); }
  }
  if (!siblings.some((c) => c.id === root.id)) siblings = [root, ...siblings];
  return {
    kind: 'siblings',
    rows: siblings.map((c) => ({ key: c.id, art: c, label: c.name, a11y: c.name, active: c.id === root.id, slug: c.slug })),
  };
}

/**
 * The products of the selected row (a category includes its sub-categories' products), in the
 * API's order with sold-out ones (is_available false, as the API reports) moved to the end.
 */
export function productsInView(products: Product[], chainOf: (id: string) => string[], view: CategoryView): Product[] {
  const target = view.selected?.id ?? view.root.id;
  const list = productsInCategory(products, chainOf, target);
  return [...list.filter((p) => p.is_available), ...list.filter((p) => !p.is_available)];
}

/** Route to a category screen (deep-linkable: /category/<slug>?sub=<sub-slug>). */
export function categoryHref(slug: string, sub?: string | null) {
  return { pathname: '/category/[slug]' as const, params: sub ? { slug, sub } : { slug } };
}

/** Route to the full categories screen, optionally opened at one Main. */
export function categoriesHref(group?: string | null) {
  return { pathname: '/categories' as const, params: group ? { group } : {} };
}
