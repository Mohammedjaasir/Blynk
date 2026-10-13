import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { markupPrice } from '../src/modules/pricing/index.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Selling-price modes and category markup (migration 044; owner, 2026-10-13):
 * every product's price is either a FIXED selling price or cost x markup,
 * the markup being the product's own, else its category's, else its parent
 * category's, else the global default. Admin and Operations control all of
 * it (products, categories, the global markup, the bulk import); customers
 * only ever see prices - never costs, markups or where a price came from.
 *
 * Everything made here (categories, products, orders, combos, audit rows) is
 * removed afterwards, and the global markup row is put back exactly.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-PRC-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const TAG = `TST-PRC-${Date.now()}`;
const STARTED = new Date();

const made = { categories: [] as string[], combos: [] as string[] };
let groceryId = ''; // parent
let riceId = ''; // sub-category of Grocery
let globalMarkup = 20;
let savedGlobalRow: { value: unknown; updated_at: Date; description: string | null } | null = null;

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
  'price_warning',
  'markup_percent',
];

const adminProduct = async (id: string) =>
  (await request(app).get(`/api/v1/admin/products/${id}`).set(auth(tokens.admin))).body.data.product;
const customerView = async (id: string) => (await request(app).get(`/api/v1/products/${id}`)).body.data.product;
const editProduct = (id: string, body: object, token = opsToken) =>
  request(app).patch(`/api/v1/admin/products/${id}`).set(auth(token)).send(body);
const editCategory = (id: string, body: object, token = opsToken) =>
  request(app).patch(`/api/v1/admin/categories/${id}`).set(auth(token)).send(body);

async function category(name: string, extra: object = {}) {
  const res = await request(app)
    .post('/api/v1/admin/categories')
    .set(auth(tokens.admin))
    .send({ name: `${TAG} ${name}`, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  made.categories.push(res.body.data.category.id);
  return res.body.data.category as { id: string; markup_percent: number | null; markup_product_count: number };
}

let seq = 0;
async function createProduct(body: Record<string, unknown>, token = tokens.admin) {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(token))
    .send({ category_id: riceId, name: `${TAG} P${seq}`, sku: `${TAG}-P${seq}`, unit: '1 pc', purchase_cost: 200, ...body });
  if (res.status === 201) fx.created.products.push(res.body.data.product.id);
  return res;
}

const placeOrder = async (items: object[], combos?: object[]) => {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(auth(tokens.customer))
    .send({ address_id: fx.addressId, items, ...(combos ? { combos } : {}) });
  if (res.status === 201) fx.created.orders.push(res.body.data.order.id);
  return res;
};

beforeAll(async () => {
  await pool.query(`DELETE FROM combos WHERE name LIKE 'TST-PRC-%'`);
  await fx.setup();
  await pool.query(`DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM categories WHERE name LIKE 'TST-PRC-%')`);
  await pool.query(`DELETE FROM categories WHERE name LIKE 'TST-PRC-%' AND parent_id IS NOT NULL`);
  await pool.query(`DELETE FROM categories WHERE name LIKE 'TST-PRC-%'`);
  const saved = await pool.query(`SELECT value, updated_at, description FROM system_configurations WHERE key = 'default_markup'`);
  savedGlobalRow = saved.rows[0] ?? null;
  groceryId = (await category('Grocery')).id;
  riceId = (await category('Rice', { parent_id: groceryId })).id;
  const setting = await request(app).get('/api/v1/admin/settings/default-markup').set(auth(tokens.admin));
  expect(setting.status, JSON.stringify(setting.body)).toBe(200);
  globalMarkup = setting.body.data.markup_percent;
});

afterAll(async () => {
  await fx.cleanup();
  if (made.combos.length) {
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [made.combos]);
    await pool.query('DELETE FROM combos WHERE id = ANY($1)', [made.combos]);
  }
  await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [made.categories]);
  for (const id of [...made.categories].reverse()) await pool.query('DELETE FROM categories WHERE id = $1', [id]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'DEFAULT_MARKUP_UPDATED' AND actor_user_id = $1 AND created_at >= $2`, [
    users.admin.id,
    STARTED,
  ]);
  await restoreGlobalRow();
});

async function restoreGlobalRow() {
  if (savedGlobalRow) {
    await pool.query(`UPDATE system_configurations SET value = $1, updated_at = $2, description = $3 WHERE key = 'default_markup'`, [
      JSON.stringify(savedGlobalRow.value),
      savedGlobalRow.updated_at,
      savedGlobalRow.description,
    ]);
  } else {
    await pool.query(`DELETE FROM system_configurations WHERE key = 'default_markup'`);
  }
}

// ----------------------------------------------------------------------------
describe('category markup (own, then parent, then global)', () => {
  let productId = '';

  it('a product without any markup uses the global markup', async () => {
    const res = await createProduct({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    productId = res.body.data.product.id;
    expect(res.body.data.product).toMatchObject({
      pricing_mode: 'MARKUP',
      pricing_source: 'GLOBAL_MARKUP',
      purchase_cost: 200,
      custom_markup_percent: null,
      effective_markup_percent: globalMarkup,
      calculated_selling_price: markupPrice(200, globalMarkup),
      selling_price: markupPrice(200, globalMarkup),
      price_warning: null,
    });
  });

  it('Operations sets the parent category markup: products of its sub-categories follow at once', async () => {
    const res = await editCategory(groceryId, { markup_percent: 15 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.category).toMatchObject({ markup_percent: 15, markup_product_count: 1 });
    expect(await adminProduct(productId)).toMatchObject({
      pricing_source: 'PARENT_CATEGORY_MARKUP',
      parent_category_markup_percent: 15,
      effective_markup_percent: 15,
      calculated_selling_price: 230,
    });
    expect((await customerView(productId)).selling_price).toBe(230);
  });

  it("the category's own markup wins over its parent's; the list shows it and how many products use it", async () => {
    const res = await editCategory(riceId, { markup_percent: 25 }, tokens.admin);
    expect(res.status).toBe(200);
    expect(res.body.data.category).toMatchObject({ markup_percent: 25, markup_product_count: 1 });
    expect(await adminProduct(productId)).toMatchObject({ pricing_source: 'CATEGORY_MARKUP', category_markup_percent: 25, calculated_selling_price: 250 });

    const list = await request(app).get('/api/v1/admin/categories').set(auth(opsToken));
    expect(list.status).toBe(200);
    const rice = list.body.data.categories.find((c: { id: string }) => c.id === riceId);
    const grocery = list.body.data.categories.find((c: { id: string }) => c.id === groceryId);
    expect(rice).toMatchObject({ markup_percent: 25, markup_product_count: 1 });
    // Rice has its own markup, so Grocery's is not followed by Rice's products.
    expect(grocery).toMatchObject({ markup_percent: 15, markup_product_count: 0 });

    const audit = await pool.query(`SELECT old_values, new_values FROM audit_logs WHERE action = 'CATEGORY_MARKUP_SET' AND entity_id = $1 ORDER BY created_at`, [riceId]);
    expect(audit.rows.at(-1)).toMatchObject({ old_values: { markup_percent: null }, new_values: { markup_percent: 25 } });
  });

  it('a product markup beats the category; clearing it goes back to the category', async () => {
    expect((await editProduct(productId, { custom_markup_percent: 30 })).body.data.product).toMatchObject({
      pricing_source: 'PRODUCT_MARKUP',
      calculated_selling_price: 260,
    });
    expect((await editProduct(productId, { custom_markup_percent: null })).body.data.product).toMatchObject({
      pricing_source: 'CATEGORY_MARKUP',
      calculated_selling_price: 250,
    });
  });

  it('a category can be created with a markup; blank (null) clears it', async () => {
    const created = await category('Flour', { parent_id: groceryId, markup_percent: 12.5 });
    expect(created).toMatchObject({ markup_percent: 12.5, markup_product_count: 0 });
    const cleared = await editCategory(created.id, { markup_percent: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.category.markup_percent).toBeNull();
  });

  it('validates the markup and the roles', async () => {
    for (const bad of [-1, 1000, 12.345, '25']) {
      const res = await editCategory(riceId, { markup_percent: bad });
      expect(res.status, `markup ${bad}`).toBe(400);
    }
    expect((await editCategory(riceId, { markup_percent: 10 }, tokens.customer)).status).toBe(403);
    expect((await editCategory(riceId, { markup_percent: 10 }, tokens.rider)).status).toBe(403);
    expect((await adminProduct(productId)).calculated_selling_price).toBe(250);
  });

  it('customers never see category markups', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    const rice = res.body.data.categories.find((c: { id: string }) => c.id === riceId);
    expect(rice).toBeDefined();
    expect(Object.keys(rice)).not.toContain('markup_percent');
    expect(Object.keys(rice)).not.toContain('markup_product_count');
  });
});

// ----------------------------------------------------------------------------
describe('product pricing modes', () => {
  let fixedId = '';
  let markupId = '';

  it('creates a FIXED product: exactly that price, implied markup over cost', async () => {
    const res = await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 275 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    fixedId = res.body.data.product.id;
    expect(res.body.data.product).toMatchObject({
      pricing_mode: 'FIXED',
      fixed_selling_price: 275,
      pricing_source: 'FIXED',
      purchase_cost: 200,
      effective_markup_percent: 37.5,
      calculated_selling_price: 275,
      price_warning: null,
    });
    expect((await customerView(fixedId)).selling_price).toBe(275);
  });

  it('a fixed price is required (and above 0) for FIXED; the mode must be MARKUP or FIXED', async () => {
    const missing = await createProduct({ pricing_mode: 'FIXED' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect((await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 0 })).status).toBe(400);
    expect((await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 10.555 })).status).toBe(400);
    expect((await createProduct({ pricing_mode: 'BOGUS', fixed_selling_price: 10 })).status).toBe(400);

    const plain = await createProduct({});
    expect(plain.status).toBe(201);
    markupId = plain.body.data.product.id;
    const toFixed = await editProduct(markupId, { pricing_mode: 'FIXED' });
    expect(toFixed.status).toBe(400);
    expect(toFixed.body.error.code).toBe('FIXED_PRICE_REQUIRED');
  });

  it('a fixed price below cost saves, with a warning (never a block)', async () => {
    const res = await editProduct(fixedId, { fixed_selling_price: 150 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.product).toMatchObject({
      calculated_selling_price: 150,
      effective_markup_percent: -25,
      price_warning: { code: 'SELLING_BELOW_COST' },
    });
    expect(res.body.data.product.price_warning.message).toContain('below the purchase cost');
  });

  it('switching back to MARKUP uses the markups again; the stored fixed price is kept for later', async () => {
    const res = await editProduct(fixedId, { pricing_mode: 'MARKUP', custom_markup_percent: 10 });
    expect(res.body.data.product).toMatchObject({ pricing_mode: 'MARKUP', pricing_source: 'PRODUCT_MARKUP', calculated_selling_price: 220, fixed_selling_price: 150 });
    const back = await editProduct(fixedId, { pricing_mode: 'FIXED' });
    expect(back.status).toBe(200);
    expect(back.body.data.product).toMatchObject({ pricing_source: 'FIXED', calculated_selling_price: 150 });
    expect((await editProduct(fixedId, { fixed_selling_price: 300 })).body.data.product.calculated_selling_price).toBe(300);
  });

  it('Admin and Ops lists carry cost, markup, source and selling price; customers never do', async () => {
    const admin = await request(app).get(`/api/v1/admin/products?search=${encodeURIComponent(TAG)}&limit=200`).set(auth(opsToken));
    expect(admin.status).toBe(200);
    const row = admin.body.data.products.find((p: { id: string }) => p.id === fixedId);
    expect(row).toMatchObject({ purchase_cost: 200, pricing_mode: 'FIXED', pricing_source: 'FIXED', calculated_selling_price: 300, selling_price: 300 });

    const list = await request(app).get(`/api/v1/products?search=${encodeURIComponent(TAG)}&limit=100`);
    expect(list.status).toBe(200);
    expect(list.body.data.products.length).toBeGreaterThanOrEqual(2);
    for (const p of list.body.data.products) {
      for (const key of STAFF_ONLY_KEYS) expect(Object.keys(p), key).not.toContain(key);
      expect(typeof p.selling_price).toBe('number');
    }
    const one = await request(app).get(`/api/v1/products/${fixedId}`).set(auth(tokens.customer));
    expect(one.body.data.product.selling_price).toBe(300);
    for (const key of STAFF_ONLY_KEYS) expect(Object.keys(one.body.data.product), key).not.toContain(key);
  });

  it('customers and riders cannot price products', async () => {
    expect((await editProduct(fixedId, { fixed_selling_price: 1 }, tokens.customer)).status).toBe(403);
    expect((await editProduct(fixedId, { fixed_selling_price: 1 }, tokens.rider)).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/products/${fixedId}`).set(auth(tokens.customer))).status).toBe(403);
  });
});

// ----------------------------------------------------------------------------
describe('offers, checkout and combos use the new prices', () => {
  let fixedId = '';
  let categoryPriced = '';
  let lossLeader = '';

  beforeAll(async () => {
    // Rice: 25% markup (set above). Grocery: 15%.
    await editCategory(riceId, { markup_percent: 25 });
    fixedId = (await createProduct({ pricing_mode: 'FIXED', fixed_selling_price: 300 })).body.data.product.id;
    categoryPriced = (await createProduct({ purchase_cost: 80 })).body.data.product.id; // 100.00
    lossLeader = (await createProduct({ purchase_cost: 100, pricing_mode: 'FIXED', fixed_selling_price: 75 })).body.data.product.id;
    expect((await adminProduct(categoryPriced)).calculated_selling_price).toBe(100);
  });

  it('an offer must be below the FIXED price', async () => {
    const tooHigh = await editProduct(fixedId, { offer_price: 300 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.code).toBe('OFFER_PRICE_NOT_LOWER');
    expect((await editProduct(fixedId, { offer_price: 280 })).status).toBe(200);
    expect(await customerView(fixedId)).toMatchObject({ selling_price: 300, offer_price: 280 });
    // Lowering the fixed price to the offer is refused while the offer stands.
    expect((await editProduct(fixedId, { fixed_selling_price: 280 })).body.error.code).toBe('OFFER_PRICE_NOT_LOWER');
  });

  it("an offer is checked against the category markup price, including after a move to another category", async () => {
    expect((await editProduct(categoryPriced, { offer_price: 100 })).body.error?.code).toBe('OFFER_PRICE_NOT_LOWER');
    expect((await editProduct(categoryPriced, { offer_price: 95 })).status).toBe(200);
    // Grocery's 15% makes it 92.00: the 95 offer would no longer be an offer.
    const moved = await editProduct(categoryPriced, { category_id: groceryId });
    expect(moved.status).toBe(400);
    expect(moved.body.error.code).toBe('OFFER_PRICE_NOT_LOWER');
    expect((await editProduct(categoryPriced, { offer_price: null })).status).toBe(200);
  });

  it('checkout charges the FIXED price, the category-markup price and offers; the snapshot fits order_items', async () => {
    const res = await placeOrder([
      { product_id: fixedId, quantity: 1 },
      { product_id: categoryPriced, quantity: 2 },
      { product_id: lossLeader, quantity: 1 },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const order = res.body.data.order;
    expect(order.subtotal_amount).toBe(280 + 200 + 75);
    const items = (
      await pool.query('SELECT product_id, unit_selling_price, markup_percentage_applied FROM order_items WHERE order_id = $1', [order.id])
    ).rows;
    const byId = new Map(items.map((r) => [r.product_id, r]));
    expect(Number(byId.get(fixedId).unit_selling_price)).toBe(280);
    expect(Number(byId.get(fixedId).markup_percentage_applied)).toBe(50);
    expect(Number(byId.get(categoryPriced).unit_selling_price)).toBe(100);
    expect(Number(byId.get(categoryPriced).markup_percentage_applied)).toBe(25);
    // Sold below cost on purpose: a negative implied markup is recorded.
    expect(Number(byId.get(lossLeader).unit_selling_price)).toBe(75);
    expect(Number(byId.get(lossLeader).markup_percentage_applied)).toBe(-25);
  });

  it('a category markup change reprices the next checkout at once', async () => {
    await editCategory(riceId, { markup_percent: 30 });
    const res = await placeOrder([{ product_id: categoryPriced, quantity: 1 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.order.subtotal_amount).toBe(104);
    await editCategory(riceId, { markup_percent: 25 });
  });

  it('combos total their items at the new prices and order at the combo price', async () => {
    expect((await editProduct(fixedId, { offer_price: null })).status).toBe(200);
    // Items today: 300 (fixed) + 2 x 100 (category markup) = 500.
    const dear = await request(app)
      .post('/api/v1/admin/combos')
      .set(auth(opsToken))
      .send({ name: `${TAG} Dear`, price: 500, items: [{ product_id: fixedId, quantity: 1 }, { product_id: categoryPriced, quantity: 2 }] });
    expect(dear.status).toBe(400);
    expect(dear.body.error.code).toBe('COMBO_PRICE_NOT_LOWER');

    const res = await request(app)
      .post('/api/v1/admin/combos')
      .set(auth(opsToken))
      .send({ name: `${TAG} Pack`, price: 450, items: [{ product_id: fixedId, quantity: 1 }, { product_id: categoryPriced, quantity: 2 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    made.combos.push(res.body.data.combo.id);
    expect(res.body.data.combo).toMatchObject({ price: 450, items_total: 500, saving: 50, is_live: true });

    const order = await placeOrder([], [{ combo_id: res.body.data.combo.id, quantity: 1 }]);
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body.data.order.subtotal_amount).toBe(450);
  });
});

// ----------------------------------------------------------------------------
describe('global default markup setting', () => {
  it('Admin and Ops read and change it (audited); products on the global markup follow', async () => {
    try {
      // A product in a category without any markup, under a parent without one.
      const plainCat = await category('Plain');
      const res = await createProduct({ category_id: plainCat.id, purchase_cost: 100 });
      const id = res.body.data.product.id;
      expect((await adminProduct(id)).pricing_source).toBe('GLOBAL_MARKUP');

      const got = await request(app).get('/api/v1/admin/settings/default-markup').set(auth(opsToken));
      expect(got.status).toBe(200);
      expect(got.body.data.products_using).toBeGreaterThanOrEqual(1);

      const next = globalMarkup === 37 ? 38 : 37;
      const set = await request(app).patch('/api/v1/admin/settings/default-markup').set(auth(opsToken)).send({ markup_percent: next });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(set.body.data.markup_percent).toBe(next);
      expect((await adminProduct(id)).calculated_selling_price).toBe(markupPrice(100, next));
      expect((await customerView(id)).selling_price).toBe(markupPrice(100, next));
      const audit = await pool.query(
        `SELECT old_values, new_values FROM audit_logs WHERE action = 'DEFAULT_MARKUP_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`,
        [STARTED]
      );
      expect(audit.rows[0]).toMatchObject({ new_values: { markup_percent: next } });
    } finally {
      await restoreGlobalRow();
    }
  });

  it('validates the value and the roles', async () => {
    for (const bad of [-1, 1000, 12.345, '20']) {
      expect((await request(app).patch('/api/v1/admin/settings/default-markup').set(auth(tokens.admin)).send({ markup_percent: bad })).status).toBe(400);
    }
    expect((await request(app).patch('/api/v1/admin/settings/default-markup').set(auth(tokens.admin)).send({ markup_percent: 20, x: 1 })).status).toBe(400);
    expect((await request(app).patch('/api/v1/admin/settings/default-markup').set(auth(tokens.customer)).send({ markup_percent: 20 })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/default-markup').set(auth(tokens.customer))).status).toBe(403);
  });
});

// ----------------------------------------------------------------------------
describe('bulk import pricing columns', () => {
  const importRows = (rows: object[], dry_run = false, token = opsToken) =>
    request(app).post('/api/v1/admin/products/import').set(auth(token)).send({ rows, dry_run });
  const sku = (n: string) => `${TAG}-IMP-${n}`;
  let rows: Record<string, unknown>[] = [];

  beforeAll(async () => {
    await editCategory(riceId, { markup_percent: 25 });
    rows = [
      { row: 2, name: `${TAG} Fixed`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, selling_price: 120, sku: sku('FIXED') },
      { row: 3, name: `${TAG} Markup`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, markup_percent: 30, sku: sku('MARKUP') },
      { row: 4, name: `${TAG} Category`, category: `${TAG} rice`, unit: 'bag', purchase_cost: 100, sku: sku('CAT') },
      { row: 5, name: `${TAG} Loss`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, selling_price: 90, sku: sku('LOSS') },
      // An older file: cost_price header, selling_price only -> FIXED now.
      { row: 6, name: `${TAG} Legacy`, category: `${TAG} Rice`, unit: 'bag', cost_price: 50, selling_price: 65, sku: sku('LEGACY') },
      { row: 7, name: `${TAG} Both`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, selling_price: 120, markup_percent: 10, sku: sku('BOTH') },
    ];
  });

  afterAll(async () => {
    const ids = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${TAG}-IMP-%`])).rows.map((r) => r.id as string);
    for (const id of ids) if (!fx.created.products.includes(id)) fx.created.products.push(id);
  });

  it('a dry run shows each row\'s selling price and source and writes nothing', async () => {
    const res = await importRows(rows, true);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byRow = new Map(res.body.data.results.map((r: { row: number }) => [r.row, r]));
    expect(byRow.get(2)).toMatchObject({ status: 'created', pricing: { pricing_mode: 'FIXED', pricing_source: 'FIXED', selling_price: 120, effective_markup_percent: 20 } });
    expect(byRow.get(3)).toMatchObject({ status: 'created', pricing: { pricing_mode: 'MARKUP', pricing_source: 'PRODUCT_MARKUP', selling_price: 130 } });
    expect(byRow.get(4)).toMatchObject({ status: 'created', pricing: { pricing_source: 'CATEGORY_MARKUP', selling_price: 125, effective_markup_percent: 25 } });
    expect(byRow.get(5)).toMatchObject({ status: 'created', pricing: { pricing_source: 'FIXED', selling_price: 90 } });
    expect((byRow.get(5) as { warnings: string[] }).warnings[0]).toContain('below the purchase cost');
    expect(byRow.get(6)).toMatchObject({ status: 'created', pricing: { pricing_source: 'FIXED', purchase_cost: 50, selling_price: 65 } });
    expect(byRow.get(7)).toMatchObject({ status: 'error', message: 'Give either selling_price or markup_percent, not both' });
    expect(res.body.data.summary).toEqual({ created: 5, updated: 0, skipped: 0, errors: 1 });
    expect((await pool.query('SELECT count(*)::int AS n FROM products WHERE sku LIKE $1', [`${TAG}-IMP-%`])).rows[0].n).toBe(0);
  });

  it('applying creates the products with exactly those prices', async () => {
    const res = await importRows(rows);
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ created: 5, updated: 0, skipped: 0, errors: 1 });
    const prices = (
      await pool.query(
        `SELECT sku, pricing_mode, pricing_source, calculated_selling_price, custom_markup_percent, fixed_selling_price
           FROM v_product_catalog WHERE sku LIKE $1`,
        [`${TAG}-IMP-%`]
      )
    ).rows;
    const bySku = new Map(prices.map((p) => [p.sku, p]));
    expect(bySku.get(sku('FIXED'))).toMatchObject({ pricing_mode: 'FIXED', pricing_source: 'FIXED', calculated_selling_price: '120.00', fixed_selling_price: '120.00' });
    expect(bySku.get(sku('MARKUP'))).toMatchObject({ pricing_mode: 'MARKUP', pricing_source: 'PRODUCT_MARKUP', calculated_selling_price: '130.00', custom_markup_percent: '30.00' });
    expect(bySku.get(sku('CAT'))).toMatchObject({ pricing_mode: 'MARKUP', pricing_source: 'CATEGORY_MARKUP', calculated_selling_price: '125.00', custom_markup_percent: null });
    expect(bySku.get(sku('LOSS'))).toMatchObject({ pricing_source: 'FIXED', calculated_selling_price: '90.00' });
    expect(bySku.get(sku('LEGACY'))).toMatchObject({ pricing_source: 'FIXED', calculated_selling_price: '65.00' });
  });

  it('re-importing the same file changes nothing', async () => {
    const res = await importRows(rows);
    expect(res.body.data.summary).toEqual({ created: 0, updated: 0, skipped: 5, errors: 1 });
    const dry = await importRows(rows, true);
    expect(dry.body.data.summary).toEqual({ created: 0, updated: 0, skipped: 5, errors: 1 });
    expect(dry.body.data.results.find((r: { row: number }) => r.row === 4)).toMatchObject({
      status: 'skipped',
      pricing: { pricing_source: 'CATEGORY_MARKUP', selling_price: 125 },
    });
  });

  it('changing the price columns switches the mode', async () => {
    const changed = [
      { ...rows[0], selling_price: undefined, markup_percent: 50 }, // FIXED -> MARKUP 50%
      { ...rows[1], markup_percent: undefined, selling_price: 140 }, // MARKUP -> FIXED 140
    ];
    const res = await importRows(changed);
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ created: 0, updated: 2, skipped: 0, errors: 0 });
    const prices = (
      await pool.query(`SELECT sku, pricing_source, calculated_selling_price FROM v_product_catalog WHERE sku = ANY($1)`, [[sku('FIXED'), sku('MARKUP')]])
    ).rows;
    const bySku = new Map(prices.map((p) => [p.sku, p]));
    expect(bySku.get(sku('FIXED'))).toMatchObject({ pricing_source: 'PRODUCT_MARKUP', calculated_selling_price: '150.00' });
    expect(bySku.get(sku('MARKUP'))).toMatchObject({ pricing_source: 'FIXED', calculated_selling_price: '140.00' });
    // And the changed file is idempotent too.
    expect((await importRows(changed)).body.data.summary).toEqual({ created: 0, updated: 0, skipped: 2, errors: 0 });
  });

  it('blank price cells keep the pricing of an existing product (owner, 2026-10-13); a new product uses the category markup', async () => {
    const blank = [
      { ...rows[3], selling_price: undefined }, // LOSS: FIXED 90 stays FIXED 90
      { ...rows[0], selling_price: undefined, markup_percent: undefined }, // FIXED sku now MARKUP 50% custom: stays
      { ...rows[1], markup_percent: undefined, selling_price: undefined, purchase_cost: 110 }, // FIXED 140 kept, cost changes
      { row: 9, name: `${TAG} New blank`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, sku: sku('NEWBLANK') },
    ];
    const dry = await importRows(blank, true);
    const byRow = new Map(dry.body.data.results.map((r: { row: number }) => [r.row, r]));
    expect(byRow.get(5)).toMatchObject({ status: 'skipped', pricing: { pricing_source: 'FIXED', selling_price: 90, kept_current: true } });
    expect(byRow.get(2)).toMatchObject({ status: 'skipped', pricing: { pricing_source: 'PRODUCT_MARKUP', selling_price: 150, kept_current: true } });
    expect(byRow.get(3)).toMatchObject({ status: 'updated', pricing: { pricing_source: 'FIXED', selling_price: 140, purchase_cost: 110, kept_current: true } });
    expect(byRow.get(9)).toMatchObject({ status: 'created', pricing: { pricing_source: 'CATEGORY_MARKUP', selling_price: 125, kept_current: false } });

    const res = await importRows(blank);
    expect(res.body.data.summary).toEqual({ created: 1, updated: 1, skipped: 2, errors: 0 });
    const prices = (
      await pool.query(`SELECT sku, pricing_source, calculated_selling_price, purchase_cost FROM v_product_catalog WHERE sku = ANY($1)`, [
        [sku('LOSS'), sku('FIXED'), sku('MARKUP'), sku('NEWBLANK')],
      ])
    ).rows;
    const bySku = new Map(prices.map((p) => [p.sku, p]));
    expect(bySku.get(sku('LOSS'))).toMatchObject({ pricing_source: 'FIXED', calculated_selling_price: '90.00' });
    expect(bySku.get(sku('FIXED'))).toMatchObject({ pricing_source: 'PRODUCT_MARKUP', calculated_selling_price: '150.00' });
    expect(bySku.get(sku('MARKUP'))).toMatchObject({ pricing_source: 'FIXED', calculated_selling_price: '140.00', purchase_cost: '110.00' });
    expect(bySku.get(sku('NEWBLANK'))).toMatchObject({ pricing_source: 'CATEGORY_MARKUP', calculated_selling_price: '125.00' });
    expect((await importRows(blank)).body.data.summary).toEqual({ created: 0, updated: 0, skipped: 4, errors: 0 });
  });

  it('rejects conflicting cost headers and bad price cells per row; customers cannot import', async () => {
    const res = await importRows(
      [
        { row: 2, name: `${TAG} Conflict`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, cost_price: 90, sku: sku('CONFLICT') },
        { row: 3, name: `${TAG} Zero`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, selling_price: 0, sku: sku('ZERO') },
        { row: 4, name: `${TAG} Huge`, category: `${TAG} Rice`, unit: 'bag', purchase_cost: 100, markup_percent: 1000, sku: sku('HUGE') },
      ],
      true
    );
    expect(res.body.data.summary.errors).toBe(3);
    expect(res.body.data.results.map((r: { errors: { field: string }[] }) => r.errors[0].field)).toEqual(['purchase_cost', 'selling_price', 'markup_percent']);
    expect((await importRows(rows, true, tokens.customer)).status).toBe(403);
  });
});
