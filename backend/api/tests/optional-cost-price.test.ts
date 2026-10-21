import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { validateImportRow, validateVariantRow } from '../src/modules/catalog/catalog.import.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Owner, 2026-10-21: "make cost price optional ... we will put the selling
 * price only ... after that we can add the cost pricing." The cost price may
 * be left out (stored as 0 = not set yet), but only at a FIXED selling price:
 * cost x markup with no cost would sell at 0. Products, variants, the import.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-NOCOST-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const TAG = `TST-NOCOST-${Date.now()}`;
const MESSAGE = 'Enter the cost price, or choose Fixed price and enter the selling price.';

let categoryId = '';
let seq = 0;

async function createProduct(body: Record<string, unknown>) {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({ category_id: categoryId, name: `${TAG} P${seq}`, sku: `${TAG}-P${seq}`, unit: '1 pc', ...body });
  if (res.status === 201) fx.created.products.push(res.body.data.product.id);
  return res;
}
const editProduct = (id: string, body: object) => request(app).patch(`/api/v1/admin/products/${id}`).set(auth(opsToken)).send(body);
const addVariant = (productId: string, body: object) =>
  request(app).post(`/api/v1/admin/products/${productId}/variants`).set(auth(opsToken)).send(body);
const editVariant = (productId: string, variantId: string, body: object) =>
  request(app).patch(`/api/v1/admin/products/${productId}/variants/${variantId}`).set(auth(opsToken)).send(body);

/** The 400 names purchase_cost (a Zod issue path, or the service's details.field). */
function expectCostError(res: request.Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  const details = res.body.error.details;
  const fields = Array.isArray(details) ? details.map((d: { path: string[] }) => d.path.join('.')) : [details?.field];
  expect(fields).toContain('purchase_cost');
  const messages = Array.isArray(details) ? details.map((d: { message: string }) => d.message) : [res.body.error.message];
  expect(messages).toContain(MESSAGE);
}

beforeAll(async () => {
  await fx.setup();
  categoryId = (await pool.query('SELECT id FROM categories WHERE is_active = true AND deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  if (fx.created.products.length) await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [fx.created.products]);
  await fx.cleanup();
});

describe('products: cost price optional at a fixed price', () => {
  it('a FIXED product without purchase_cost is created with cost 0 and sells at the fixed price', async () => {
    const res = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 250 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.product).toMatchObject({ purchase_cost: 0, pricing_mode: 'FIXED', calculated_selling_price: 250 });
    const customer = (await request(app).get(`/api/v1/products/${res.body.data.product.id}`)).body.data.product;
    expect(Number(customer.selling_price ?? customer.price)).toBe(250);
  });

  it('MARKUP with no cost (omitted, or 0) is refused on purchase_cost', async () => {
    expectCostError(await createProduct({}));
    expectCostError(await createProduct({ purchase_cost: 0 }));
    expectCostError(await createProduct({ pricing_mode: 'MARKUP', purchase_cost: 0, custom_markup_percent: 20 }));
    // With a cost, MARKUP is fine as before.
    expect((await createProduct({ purchase_cost: 100 })).status).toBe(201);
  });

  it('an edit to MARKUP with cost 0 is refused; adding the cost later works', async () => {
    const created = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 120 });
    const id = created.body.data.product.id;
    expectCostError(await editProduct(id, { pricing_mode: 'MARKUP' }));
    expectCostError(await editProduct(id, { pricing_mode: 'MARKUP', purchase_cost: 0 }));
    // Other edits of the cost-0 FIXED product are fine.
    expect((await editProduct(id, { is_available: false })).status).toBe(200);
    // The supplier's cost arrives: set it, then switch to markup.
    const withCost = await editProduct(id, { purchase_cost: 90, pricing_mode: 'MARKUP', custom_markup_percent: 20 });
    expect(withCost.status, JSON.stringify(withCost.body)).toBe(200);
    expect(withCost.body.data.product).toMatchObject({ purchase_cost: 90, pricing_mode: 'MARKUP', calculated_selling_price: 108 });
    // And the cost cannot be cleared back to 0 while on markup.
    expectCostError(await editProduct(id, { purchase_cost: 0 }));
  });
});

describe('variants: cost price optional at a fixed price', () => {
  it('a FIXED variant without purchase_cost is created with cost 0; MARKUP without cost is refused; edit to MARKUP refused', async () => {
    const product = (await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 300 })).body.data.product;
    const fixed = await addVariant(product.id, { label: '100 g', pricing_mode: 'FIXED', fixed_selling_price: 80 });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(201);
    expect(fixed.body.data.variant).toMatchObject({ purchase_cost: 0, pricing_mode: 'FIXED', selling_price: 80 });

    expectCostError(await addVariant(product.id, { label: '250 g' }));
    expectCostError(await addVariant(product.id, { label: '250 g', purchase_cost: 0, pricing_mode: 'MARKUP' }));

    const variantId = fixed.body.data.variant.id;
    expectCostError(await editVariant(product.id, variantId, { pricing_mode: 'MARKUP' }));
    expect((await editVariant(product.id, variantId, { label: '100 g pack' })).status).toBe(200);
    const withCost = await editVariant(product.id, variantId, { purchase_cost: 60, pricing_mode: 'MARKUP', custom_markup_percent: 50 });
    expect(withCost.status, JSON.stringify(withCost.body)).toBe(200);
    expect(withCost.body.data.variant).toMatchObject({ purchase_cost: 60, selling_price: 90 });
  });
});

describe('import: cost may be blank when the row gives a selling_price', () => {
  const row = (extra: Record<string, unknown>) => ({ name: 'Rice 5kg', category: 'Rice', unit: 'bag', sku: 'RICE-5KG', ...extra });

  it('row validation', () => {
    expect(validateImportRow(row({ selling_price: 500 }), 0)).toMatchObject({ errors: [], row: { cost_price: undefined, selling_price: 500 } });
    // Admin / Ops send a blank cost cell as null.
    expect(validateImportRow(row({ purchase_cost: null, selling_price: 500 }), 0)).toMatchObject({ errors: [], row: { cost_price: undefined } });
    expect(validateImportRow(row({}), 0).errors).toEqual([{ field: 'purchase_cost', message: 'Purchase cost is required' }]);
    expect(validateImportRow(row({ markup_percent: 20 }), 0).errors[0]?.field).toBe('purchase_cost');
    const variant = { parent_sku: 'RICE-5KG', variant: '1 kg' };
    expect(validateVariantRow({ ...variant, selling_price: 110 }, 0).errors).toEqual([]);
    expect(validateVariantRow(variant, 0).errors[0]?.field).toBe('purchase_cost');
  });

  it('applies: a blank cost + selling price creates a FIXED product and variant at cost 0; cost 0 on markup is an error row', async () => {
    const category = (await pool.query('SELECT name FROM categories WHERE id = $1', [categoryId])).rows[0].name;
    const res = await request(app)
      .post('/api/v1/admin/products/import')
      .set(auth(opsToken))
      .send({
        rows: [
          { row: 2, name: `${TAG} Imported`, category, unit: '1 pc', sku: `${TAG}-IMP`, selling_price: 150 },
          { row: 3, name: `${TAG} Zero`, category, unit: '1 pc', sku: `${TAG}-ZERO`, purchase_cost: 0 },
          { row: 4, parent_sku: `${TAG}-IMP`, variant: '2 pack', selling_price: 280 },
          { row: 5, parent_sku: `${TAG}-IMP`, variant: '3 pack', purchase_cost: 0, markup_percent: 10 },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const results = res.body.data.results as Array<{ row: number; status: string; product_id?: string; errors?: Array<{ field: string; message: string }> }>;
    for (const r of results) if (r.product_id) fx.created.products.push(r.product_id);
    const byRow = new Map(results.map((r) => [r.row, r]));
    expect(byRow.get(2)?.status).toBe('created');
    expect(byRow.get(3)).toMatchObject({ status: 'error', errors: [{ field: 'purchase_cost', message: MESSAGE }] });
    expect(byRow.get(4)?.status).toBe('created');
    expect(byRow.get(5)).toMatchObject({ status: 'error', errors: [{ field: 'purchase_cost', message: MESSAGE }] });

    const stored = (await pool.query('SELECT id, purchase_cost, pricing_mode, fixed_selling_price FROM products WHERE sku = $1', [`${TAG}-IMP`])).rows[0];
    if (!fx.created.products.includes(stored.id)) fx.created.products.push(stored.id);
    expect(stored).toMatchObject({ pricing_mode: 'FIXED' });
    expect(Number(stored.purchase_cost)).toBe(0);
    expect(Number(stored.fixed_selling_price)).toBe(150);
    const variant = (await pool.query('SELECT purchase_cost, pricing_mode FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL', [stored.id])).rows;
    expect(variant).toHaveLength(1);
    expect(Number(variant[0].purchase_cost)).toBe(0);
    expect((await pool.query('SELECT 1 FROM products WHERE sku = $1', [`${TAG}-ZERO`])).rowCount).toBe(0);

    // Re-importing with the cost still blank (null, as Admin / Ops send it) keeps a cost added since.
    await pool.query('UPDATE products SET purchase_cost = 95 WHERE id = $1', [stored.id]);
    const again = await request(app)
      .post('/api/v1/admin/products/import')
      .set(auth(opsToken))
      .send({ rows: [{ row: 2, name: `${TAG} Imported`, category, unit: '1 pc', sku: `${TAG}-IMP`, purchase_cost: null, selling_price: 150 }] });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.data.results[0].status).toBe('skipped');
    expect(Number((await pool.query('SELECT purchase_cost FROM products WHERE id = $1', [stored.id])).rows[0].purchase_cost)).toBe(95);
  });
});
