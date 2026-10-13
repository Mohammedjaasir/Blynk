import { expect, test } from 'vitest';
import { applyFilters, toggle } from './filters';
import { ancestorsOf, categoryOfferActive, topLevelOf } from './categories';
import { milk, sugar, dairy } from '../test/fixtures';

test('chips really filter: on offer, under LKR 300, in stock', () => {
  const gone = { ...sugar, id: 'p-gone', is_available: false };
  const all = [milk, sugar, gone];
  expect(applyFilters(all, []).length).toBe(3);
  expect(applyFilters(all, ['offer']).map((p) => p.id)).toEqual([milk.id]);
  expect(applyFilters(all, ['under300']).map((p) => p.id)).toEqual([sugar.id, gone.id]);
  expect(applyFilters(all, ['under300', 'instock']).map((p) => p.id)).toEqual([sugar.id]);
  expect(toggle(['offer'], 'offer')).toEqual([]);
});

test('sub-category products roll up to their aisle', () => {
  const kid = { ...dairy, id: 'c-milk', slug: 'milk', parent_id: dairy.id };
  const grand = { ...dairy, id: 'c-fresh', slug: 'fresh', parent_id: kid.id };
  const cats = [dairy, kid, grand];
  expect(topLevelOf(cats)('c-fresh')).toBe(dairy.id);
  expect(ancestorsOf(cats)('c-fresh')).toEqual(['c-fresh', 'c-milk', dairy.id]);
  expect(categoryOfferActive(dairy)).toBe(true);
  expect(categoryOfferActive({ offer_percent: 5, offer_ends_at: '2020-01-01T00:00:00Z' })).toBe(false);
});
