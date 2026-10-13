import { describe, it, expect } from 'vitest';
import {
  formatLkr,
  inheritedMarkup,
  marginPercent,
  markupPrice,
  markupSourceText,
  parseMarkupInput,
  previewPrice,
} from '../lib/pricing';

/**
 * Selling-price modes and category markup (migration 044; owner,
 * 2026-10-13): the preview math must match the server's
 * (backend pricing/index.ts) to the cent.
 */
const CATEGORIES = [
  { id: 'grocery', name: 'Grocery', parent_id: null, markup_percent: 15 },
  { id: 'rice', name: 'Rice', parent_id: 'grocery', markup_percent: 25 },
  { id: 'snacks', name: 'Snacks', parent_id: 'grocery', markup_percent: null },
  { id: 'household', name: 'Household', parent_id: null, markup_percent: null },
  { id: 'soap', name: 'Soap', parent_id: 'household', markup_percent: null },
];

describe('markupPrice', () => {
  it('is cost x (1 + m/100) rounded half up to the cent, on whole cents', () => {
    expect(markupPrice(100, 25)).toBe(125);
    expect(markupPrice(99.99, 12.5)).toBe(112.49);
    expect(markupPrice(200, 0)).toBe(200);
    expect(markupPrice(0, 50)).toBe(0);
    // 0.075 -> 0.08 (plain float math gives 0.07); 1.515 -> 1.52.
    expect(markupPrice(0.05, 50)).toBe(0.08);
    expect(markupPrice(1.01, 50)).toBe(1.52);
    expect(markupPrice(430, 11.63)).toBe(480.01);
    expect(markupPrice(99_999_999.99, 0)).toBe(99_999_999.99);
  });
});

describe('marginPercent', () => {
  it('is the % over cost to 2 decimals; null when the cost is 0; negative below cost', () => {
    expect(marginPercent(100, 110)).toBe(10);
    expect(marginPercent(3, 4)).toBe(33.33);
    expect(marginPercent(100, 90)).toBe(-10);
    expect(marginPercent(0, 50)).toBeNull();
  });
});

describe('inheritedMarkup', () => {
  it("uses the category's own markup, else the parent's, else the global default (20 when unknown)", () => {
    expect(inheritedMarkup('rice', CATEGORIES, 30)).toEqual({ markup: 25, source: 'CATEGORY_MARKUP', categoryName: 'Rice' });
    expect(inheritedMarkup('snacks', CATEGORIES, 30)).toEqual({
      markup: 15,
      source: 'PARENT_CATEGORY_MARKUP',
      categoryName: 'Grocery',
    });
    expect(inheritedMarkup('soap', CATEGORIES, 30)).toEqual({ markup: 30, source: 'GLOBAL_MARKUP', categoryName: null });
    expect(inheritedMarkup('household', CATEGORIES, null)).toEqual({ markup: 20, source: 'GLOBAL_MARKUP', categoryName: null });
    expect(inheritedMarkup('', CATEGORIES, 18)).toMatchObject({ markup: 18, source: 'GLOBAL_MARKUP' });
    // A 0% category markup is a markup (not "none").
    expect(inheritedMarkup('x', [{ id: 'x', name: 'X', parent_id: null, markup_percent: 0 }], 20)).toMatchObject({
      markup: 0,
      source: 'CATEGORY_MARKUP',
    });
  });
});

describe('previewPrice', () => {
  const inherited = inheritedMarkup('rice', CATEGORIES, 20);

  it('MARKUP: the product markup wins over the inherited one', () => {
    expect(previewPrice({ cost: 100, mode: 'MARKUP', customMarkup: 30, inherited })).toMatchObject({
      price: 130,
      source: 'PRODUCT_MARKUP',
      markup: 30,
    });
    expect(previewPrice({ cost: 100, mode: 'MARKUP', customMarkup: null, inherited })).toMatchObject({
      price: 125,
      source: 'CATEGORY_MARKUP',
      categoryName: 'Rice',
    });
  });

  it('FIXED: exactly the price, with the margin and the loss below cost', () => {
    expect(previewPrice({ cost: 100, mode: 'FIXED', fixedPrice: 110, customMarkup: 50, inherited })).toEqual({
      mode: 'FIXED',
      source: 'FIXED',
      price: 110,
      markup: 10,
      categoryName: null,
      lossPerUnit: null,
    });
    expect(previewPrice({ cost: 100, mode: 'FIXED', fixedPrice: 90, inherited })).toMatchObject({ markup: -10, lossPerUnit: 10 });
    expect(previewPrice({ cost: 0, mode: 'FIXED', fixedPrice: 90, inherited })).toMatchObject({ markup: null, lossPerUnit: null });
  });

  it('is null while the inputs cannot give a price', () => {
    expect(previewPrice({ cost: NaN, mode: 'MARKUP', inherited })).toBeNull();
    expect(previewPrice({ cost: -1, mode: 'MARKUP', inherited })).toBeNull();
    expect(previewPrice({ cost: 100, mode: 'FIXED', fixedPrice: null, inherited })).toBeNull();
    expect(previewPrice({ cost: 100, mode: 'FIXED', fixedPrice: 0, inherited })).toBeNull();
  });
});

describe('labels and parsing', () => {
  it('describes where a markup comes from', () => {
    expect(markupSourceText('PRODUCT_MARKUP', 30, null)).toBe('product markup 30%');
    expect(markupSourceText('CATEGORY_MARKUP', 25, 'Rice')).toBe("from category 'Rice' 25%");
    expect(markupSourceText('PARENT_CATEGORY_MARKUP', 15, 'Grocery')).toBe("from parent category 'Grocery' 15%");
    expect(markupSourceText('GLOBAL_MARKUP', 20, null)).toBe('global markup 20%');
    expect(formatLkr(1250)).toBe('LKR 1,250.00');
  });

  it('parses a markup: blank = inherit, 0..999.99 with 2 decimals', () => {
    expect(parseMarkupInput('')).toEqual({ value: null });
    expect(parseMarkupInput(' 12.5 ')).toEqual({ value: 12.5 });
    expect(parseMarkupInput('0')).toEqual({ value: 0 });
    expect(parseMarkupInput('999.99')).toEqual({ value: 999.99 });
    expect(parseMarkupInput('1000')).toHaveProperty('error');
    expect(parseMarkupInput('12.345')).toHaveProperty('error');
    expect(parseMarkupInput('-1')).toHaveProperty('error');
    expect(parseMarkupInput('abc')).toHaveProperty('error');
  });
});
