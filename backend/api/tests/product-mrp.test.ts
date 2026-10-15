import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { capAtMrp, resolveSellingPrice, resolveVariantPrice } from '../src/modules/pricing/index.js';
import { publicMrp } from '../src/modules/catalog/catalog.variants.js';
import { validateImportRow, validateVariantRow } from '../src/modules/catalog/catalog.import.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Migration 048 (owner, 2026-10-14): MRP on products and sizes.
 *   - Cap at MRP: a computed price (markup or fixed) above the MRP is charged
 *     at the MRP - in the catalog views AND at order creation (the server
 *     never trusts the client).
 *   - Staff (Admin and Ops) see mrp, computed_selling_price and mrp_capped.
 *   - Customers get `mrp` only when it is above the price they pay now.
 *   - An offer at or above the (capped) selling price is refused.
 *   - Excel import: an `mrp` column (blank keeps the stored MRP), capped rows
 *     reported (warning + mrp_capped count).
 * Everything made here is removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-MRP-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const TAG = `TST-MRP-${Date.now()}`;

let categoryId = '';
let categoryName = '';
let seq = 0;

async function createProduct(body: Record<string, unknown> = {}, token = tokens.admin) {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(token))
    .send({ category_id: categoryId, name: `${TAG} P${seq}`, sku: `${TAG}-P${seq}`, unit: '1 pack', purchase_cost: 100, ...body });
  if (res.status === 201) fx.created.products.push(res.body.data.product.id);
  return res;
}
const patchProduct = (id: string, body: object, token = opsToken) =>
  request(app).patch(`/api/v1/admin/products/${id}`).set(auth(token)).send(body);
const addVariant = (productId: string, body: object, token = opsToken) =>
  request(app).post(`/api/v1/admin/products/${productId}/variants`).set(auth(token)).send(body);
const editVariant = (productId: string, variantId: string, body: object, token = tokens.admin) =>
  request(app).patch(`/api/v1/admin/products/${productId}/variants/${variantId}`).set(auth(token)).send(body);
const customerProduct = async (id: string) => (await request(app).get(`/api/v1/products/${id}`)).body.data.product;
const adminProduct = async (id: string) => (await request(app).get(`/api/v1/admin/products/${id}`).set(auth(tokens.admin))).body.data.product;
const order = async (items: object[]) => {
  const res = await request(app).post('/api/v1/orders').set(auth(tokens.customer)).send({ address_id: fx.addressId, items });
  if (res.status === 201) fx.created.orders.push(res.body.data.order.id);
  return res;
};

beforeAll(async () => {
  await fx.setup();
  const cat = (await pool.query('SELECT id, name FROM categories WHERE is_active = true AND deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0];
  categoryId = cat.id;
  categoryName = cat.name;
});

afterAll(async () => {
  if (fx.created.products.length) await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [fx.created.products]);
  await fx.cleanup();
});

// ----------------------------------------------------------------------------
describe('the rule (pricing/index.ts, the views\' TypeScript twin)', () => {
  it('capAtMrp: the lower of the price and the MRP; no MRP, no cap', () => {
    expect(capAtMrp(150, 120)).toEqual({ sellingPrice: 120, mrp: 120, mrpCapped: true });
    expect(capAtMrp(120, '120.00')).toEqual({ sellingPrice: 120, mrp: 120, mrpCapped: false });
    expect(capAtMrp(90, 100)).toEqual({ sellingPrice: 90, mrp: 100, mrpCapped: false });
    expect(capAtMrp(90, null)).toEqual({ sellingPrice: 90, mrp: null, mrpCapped: false });
    expect(capAtMrp(90, '')).toEqual({ sellingPrice: 90, mrp: null, mrpCapped: false });
  });

  it('markup and fixed prices are capped; the rule and the price before the cap are kept', () => {
    const markup = resolveSellingPrice({ purchaseCost: 100, productMarkupPercent: 50, mrp: 120 });
    expect(markup).toMatchObject({ pricingSource: 'PRODUCT_MARKUP', effectiveMarkupPercent: 50, computedSellingPrice: 150, sellingPrice: 120, mrp: 120, mrpCapped: true, warning: null });
    const fixed = resolveSellingPrice({ purchaseCost: 100, pricingMode: 'FIXED', fixedSellingPrice: 300, mrp: 250 });
    expect(fixed).toMatchObject({ computedSellingPrice: 300, sellingPrice: 250, mrpCapped: true });
    // An MRP under the cost: allowed, with the below-cost warning.
    const under = resolveSellingPrice({ purchaseCost: 100, productMarkupPercent: 20, mrp: 95 });
    expect(under).toMatchObject({ sellingPrice: 95, mrpCapped: true });
    expect(under.warning?.code).toBe('SELLING_BELOW_COST');
  });

  it("a size uses its own MRP", () => {
    const v = resolveVariantPrice({ purchaseCost: 70, variantMarkupPercent: 30, mrp: 85 });
    expect(v).toMatchObject({ pricingSource: 'VARIANT_MARKUP', computedSellingPrice: 91, sellingPrice: 85, mrpCapped: true });
  });

  it('publicMrp: shown only when above the price paid', () => {
    expect(publicMrp('300.00', 250)).toBe(300);
    expect(publicMrp(300, 300)).toBeNull();
    expect(publicMrp(null, 250)).toBeNull();
  });

  it('import cells: mrp above 0 with up to 2 decimals; blank is fine', () => {
    const base = { name: 'X product', category: 'C', unit: '1', sku: 'SKU-1', purchase_cost: 10 };
    expect(validateImportRow({ ...base, mrp: 'LKR 1,250.50' }, 0).row?.mrp).toBe(1250.5);
    expect(validateImportRow({ ...base, mrp: '' }, 0).row?.mrp).toBeUndefined();
    expect(validateImportRow({ ...base, mrp: 0 }, 0).errors).toEqual([{ field: 'mrp', message: 'MRP must be above 0' }]);
    expect(validateImportRow({ ...base, mrp: 'abc' }, 0).errors).toEqual([{ field: 'mrp', message: 'MRP must be a number' }]);
    expect(validateImportRow({ ...base, mrp: 1.234 }, 0).errors[0].field).toBe('mrp');
    expect(validateVariantRow({ parent_sku: 'SKU-1', variant: '50 g', purchase_cost: 5, mrp: -1 }, 0).errors[0].field).toBe('mrp');
  });
});

// ----------------------------------------------------------------------------
describe('products (Admin and Ops)', () => {
  it('a markup price above the MRP is capped; staff see the price before the cap; customers pay the MRP', async () => {
    const res = await createProduct({ custom_markup_percent: 50, mrp: 120 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const staff = res.body.data.product;
    expect(staff).toMatchObject({ mrp: 120, computed_selling_price: 150, mrp_capped: true, selling_price: 120, calculated_selling_price: 120, effective_markup_percent: 50 });

    const list = await request(app).get('/api/v1/admin/products').query({ search: staff.sku }).set(auth(opsToken));
    expect(list.body.data.products[0]).toMatchObject({ mrp: 120, computed_selling_price: 150, mrp_capped: true, selling_price: 120 });

    const customer = await customerProduct(staff.id);
    // The price IS the MRP: nothing struck.
    expect(customer).toMatchObject({ selling_price: 120, mrp: null, price_min: 120 });
    const text = JSON.stringify(customer);
    for (const key of ['computed_selling_price', 'mrp_capped', 'purchase_cost', 'calculated_selling_price']) expect(text).not.toContain(`"${key}"`);
  });

  it('a price below the MRP shows the MRP to customers; clearing the MRP (null) removes the cap', async () => {
    const res = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 90, mrp: 100 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.product.id;
    expect(res.body.data.product).toMatchObject({ mrp: 100, mrp_capped: false, selling_price: 90, computed_selling_price: 90 });
    expect(await customerProduct(id)).toMatchObject({ selling_price: 90, mrp: 100 });

    // Ops lowers the MRP under the fixed price: capped.
    const lower = await patchProduct(id, { mrp: 80 });
    expect(lower.status, JSON.stringify(lower.body)).toBe(200);
    expect(lower.body.data.product).toMatchObject({ mrp: 80, mrp_capped: true, selling_price: 80, computed_selling_price: 90 });

    // Admin clears it.
    const cleared = await patchProduct(id, { mrp: null }, tokens.admin);
    expect(cleared.body.data.product).toMatchObject({ mrp: null, mrp_capped: false, selling_price: 90 });
    expect(await customerProduct(id)).toMatchObject({ selling_price: 90, mrp: null });
  });

  it('refuses an MRP of 0, negative or with 3 decimals', async () => {
    for (const mrp of [0, -5, 10.123, '100']) {
      const res = await createProduct({ mrp });
      expect(res.status, `mrp ${mrp}`).toBe(400);
    }
  });

  it('offers: an offer at or above the capped price is refused; below it, customers see the MRP struck', async () => {
    const res = await createProduct({ custom_markup_percent: 50, mrp: 120, offer_price: 125 });
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('OFFER_PRICE_NOT_LOWER');
    expect(JSON.stringify(res.body)).toContain('capped at the MRP');

    const ok = await createProduct({ custom_markup_percent: 50, mrp: 120, offer_price: 110 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const id = ok.body.data.product.id;
    expect(ok.body.data.product).toMatchObject({ offer_active: true, customer_price: 110 });
    expect(await customerProduct(id)).toMatchObject({ selling_price: 120, offer_price: 110, mrp: 120, price_min: 110 });

    // Lowering the MRP to (or under) the running offer is refused.
    const bad = await patchProduct(id, { mrp: 110 });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('OFFER_PRICE_NOT_LOWER');
  });

  it('orders are charged the capped price and snapshot the MRP', async () => {
    const capped = (await createProduct({ custom_markup_percent: 50, mrp: 120 })).body.data.product;
    const under = (await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 90, mrp: 100 })).body.data.product;
    const none = (await createProduct({ custom_markup_percent: 10 })).body.data.product;
    const res = await order([
      { product_id: capped.id, quantity: 2 },
      { product_id: under.id, quantity: 1 },
      { product_id: none.id, quantity: 1 },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.order.subtotal_amount).toBe(2 * 120 + 90 + 110);
    const rows = (
      await pool.query(
        `SELECT product_id, unit_selling_price::float AS price, mrp_snapshot::float AS mrp, markup_percentage_applied::float AS markup
           FROM order_items WHERE order_id = $1`,
        [res.body.data.order.id]
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.product_id, r]));
    expect(byId.get(capped.id)).toEqual({ product_id: capped.id, price: 120, mrp: 120, markup: 20 });
    expect(byId.get(under.id)).toMatchObject({ price: 90, mrp: 100 });
    expect(byId.get(none.id)).toMatchObject({ price: 110, mrp: null });
  });
});

// ----------------------------------------------------------------------------
describe('sizes (variants)', () => {
  it('each size has its own MRP and cap; customers see it per size and on the cheapest size', async () => {
    const product = (await createProduct({ custom_markup_percent: 10, mrp: 1 })).body.data.product;
    const v50 = await addVariant(product.id, { label: '50 g', purchase_cost: 40, pricing_mode: 'FIXED', fixed_selling_price: 50, mrp: 60 });
    expect(v50.status, JSON.stringify(v50.body)).toBe(201);
    expect(v50.body.data.variant).toMatchObject({ selling_price: 50, mrp: 60, mrp_capped: false, computed_selling_price: 50 });
    const v100 = await addVariant(product.id, { label: '100 g', purchase_cost: 70, custom_markup_percent: 30, mrp: 85 }, tokens.admin);
    expect(v100.body.data.variant).toMatchObject({ selling_price: 85, computed_selling_price: 91, mrp_capped: true });
    // No MRP on the size: the product's MRP (1) does NOT cap it.
    const v250 = await addVariant(product.id, { label: '250 g', purchase_cost: 150, pricing_mode: 'FIXED', fixed_selling_price: 210 });
    expect(v250.body.data.variant).toMatchObject({ selling_price: 210, mrp: null, mrp_capped: false });

    const customer = await customerProduct(product.id);
    expect(customer).toMatchObject({ has_variants: true, price_min: 50, price_max: 210, selling_price: 50, mrp: 60 });
    const sizes = Object.fromEntries(customer.variants.map((v: { label: string }) => [v.label, v]));
    expect(sizes['50 g']).toMatchObject({ price: 50, mrp: 60 });
    expect(sizes['100 g']).toMatchObject({ price: 85, selling_price: 85, mrp: null });
    expect(sizes['250 g']).toMatchObject({ price: 210, mrp: null });

    // An offer on a capped size must be under the MRP.
    const bad = await editVariant(product.id, v100.body.data.variant.id, { offer_price: 85 });
    expect(bad.status).toBe(400);
    const good = await editVariant(product.id, v100.body.data.variant.id, { offer_price: 80 });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect((await customerProduct(product.id)).variants.find((v: { label: string }) => v.label === '100 g')).toMatchObject({ price: 80, mrp: 85 });
    // Clearing the size's MRP lifts the cap.
    const lifted = await editVariant(product.id, v100.body.data.variant.id, { mrp: null }, opsToken);
    expect(lifted.body.data.variant).toMatchObject({ mrp: null, mrp_capped: false, selling_price: 91 });

    const res = await order([{ product_id: product.id, variant_id: v50.body.data.variant.id, quantity: 1 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = (await pool.query('SELECT unit_selling_price::float AS price, mrp_snapshot::float AS mrp FROM order_items WHERE order_id = $1', [res.body.data.order.id])).rows[0];
    expect(row).toEqual({ price: 50, mrp: 60 });
  });
});

// ----------------------------------------------------------------------------
describe('Excel import: the mrp column', () => {
  const rows = () => [
    { row: 2, name: `${TAG} Imp capped`, category: categoryName, unit: '1 pack', purchase_cost: 100, markup_percent: 50, mrp: 120, sku: `${TAG}-I1` },
    { row: 3, name: `${TAG} Imp under`, category: categoryName, unit: '1 pack', purchase_cost: 100, selling_price: 110, mrp: 'LKR 130', sku: `${TAG}-I2` },
    { row: 4, parent_sku: `${TAG}-I2`, variant: '2 pack', purchase_cost: 200, selling_price: 260, mrp: 240 },
    { row: 5, name: `${TAG} Imp bad`, category: categoryName, unit: '1 pack', purchase_cost: 100, mrp: 0, sku: `${TAG}-I3` },
  ];
  const run = async (dry_run: boolean, body = rows()) => {
    const res = await request(app).post('/api/v1/admin/products/import').set(auth(opsToken)).send({ dry_run, rows: body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  };

  it('reports capped rows (dry run and apply); blank mrp keeps the stored MRP on re-import', async () => {
    const dry = await run(true);
    expect(dry.summary).toEqual({ created: 3, updated: 0, skipped: 0, errors: 1 });
    expect(dry.mrp_capped).toBe(2);
    expect(dry.results[0].pricing).toMatchObject({ selling_price: 120, computed_selling_price: 150, mrp: 120, mrp_capped: true });
    expect(dry.results[0].warnings).toEqual(['Capped at MRP LKR 120.00 (the price would be LKR 150.00)']);
    expect(dry.results[1].pricing).toMatchObject({ selling_price: 110, mrp: 130, mrp_capped: false });
    expect(dry.results[2].pricing).toMatchObject({ selling_price: 240, mrp_capped: true });
    expect(dry.results[3].errors[0]).toEqual({ field: 'mrp', message: 'MRP must be above 0' });

    const applied = await run(false);
    expect(applied.mrp_capped).toBe(2);
    for (const r of applied.results) if (r.kind === 'product' && r.product_id) fx.created.products.push(r.product_id);
    const p1 = await adminProduct(applied.results[0].product_id);
    expect(p1).toMatchObject({ mrp: 120, selling_price: 120, mrp_capped: true });
    const p2 = await adminProduct(applied.results[1].product_id);
    expect(p2.variants[0]).toMatchObject({ label: '2 pack', mrp: 240, selling_price: 240, mrp_capped: true });

    // Re-import with the mrp cells blank: nothing changes, the MRPs stay.
    const blank = rows().slice(0, 3).map(({ mrp: _mrp, ...r }) => r);
    const again = await run(false, blank);
    expect(again.summary).toEqual({ created: 0, updated: 0, skipped: 3, errors: 0 });
    expect(again.mrp_capped).toBe(2);
    expect((await adminProduct(applied.results[0].product_id)).mrp).toBe(120);

    // A new mrp value updates it.
    const changed = await run(false, [{ ...rows()[0], mrp: 200 }]);
    expect(changed.summary).toMatchObject({ updated: 1 });
    expect(changed.mrp_capped).toBe(0);
    expect(await adminProduct(applied.results[0].product_id)).toMatchObject({ mrp: 200, selling_price: 150, mrp_capped: false });
  });
});
