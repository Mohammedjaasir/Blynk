import { describe, expect, test } from 'vitest';
import type { Category, Product } from '../api/types';
import { ancestorsOf } from '../lib/categories';
import { categoryCounts, inCategory, isMainIn, productsInCategory } from './membership';
import { productsInView, resolveCategory } from './tree';
import { homeSectionViews } from '../promo/homeSections';

const cat = (id: string, parent_id: string | null = null, display_order = 0): Category =>
  ({ id, name: id, slug: id, parent_id, display_order, description: null, image_url: null } as unknown as Category);
const categories = [cat('rice'), cat('basmati', 'rice'), cat('ready'), cat('snacks'), cat('drinks')];
const chainOf = ancestorsOf(categories);

const product = (id: string, category_id: string, extra?: string[], is_available = true): Product =>
  ({ id, category_id, category_name: category_id, name: id, is_available, selling_price: 100, offer_price: null,
    ...(extra ? { extra_category_ids: extra } : {}) } as unknown as Product);

const kottu = product('kottu', 'rice', ['ready']);
const plain = product('plain', 'rice');
const bar = product('bar', 'snacks', ['ready', 'basmati']);
const old = product('old', 'ready'); // an older server: no extra_category_ids at all
const all = [kottu, plain, bar, old];

describe('multi-category membership', () => {
  test('a product is in its main category and in each extra category', () => {
    expect(inCategory(kottu, chainOf, 'rice')).toBe(true);
    expect(inCategory(kottu, chainOf, 'ready')).toBe(true);
    expect(inCategory(kottu, chainOf, 'drinks')).toBe(false);
    expect(isMainIn(kottu, chainOf, 'ready')).toBe(false);
  });

  test('a parent category includes products whose EXTRA category is one of its sub-categories', () => {
    expect(inCategory(bar, chainOf, 'basmati')).toBe(true);
    expect(inCategory(bar, chainOf, 'rice')).toBe(true);
    expect(productsInCategory(all, chainOf, 'rice').map((p) => p.id)).toEqual(['kottu', 'plain', 'bar']);
  });

  test('a category lists its main products first, then those listed through an extra category, each once', () => {
    expect(productsInCategory(all, chainOf, 'ready').map((p) => p.id)).toEqual(['old', 'kottu', 'bar']);
    const twice = product('twice', 'rice', ['basmati', 'rice' /* never the main, but a stale list must not duplicate */]);
    expect(productsInCategory([twice], chainOf, 'rice')).toHaveLength(1);
  });

  test('an older server (no extra_category_ids) behaves as before', () => {
    expect(productsInCategory([plain, old], chainOf, 'rice').map((p) => p.id)).toEqual(['plain']);
    expect(inCategory({ category_id: 'ready', extra_category_ids: null }, chainOf, 'rice')).toBe(false);
  });

  test('category counts count a product once per category (parents roll up, no double count)', () => {
    const counts = categoryCounts(all, chainOf);
    expect(counts.get('rice')).toBe(3); // kottu, plain, bar (via basmati) - bar once even though basmati is under rice
    expect(counts.get('basmati')).toBe(1);
    expect(counts.get('ready')).toBe(3);
    expect(counts.get('snacks')).toBe(1);
    expect(counts.get('drinks')).toBeUndefined();
  });

  test('the category screen shows an extra-category product, sold-out ones last', () => {
    const soldOut = product('sold', 'snacks', ['ready'], false);
    const view = resolveCategory(categories, 'ready')!;
    expect(productsInView([soldOut, ...all], chainOf, view).map((p) => p.id)).toEqual(['old', 'kottu', 'bar', 'sold']);
  });

  test('a staff Home rail of a category includes extra-category products, once', () => {
    const rails = homeSectionViews(
      [{ id: 's1', title: 'Ready to eat', category: { id: 'ready', slug: 'ready' }, max_items: 8 } as never],
      { products: all, categories, chainOf }, Date.now(),
    );
    expect(rails).toHaveLength(1);
    expect(rails[0]!.products.map((p) => p.id)).toEqual(['kottu', 'bar', 'old'].sort((a, b) => all.findIndex((p) => p.id === a) - all.findIndex((p) => p.id === b)));
    expect(new Set(rails[0]!.products.map((p) => p.id)).size).toBe(rails[0]!.products.length);
  });
});
