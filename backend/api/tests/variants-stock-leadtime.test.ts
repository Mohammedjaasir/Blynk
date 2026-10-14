import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { storeSchedule, DEFAULT_STORED_SCHEDULE } from '../src/modules/configuration/store-schedule.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Migration 045 (owner, 2026-10-14), against the database:
 *   A. variants - staff CRUD (Admin and Ops), the customer price range and
 *      variant list, server pricing of variant order lines, order snapshots,
 *      combos holding a variant, the Excel import (dry run, apply, re-import);
 *   B. stock - the product form's stock call, order-time enforcement for every
 *      tracked item (loose products too), the catalog's sold-out flag (never a
 *      count), per-variant decrement at pack and restore on cancel, variants
 *      on the low-stock and purchase lists;
 *   C. delivery lead time - slots from today + N days, ASAP refused, the
 *      earliest date on GET /orders/slots and /orders/checkout-info.
 * Customers never see a cost, markup, pricing source or stock number.
 *
 * Everything made here is removed afterwards (products cascade to their
 * variants and stock rows; orders, combos, audit rows by id).
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-VAR-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const TAG = `TST-VAR-${Date.now()}`;
const made = { combos: [] as string[] };

const STAFF_ONLY_KEYS = [
  'purchase_cost',
  'custom_markup_percent',
  'effective_markup_percent',
  'calculated_selling_price',
  'pricing_mode',
  'pricing_source',
  'fixed_selling_price',
  'category_markup_percent',
  'parent_category_markup_percent',
  'global_markup_percent',
  'product_markup_percent',
  'price_warning',
  'stock',
  'stock_tracked',
  'stock_sellable',
  'is_orderable',
  'quantity_on_hand',
  'quantity_sellable',
  'on_hand',
  'sellable',
  'low_stock_threshold',
];

function expectNoStaffKeys(obj: unknown, where: string) {
  const text = JSON.stringify(obj);
  for (const key of STAFF_ONLY_KEYS) expect(text.includes(`"${key}"`), `${where} leaks ${key}`).toBe(false);
}

let categoryId = '';
let seq = 0;

async function createProduct(body: Record<string, unknown> = {}, token = tokens.admin) {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(token))
    .send({ category_id: categoryId, name: `${TAG} P${seq}`, sku: `${TAG}-P${seq}`, unit: '1 pack', purchase_cost: 100, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  fx.created.products.push(res.body.data.product.id);
  return res.body.data.product as { id: string; sku: string; name: string };
}

const addVariant = (productId: string, body: object, token = opsToken) =>
  request(app).post(`/api/v1/admin/products/${productId}/variants`).set(auth(token)).send(body);
const editVariant = (productId: string, variantId: string, body: object, token = opsToken) =>
  request(app).patch(`/api/v1/admin/products/${productId}/variants/${variantId}`).set(auth(token)).send(body);
const setStock = (productId: string, body: object, token = opsToken) =>
  request(app).put(`/api/v1/admin/inventory/${productId}/stock`).set(auth(token)).send(body);
const customerProduct = async (id: string) => (await request(app).get(`/api/v1/products/${id}`)).body.data.product;
const adminProduct = async (id: string) => (await request(app).get(`/api/v1/admin/products/${id}`).set(auth(tokens.admin))).body.data.product;

const order = async (items: object[], extra: object = {}) => {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(auth(tokens.customer))
    .send({ address_id: fx.addressId, items, ...extra });
  if (res.status === 201) fx.created.orders.push(res.body.data.order.id);
  return res;
};

/** A product with three variants: 50 g FIXED 50 (offer 45), 100 g cost 70 +30% = 91, 250 g FIXED 210. */
async function chilli() {
  const product = await createProduct({ custom_markup_percent: 10 });
  const v50 = await addVariant(product.id, { label: '50 g', sku: `${product.sku}-50`, purchase_cost: 40, pricing_mode: 'FIXED', fixed_selling_price: 50, offer_price: 45 });
  expect(v50.status, JSON.stringify(v50.body)).toBe(201);
  const v100 = await addVariant(product.id, { label: '100 g', purchase_cost: 70, custom_markup_percent: 30 });
  expect(v100.status, JSON.stringify(v100.body)).toBe(201);
  const v250 = await addVariant(product.id, { label: '250 g', purchase_cost: 150, pricing_mode: 'FIXED', fixed_selling_price: 210 });
  expect(v250.status, JSON.stringify(v250.body)).toBe(201);
  return { product, v50: v50.body.data.variant, v100: v100.body.data.variant, v250: v250.body.data.variant };
}

const pinnedRead = storeSchedule.read;

beforeAll(async () => {
  await pool.query(`DELETE FROM combos WHERE name LIKE 'TST-VAR-%'`);
  await fx.setup();
  categoryId = (await pool.query('SELECT id FROM categories WHERE is_active = true AND deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  storeSchedule.read = pinnedRead;
  if (made.combos.length) {
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [made.combos]);
    await pool.query('DELETE FROM combos WHERE id = ANY($1)', [made.combos]);
  }
  if (fx.created.products.length) await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [fx.created.products]);
  await fx.cleanup();
});

// ----------------------------------------------------------------------------
describe('A. variants: staff (Admin and Ops)', () => {
  it('Ops adds variants; each is priced by its own rule (fixed, own markup, product markup fallback)', async () => {
    const { product, v50, v100, v250 } = await chilli();
    expect(v50).toMatchObject({ label: '50 g', pricing_mode: 'FIXED', pricing_source: 'FIXED', selling_price: 50, offer_price: 45, offer_active: true, customer_price: 45, sort_order: 0 });
    expect(v100).toMatchObject({ pricing_source: 'VARIANT_MARKUP', purchase_cost: 70, selling_price: 91, effective_markup_percent: 30, sort_order: 1 });
    expect(v250).toMatchObject({ selling_price: 210, sort_order: 2 });
    expect(v100.stock).toMatchObject({ tracked: false, sellable: null });

    // No own markup: the product's custom markup (10%).
    const v1kg = await addVariant(product.id, { label: '1 kg', purchase_cost: 500 }, tokens.admin);
    expect(v1kg.status).toBe(201);
    expect(v1kg.body.data.variant).toMatchObject({ pricing_source: 'PRODUCT_MARKUP', selling_price: 550, product_markup_percent: 10 });

    const staff = await adminProduct(product.id);
    expect(staff).toMatchObject({ has_variants: true, variant_count: 4, active_variant_count: 4, price_min: 50, price_max: 550, delivery_lead_days: 0 });
    expect(staff.variants.map((v: { label: string }) => v.label)).toEqual(['50 g', '100 g', '250 g', '1 kg']);

    const list = await request(app).get('/api/v1/admin/products').query({ search: product.sku }).set(auth(opsToken));
    expect(list.body.data.products[0]).toMatchObject({ id: product.id, has_variants: true, variant_count: 4, price_min: 50, price_max: 550 });
  });

  it('refuses a duplicate label, a taken SKU, an offer not below the price; reorders and deletes', async () => {
    const { product, v50, v100, v250 } = await chilli();
    expect((await addVariant(product.id, { label: '100G ', purchase_cost: 1 })).status).toBe(201); // '100G' differs from '100 g'
    const dup = await addVariant(product.id, { label: ' 50 G', purchase_cost: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('VARIANT_LABEL_EXISTS');
    const sku = await addVariant(product.id, { label: 'x', sku: product.sku, purchase_cost: 1 });
    expect(sku.body.error.code).toBe('VARIANT_SKU_EXISTS');
    // A product cannot take a variant's SKU either.
    const clash = await request(app)
      .post('/api/v1/admin/products')
      .set(auth(tokens.admin))
      .send({ category_id: categoryId, name: `${TAG} clash`, sku: `${product.sku}-50`, unit: '1', purchase_cost: 1 });
    expect(clash.status).toBe(409);

    const offer = await editVariant(product.id, v250.id, { offer_price: 210 });
    expect(offer.status).toBe(400);
    expect(offer.body.error.code).toBe('OFFER_PRICE_NOT_LOWER');
    const edited = await editVariant(product.id, v250.id, { fixed_selling_price: 220, offer_price: 199 });
    expect(edited.body.data.variant).toMatchObject({ selling_price: 220, offer_price: 199, customer_price: 199 });

    const all = (await request(app).get(`/api/v1/admin/products/${product.id}/variants`).set(auth(opsToken))).body.data.variants;
    const ids = all.map((v: { id: string }) => v.id).reverse();
    const reordered = await request(app).put(`/api/v1/admin/products/${product.id}/variants/order`).set(auth(opsToken)).send({ variant_ids: ids });
    expect(reordered.status, JSON.stringify(reordered.body)).toBe(200);
    expect(reordered.body.data.variants.map((v: { id: string }) => v.id)).toEqual(ids);
    const partial = await request(app).put(`/api/v1/admin/products/${product.id}/variants/order`).set(auth(opsToken)).send({ variant_ids: ids.slice(1) });
    expect(partial.body.error.code).toBe('VARIANT_ORDER_MISMATCH');

    const del = await request(app).delete(`/api/v1/admin/products/${product.id}/variants/${v100.id}`).set(auth(opsToken));
    expect(del.body.data).toMatchObject({ mode: 'HARD' });
    expect((await adminProduct(product.id)).variants.some((v: { id: string }) => v.id === v100.id)).toBe(false);
    const audits = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`, [product.id]);
    expect(audits.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['PRODUCT_VARIANT_CREATED', 'PRODUCT_VARIANT_UPDATED', 'PRODUCT_VARIANTS_REORDERED', 'PRODUCT_VARIANT_DELETED'])
    );
    void v50;
  });

  it('customers and packing staff cannot manage variants or stock', async () => {
    const product = await createProduct();
    expect((await addVariant(product.id, { label: 'x', purchase_cost: 1 }, tokens.customer)).status).toBe(403);
    expect((await addVariant(product.id, { label: 'x', purchase_cost: 1 }, tokens.staff)).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/products/${product.id}/variants`).set(auth(tokens.customer))).status).toBe(403);
    expect((await setStock(product.id, { tracked: true, stock_count: 5 }, tokens.customer)).status).toBe(403);
    expect((await setStock(product.id, { tracked: true, stock_count: 5 }, tokens.staff)).status).toBe(403);
  });
});

describe('A. variants: customer catalog', () => {
  it('lists a price range and the variants - prices and availability only', async () => {
    const { product, v100, v250 } = await chilli();
    const detail = await customerProduct(product.id);
    expect(detail).toMatchObject({
      has_variants: true,
      variant_count: 3,
      price_min: 45, // the 50 g offer
      price_max: 210,
      selling_price: 50, // the cheapest variant, for older apps
      offer_price: 45,
      is_available: true,
      delivery_lead_days: 0,
      earliest_delivery_date: null,
    });
    expect(detail.variants.map((v: { label: string; price: number }) => [v.label, v.price])).toEqual([
      ['50 g', 45],
      ['100 g', 91],
      ['250 g', 210],
    ]);
    expectNoStaffKeys(detail, 'customer product detail');

    // A switched-off variant disappears; a sold-out one stays, marked, and leaves the range.
    await editVariant(product.id, v250.id, { is_active: false });
    expect((await setStock(product.id, { variant_id: v100.id, tracked: true, stock_count: 0 })).status).toBe(200);
    const after = await customerProduct(product.id);
    expect(after.variants.map((v: { label: string; is_available: boolean }) => [v.label, v.is_available])).toEqual([
      ['50 g', true],
      ['100 g', false],
    ]);
    expect(after).toMatchObject({ price_min: 45, price_max: 45, variant_count: 2 });

    const list = await request(app).get('/api/v1/products').query({ search: product.sku, limit: 5 });
    const tile = list.body.data.products.find((p: { id: string }) => p.id === product.id);
    expect(tile).toMatchObject({ has_variants: true, price_min: 45, price_max: 45, is_available: true });
    expect(tile.variants).toBeUndefined();
    expectNoStaffKeys(list.body, 'customer product list');
  });

  it('a product without variants keeps its shape, with price_min = price_max', async () => {
    const plain = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 120 });
    const p = await customerProduct(plain.id);
    expect(p).toMatchObject({ has_variants: false, variant_count: 0, selling_price: 120, price_min: 120, price_max: 120, variants: [] });
    expectNoStaffKeys(p, 'plain product');
  });

  it('on_offer lists a product whose variant is on offer', async () => {
    const { product } = await chilli();
    const res = await request(app).get('/api/v1/products').query({ on_offer: 'true', search: product.sku });
    expect(res.body.data.products.map((p: { id: string }) => p.id)).toContain(product.id);
  });
});

describe('A. variants: orders and combos', () => {
  it('prices a variant line on the server and snapshots its label', async () => {
    const { product, v50, v100 } = await chilli();
    const res = await order([
      { product_id: product.id, variant_id: v50.id, quantity: 2 },
      { product_id: product.id, variant_id: v100.id, quantity: 1 },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.order.subtotal_amount).toBe(181); // 2 x 45 + 91
    const rows = (
      await pool.query(
        `SELECT variant_id, variant_label_snapshot, unit_snapshot, unit_selling_price::float AS price, estimated_unit_cost::float AS cost
           FROM order_items WHERE order_id = $1 ORDER BY unit_selling_price`,
        [res.body.data.order.id]
      )
    ).rows;
    expect(rows).toEqual([
      { variant_id: v50.id, variant_label_snapshot: '50 g', unit_snapshot: '50 g', price: 45, cost: 40 },
      { variant_id: v100.id, variant_label_snapshot: '100 g', unit_snapshot: '100 g', price: 91, cost: 70 },
    ]);
    expectNoStaffKeys(res.body.data.order.items, 'customer order items');
  });

  it('refuses no variant, a switched-off variant and a variant of another product', async () => {
    const { product, v50 } = await chilli();
    const other = await createProduct();
    const none = await order([{ product_id: product.id, quantity: 1 }]);
    expect([none.status, none.body.error.code]).toEqual([400, 'VARIANT_REQUIRED']);
    const wrong = await order([{ product_id: other.id, variant_id: v50.id, quantity: 1 }]);
    expect([wrong.status, wrong.body.error.code]).toEqual([400, 'VARIANT_NOT_FOUND']);
    await editVariant(product.id, v50.id, { is_available: false });
    const off = await order([{ product_id: product.id, variant_id: v50.id, quantity: 1 }]);
    expect([off.status, off.body.error.code]).toEqual([400, 'VARIANT_UNAVAILABLE']);
  });

  it('a combo can hold a specific variant and orders it as that variant', async () => {
    const { product, v100 } = await chilli();
    const bread = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 100 });
    const combo = await request(app)
      .post('/api/v1/admin/combos')
      .set(auth(opsToken))
      .send({
        name: `${TAG} combo`,
        price: 150,
        items: [
          { product_id: product.id, variant_id: v100.id, quantity: 1 },
          { product_id: bread.id, quantity: 1 },
        ],
      });
    expect(combo.status, JSON.stringify(combo.body)).toBe(201);
    made.combos.push(combo.body.data.combo.id);
    expect(combo.body.data.combo).toMatchObject({ items_total: 191, is_live: true });
    const pub = (await request(app).get(`/api/v1/catalog/combos/${combo.body.data.combo.id}`)).body.data.combo;
    expect(pub.items.find((i: { variant_id: string | null }) => i.variant_id === v100.id)).toMatchObject({ variant_label: '100 g', unit_price: 91 });
    expectNoStaffKeys(pub, 'public combo');

    const res = await order([], { combos: [{ combo_id: combo.body.data.combo.id, quantity: 1 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = (await pool.query('SELECT variant_id, variant_label_snapshot FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL', [res.body.data.order.id])).rows;
    expect(rows).toEqual([{ variant_id: v100.id, variant_label_snapshot: '100 g' }]);

    const wrongVariant = await request(app)
      .post('/api/v1/admin/combos')
      .set(auth(opsToken))
      .send({ name: `${TAG} bad`, price: 50, items: [{ product_id: bread.id, variant_id: v100.id, quantity: 2 }] });
    expect(wrongVariant.body.error.code).toBe('COMBO_VARIANT_NOT_FOUND');
  });
});

// ----------------------------------------------------------------------------
describe('B. stock (customers can order until it reaches 0)', () => {
  it('the product form sets tracking, count and low level in one audited call', async () => {
    const product = await createProduct();
    const res = await setStock(product.id, { tracked: true, stock_count: 10, low_stock_threshold: 3, reason: 'Shelf count' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.stock).toMatchObject({ tracked: true, on_hand: 10, sellable: 10, low_stock_threshold: 3, is_low_stock: false });
    const ledger = (
      await pool.query(
        `SELECT a.adjustment_type, a.quantity_delta, a.previous_quantity, a.new_quantity, a.notes, a.created_by_user_id
           FROM inventory_adjustments a JOIN inventory i ON i.id = a.inventory_id WHERE i.product_id = $1`,
        [product.id]
      )
    ).rows;
    expect(ledger).toEqual([
      {
        adjustment_type: 'INVENTORY_AUDIT_ADJUSTMENT',
        quantity_delta: 10,
        previous_quantity: 0,
        new_quantity: 10,
        notes: 'Stock count set to 10 (was 0): Shelf count',
        created_by_user_id: users.admin.id,
      },
    ]);
    const audit = await pool.query(`SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'STOCK_SETTINGS_UPDATED'`, [product.id]);
    expect(audit.rows[0].new_values).toMatchObject({ tracking_mode: 'TRACKED', low_stock_threshold: 3 });
    // Same values again: no new ledger row.
    await setStock(product.id, { tracked: true, stock_count: 10 });
    expect((await pool.query(`SELECT count(*)::int AS n FROM inventory_adjustments a JOIN inventory i ON i.id = a.inventory_id WHERE i.product_id = $1`, [product.id])).rows[0].n).toBe(1);
    // A count needs tracking.
    expect((await setStock(product.id, { tracked: false, stock_count: 3 })).status).toBe(400);
    const staff = await adminProduct(product.id);
    expect(staff.stock).toMatchObject({ tracked: true, on_hand: 10 });
  });

  it('loose tracked products are checked at order time: "only N left", then "sold out", and the catalog hides it', async () => {
    const product = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 100 });
    await setStock(product.id, { tracked: true, stock_count: 3 });
    expect((await order([{ product_id: product.id, quantity: 2 }])).status).toBe(201);
    // 3 on hand, 2 in an open order -> 1 left.
    const more = await order([{ product_id: product.id, quantity: 2 }]);
    expect(more.status).toBe(409);
    expect(more.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { available: 1, requested: 2 } });
    expect(more.body.error.message).toMatch(/^Only 1 left of /);
    expect((await customerProduct(product.id)).is_available).toBe(true);
    expect((await order([{ product_id: product.id, quantity: 1 }])).status).toBe(201);
    // Nothing left to sell.
    const sold = await order([{ product_id: product.id, quantity: 1 }]);
    expect([sold.status, sold.body.error.code]).toEqual([409, 'OUT_OF_STOCK']);
    const p = await customerProduct(product.id);
    expect(p.is_available).toBe(false);
    expectNoStaffKeys(p, 'sold-out product');
    const available = await request(app).get('/api/v1/products').query({ search: product.sku, is_available: 'true' });
    expect(available.body.data.products.map((x: { id: string }) => x.id)).not.toContain(product.id);
    expect((await adminProduct(product.id)).stock).toMatchObject({ on_hand: 3, in_open_orders: 3, sellable: 0, is_out_of_stock: true });
  });

  it('untracked products are never limited', async () => {
    const product = await createProduct();
    expect((await order([{ product_id: product.id, quantity: 50 }])).status).toBe(201);
  });

  it('variant stock is its own: checked per variant, taken at pack, returned on cancel', async () => {
    const { product, v50, v100 } = await chilli();
    await setStock(product.id, { variant_id: v50.id, tracked: true, stock_count: 3, low_stock_threshold: 2 });
    const first = await order([{ product_id: product.id, variant_id: v50.id, quantity: 2 }]);
    expect(first.status).toBe(201);
    const short = await order([{ product_id: product.id, variant_id: v50.id, quantity: 2 }]);
    expect(short.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { variant_id: v50.id, available: 1 } });
    expect(short.body.error.message).toMatch(/50 g/);
    // The untracked 100 g is not limited by the 50 g's stock.
    expect((await order([{ product_id: product.id, variant_id: v100.id, quantity: 9 }])).status).toBe(201);

    // Pack: the 50 g row loses 2 (ORDER_FULFILLMENT on the variant's row).
    expect((await fx.pack(first.body.data.order.id)).status).toBe(200);
    const inv = (await pool.query('SELECT id, quantity_on_hand FROM inventory WHERE variant_id = $1', [v50.id])).rows[0];
    expect(inv.quantity_on_hand).toBe(1);
    const taken = await pool.query(`SELECT quantity_delta FROM inventory_adjustments WHERE inventory_id = $1 AND adjustment_type = 'ORDER_FULFILLMENT'`, [inv.id]);
    expect(taken.rows).toEqual([{ quantity_delta: -2 }]);

    // Low-stock list (Ops) shows the variant by name; so does the purchase list.
    const low = await request(app).get('/api/v1/admin/inventory/low-stock').set(auth(opsToken));
    const item = low.body.data.items.find((i: { variant_id: string | null }) => i.variant_id === v50.id);
    expect(item).toMatchObject({ product_id: product.id, variant_label: '50 g', display_name: `${product.name} - 50 g`, quantity_on_hand: 1, stock_state: 'LOW' });
    const purchase = await request(app).get('/api/v1/admin/inventory/purchase-list').set(auth(opsToken));
    expect(purchase.body.data.items.find((i: { variant_id: string | null }) => i.variant_id === v50.id)).toMatchObject({ unit_cost: 40, variant_label: '50 g' });

    // Cancel: the 2 come back to the variant's row.
    expect((await fx.adminCancel(first.body.data.order.id)).status).toBe(200);
    expect((await pool.query('SELECT quantity_on_hand FROM inventory WHERE variant_id = $1', [v50.id])).rows[0].quantity_on_hand).toBe(3);

    // The existing inventory endpoints take a variant too.
    const adjust = await request(app)
      .post(`/api/v1/admin/inventory/${product.id}/adjust`)
      .set(auth(tokens.staff))
      .send({ adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 4, variant_id: v50.id, notes: 'Delivery' });
    expect(adjust.status, JSON.stringify(adjust.body)).toBe(200);
    const one = await request(app).get(`/api/v1/admin/inventory/${product.id}`).query({ variant_id: v50.id }).set(auth(opsToken));
    expect(one.body.data).toMatchObject({ variant_id: v50.id, quantity_on_hand: 7 });
  });

  it('two checkouts racing for the last unit: exactly one wins', async () => {
    const product = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 10 });
    await setStock(product.id, { tracked: true, stock_count: 1 });
    const results = await Promise.all([order([{ product_id: product.id, quantity: 1 }]), order([{ product_id: product.id, quantity: 1 }])]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});

// ----------------------------------------------------------------------------
describe('C. delivery lead time', () => {
  // The checkout clock is pinned to Tue 6 Oct 2026, 12:00 Colombo (tests/setup/ordering-clock.ts).
  beforeAll(() => {
    storeSchedule.read = async () => ({
      ...DEFAULT_STORED_SCHEDULE,
      slots: { enabled: true, slot_minutes: 120, days_ahead: 1, max_orders_per_slot: 50, min_lead_minutes: 60 },
    });
  });
  afterAll(() => {
    storeSchedule.read = pinnedRead;
  });

  it('staff set it; customers see it with the first delivery day', async () => {
    const cake = await createProduct({ delivery_lead_days: 2, pricing_mode: 'FIXED', fixed_selling_price: 3500 }, opsToken);
    expect((await adminProduct(cake.id)).delivery_lead_days).toBe(2);
    const p = await customerProduct(cake.id);
    expect(p).toMatchObject({ delivery_lead_days: 2, earliest_delivery_date: '2026-10-08' });
    const edit = await request(app).patch(`/api/v1/admin/products/${cake.id}`).set(auth(tokens.admin)).send({ delivery_lead_days: 31 });
    expect(edit.status).toBe(400);
  });

  it('slots and checkout-info start on today + N; ASAP and earlier slots are refused', async () => {
    const cake = await createProduct({ delivery_lead_days: 2, pricing_mode: 'FIXED', fixed_selling_price: 3500 });
    const milk = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 300 });

    const slots = await request(app).get('/api/v1/orders/slots').query({ product_ids: `${milk.id},${cake.id}` }).set(auth(tokens.customer));
    expect(slots.status, JSON.stringify(slots.body)).toBe(200);
    expect(slots.body.data).toMatchObject({ lead_days: 2, earliest_delivery_date: '2026-10-08', earliest_delivery_label: 'Thu 8 Oct', asap_available: false });
    expect(slots.body.data.slots.length).toBeGreaterThan(0);
    expect(slots.body.data.slots[0].start).toBe('2026-10-08T02:30:00.000Z');
    const plain = await request(app).get('/api/v1/orders/slots').set(auth(tokens.customer));
    expect(plain.body.data).toMatchObject({ lead_days: 0, earliest_delivery_date: '2026-10-06', asap_available: true });

    const info = await request(app).get('/api/v1/orders/checkout-info').query({ product_ids: cake.id }).set(auth(tokens.customer));
    expect(info.body.data.delivery_lead).toEqual({ lead_days: 2, earliest_delivery_date: '2026-10-08', earliest_delivery_label: 'Thu 8 Oct', asap_allowed: false });

    const asap = await order([{ product_id: cake.id, quantity: 1 }, { product_id: milk.id, quantity: 1 }]);
    expect([asap.status, asap.body.error.code]).toEqual([422, 'LEAD_TIME_REQUIRES_SLOT']);
    expect(asap.body.error.details).toMatchObject({ lead_days: 2, earliest_delivery_date: '2026-10-08' });

    const tomorrow = plain.body.data.slots.find((s: { start: string }) => s.start.startsWith('2026-10-07'));
    const early = await order([{ product_id: cake.id, quantity: 1 }], { delivery_slot_start: tomorrow.start });
    expect([early.status, early.body.error.code]).toEqual([422, 'SLOT_BEFORE_LEAD_TIME']);

    const ok = await order([{ product_id: cake.id, quantity: 1 }], { delivery_slot_start: slots.body.data.slots[0].start });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // A cart without lead-time items still goes as soon as possible.
    expect((await order([{ product_id: milk.id, quantity: 1 }])).status).toBe(201);
  });
});

// ----------------------------------------------------------------------------
describe('A. import with variants', () => {
  const rows = () => [
    { row: 2, name: `${TAG} Chilli import`, category: '__CATEGORY__', unit: '1 pack', purchase_cost: 40, sku: `${TAG}-IMP`, delivery_lead_days: 1 },
    { row: 3, parent_sku: `${TAG}-IMP`, variant: '50 g', purchase_cost: 40, selling_price: 50, sku: `${TAG}-IMP-50`, tracked: 'yes', opening_stock: 20 },
    { row: 4, parent_sku: `${TAG}-IMP`, variant: '100 g', purchase_cost: 70, markup_percent: 30 },
    { row: 5, parent_sku: `${TAG}-NOPE`, variant: '1 kg', purchase_cost: 1 },
  ];
  const run = async (dry_run: boolean) => {
    const category = (await pool.query('SELECT name FROM categories WHERE id = $1', [categoryId])).rows[0].name;
    const res = await request(app)
      .post('/api/v1/admin/products/import')
      .set(auth(opsToken))
      .send({ dry_run, rows: rows().map((r) => ('category' in r ? { ...r, category } : r)) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  };

  it('dry run previews variants; applying creates them; importing again changes nothing', async () => {
    const dry = await run(true);
    expect(dry.results.map((r: { row: number; kind: string; status: string }) => [r.row, r.kind, r.status])).toEqual([
      [2, 'product', 'created'],
      [3, 'variant', 'created'],
      [4, 'variant', 'created'],
      [5, 'variant', 'error'],
    ]);
    expect(dry.results[1]).toMatchObject({ parent_sku: `${TAG}-IMP`, variant: '50 g', pricing: { pricing_mode: 'FIXED', selling_price: 50 } });
    expect(dry.results[2].pricing).toMatchObject({ pricing_source: 'VARIANT_MARKUP', selling_price: 91 });
    expect(dry.results[3].errors[0].field).toBe('parent_sku');
    expect((await pool.query('SELECT count(*)::int AS n FROM products WHERE sku = $1', [`${TAG}-IMP`])).rows[0].n).toBe(0);

    const applied = await run(false);
    expect(applied.summary).toEqual({ created: 3, updated: 0, skipped: 0, errors: 1 });
    const productId = applied.results[0].product_id as string;
    fx.created.products.push(productId);
    const staff = await adminProduct(productId);
    expect(staff).toMatchObject({ delivery_lead_days: 1, has_variants: true, variant_count: 2 });
    const v50 = staff.variants.find((v: { label: string }) => v.label === '50 g');
    expect(v50).toMatchObject({ sku: `${TAG}-IMP-50`, selling_price: 50, stock: { tracked: true, on_hand: 20 } });

    const again = await run(false);
    expect(again.summary).toEqual({ created: 0, updated: 0, skipped: 3, errors: 1 });
    expect((await adminProduct(productId)).variants).toHaveLength(2);
  });
});
