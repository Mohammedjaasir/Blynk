import { describe, expect, test } from 'vitest';
import type { Product, ProductVariant } from '../api/types';
import { milk } from '../test/fixtures';
import {
  colomboDayPlus, dayLabel, defaultVariant, deliveredFromText, earliestDeliveryDate, hasVariants, normalizeProductExtras, parseVariants,
  priceRange, priceText, RANGE_MAX_CHARS, selectVariant, variantOnOffer, variantPrice,
} from './variants';

const v = (id: string, label: string, selling: number, offer: number | null, available = true, sort = 0): ProductVariant => ({
  id, label, sku: null, barcode: null, sort_order: sort, selling_price: selling, offer_price: offer, offer_ends_at: null,
  offer_kind: offer == null ? null : 'PRODUCT', price: offer ?? selling, is_available: available,
});
const chilli: Product = {
  ...milk, id: 'p-chilli', name: 'Chilli Powder', selling_price: 60, offer_price: 50, offer_kind: 'PRODUCT',
  has_variants: true, variant_count: 4, price_min: 50, price_max: 350, delivery_lead_days: 0, earliest_delivery_date: null,
};
const NOW = new Date('2026-10-14T04:00:00.000Z'); // Wed 14 Oct, 09:30 in Colombo

describe('price range', () => {
  test('a product with variants shows "LKR 50 – 350"; compact shows "From LKR 50"', () => {
    expect(priceText(chilli)).toBe('LKR 50 – 350');
    expect(priceText(chilli, { compact: true })).toBe('From LKR 50');
    expect(priceRange(chilli)).toEqual({ min: 50, max: 350 });
  });

  test('one price when the sizes cost the same, or without variants (offer-aware)', () => {
    expect(priceText({ ...chilli, price_min: 120, price_max: 120 })).toBe('LKR 120');
    expect(priceText(milk)).toBe('LKR 513');
    expect(hasVariants(milk)).toBe(false);
  });

  test('a range too wide for a card falls back to "From"', () => {
    const wide = { ...chilli, price_min: 1250, price_max: 13500 };
    expect(`LKR 1,250 – 13,500`.length).toBeGreaterThan(RANGE_MAX_CHARS);
    expect(priceText(wide)).toBe('From LKR 1,250');
  });

  test('missing or string range values never show NaN', () => {
    expect(priceText({ ...chilli, price_min: undefined, price_max: undefined })).toBe('LKR 50');
    expect(priceText({ ...chilli, price_min: '50' as unknown as number, price_max: '350.5' as unknown as number })).toBe('LKR 50 – 350.50');
  });
});

describe('variants', () => {
  const list = [v('a2', '100 g', 110, null, false, 1), v('a1', '50 g', 60, 50, true, 0), v('a3', '250 g', 250, null, true, 2)];

  test('parse keeps staff order, turns strings into numbers and drops bad rows', () => {
    const parsed = parseVariants([...list, { id: 'x' }, null, { ...list[0], id: 'a4', label: '1 kg', selling_price: '900', price: '900', sort_order: 3 }]);
    expect(parsed.map((x) => x.label)).toEqual(['50 g', '100 g', '250 g', '1 kg']);
    expect(parsed[3].selling_price).toBe(900);
    expect(parseVariants('nope')).toEqual([]);
  });

  test('the default size is the first in stock; a chosen size stays chosen', () => {
    const parsed = parseVariants(list);
    expect(defaultVariant(parsed)?.label).toBe('50 g');
    expect(defaultVariant([v('z', 'only', 10, null, false)])?.label).toBe('only');
    expect(selectVariant(parsed, 'a3')?.label).toBe('250 g');
    expect(selectVariant(parsed, 'gone')?.label).toBe('50 g');
    expect(selectVariant([], null)).toBeNull();
  });

  test("a size's price is its offer while it runs", () => {
    expect(variantPrice(list[1])).toBe(50);
    expect(variantOnOffer(list[1])).toBe(true);
    const ended = { ...list[1], offer_ends_at: '2026-10-01T00:00:00.000Z' };
    expect(variantPrice(ended, NOW)).toBe(60);
  });

  test('normalizeProductExtras parses the detail variants and numeric fields', () => {
    const p = normalizeProductExtras({ ...chilli, price_max: '350' as unknown as number, delivery_lead_days: '2' as unknown as number, variants: list as ProductVariant[] });
    expect(p.price_max).toBe(350);
    expect(p.delivery_lead_days).toBe(2);
    expect(p.variants?.map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('delivery lead time on cards and pages', () => {
  test('"Delivered from Sat 17 Oct" from the server date', () => {
    expect(deliveredFromText({ delivery_lead_days: 3, earliest_delivery_date: '2026-10-17' }, NOW)).toBe('Delivered from Sat 17 Oct');
  });
  test('without a server date: today in Colombo plus the lead days', () => {
    expect(colomboDayPlus(2, NOW)).toBe('2026-10-16');
    // 23:00 Colombo on the 14th is still the 14th there (UTC is 17:30)
    expect(colomboDayPlus(0, new Date('2026-10-14T17:30:00.000Z'))).toBe('2026-10-14');
    expect(colomboDayPlus(0, new Date('2026-10-14T18:31:00.000Z'))).toBe('2026-10-15');
    expect(earliestDeliveryDate({ delivery_lead_days: 2, earliest_delivery_date: null }, NOW)).toBe('2026-10-16');
    expect(deliveredFromText({ delivery_lead_days: 2 }, NOW)).toBe('Delivered from Fri 16 Oct');
  });
  test('same day shows nothing; bad dates are ignored', () => {
    expect(deliveredFromText({ delivery_lead_days: 0, earliest_delivery_date: '2026-10-17' }, NOW)).toBeNull();
    expect(deliveredFromText(milk, NOW)).toBeNull();
    expect(dayLabel('2026-02-30')).toBeNull();
    expect(dayLabel('17/10/2026')).toBeNull();
  });
});
