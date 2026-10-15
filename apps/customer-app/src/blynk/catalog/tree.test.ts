import { describe, expect, it } from 'vitest';
import type { Category, HomeGroup, Product } from '../api/types';
import { ancestorsOf } from '../lib/categories';
import { milk } from '../test/fixtures';
import { buildCategoryTree, categoriesHref, categoryHref, categoryRail, productsInView, resolveCategory, subCategoriesOf, type CategoryRail } from './tree';

const cat = (id: string, name: string, display_order: number, parent_id: string | null = null): Category => ({
  id, name, slug: id, description: null, image_url: null, display_order, parent_id, offer_percent: null, offer_ends_at: null,
});

// Grocery: Rice & Flour (Rice, Flour), Oils.  Dairy: Milk.  Snacks is in no group.
const riceFlour = cat('rice-flour', 'Rice & Flour', 10);
const oils = cat('oils', 'Oils', 20);
const milkCat = cat('milk', 'Milk', 10);
const snacks = cat('snacks', 'Snacks', 30);
const flour = cat('flour', 'Flour', 20, 'rice-flour');
const rice = cat('rice', 'Rice', 10, 'rice-flour');
const basmati = cat('basmati', 'Basmati', 10, 'rice'); // a deeper level, cycle-safe resolution
const all = [riceFlour, oils, milkCat, snacks, flour, rice, basmati];
const groups: HomeGroup[] = [
  { id: 'g-grocery', name: 'Grocery', sort_order: 0, categories: [riceFlour, oils] },
  { id: 'g-dairy', name: 'Dairy', sort_order: 1, categories: [milkCat, riceFlour] },
  { id: 'g-empty', name: 'Empty', sort_order: 2, categories: [] },
];

describe('category tree (Main -> Category -> Sub-category)', () => {
  it('builds Mains in order with their tiles and sub-categories in display order', () => {
    const tree = buildCategoryTree(groups, all);
    expect(tree.map((m) => m.name)).toEqual(['Grocery', 'Dairy', 'More']);
    expect(tree[0].categories.map((n) => n.category.id)).toEqual(['rice-flour', 'oils']);
    expect(tree[0].categories[0].subs.map((s) => s.name)).toEqual(['Rice', 'Flour']);
    expect(tree[0].categories[1].subs).toEqual([]);
  });

  it('lists a tile once, drops empty groups, and closes with the ungrouped categories', () => {
    const tree = buildCategoryTree(groups, all);
    expect(tree[1].categories.map((n) => n.category.id)).toEqual(['milk']);
    expect(tree.find((m) => m.name === 'Empty')).toBeUndefined();
    expect(tree[2]).toMatchObject({ id: null, key: 'more' });
    expect(tree[2].categories.map((n) => n.category.id)).toEqual(['snacks']);
  });

  it('adds ungrouped categories to the backend\'s own "More" group', () => {
    const tree = buildCategoryTree([...groups, { id: null, name: 'More', sort_order: 99, categories: [] }], all);
    expect(tree.filter((m) => m.id === null)).toHaveLength(1);
    const withMore = buildCategoryTree([groups[0], { id: null, name: 'More', sort_order: 99, categories: [milkCat] }], all);
    expect(withMore[1].categories.map((n) => n.category.id)).toEqual(['milk', 'snacks']);
  });

  it('titles a lone catch-all group "Shop by category"', () => {
    const tree = buildCategoryTree([{ id: null, name: 'More', sort_order: 0, categories: [riceFlour, oils] }], all);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Shop by category');
    expect(tree[0].categories.map((n) => n.category.id)).toEqual(['rice-flour', 'oils', 'milk', 'snacks']);
  });

  it('ignores sub-categories listed in a group and works with no categories list', () => {
    const tree = buildCategoryTree([{ id: 'g', name: 'G', sort_order: 0, categories: [riceFlour, rice] }], [riceFlour]);
    expect(tree[0].categories.map((n) => n.category.id)).toEqual(['rice-flour']);
    expect(buildCategoryTree([], [])).toEqual([]);
  });

  it('sorts sub-categories by display order, then name', () => {
    const a = cat('a', 'Beta', 5, 'p');
    const b = cat('b', 'Alpha', 5, 'p');
    const c = cat('c', 'Zed', 1, 'p');
    expect(subCategoriesOf([a, b, c], 'p').map((x) => x.name)).toEqual(['Zed', 'Alpha', 'Beta']);
  });
});

describe('category screen resolution (sidebar)', () => {
  it('a Category opens with "All" selected and its sub-categories in the sidebar', () => {
    const v = resolveCategory(all, 'rice-flour');
    expect(v?.root.id).toBe('rice-flour');
    expect(v?.subs.map((s) => s.id)).toEqual(['rice', 'flour']);
    expect(v?.selected).toBeNull();
  });

  it('?sub= selects a sub-category; an unknown sub falls back to All', () => {
    expect(resolveCategory(all, 'rice-flour', 'flour')?.selected?.id).toBe('flour');
    expect(resolveCategory(all, 'rice-flour', 'nope')?.selected).toBeNull();
    expect(resolveCategory(all, 'oils', 'rice')?.selected).toBeNull(); // not a child of Oils
  });

  it("a sub-category's own slug opens its parent with it selected", () => {
    const v = resolveCategory(all, 'flour');
    expect(v?.root.id).toBe('rice-flour');
    expect(v?.selected?.id).toBe('flour');
    const deep = resolveCategory(all, 'basmati');
    expect(deep?.root.id).toBe('rice-flour');
    expect(deep?.selected?.id).toBe('rice');
  });

  it('accepts an id, and is null for an unknown or missing slug', () => {
    expect(resolveCategory(all, 'oils')?.root.name).toBe('Oils');
    expect(resolveCategory([{ ...oils, slug: 'cooking-oils' }], 'oils')?.root.slug).toBe('cooking-oils');
    expect(resolveCategory(all, 'gone')).toBeNull();
    expect(resolveCategory(all, undefined)).toBeNull();
  });

  it('is cycle-safe', () => {
    const x = cat('x', 'X', 0, 'y');
    const y = cat('y', 'Y', 0, 'x');
    expect(resolveCategory([x, y], 'x')).not.toBeNull();
  });

  it('products: a Category includes its sub-categories; a sub-category only its own; sold out last', () => {
    const p = (id: string, category_id: string, is_available = true): Product => ({ ...milk, id, category_id, is_available });
    const products = [p('p1', 'rice'), p('p2', 'flour', false), p('p3', 'rice-flour'), p('p4', 'oils'), p('p5', 'basmati')];
    const chainOf = ancestorsOf(all);
    const allView = resolveCategory(all, 'rice-flour')!;
    expect(productsInView(products, chainOf, allView).map((x) => x.id)).toEqual(['p1', 'p3', 'p5', 'p2']);
    const riceView = resolveCategory(all, 'rice-flour', 'rice')!;
    expect(productsInView(products, chainOf, riceView).map((x) => x.id)).toEqual(['p1', 'p5']);
    const flourView = resolveCategory(all, 'flour')!;
    expect(productsInView(products, chainOf, flourView).map((x) => [x.id, x.is_available])).toEqual([['p2', false]]);
  });

  describe('the left rail (always shown)', () => {
    const tree = buildCategoryTree(groups, all);
    const rail = (slug: string | undefined, sub?: string, t = tree, cats = all) => categoryRail(t, cats, resolveCategory(cats, slug, sub));
    const ids = (r: CategoryRail) => r.rows.map((x) => x.key);
    const active = (r: CategoryRail) => r.rows.filter((x) => x.active).map((x) => x.key);

    it('with sub-categories: "All" and then the sub-categories, routed under the category', () => {
      const r = rail('rice-flour');
      expect(r.kind).toBe('subs');
      expect(r.rows.map((x) => x.label)).toEqual(['All', 'Rice', 'Flour']);
      expect(r.rows[0]).toMatchObject({ a11y: 'All Rice & Flour', active: true, slug: 'rice-flour' });
      expect(r.rows[0].sub).toBeUndefined();
      expect(r.rows[1]).toMatchObject({ slug: 'rice-flour', sub: 'rice', active: false });
      expect(r.rows[0].art.id).toBe('rice-flour');
    });

    it('a sub-category opened directly (?sub= or its own slug) is the selected row', () => {
      expect(active(rail('rice-flour', 'flour'))).toEqual(['flour']);
      expect(active(rail('flour'))).toEqual(['flour']);
      expect(active(rail('basmati'))).toEqual(['rice']);
    });

    it('without sub-categories, grouped: the categories of its Home group, it selected', () => {
      const r = rail('oils');
      expect(r.kind).toBe('siblings');
      expect(ids(r)).toEqual(['rice-flour', 'oils']);
      expect(active(r)).toEqual(['oils']);
      expect(r.rows.map((x) => [x.slug, x.sub])).toEqual([['rice-flour', undefined], ['oils', undefined]]);
    });

    it('without sub-categories, alone in its group or ungrouped: every top-level category in Home order', () => {
      expect(ids(rail('milk'))).toEqual(['rice-flour', 'oils', 'milk', 'snacks']); // Dairy holds only Milk
      expect(active(rail('snacks'))).toEqual(['snacks']); // the closing "More"
      expect(ids(rail('snacks'))).toEqual(['rice-flour', 'oils', 'milk', 'snacks']);
    });

    it('live shop: no groups and no sub-categories -> the top-level categories in display order', () => {
      const live = [cat('bakery', 'Bakery', 0), cat('cosmetics', 'Cosmetics', 1), cat('groceries', 'Groceries', 2), cat('household', 'Household', 3), cat('dairy-eggs', 'Dairy & Eggs', 4)];
      const one = buildCategoryTree([{ id: null, name: 'More', sort_order: 0, categories: live }], live);
      const r = rail('groceries', undefined, one, live);
      expect(r.kind).toBe('siblings');
      expect(r.rows.map((x) => x.label)).toEqual(['Bakery', 'Cosmetics', 'Groceries', 'Household', 'Dairy & Eggs']);
      expect(active(r)).toEqual(['groceries']);
      // no Home groups at all (an empty tree) still lists them
      expect(ids(rail('household', undefined, [], live))).toEqual(['bakery', 'cosmetics', 'groceries', 'household', 'dairy-eggs']);
    });

    it('an unknown category has no rail', () => {
      expect(rail('gone').rows).toEqual([]);
      expect(rail(undefined).rows).toEqual([]);
    });
  });

  it('routes are deep-linkable', () => {
    expect(categoryHref('rice-flour')).toEqual({ pathname: '/category/[slug]', params: { slug: 'rice-flour' } });
    expect(categoryHref('rice-flour', 'rice')).toEqual({ pathname: '/category/[slug]', params: { slug: 'rice-flour', sub: 'rice' } });
    expect(categoriesHref('g-1')).toEqual({ pathname: '/categories', params: { group: 'g-1' } });
    expect(categoriesHref(null)).toEqual({ pathname: '/categories', params: {} });
  });
});
