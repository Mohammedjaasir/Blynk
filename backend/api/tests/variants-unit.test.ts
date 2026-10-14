import { describe, it, expect } from 'vitest';
import { resolveVariantPrice, resolveSellingPrice } from '../src/modules/pricing/index.js';
import { toCustomerVariant, variantPriceRange, variantSummary, type CustomerVariantDto, type StaffVariant } from '../src/modules/catalog/catalog.variants.js';
import { isVariantRow, validateVariantRow } from '../src/modules/catalog/catalog.import.js';
import { looseQuantities } from '../src/modules/catalog/catalog.combos.js';
import { mergeCartLines, outOfStockError } from '../src/modules/inventory/sellable.js';
import { toStaffStock } from '../src/modules/inventory/stock-view.js';
import { stockKeyOf } from '../src/modules/inventory/stock-ledger.js';
import { buildSlots, earliestDeliveryDay, DEFAULT_SCHEDULE, DEFAULT_SLOT_SETTINGS } from '../src/utils/store-hours.js';
import { leadInfo, leadQuerySchema, leadTimeRequiresSlotError, slotBeforeLeadTimeError } from '../src/modules/orders/lead-time.js';
import { orderItemInputSchema } from '../src/modules/orders/order.schema.js';
import { createVariantSchema, updateVariantSchema } from '../src/modules/catalog/catalog.variants.js';
import { setStockSchema } from '../src/modules/inventory/inventory.schema.js';
import { createProductSchema } from '../src/modules/catalog/catalog.schema.js';

/**
 * Migration 045 (owner, 2026-10-14) rules that need no database: the variant
 * price rule, the customer price range, the cart stock messages, the lead-time
 * slot window and the import's variant rows. The database behaviour is in
 * tests/variants-stock-leadtime.test.ts.
 */

const STAFF_ONLY = ['purchase_cost', 'custom_markup_percent', 'effective_markup_percent', 'pricing_source', 'pricing_mode', 'stock', 'stock_sellable', 'quantity_on_hand'];

describe('variant price rule (resolveVariantPrice)', () => {
  const inherited = { categoryMarkupPercent: 25, parentCategoryMarkupPercent: 15, globalMarkupPercent: 20 };

  it('FIXED: the variant price exactly, with the implied markup and a below-cost warning', () => {
    const p = resolveVariantPrice({ purchaseCost: 40, pricingMode: 'FIXED', fixedSellingPrice: 50, variantMarkupPercent: 99, ...inherited });
    expect(p).toMatchObject({ pricingMode: 'FIXED', pricingSource: 'FIXED', sellingPrice: 50, effectiveMarkupPercent: 25, warning: null });
    const below = resolveVariantPrice({ purchaseCost: 60, pricingMode: 'FIXED', fixedSellingPrice: 50 });
    expect(below.warning?.code).toBe('SELLING_BELOW_COST');
  });

  it("MARKUP: the variant's own markup first", () => {
    const p = resolveVariantPrice({ purchaseCost: 70, variantMarkupPercent: 30, productMarkupPercent: 10, ...inherited });
    expect(p).toMatchObject({ pricingSource: 'VARIANT_MARKUP', sellingPrice: 91, effectiveMarkupPercent: 30 });
  });

  it("then the product's custom markup, then category, parent, global", () => {
    expect(resolveVariantPrice({ purchaseCost: 100, productMarkupPercent: 10, ...inherited })).toMatchObject({ pricingSource: 'PRODUCT_MARKUP', sellingPrice: 110 });
    expect(resolveVariantPrice({ purchaseCost: 100, ...inherited })).toMatchObject({ pricingSource: 'CATEGORY_MARKUP', sellingPrice: 125 });
    expect(resolveVariantPrice({ purchaseCost: 100, parentCategoryMarkupPercent: 15, globalMarkupPercent: 20 })).toMatchObject({
      pricingSource: 'PARENT_CATEGORY_MARKUP',
      sellingPrice: 115,
    });
    expect(resolveVariantPrice({ purchaseCost: 100, globalMarkupPercent: 20 })).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', sellingPrice: 120 });
    expect(resolveVariantPrice({ purchaseCost: 100 })).toMatchObject({ pricingSource: 'GLOBAL_MARKUP', sellingPrice: 120 });
  });

  it('rounds half up to the cent exactly like the product rule (and Postgres ROUND)', () => {
    // 33.33 x 1.15 = 38.3295 -> 38.33; 0.05 x 1.5 = 0.075 -> 0.08
    expect(resolveVariantPrice({ purchaseCost: 33.33, variantMarkupPercent: 15 }).sellingPrice).toBe(38.33);
    expect(resolveVariantPrice({ purchaseCost: 0.05, variantMarkupPercent: 50 }).sellingPrice).toBe(0.08);
    for (const cost of [1, 9.99, 49.5, 123.45, 999.99]) {
      for (const m of [0, 7.5, 20, 33.33]) {
        expect(resolveVariantPrice({ purchaseCost: cost, variantMarkupPercent: m }).sellingPrice).toBe(
          resolveSellingPrice({ purchaseCost: cost, productMarkupPercent: m }).sellingPrice
        );
      }
    }
  });

  it('a blank variant markup is not 0: it falls through to the product', () => {
    expect(resolveVariantPrice({ purchaseCost: 100, variantMarkupPercent: null, productMarkupPercent: 50 }).sellingPrice).toBe(150);
    expect(resolveVariantPrice({ purchaseCost: 100, variantMarkupPercent: '', productMarkupPercent: 50 }).sellingPrice).toBe(150);
    expect(resolveVariantPrice({ purchaseCost: 100, variantMarkupPercent: 0, productMarkupPercent: 50 }).sellingPrice).toBe(100);
  });
});

describe('customer price range of a product with variants', () => {
  const v = (label: string, price: number, available = true, selling = price): CustomerVariantDto => ({
    id: label,
    label,
    sku: null,
    barcode: null,
    sort_order: 0,
    selling_price: selling,
    offer_price: price < selling ? price : null,
    offer_ends_at: null,
    offer_kind: price < selling ? 'PRODUCT' : null,
    price,
    is_available: available,
  });

  it('is the cheapest and dearest AVAILABLE variant, offers included ("LKR 50-350")', () => {
    const range = variantPriceRange([v('50 g', 50, true, 60), v('100 g', 95), v('250 g', 210), v('500 g', 350), v('1 kg', 700, false)]);
    expect(range).toMatchObject({ price_min: 50, price_max: 350 });
    expect(range!.headline.label).toBe('50 g');
    expect(range!.headline.selling_price).toBe(60);
  });

  it('falls back to every active variant when all are sold out, and is null without variants', () => {
    expect(variantPriceRange([v('a', 30, false), v('b', 90, false)])).toMatchObject({ price_min: 30, price_max: 90 });
    expect(variantPriceRange([])).toBeNull();
  });

  it('a customer variant carries prices and availability only - never cost, markup or stock', () => {
    const dto = toCustomerVariant({
      id: 'v1',
      product_id: 'p1',
      label: '100 g',
      sku: 'X-100',
      barcode: null,
      sort_order: 1,
      purchase_cost: '70.00',
      pricing_mode: 'MARKUP',
      fixed_selling_price: null,
      custom_markup_percent: '30.00',
      product_markup_percent: null,
      category_markup_percent: null,
      parent_category_markup_percent: null,
      global_markup_percent: '20.00',
      effective_markup_percent: '30.00',
      calculated_selling_price: '91.00',
      pricing_source: 'VARIANT_MARKUP',
      offer_price: '80.00',
      offer_ends_at: null,
      category_offer_percent: '50.00',
      category_offer_ends_at: null,
      is_active: true,
      is_available: true,
      product_is_active: true,
      product_is_available: true,
      delivery_lead_days: 0,
      created_at: new Date(),
      updated_at: new Date(),
      stock_tracked: true,
      stock_sellable: 7,
      is_orderable: true,
    } as never);
    // Category 50% (45.50) beats the variant's own offer (80).
    expect(dto).toEqual({
      id: 'v1',
      label: '100 g',
      sku: 'X-100',
      barcode: null,
      sort_order: 1,
      selling_price: 91,
      offer_price: 45.5,
      offer_ends_at: null,
      offer_kind: 'CATEGORY',
      price: 45.5,
      is_available: true,
    });
    for (const key of STAFF_ONLY) expect(dto).not.toHaveProperty(key);
  });

  it('staff summary: count and regular price range of the active variants', () => {
    const staff = (selling: number, active: boolean) => ({ selling_price: selling, is_active: active }) as StaffVariant;
    expect(variantSummary([staff(60, true), staff(110, true), staff(500, false)])).toEqual({
      variant_count: 3,
      active_variant_count: 2,
      price_min: 60,
      price_max: 110,
    });
    expect(variantSummary(undefined)).toEqual({ variant_count: 0, active_variant_count: 0, price_min: null, price_max: null });
  });
});

describe('stock (customers can order until it reaches 0)', () => {
  it('adds a cart up per product and per variant (loose and combo lines together)', () => {
    const merged = mergeCartLines([
      { product_id: 'p', variant_id: null, quantity: 1, name: 'Rice' },
      { product_id: 'p', variant_id: 'v1', quantity: 2, name: 'Chilli 50 g' },
      { product_id: 'p', variant_id: 'v1', quantity: 3, name: 'Chilli 50 g' },
      { product_id: 'p', variant_id: 'v2', quantity: 1, name: 'Chilli 100 g' },
    ]);
    expect(merged.map((m) => [stockKeyOf(m), m.quantity])).toEqual([
      ['p:', 1],
      ['p:v1', 5],
      ['p:v2', 1],
    ]);
    expect([...looseQuantities([{ product_id: 'p', quantity: 2 }, { product_id: 'p', variant_id: 'v1', quantity: 1 }])]).toEqual([
      ['p:', 2],
      ['p:v1', 1],
    ]);
  });

  it('says "sold out" at 0 and "only N left" otherwise (409), without other numbers', () => {
    const line = { product_id: 'p', variant_id: 'v1', quantity: 5, name: 'Chilli Powder 100 g' };
    const sold = outOfStockError(line, 0);
    expect(sold).toMatchObject({ statusCode: 409, code: 'OUT_OF_STOCK', message: 'Sorry, Chilli Powder 100 g is sold out.' });
    const few = outOfStockError(line, 3);
    expect(few).toMatchObject({ statusCode: 409, code: 'INSUFFICIENT_STOCK', message: 'Only 3 left of Chilli Powder 100 g. Please lower the quantity.' });
    expect((few as unknown as { details: object }).details).toMatchObject({ available: 3, requested: 5, variant_id: 'v1' });
  });

  it('staff stock: sellable = on hand - reserved - in open orders; low and out flags', () => {
    const row = { inventory_id: 'i', tracking_mode: 'TRACKED', quantity_on_hand: 5, quantity_reserved: 0, quantity_in_open_orders: 5, quantity_sellable: 0, low_stock_threshold: 5 };
    expect(toStaffStock(row)).toEqual({
      inventory_id: 'i',
      tracked: true,
      on_hand: 5,
      reserved: 0,
      in_open_orders: 5,
      sellable: 0,
      low_stock_threshold: 5,
      is_low_stock: true,
      is_out_of_stock: true,
    });
    expect(toStaffStock({ ...row, tracking_mode: 'UNTRACKED' })).toMatchObject({ tracked: false, sellable: null, is_low_stock: false, is_out_of_stock: false });
    expect(toStaffStock(undefined)).toMatchObject({ inventory_id: null, tracked: false, sellable: null });
  });
});

describe('delivery lead time', () => {
  const schedule = { ...DEFAULT_SCHEDULE, slots: { ...DEFAULT_SLOT_SETTINGS, enabled: true, days_ahead: 1, slot_minutes: 120 as const, min_lead_minutes: 0 } };
  // Tue 14 Oct 2026, 10:00 in Colombo (04:30 UTC).
  const now = new Date('2026-10-14T04:30:00.000Z');
  const colomboDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

  it('the earliest day is today + N in Colombo, with a label', () => {
    expect(earliestDeliveryDay(now, 0)).toMatchObject({ date: '2026-10-14', label: 'Today' });
    expect(earliestDeliveryDay(now, 1)).toMatchObject({ date: '2026-10-15', label: 'Tomorrow' });
    expect(earliestDeliveryDay(now, 2)).toMatchObject({ date: '2026-10-16', label: 'Fri 16 Oct' });
    // Late evening UTC is already the next day in Colombo.
    expect(earliestDeliveryDay(new Date('2026-10-14T19:00:00.000Z'), 0).date).toBe('2026-10-15');
  });

  it('slots start on today + N and keep the usual days_ahead window', () => {
    const plain = buildSlots(schedule, now);
    expect(new Set(plain.map((s) => colomboDay(s.start)))).toEqual(new Set(['2026-10-14', '2026-10-15']));
    const lead2 = buildSlots(schedule, now, new Map(), { leadDays: 2 });
    expect(new Set(lead2.map((s) => colomboDay(s.start)))).toEqual(new Set(['2026-10-16', '2026-10-17']));
    expect(lead2[0].label).toMatch(/^Fri 16 Oct/);
    // A whole day from opening: no "min lead minutes" cut on a future day.
    expect(lead2[0].start).toBe('2026-10-16T02:30:00.000Z');
  });

  it('answers for the app, and clear refusals', () => {
    expect(leadInfo(now, { lead_days: 0, product_name: null })).toEqual({
      lead_days: 0,
      earliest_delivery_date: '2026-10-14',
      earliest_delivery_label: 'Today',
      asap_allowed: true,
    });
    expect(leadInfo(now, { lead_days: 2, product_name: 'Ribbon Cake' })).toMatchObject({ asap_allowed: false, earliest_delivery_date: '2026-10-16' });
    const asap = leadTimeRequiresSlotError(now, { lead_days: 2, product_name: 'Ribbon Cake' }, true);
    expect(asap).toMatchObject({ statusCode: 422, code: 'LEAD_TIME_REQUIRES_SLOT' });
    expect(asap.message).toBe("'Ribbon Cake' can be delivered from Fri 16 Oct. Please pick a delivery slot on or after that day.");
    expect(leadTimeRequiresSlotError(now, { lead_days: 2, product_name: null }, false).message).toMatch(/scheduled delivery is not available right now/);
    expect(slotBeforeLeadTimeError(now, { lead_days: 1, product_name: 'Cake' })).toMatchObject({ code: 'SLOT_BEFORE_LEAD_TIME' });
  });

  it('reads ?product_ids= and ?lead_days= for slots and checkout-info', () => {
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    expect(leadQuerySchema.parse({ product_ids: `${id}, ${id}` })).toEqual({ product_ids: [id, id] });
    expect(leadQuerySchema.parse({})).toEqual({ product_ids: [] });
    expect(leadQuerySchema.parse({ lead_days: '3' }).lead_days).toBe(3);
    expect(() => leadQuerySchema.parse({ product_ids: 'nope' })).toThrow();
    expect(() => leadQuerySchema.parse({ lead_days: '31' })).toThrow();
  });

  it('the product form takes whole days 0..30', () => {
    const base = { category_id: '0f0e0d0c-0b0a-4908-8706-050403020100', name: 'Cake', sku: 'CAKE-1', unit: '1 kg', purchase_cost: 100 };
    expect(createProductSchema.parse({ ...base, delivery_lead_days: 2 }).delivery_lead_days).toBe(2);
    expect(() => createProductSchema.parse({ ...base, delivery_lead_days: 31 })).toThrow();
    expect(() => createProductSchema.parse({ ...base, delivery_lead_days: 1.5 })).toThrow();
  });
});

describe('request shapes', () => {
  it('an order line may name a variant', () => {
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    expect(orderItemInputSchema.parse({ product_id: id, variant_id: id, quantity: 2 })).toEqual({ product_id: id, variant_id: id, quantity: 2 });
    expect(orderItemInputSchema.parse({ product_id: id, quantity: 1 })).toEqual({ product_id: id, quantity: 1 });
    expect(() => orderItemInputSchema.parse({ product_id: id, variant_id: 'x', quantity: 1 })).toThrow();
  });

  it('a variant needs a label and a cost; FIXED needs a price; a count needs tracking', () => {
    expect(createVariantSchema.safeParse({ label: '100 g', purchase_cost: 70 }).success).toBe(true);
    expect(createVariantSchema.safeParse({ label: ' ', purchase_cost: 70 }).success).toBe(false);
    expect(createVariantSchema.safeParse({ label: '100 g' }).success).toBe(false);
    expect(createVariantSchema.safeParse({ label: '100 g', purchase_cost: 70, pricing_mode: 'FIXED' }).success).toBe(false);
    expect(createVariantSchema.safeParse({ label: '100 g', purchase_cost: 70, stock_count: 5 }).success).toBe(false);
    expect(createVariantSchema.safeParse({ label: '100 g', purchase_cost: 70, track_stock: true, stock_count: 5 }).success).toBe(true);
    expect(createVariantSchema.parse({ label: '100 g', purchase_cost: 70, sku: '' }).sku).toBeNull();
    expect(updateVariantSchema.safeParse({}).success).toBe(false);
    expect(updateVariantSchema.safeParse({ is_active: false }).success).toBe(true);
  });

  it('PUT .../stock: tracked required, a count only when tracked', () => {
    expect(setStockSchema.safeParse({ tracked: true, stock_count: 10, low_stock_threshold: 3 }).success).toBe(true);
    expect(setStockSchema.safeParse({ tracked: false, stock_count: 10 }).success).toBe(false);
    expect(setStockSchema.safeParse({ stock_count: 10 }).success).toBe(false);
    expect(setStockSchema.safeParse({ tracked: true, stock_count: -1 }).success).toBe(false);
  });
});

describe('import: variant rows', () => {
  it('a row is a variant row when variant or parent_sku is filled', () => {
    expect(isVariantRow({ name: 'Rice', sku: 'R1' })).toBe(false);
    expect(isVariantRow({ variant: '100 g' })).toBe(true);
    expect(isVariantRow({ parent_sku: 'CHILLI' })).toBe(true);
    expect(isVariantRow({ variant: '  ', parent_sku: '' })).toBe(false);
  });

  it('needs parent_sku, variant and purchase_cost - not name, category or unit', () => {
    const ok = validateVariantRow({ row: 6, parent_sku: 'CHILLI-PWD', variant: '50 g', purchase_cost: 40, selling_price: 50, sku: 'CHILLI-PWD-50G', tracked: 'yes', opening_stock: 20 }, 0);
    expect(ok.errors).toEqual([]);
    expect(ok.row).toMatchObject({ row: 6, parent_sku: 'CHILLI-PWD', label: '50 g', cost_price: 40, selling_price: 50, sku: 'CHILLI-PWD-50G', tracked: true, opening_stock: 20 });
    const bad = validateVariantRow({ variant: '50 g' }, 3);
    expect(bad.rowNo).toBe(5);
    expect(bad.errors.map((e) => e.field).sort()).toEqual(['parent_sku', 'purchase_cost']);
  });

  it('the same pricing and stock rules as a product row', () => {
    const fields = (raw: Record<string, unknown>) =>
      validateVariantRow({ parent_sku: 'PPP', variant: 'v', purchase_cost: 10, ...raw }, 0).errors.map((e) => e.field);
    expect(fields({ selling_price: 20, markup_percent: 10 })).toEqual(['selling_price']);
    expect(fields({ markup_percent: 1000 })).toEqual(['markup_percent']);
    expect(fields({ opening_stock: 5 })).toEqual(['opening_stock']);
    expect(fields({ sku: 'PPP' })).toEqual(['sku']);
    expect(fields({ sku: 'AB' })).toEqual(['sku']);
    expect(fields({ tracked: 'maybe' })).toEqual(['tracked']);
  });
});
