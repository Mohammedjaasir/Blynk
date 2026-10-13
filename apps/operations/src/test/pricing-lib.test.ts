import { describe, expect, it } from 'vitest';
import {
  belowCostText,
  inheritedMarkup,
  marginPercent,
  markupPrice,
  markupProductCountText,
  markupSourceText,
  parseMarkupPercent,
  parseSellingPrice,
  percentText,
  pricingSourceLabel,
  resolveMarkup,
  round2,
} from '../lib/pricing';

/** Selling-price modes (migration 044; owner, 2026-10-13): the preview twin of the server's price rule. */

describe('markupPrice (same integer rounding as the server / Postgres ROUND)', () => {
  it('works on whole cents and basis points', () => {
    expect(markupPrice(100, 25)).toBe(125);
    expect(markupPrice(300, 20)).toBe(360);
    expect(markupPrice(0, 20)).toBe(0);
    expect(markupPrice(99.99, 0)).toBe(99.99);
  });

  it('rounds half up to the cent without float drift', () => {
    // 1.15 x 1.10 = 1.265 -> 1.27 (a naive float multiply gives 1.2649999...)
    expect(markupPrice(1.15, 10)).toBe(1.27);
    // 10.05 x 1.125 = 11.30625 -> 11.31
    expect(markupPrice(10.05, 12.5)).toBe(11.31);
    // 0.01 x 1.5 = 0.015 -> 0.02
    expect(markupPrice(0.01, 50)).toBe(0.02);
    expect(markupPrice(1234.56, 999.99)).toBe(13580.04);
  });
});

describe('marginPercent / round2 / belowCostText', () => {
  it('is the % over cost, 2 decimals, negative below cost, null on a zero cost', () => {
    expect(marginPercent(100, 125)).toBe(25);
    expect(marginPercent(300, 350)).toBe(16.67);
    expect(marginPercent(100, 90)).toBe(-10);
    expect(marginPercent(0, 50)).toBeNull();
    expect(round2(-1.005)).toBe(-1.01);
  });

  it('warns only below cost, with the loss per unit', () => {
    expect(belowCostText(100, 90)).toBe('Below purchase cost — you lose LKR 10.00 per unit');
    expect(belowCostText(100, 100)).toBeNull();
    expect(belowCostText(100, 120)).toBeNull();
  });
});

describe('inheritedMarkup / resolveMarkup', () => {
  const categories = [
    { id: 'grocery', name: 'Grocery', parent_id: null, markup_percent: 15 },
    { id: 'rice', name: 'Rice', parent_id: 'grocery', markup_percent: 25 },
    { id: 'flour', name: 'Flour', parent_id: 'grocery', markup_percent: null },
    { id: 'soap', name: 'Soap', parent_id: null, markup_percent: null },
    { id: 'old', name: 'Old API', parent_id: null },
  ];

  it('uses the category markup, else the parent category markup, else the global markup', () => {
    expect(inheritedMarkup('rice', categories, 20)).toEqual({ percent: 25, source: 'CATEGORY_MARKUP', categoryName: 'Rice' });
    expect(inheritedMarkup('flour', categories, 20)).toEqual({ percent: 15, source: 'PARENT_CATEGORY_MARKUP', categoryName: 'Grocery' });
    expect(inheritedMarkup('soap', categories, 30)).toEqual({ percent: 30, source: 'GLOBAL_MARKUP' });
    expect(inheritedMarkup('old', categories, null)).toEqual({ percent: 20, source: 'GLOBAL_MARKUP' });
    expect(inheritedMarkup('', categories, 18)).toEqual({ percent: 18, source: 'GLOBAL_MARKUP' });
  });

  it('a category markup of 0 is a real markup, not "none"', () => {
    expect(inheritedMarkup('zero', [{ id: 'zero', name: 'Zero', markup_percent: 0 }], 20)).toMatchObject({
      percent: 0,
      source: 'CATEGORY_MARKUP',
    });
  });

  it("the product's own markup wins; null inherits", () => {
    const inherited = inheritedMarkup('rice', categories, 20);
    expect(resolveMarkup(30, inherited)).toEqual({ percent: 30, source: 'PRODUCT_MARKUP' });
    expect(resolveMarkup(null, inherited)).toBe(inherited);
  });

  it('describes where the markup comes from', () => {
    expect(markupSourceText({ percent: 25, source: 'CATEGORY_MARKUP', categoryName: 'Rice' })).toBe("from category 'Rice' 25%");
    expect(markupSourceText({ percent: 15, source: 'PARENT_CATEGORY_MARKUP', categoryName: 'Grocery' })).toBe(
      "from parent category 'Grocery' 15%"
    );
    expect(markupSourceText({ percent: 30, source: 'PRODUCT_MARKUP' })).toBe('product markup 30%');
    expect(markupSourceText({ percent: 20, source: 'GLOBAL_MARKUP' })).toBe('global markup 20%');
  });
});

describe('labels and parsing', () => {
  it('labels every pricing source', () => {
    expect(pricingSourceLabel('FIXED')).toBe('Fixed');
    expect(pricingSourceLabel('PRODUCT_MARKUP')).toBe('Product markup');
    expect(pricingSourceLabel('CATEGORY_MARKUP')).toBe('Category markup');
    expect(pricingSourceLabel('PARENT_CATEGORY_MARKUP')).toBe('Parent category markup');
    expect(pricingSourceLabel('GLOBAL_MARKUP')).toBe('Global markup');
    expect(pricingSourceLabel(undefined)).toBe('');
    expect(percentText(12.5)).toBe('12.5%');
    expect(percentText(20)).toBe('20%');
  });

  it('parseMarkupPercent: blank inherits, 0..999.99, 2 decimals', () => {
    expect(parseMarkupPercent('  ')).toEqual({ value: null });
    expect(parseMarkupPercent('0')).toEqual({ value: 0 });
    expect(parseMarkupPercent('999.99')).toEqual({ value: 999.99 });
    expect(parseMarkupPercent('1000')).toEqual({ error: 'Markup can be at most 999.99%.' });
    expect(parseMarkupPercent('12.345')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseMarkupPercent('-1')).toHaveProperty('error');
    expect(parseMarkupPercent('abc')).toHaveProperty('error');
  });

  it('parseSellingPrice: required, above 0, 2 decimals, within the limit', () => {
    expect(parseSellingPrice('250')).toEqual({ value: 250 });
    expect(parseSellingPrice('')).toEqual({ error: 'Enter the selling price.' });
    expect(parseSellingPrice('0')).toEqual({ error: 'The selling price must be more than LKR 0.' });
    expect(parseSellingPrice('1.234')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseSellingPrice('100000000')).toEqual({ error: 'The selling price is too large.' });
  });

  it('says how many products follow a category markup', () => {
    expect(markupProductCountText(12, true)).toBe('12 products use this markup');
    expect(markupProductCountText(1, true)).toBe('1 product uses this markup');
    expect(markupProductCountText(12, false)).toBe('12 products follow the parent/global markup');
    expect(markupProductCountText(undefined, true)).toBeNull();
  });
});
