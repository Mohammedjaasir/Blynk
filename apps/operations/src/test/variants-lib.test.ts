import { describe, expect, it } from 'vitest';
import { leadTimeLabel, parseLeadDays, productPriceText } from '../lib/catalog';
import { staffStockBadge, stockRowKey, stockRowName } from '../lib/inventory';
import { orderItemName, orderItemUnit } from '../lib/orders';
import { parseImportRow, parseSheet, resultLabel, rowPricing, TEMPLATE_COLUMNS } from '../lib/productImport';
import { resolveVariantPrice } from '../lib/pricing';

/** Variants, customer-hidden stock and delivery lead time (migration 045) - the pure helpers. */

const BASE = { categoryMarkupPercent: 25, parentCategoryMarkupPercent: 15, globalMarkupPercent: 18 };

describe('resolveVariantPrice (twin of the backend)', () => {
  it('FIXED: exactly the fixed price, implied markup over cost', () => {
    const r = resolveVariantPrice({ ...BASE, purchaseCost: 40, pricingMode: 'FIXED', fixedSellingPrice: 50, variantMarkupPercent: 99 });
    expect(r).toMatchObject({ pricingMode: 'FIXED', pricingSource: 'FIXED', sellingPrice: 50, effectiveMarkupPercent: 25 });
  });

  it("MARKUP: the variant's own markup wins", () => {
    const r = resolveVariantPrice({ ...BASE, purchaseCost: 70, pricingMode: 'MARKUP', variantMarkupPercent: 30, productMarkupPercent: 50 });
    expect(r).toMatchObject({ pricingSource: 'VARIANT_MARKUP', sellingPrice: 91, effectiveMarkupPercent: 30 });
  });

  it("falls back to the product's markup, then category, parent, global (20% when unset)", () => {
    expect(resolveVariantPrice({ ...BASE, purchaseCost: 100, variantMarkupPercent: null, productMarkupPercent: 40 })).toMatchObject({
      pricingSource: 'PRODUCT_MARKUP',
      sellingPrice: 140,
    });
    expect(resolveVariantPrice({ ...BASE, purchaseCost: 100, variantMarkupPercent: '', productMarkupPercent: null })).toMatchObject({
      pricingSource: 'CATEGORY_MARKUP',
      sellingPrice: 125,
    });
    expect(
      resolveVariantPrice({ purchaseCost: 100, categoryMarkupPercent: null, parentCategoryMarkupPercent: 15, globalMarkupPercent: 18 })
    ).toMatchObject({ pricingSource: 'PARENT_CATEGORY_MARKUP', sellingPrice: 115 });
    expect(resolveVariantPrice({ purchaseCost: 100, globalMarkupPercent: 18 })).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', sellingPrice: 118 });
    expect(resolveVariantPrice({ purchaseCost: 100 })).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', sellingPrice: 120 });
  });

  it('rounds to the cent exactly (half up on whole cents)', () => {
    // 33.33 x 1.125 = 37.49625 -> 37.50
    expect(resolveVariantPrice({ purchaseCost: 33.33, variantMarkupPercent: 12.5 }).sellingPrice).toBe(37.5);
    // 0.1 x 1.15 = 0.115 -> 0.12 (float maths would give 0.11)
    expect(resolveVariantPrice({ purchaseCost: 0.1, variantMarkupPercent: 15 }).sellingPrice).toBe(0.12);
    // A fixed price is rounded to 2 decimals too.
    expect(resolveVariantPrice({ purchaseCost: 10, pricingMode: 'FIXED', fixedSellingPrice: '12.345' }).sellingPrice).toBe(12.35);
  });

  it('refuses a FIXED price that is missing, as the server does', () => {
    expect(() => resolveVariantPrice({ purchaseCost: 10, pricingMode: 'FIXED', fixedSellingPrice: null })).toThrow();
  });
});

describe('catalog helpers', () => {
  it('product price: range for variants, single price otherwise', () => {
    expect(productPriceText({ has_variants: true, price_min: 50, price_max: 350 })).toBe('LKR 50 - 350');
    expect(productPriceText({ has_variants: true, price_min: 60, price_max: 60 })).toBe('LKR 60');
    expect(productPriceText({ has_variants: true, price_min: 49.5, price_max: 91 })).toBe('LKR 49.50 - 91');
    expect(productPriceText({ has_variants: false, calculated_selling_price: 125 })).toBe('LKR 125.00');
  });

  it('lead days: whole 0-30, blank = 0', () => {
    expect(parseLeadDays('')).toEqual({ value: 0 });
    expect(parseLeadDays('2')).toEqual({ value: 2 });
    expect(parseLeadDays('31')).toHaveProperty('error');
    expect(parseLeadDays('1.5')).toHaveProperty('error');
    expect(leadTimeLabel(0)).toBeNull();
    expect(leadTimeLabel(1)).toBe('Delivered after 1 day');
    expect(leadTimeLabel(3)).toBe('Delivered after 3 days');
  });

  it('staff stock badge', () => {
    const s = { tracked: true, sellable: 3, is_low_stock: true, is_out_of_stock: false };
    expect(staffStockBadge(s)).toEqual({ kind: 'LOW', label: 'Low · 3 left' });
    expect(staffStockBadge({ ...s, sellable: 0, is_out_of_stock: true })).toEqual({ kind: 'OUT', label: 'Sold out' });
    expect(staffStockBadge({ ...s, sellable: 24, is_low_stock: false })).toEqual({ kind: 'IN_STOCK', label: '24 in stock' });
    expect(staffStockBadge({ ...s, tracked: false })).toBeNull();
  });

  it('stock rows: display name and a product + variant key', () => {
    expect(stockRowName({ product_name: 'Chilli Powder', display_name: 'Chilli Powder - 100 g' })).toBe('Chilli Powder - 100 g');
    expect(stockRowName({ product_name: 'Chilli Powder', variant_label: '50 g' })).toBe('Chilli Powder - 50 g');
    expect(stockRowKey({ product_id: 'p', variant_id: 'v1' })).not.toBe(stockRowKey({ product_id: 'p', variant_id: 'v2' }));
    expect(stockRowKey({ product_id: 'p', variant_id: null })).toBe('p:');
  });

  it('order lines: variant label with the name, never twice', () => {
    const line = { product_name_snapshot: 'Chilli Powder', variant_label_snapshot: '100 g', unit_snapshot: '100 g' };
    expect(orderItemName(line)).toBe('Chilli Powder - 100 g');
    expect(orderItemUnit(line)).toBe('');
    expect(orderItemName({ product_name_snapshot: 'Kotmale Milk 1L', variant_label_snapshot: null })).toBe('Kotmale Milk 1L');
    expect(orderItemUnit({ unit_snapshot: '1 L', variant_label_snapshot: null })).toBe('1 L');
  });
});

describe('import: variant rows', () => {
  it('accepts a variant row without name/category/unit/sku and sends parent_sku + variant', () => {
    const r = parseImportRow({ parent_sku: 'CHILLI-PWD', variant: '100 g', purchase_cost: 70, markup_percent: 30 }, 6);
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ parent_sku: 'CHILLI-PWD', variant: '100 g', name: '', sku: '', purchase_cost: 70 });
    expect(r.data).not.toHaveProperty('delivery_lead_days');
    expect(rowPricing(r.data, undefined)).toMatchObject({ price: 91, source: 'VARIANT_MARKUP', label: 'Variant markup' });
  });

  it('needs parent_sku, variant and purchase_cost on a variant row', () => {
    const fields = parseImportRow({ variant: '50 g' }, 2).errors.map((e) => e.field);
    expect(fields).toEqual(['parent_sku', 'purchase_cost']);
    expect(parseImportRow({ parent_sku: 'X-1', purchase_cost: 5 }, 2).errors.map((e) => e.field)).toEqual(['variant']);
    expect(parseImportRow({ parent_sku: 'X-1', variant: '1 kg', purchase_cost: 5, sku: 'X-1' }, 2).errors[0]!.field).toBe('sku');
    expect(parseImportRow({ parent_sku: 'X-1', variant: '1 kg', purchase_cost: 5, sku: 'ab' }, 2).errors[0]!.field).toBe('sku');
  });

  it('delivery_lead_days: whole 0-30 on product rows, sent when filled', () => {
    const good = { name: 'Ribbon Cake', category: 'Bakery', unit: '1 kg', purchase_cost: 2500, sku: 'CAKE-1' };
    expect(parseImportRow({ ...good, delivery_lead_days: '2' }, 2).data.delivery_lead_days).toBe(2);
    expect(parseImportRow({ ...good, delivery_lead_days: 31 }, 2).errors[0]!.field).toBe('delivery_lead_days');
    expect(parseImportRow({ ...good, delivery_lead_days: 1.5 }, 2).errors[0]!.field).toBe('delivery_lead_days');
    expect(parseImportRow({ ...good }, 2).data).not.toHaveProperty('delivery_lead_days');
  });

  it('flags the same variant twice in one file', () => {
    const line = (v: Record<string, unknown>) => TEMPLATE_COLUMNS.map((c) => v[c] ?? null);
    const sheet = parseSheet([
      [...TEMPLATE_COLUMNS],
      line({ parent_sku: 'CHILLI-PWD', variant: '50 g', purchase_cost: 40 }),
      line({ parent_sku: 'chilli-pwd', variant: '50 G', purchase_cost: 41 }),
    ]);
    expect(sheet.rows[0]!.errors).toEqual([]);
    expect(sheet.rows[1]!.errors).toEqual([{ field: 'variant', message: 'Same variant as row 2.' }]);
  });

  it('describes variant dry-run results', () => {
    expect(resultLabel({ row: 2, sku: null, status: 'created', kind: 'variant' })).toBe('New variant will be added');
    expect(resultLabel({ row: 2, sku: null, status: 'updated', kind: 'variant' })).toBe('Will update the existing variant');
  });
});
