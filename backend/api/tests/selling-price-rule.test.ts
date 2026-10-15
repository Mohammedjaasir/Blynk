import { describe, it, expect } from 'vitest';
import {
  calculateSellingPrice,
  defaultMarkupFrom,
  impliedMarkupPercent,
  markupPrice,
  recordableMarkupPercent,
  resolveSellingPrice,
} from '../src/modules/pricing/index.js';
import { staffPricing } from '../src/modules/catalog/catalog.pricing.js';
import { validateImportRow } from '../src/modules/catalog/catalog.import.js';

/**
 * The selling-price rule (migration 044; owner, 2026-10-13), without a
 * database: FIXED price, or cost x (product, category, parent category,
 * global) markup, rounded to the cent like Postgres ROUND(numeric, 2).
 */
describe('resolveSellingPrice - MARKUP sources in order', () => {
  const base = { purchaseCost: 200, categoryMarkupPercent: 25, parentCategoryMarkupPercent: 15, globalMarkupPercent: 20 };

  it('a product markup wins over everything', () => {
    expect(resolveSellingPrice({ ...base, productMarkupPercent: 30 })).toMatchObject({
      pricingMode: 'MARKUP',
      pricingSource: 'PRODUCT_MARKUP',
      sellingPrice: 260,
      effectiveMarkupPercent: 30,
      warning: null,
    });
  });

  it('a product markup of 0 is a markup (cost price), not "blank"', () => {
    expect(resolveSellingPrice({ ...base, productMarkupPercent: 0 })).toMatchObject({ pricingSource: 'PRODUCT_MARKUP', sellingPrice: 200 });
  });

  it('then the category markup', () => {
    expect(resolveSellingPrice({ ...base, productMarkupPercent: null })).toMatchObject({
      pricingSource: 'CATEGORY_MARKUP',
      sellingPrice: 250,
      effectiveMarkupPercent: 25,
    });
    // Postgres NUMERIC arrives as a string.
    expect(resolveSellingPrice({ ...base, categoryMarkupPercent: '25.00' })).toMatchObject({ pricingSource: 'CATEGORY_MARKUP', sellingPrice: 250 });
  });

  it('then the parent category markup', () => {
    expect(resolveSellingPrice({ ...base, categoryMarkupPercent: null })).toMatchObject({
      pricingSource: 'PARENT_CATEGORY_MARKUP',
      sellingPrice: 230,
      effectiveMarkupPercent: 15,
    });
  });

  it('then the global markup, and 20% when even that is missing', () => {
    expect(resolveSellingPrice({ purchaseCost: 200, globalMarkupPercent: 10 })).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', sellingPrice: 220 });
    expect(resolveSellingPrice({ purchaseCost: 200 })).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', sellingPrice: 240, effectiveMarkupPercent: 20 });
    // Blank strings are "not set".
    expect(resolveSellingPrice({ purchaseCost: 200, productMarkupPercent: '', categoryMarkupPercent: ' ' })).toMatchObject({
      pricingSource: 'GLOBAL_MARKUP',
    });
  });

  it('pricing_mode MARKUP ignores a stored fixed price', () => {
    expect(resolveSellingPrice({ ...base, pricingMode: 'MARKUP', fixedSellingPrice: 999 })).toMatchObject({ pricingSource: 'CATEGORY_MARKUP', sellingPrice: 250 });
  });

  it('refuses a negative cost or markup', () => {
    expect(() => resolveSellingPrice({ purchaseCost: -1 })).toThrow();
    expect(() => resolveSellingPrice({ purchaseCost: 10, productMarkupPercent: -5 })).toThrow();
  });
});

describe('rounding (half up to the cent, exact like Postgres ROUND)', () => {
  it('rounds the half cent up where float maths would round it down', () => {
    // 1.15 x 1.5 = 1.725 exactly; in floating point 1.7249999...
    expect(markupPrice(1.15, 50)).toBe(1.73);
    expect(resolveSellingPrice({ purchaseCost: 1.15, productMarkupPercent: 50 }).sellingPrice).toBe(1.73);
    expect(calculateSellingPrice({ purchaseCost: 1.15, customMarkupPercent: 50 }).sellingPrice).toBe(1.73);
  });

  it('handles fractional markups and tiny costs', () => {
    expect(markupPrice(99.99, 12.5)).toBe(112.49); // 112.48875
    expect(markupPrice(0.05, 10)).toBe(0.06); // 0.055
    expect(markupPrice(0.01, 0)).toBe(0.01);
    expect(markupPrice(0, 25)).toBe(0);
    expect(markupPrice(99_999_999.99, 999.99)).toBe(1_099_989_999.89); // integer maths stays exact at the column limits
  });

  it('keeps the existing prices: custom else global, the same as before 044', () => {
    expect(calculateSellingPrice({ purchaseCost: 400, customMarkupPercent: null, defaultMarkupPercent: 20 }).sellingPrice).toBe(480);
    expect(calculateSellingPrice({ purchaseCost: 700, customMarkupPercent: 15, defaultMarkupPercent: 20 }).sellingPrice).toBe(805);
    for (const [cost, markup] of [
      [123.45, 17.5],
      [80, 25],
      [33.33, 33.33],
      [1999.99, 7.25],
    ] as const) {
      expect(resolveSellingPrice({ purchaseCost: cost, globalMarkupPercent: markup }).sellingPrice).toBe(
        calculateSellingPrice({ purchaseCost: cost, defaultMarkupPercent: markup }).sellingPrice
      );
    }
  });
});

describe('resolveSellingPrice - FIXED', () => {
  it('charges exactly the fixed price and reports the implied markup', () => {
    expect(resolveSellingPrice({ purchaseCost: 200, pricingMode: 'FIXED', fixedSellingPrice: '275.00', productMarkupPercent: 50 })).toEqual({
      pricingMode: 'FIXED',
      pricingSource: 'FIXED',
      purchaseCost: 200,
      sellingPrice: 275,
      effectiveMarkupPercent: 37.5,
      warning: null,
      // Migration 048: no MRP, so nothing is capped.
      computedSellingPrice: 275,
      mrp: null,
      mrpCapped: false,
    });
  });

  it('a fixed price below cost is allowed, with a warning and a negative implied markup', () => {
    const r = resolveSellingPrice({ purchaseCost: 100, pricingMode: 'FIXED', fixedSellingPrice: 90 });
    expect(r.sellingPrice).toBe(90);
    expect(r.effectiveMarkupPercent).toBe(-10);
    expect(r.warning).toEqual({ code: 'SELLING_BELOW_COST', message: 'The selling price LKR 90.00 is below the purchase cost LKR 100.00.' });
    // At cost: no warning.
    expect(resolveSellingPrice({ purchaseCost: 100, pricingMode: 'FIXED', fixedSellingPrice: 100 }).warning).toBeNull();
  });

  it('a zero cost has no implied markup', () => {
    expect(resolveSellingPrice({ purchaseCost: 0, pricingMode: 'FIXED', fixedSellingPrice: 50 })).toMatchObject({
      sellingPrice: 50,
      effectiveMarkupPercent: null,
      warning: null,
    });
    expect(impliedMarkupPercent(0, 10)).toBeNull();
    expect(impliedMarkupPercent(3, 4)).toBe(33.33);
  });

  it('needs a fixed price above 0', () => {
    expect(() => resolveSellingPrice({ purchaseCost: 10, pricingMode: 'FIXED', fixedSellingPrice: null })).toThrow();
    expect(() => resolveSellingPrice({ purchaseCost: 10, pricingMode: 'FIXED', fixedSellingPrice: 0 })).toThrow();
  });
});

describe('helpers', () => {
  it('recordableMarkupPercent fits order_items NUMERIC(5,2) and never null', () => {
    expect(recordableMarkupPercent(null)).toBe(0);
    expect(recordableMarkupPercent(undefined)).toBe(0);
    expect(recordableMarkupPercent('37.50')).toBe(37.5);
    expect(recordableMarkupPercent(-10)).toBe(-10);
    expect(recordableMarkupPercent(9900)).toBe(999.99);
    expect(recordableMarkupPercent(-5000)).toBe(-999.99);
  });

  it('defaultMarkupFrom reads system_configurations.default_markup, 20 when unusable', () => {
    expect(defaultMarkupFrom({ markup_percent: 25 })).toBe(25);
    expect(defaultMarkupFrom({ markup_percent: '17.5' })).toBe(17.5);
    expect(defaultMarkupFrom({ markup_percent: -1 })).toBe(20);
    expect(defaultMarkupFrom({})).toBe(20);
    expect(defaultMarkupFrom(null)).toBe(20);
  });

  it('staffPricing shapes a catalog row for Admin/Ops, with the below-cost warning', () => {
    const fixed = staffPricing({
      purchase_cost: '100.00',
      pricing_mode: 'FIXED',
      fixed_selling_price: '90.00',
      custom_markup_percent: null,
      category_markup_percent: '25.00',
      parent_category_markup_percent: null,
      global_markup_percent: '20',
      effective_markup_percent: '-10.00',
      pricing_source: 'FIXED',
      calculated_selling_price: '90.00',
    });
    expect(fixed).toMatchObject({
      purchase_cost: 100,
      pricing_mode: 'FIXED',
      fixed_selling_price: 90,
      category_markup_percent: 25,
      global_markup_percent: 20,
      effective_markup_percent: -10,
      pricing_source: 'FIXED',
      calculated_selling_price: 90,
      selling_price: 90,
    });
    expect(fixed.price_warning?.code).toBe('SELLING_BELOW_COST');
    const markup = staffPricing({
      purchase_cost: 200,
      pricing_mode: 'MARKUP',
      fixed_selling_price: null,
      custom_markup_percent: null,
      category_markup_percent: '25.00',
      effective_markup_percent: '25.00',
      pricing_source: 'CATEGORY_MARKUP',
      calculated_selling_price: '250.00',
    });
    expect(markup).toMatchObject({ pricing_source: 'CATEGORY_MARKUP', selling_price: 250, price_warning: null });
  });
});

describe('import rows: pricing columns (validateImportRow)', () => {
  const row = (extra: Record<string, unknown>) => ({ name: 'Rice 5kg', category: 'Rice', unit: 'bag', sku: 'RICE-5KG', ...extra });
  const fieldErrors = (extra: Record<string, unknown>) => validateImportRow(row(extra), 0).errors;

  it('accepts purchase_cost, or the older cost_price header', () => {
    expect(validateImportRow(row({ purchase_cost: 100 }), 0).row?.cost_price).toBe(100);
    expect(validateImportRow(row({ cost_price: '1,250.50' }), 0).row?.cost_price).toBe(1250.5);
    expect(validateImportRow(row({ purchase_cost: 100, cost_price: 100 }), 0).errors).toEqual([]);
    expect(fieldErrors({ purchase_cost: 100, cost_price: 90 })).toEqual([
      { field: 'purchase_cost', message: 'purchase_cost and cost_price differ; fill only one of them' },
    ]);
    expect(fieldErrors({})).toEqual([{ field: 'purchase_cost', message: 'Purchase cost is required' }]);
  });

  it('selling_price or markup_percent, never both', () => {
    expect(fieldErrors({ purchase_cost: 100, selling_price: 120, markup_percent: 20 })).toEqual([
      { field: 'selling_price', message: 'Give either selling_price or markup_percent, not both' },
    ]);
    expect(validateImportRow(row({ purchase_cost: 100, selling_price: 120 }), 0).row).toMatchObject({ selling_price: 120, markup_percent: undefined });
    expect(validateImportRow(row({ purchase_cost: 100, markup_percent: '12.5' }), 0).row).toMatchObject({ selling_price: undefined, markup_percent: 12.5 });
  });

  it('a selling price below cost is allowed (a warning later), but must be above 0', () => {
    expect(fieldErrors({ purchase_cost: 100, selling_price: 90 })).toEqual([]);
    expect(fieldErrors({ purchase_cost: 0, selling_price: 50 })).toEqual([]);
    expect(fieldErrors({ purchase_cost: 100, selling_price: 0 })[0]?.message).toBe('Selling price must be above 0');
    expect(fieldErrors({ purchase_cost: 100, selling_price: 10.555 })[0]?.message).toBe('Selling price can have at most 2 decimals');
  });

  it('markup_percent is 0 to 999.99 with at most 2 decimals', () => {
    expect(fieldErrors({ purchase_cost: 100, markup_percent: 0 })).toEqual([]);
    expect(fieldErrors({ purchase_cost: 100, markup_percent: 1000 })[0]?.field).toBe('markup_percent');
    expect(fieldErrors({ purchase_cost: 100, markup_percent: -1 })[0]?.field).toBe('markup_percent');
    expect(fieldErrors({ purchase_cost: 100, markup_percent: 'abc' })[0]?.message).toBe('Markup must be a number');
  });
});
