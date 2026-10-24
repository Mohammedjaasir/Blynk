import { describe, expect, it } from 'vitest';
import type { Category, Product, PublicHomeSection } from '../api/types';
import {
  countdownText, countdownUrgent, endMs, endsInText, homeSectionViews, nextEndDelay, railLimit, sectionEnded,
  type SectionCatalog,
} from './homeSections';

const product = (id: string, category_id: string, over: Partial<Product> = {}): Product => ({
  id, category_id, category_name: category_id, name: `P ${id}`, slug: id, description: null, unit: 'pc', pack_size: null,
  image_url: null, image_focal_x: null, image_focal_y: null, selling_price: 100, offer_price: null, offer_ends_at: null,
  offer_kind: null, is_available: true, ...over,
});
const cat = (id: string, parent_id: string | null = null): Category => ({
  id, name: `Cat ${id}`, slug: `cat-${id}`, description: null, image_url: null, display_order: 0, parent_id, offer_percent: null, offer_ends_at: null,
});

// snacks (c1) has a sub-category chips (c1a); juices is c2
const categories = [cat('c1'), cat('c1a', 'c1'), cat('c2')];
const chains: Record<string, string[]> = { c1: ['c1'], c1a: ['c1a', 'c1'], c2: ['c2'] };
const catalog = (products: Product[]): SectionCatalog => ({ products, categories, chainOf: (id) => chains[id] ?? [id] });

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const section = (over: Partial<PublicHomeSection> = {}): PublicHomeSection => ({
  id: 's1', title: 'Snacks', subtitle: null, ends_at: null, show_countdown: false, max_items: 8,
  category: { id: 'c1', slug: 'cat-c1' }, product_ids: null, ...over,
});

describe('which products a section shows', () => {
  it('a category section lists the category and its sub-categories, in catalogue order, orderable only', () => {
    const c = catalog([
      product('a', 'c1'), product('b', 'c2'), product('c', 'c1a'), product('d', 'c1', { is_available: false }), product('e', 'c1'),
    ]);
    const [v] = homeSectionViews([section()], c, NOW);
    expect(v.products.map((p) => p.id)).toEqual(['a', 'c', 'e']);
    expect(v.seeAll).toEqual({ slug: 'cat-c1', name: 'Cat c1' });
  });

  it('max_items limits a category rail (kept to 4-12, 8 when unusable)', () => {
    const c = catalog(Array.from({ length: 20 }, (_, i) => product(`p${i}`, 'c1')));
    expect(homeSectionViews([section({ max_items: 5 })], c, NOW)[0].products).toHaveLength(5);
    expect(homeSectionViews([section({ max_items: 99 })], c, NOW)[0].products).toHaveLength(12);
    expect(homeSectionViews([section({ max_items: 1 })], c, NOW)[0].products).toHaveLength(4);
    expect(homeSectionViews([section({ max_items: undefined as unknown as number })], c, NOW)[0].products).toHaveLength(8);
    expect(railLimit(Number.NaN)).toBe(8);
    expect(railLimit(6.9)).toBe(6);
  });

  it('a hand-picked section keeps staff order and skips missing or unavailable products', () => {
    const c = catalog([product('a', 'c1'), product('b', 'c2'), product('x', 'c1', { is_available: false }), product('d', 'c2')]);
    const [v] = homeSectionViews([section({ category: null, product_ids: ['d', 'gone', 'x', 'a', 'd', 'b'] })], c, NOW);
    expect(v.products.map((p) => p.id)).toEqual(['d', 'a', 'b']);
    expect(v.seeAll).toBeNull();
  });

  it('a hand-picked rail is not cut by max_items but never exceeds 12', () => {
    const many = Array.from({ length: 15 }, (_, i) => product(`p${i}`, 'c1'));
    const [v] = homeSectionViews([section({ category: null, max_items: 4, product_ids: many.map((p) => p.id) })], catalog(many), NOW);
    expect(v.products).toHaveLength(12);
  });

  it('a section with no products is hidden, the others stay in the server order', () => {
    const c = catalog([product('a', 'c2'), product('b', 'c1')]);
    const views = homeSectionViews([
      section({ id: 'one', category: { id: 'c1', slug: 'cat-c1' } }),
      section({ id: 'empty', category: null, product_ids: ['nope'] }),
      section({ id: 'two', category: { id: 'c2', slug: 'cat-c2' } }),
    ], c, NOW);
    expect(views.map((v) => v.id)).toEqual(['one', 'two']);
  });
});

describe('when a section disappears', () => {
  const c = catalog([product('a', 'c1')]);
  it('after its end, not before', () => {
    const ends = new Date(NOW + 60_000).toISOString();
    expect(homeSectionViews([section({ ends_at: ends })], c, NOW)).toHaveLength(1);
    expect(homeSectionViews([section({ ends_at: ends })], c, NOW + 59_999)).toHaveLength(1);
    expect(homeSectionViews([section({ ends_at: ends })], c, NOW + 60_000)).toHaveLength(0);
    expect(sectionEnded(NOW + 1, NOW)).toBe(false);
    expect(sectionEnded(NOW, NOW)).toBe(true);
    expect(sectionEnded(null, NOW)).toBe(false);
  });

  it('a section without an end never ends; an unreadable end counts as none', () => {
    expect(homeSectionViews([section()], c, NOW + 1e12)).toHaveLength(1);
    expect(homeSectionViews([section({ ends_at: 'soon' })], c, NOW)).toHaveLength(1);
    expect(endMs('soon')).toBeNull();
    expect(endMs(null)).toBeNull();
    expect(endMs('2026-10-24T10:00:00+05:30')).toBe(Date.parse('2026-10-24T04:30:00.000Z'));
  });

  it('the countdown shows only with show_countdown and an end', () => {
    const ends = new Date(NOW + 5000).toISOString();
    expect(homeSectionViews([section({ ends_at: ends, show_countdown: true })], c, NOW)[0].countdown).toBe(true);
    expect(homeSectionViews([section({ ends_at: ends })], c, NOW)[0].countdown).toBe(false);
    expect(homeSectionViews([section({ show_countdown: true })], c, NOW)[0].countdown).toBe(false);
  });

  it('the next check is at the soonest future end, and nothing is scheduled without one', () => {
    expect(nextEndDelay([{ endsAtMs: null }], NOW)).toBeNull();
    expect(nextEndDelay([], NOW)).toBeNull();
    expect(nextEndDelay([{ endsAtMs: NOW + 9000 }, { endsAtMs: null }, { endsAtMs: NOW + 3000 }, { endsAtMs: NOW - 5 }], NOW)).toBe(3050);
    expect(nextEndDelay([{ endsAtMs: NOW + 400 * 86400_000 }], NOW)).toBe(2_147_483_000);
  });
});

describe('defensive reading of /store', () => {
  it('older API, no catalogue yet, junk entries', () => {
    const c = catalog([product('a', 'c1')]);
    expect(homeSectionViews(undefined, c, NOW)).toEqual([]);
    expect(homeSectionViews([], c, NOW)).toEqual([]);
    expect(homeSectionViews([section()], null, NOW)).toEqual([]);
    expect(homeSectionViews('x' as unknown as PublicHomeSection[], c, NOW)).toEqual([]);
    expect(homeSectionViews([null as unknown as PublicHomeSection, section({ title: '  ' })], c, NOW)).toEqual([]);
  });
  it('a repeated id is drawn once; texts are trimmed', () => {
    const c = catalog([product('a', 'c1')]);
    const views = homeSectionViews([section({ title: ' Snacks ', subtitle: ' Crunchy ' }), section({ title: 'Again' })], c, NOW);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ title: 'Snacks', subtitle: 'Crunchy' });
    expect(homeSectionViews([section({ subtitle: '   ' })], c, NOW)[0].subtitle).toBeNull();
  });
});

describe('countdown text', () => {
  const h = 3600_000;
  it('under a day: hh:mm:ss', () => {
    expect(countdownText(2 * h + 14 * 60_000 + 9000)).toBe('02:14:09');
    expect(countdownText(59 * 60_000 + 59_000)).toBe('00:59:59');
    expect(countdownText(24 * h - 1000)).toBe('23:59:59');
  });
  it('a day or more: "2d 04:10" (days, hours:minutes)', () => {
    expect(countdownText(2 * 86400_000 + 4 * h + 10 * 60_000 + 33_000)).toBe('2d 04:10');
    expect(countdownText(24 * h)).toBe('1d 00:00');
    expect(countdownText(10 * 86400_000)).toBe('10d 00:00');
  });
  it('whole seconds round up, so the last second still shows', () => {
    expect(countdownText(1)).toBe('00:00:01');
    expect(countdownText(1000)).toBe('00:00:01');
    expect(countdownText(1001)).toBe('00:00:02');
  });
  it('nothing once it is over', () => {
    expect(countdownText(0)).toBeNull();
    expect(countdownText(-5)).toBeNull();
    expect(countdownText(Number.NaN)).toBeNull();
  });
  it('the pill words it as "Ends in ..." and goes away at the end', () => {
    expect(endsInText(NOW + 2 * h + 14 * 60_000 + 9000, NOW)).toBe('Ends in 02:14:09');
    expect(endsInText(NOW, NOW)).toBeNull();
    expect(endsInText(null, NOW)).toBeNull();
  });
  it('urgent under an hour', () => {
    expect(countdownUrgent(NOW + 59 * 60_000, NOW)).toBe(true);
    expect(countdownUrgent(NOW + 61 * 60_000, NOW)).toBe(false);
  });
});
