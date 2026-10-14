import { describe, expect, it } from 'vitest';
import type { Promotion, PromotionTarget } from '../api/types';
import {
  destinationHref, promoDestination, visiblePromotions,
} from './promoTarget';

const target = (t: Partial<PromotionTarget>): PromotionTarget => ({
  level: 'CATALOG', id: null, slug: null, name: null, parent_id: null, parent_slug: null, parent_name: null, is_active: true, ...t,
});
const promo = (p: Partial<Promotion>): Promotion => ({
  id: 'pr', title: 'Fresh milk', subtitle: null, image_url: null, background_type: 'SOLID', background_color: '#FFE141',
  background_color_end: null, background_image_url: null, background_focal_x: 50, background_focal_y: 50, cta_label: null,
  cta_destination_type: null, cta_destination_value: null, display_order: 0, ...p,
});

describe('promotion cta_target routing', () => {
  it('MAIN opens the categories screen at that group', () => {
    const d = promoDestination(promo({ cta_target: target({ level: 'MAIN', id: 'g-grocery', name: 'Grocery' }) }));
    expect(d).toEqual({ kind: 'categories', group: 'g-grocery' });
    expect(destinationHref(d!)).toEqual({ pathname: '/categories', params: { group: 'g-grocery' } });
  });

  it('CATEGORY opens that category', () => {
    const d = promoDestination(promo({ cta_target: target({ level: 'CATEGORY', id: 'c1', slug: 'rice-flour' }) }));
    expect(d).toEqual({ kind: 'category', slug: 'rice-flour', sub: null });
    expect(destinationHref(d!)).toEqual({ pathname: '/category/[slug]', params: { slug: 'rice-flour' } });
  });

  it('SUB_CATEGORY opens the parent with the sub-category selected', () => {
    const d = promoDestination(promo({ cta_target: target({ level: 'SUB_CATEGORY', slug: 'rice', parent_slug: 'rice-flour', parent_id: 'c1' }) }));
    expect(d).toEqual({ kind: 'category', slug: 'rice-flour', sub: 'rice' });
    expect(destinationHref(d!)).toEqual({ pathname: '/category/[slug]', params: { slug: 'rice-flour', sub: 'rice' } });
    // no parent slug: the sub-category's own slug still resolves inside its parent on the screen
    expect(promoDestination(promo({ cta_target: target({ level: 'SUB_CATEGORY', slug: 'rice' }) }))).toEqual({ kind: 'category', slug: 'rice', sub: null });
  });

  it('PRODUCT opens the product page', () => {
    const d = promoDestination(promo({ cta_target: target({ level: 'PRODUCT', id: 'p-1', slug: 'milk' }) }));
    expect(d).toEqual({ kind: 'product', id: 'p-1' });
    expect(destinationHref(d!)).toEqual({ pathname: '/p/[id]', params: { id: 'p-1' } });
  });

  it('CATALOG and an unknown level open all categories', () => {
    expect(promoDestination(promo({ cta_target: target({ level: 'CATALOG' }) }))).toEqual({ kind: 'categories', group: null });
    expect(promoDestination(promo({ cta_target: target({ level: 'SOMETHING_NEW' as PromotionTarget['level'] }) }))).toEqual({ kind: 'categories', group: null });
    expect(destinationHref({ kind: 'categories', group: null })).toEqual({ pathname: '/categories', params: {} });
  });

  it('null cta_target, a switched-off target or a target without its key is not tappable', () => {
    expect(promoDestination(promo({ cta_target: null, cta_destination_type: 'CATEGORY', cta_destination_value: 'x' }))).toBeNull();
    expect(promoDestination(promo({ cta_target: target({ level: 'CATEGORY', slug: 'rice', is_active: false }) }))).toBeNull();
    expect(promoDestination(promo({ cta_target: target({ level: 'CATEGORY', slug: null }) }))).toBeNull();
    expect(promoDestination(promo({ cta_target: target({ level: 'PRODUCT', id: null }) }))).toBeNull();
  });

  it('an older backend (no cta_target) uses the stored destination', () => {
    expect(promoDestination(promo({ cta_destination_type: 'CATEGORY', cta_destination_value: ' dairy ' }))).toEqual({ kind: 'category', slug: 'dairy', sub: null });
    expect(promoDestination(promo({ cta_destination_type: 'PRODUCT', cta_destination_value: 'p-9' }))).toEqual({ kind: 'product', id: 'p-9' });
    expect(promoDestination(promo({ cta_destination_type: 'CATALOG', cta_destination_value: 'g-1' }))).toEqual({ kind: 'categories', group: null });
    expect(promoDestination(promo({ cta_destination_type: null }))).toBeNull();
    expect(promoDestination(promo({ cta_destination_type: 'CATEGORY', cta_destination_value: '' }))).toBeNull();
  });
});

describe('promotions carousel', () => {
  it('shows banners with something to draw, in display order', () => {
    const list = [
      promo({ id: 'b', display_order: 2, title: 'Second' }),
      promo({ id: 'empty', display_order: 0, title: '  ' }),
      promo({ id: 'a', display_order: 1, title: null, background_type: 'ARTWORK', background_image_url: 'https://x/a.png' }),
    ];
    expect(visiblePromotions(list).map((p) => p.id)).toEqual(['a', 'b']);
  });
});
