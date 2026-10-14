import { describe, expect, it } from 'vitest';
import type { Promotion, PublicPromoBand } from '../api/types';
import {
  BAND_DEFAULT_COLORS, bandHeadlineRows, bandLink, bandTextWidth, resolvePromoBand,
} from './promoBand';
import { autoAdvances, carouselOrder, isDarkHex, nextSlide, slideLook } from './carousel';

const fallback = { line1: 'Free delivery on your first 2 orders', fees: ['No Platform Fee', 'No Packaging Fee'] };
const config = (over: Partial<PublicPromoBand> = {}): PublicPromoBand => ({
  lines: [], ticks: [], background: 'YELLOW', colors: { start: '#FFE141', end: '#F2C600', text: '#1A1D2E' },
  item: { kind: 'NONE', illustration: null, image_url: null }, mascot: 'WAVE', cta_target: null, ends_at: null, ...over,
});
const target = (over: Partial<NonNullable<PublicPromoBand['cta_target']>>) => ({
  level: 'CATEGORY' as const, id: 'c1', slug: 'rice', name: 'Rice', parent_id: null, parent_slug: null, parent_name: null, is_active: true, ...over,
});

describe('promo band render model', () => {
  it('an older API (no promo_band) draws the band as it always was', () => {
    expect(resolvePromoBand(undefined, fallback)).toEqual({
      lines: [fallback.line1], ticks: fallback.fees, colors: BAND_DEFAULT_COLORS, item: { kind: 'NONE' }, mascot: 'WAVE', link: null,
    });
    // no free deliveries: no headline row, as before
    expect(resolvePromoBand(undefined, { line1: null, fees: ['No Platform Fee'] })?.lines).toEqual([]);
  });

  it('null = Admin / Ops switched it off (or it is outside its schedule): hidden', () => {
    expect(resolvePromoBand(null, fallback)).toBeNull();
  });

  it('the stored defaults (empty lines and ticks) keep the app\'s own copy and look', () => {
    expect(resolvePromoBand(config(), fallback)).toEqual(resolvePromoBand(undefined, fallback));
  });

  it('draws Admin / Ops\' headlines, points, colours, item, mascot and link', () => {
    const m = resolvePromoBand(
      config({
        lines: [' Fresh bread daily ', '', 'Weekend deals'],
        ticks: ['No Platform Fee'],
        colors: { start: '#1A1D2E', end: '#2A2E45', text: '#FFE141' },
        item: { kind: 'ILLUSTRATED', illustration: 'bread', image_url: null },
        mascot: 'RIDE',
        cta_target: target({}),
      }),
      fallback,
    );
    expect(m).toEqual({
      lines: ['Fresh bread daily', 'Weekend deals'],
      ticks: ['No Platform Fee'],
      colors: { start: '#1A1D2E', end: '#2A2E45', text: '#FFE141' },
      item: { kind: 'ILLUSTRATED', emoji: '🍞' },
      mascot: 'RIDE',
      link: { kind: 'aisle', slug: 'rice', name: 'Rice' },
    });
  });

  it('falls back safely on anything it cannot draw', () => {
    const m = resolvePromoBand(
      config({
        colors: { start: 'red', end: '#F2C600', text: '#1A1D2E' },
        item: { kind: 'ILLUSTRATED', illustration: 'pizza', image_url: null },
        mascot: 'DANCE' as never,
      }),
      fallback,
    )!;
    expect(m.colors).toEqual(BAND_DEFAULT_COLORS);
    expect(m.item).toEqual({ kind: 'NONE' });
    expect(m.mascot).toBe('WAVE');
    expect(resolvePromoBand(config({ item: { kind: 'IMAGE', illustration: null, image_url: 'javascript:x' } }), fallback)!.item).toEqual({ kind: 'NONE' });
    expect(resolvePromoBand(config({ item: { kind: 'IMAGE', illustration: null, image_url: 'https://cdn/x.png' } }), fallback)!.item)
      .toEqual({ kind: 'IMAGE', uri: 'https://cdn/x.png' });
  });

  it('links: category, sub-category (its parent aisle), product, main / catalog (search)', () => {
    expect(bandLink(target({ level: 'SUB_CATEGORY', slug: 'basmati', name: 'Basmati', parent_slug: 'rice', parent_name: 'Rice' })))
      .toEqual({ kind: 'aisle', slug: 'rice', name: 'Rice' });
    expect(bandLink(target({ level: 'PRODUCT', id: 'p-9' }))).toEqual({ kind: 'product', id: 'p-9' });
    expect(bandLink(target({ level: 'MAIN', id: 'g1', slug: null }))).toEqual({ kind: 'search' });
    expect(bandLink(target({ level: 'CATALOG', id: null, slug: null }))).toEqual({ kind: 'search' });
    expect(bandLink(null)).toBeNull();
  });

  it('keeps room for the mascot and the beam, and sizes the headline row for the longest line', () => {
    const plain = { item: { kind: 'NONE' as const }, mascot: 'WAVE' as const };
    expect(bandTextWidth(390, plain)).toBe(270);
    expect(bandTextWidth(390, { item: { kind: 'ILLUSTRATED', emoji: '🍞' }, mascot: 'WAVE' })).toBe(170);
    expect(bandTextWidth(390, { item: { kind: 'NONE' }, mascot: 'OFF' })).toBe(354);
    expect(bandHeadlineRows([fallback.line1!], 270)).toBe(1);
    expect(bandHeadlineRows(['Short', 'A much longer headline that wraps'], 170)).toBe(2);
  });
});

const promo = (over: Partial<Promotion>): Promotion => ({
  id: 'p1', title: 'Fresh fruit', subtitle: 'Picked this morning', image_url: null, background_type: 'SOLID',
  background_color: '#FFE141', background_color_end: null, background_image_url: null, background_focal_x: 50, background_focal_y: 50,
  cta_label: null, cta_destination_type: null, cta_destination_value: null, display_order: 0, ...over,
});

describe('carousel slide look', () => {
  it('solid / gradient / image / artwork backgrounds and their text colours', () => {
    expect(slideLook(promo({})).background).toEqual({ kind: 'solid', color: '#FFE141' });
    expect(slideLook(promo({})).titleColor).toBe('#12151F');
    expect(slideLook(promo({ background_color: '#1A1D2E' })).titleColor).toBe('#FFFFFF');
    expect(slideLook(promo({ background_type: 'GRADIENT', background_color: '#0C831F', background_color_end: '#1A1D2E' })).background)
      .toEqual({ kind: 'gradient', from: '#0C831F', to: '#1A1D2E' });
    const image = slideLook(promo({ background_type: 'IMAGE', background_image_url: 'https://x/bg.jpg', background_focal_y: 10 }));
    expect(image.background).toEqual({ kind: 'image', uri: 'https://x/bg.jpg', focalX: 50, focalY: 10, scrim: 'rgba(16,19,25,0.66)' });
    expect(image.titleColor).toBe('#FFFFFF');
  });

  it('artwork draws no words; without a label the whole card is the button', () => {
    const art = slideLook(promo({
      background_type: 'ARTWORK', background_image_url: 'https://x/a.png', image_url: 'https://x/fg.png',
      cta_destination_type: 'CATEGORY', cta_destination_value: 'rice', cta_target: target({}),
    }));
    expect(art.showText).toBe(false);
    expect(art.foreground).toBeNull();
    expect(art.cta).toBeNull();
    expect(art.wholeCardTap).toBe(true);
    expect(art.link).toEqual({ kind: 'aisle', slug: 'rice', name: 'Rice' });
  });

  it('a button needs a label and a destination; older APIs link from the stored value', () => {
    expect(slideLook(promo({ cta_label: 'Shop' })).cta).toBeNull();
    const withDest = slideLook(promo({ cta_label: 'Shop', cta_destination_type: 'PRODUCT', cta_destination_value: 'p-1' }));
    expect(withDest.cta).toBe('Shop');
    expect(withDest.link).toEqual({ kind: 'product', id: 'p-1' });
    expect(withDest.wholeCardTap).toBe(false);
    // a yellow pill would vanish on the yellow card: ink pill on light slides, yellow on dark ones
    expect(withDest.ctaColors).toEqual({ bg: '#1A1D2E', text: '#FFFFFF' });
    expect(slideLook(promo({ background_color: '#1A1D2E', cta_label: 'Go', cta_destination_type: 'CATALOG' })).ctaColors)
      .toEqual({ bg: '#FFE141', text: '#1A1D2E' });
  });

  it('order, wrap-around and auto-advance rules', () => {
    const rows = [promo({ id: 'a', display_order: 20 }), promo({ id: 'b', display_order: 10 }), promo({ id: 'c', display_order: 10 })];
    expect(carouselOrder(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(nextSlide(2, 3)).toBe(0);
    expect(nextSlide(0, 0)).toBe(0);
    expect(autoAdvances(3, false)).toBe(true);
    expect(autoAdvances(3, true)).toBe(false);
    expect(autoAdvances(1, false)).toBe(false);
    expect(isDarkHex('#1A1D2E80')).toBe(true);
    expect(isDarkHex('nope')).toBe(false);
  });
});
