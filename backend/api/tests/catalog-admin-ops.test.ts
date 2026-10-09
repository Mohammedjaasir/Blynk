import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Catalog admin operations (migration 017 and friends):
 *   1. deleting products (hard when never ordered, soft otherwise) and
 *      categories (move products, 409 when a target is needed);
 *   2. the delivery fee setting and the public GET /store;
 *   3. the low-stock alert list and editable thresholds;
 *   4. bulk product import (dry run, create, idempotent re-import, update).
 * Everything the file creates is removed again, including audit rows, and the
 * delivery fee row is restored byte for byte (test:hygiene).
 */
const app = createApp();
const PREFIX = 'T-CAO-';
const fx = stockFixtures(app, PREFIX);
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

const createdCategories: string[] = [];
const auditEntities: string[] = [];
let testStart: Date;
let feeRow: { value: unknown; description: string | null; created_at: Date; updated_at: Date } | undefined;

async function newCategory(label: string) {
  const res = await request(app)
    .post('/api/v1/admin/categories')
    .set(auth(tokens.admin))
    .send({ name: `CAO ${label} ${Date.now()}`, slug: `test-cat-cao-${label}-${Date.now()}` });
  expect(res.status).toBe(201);
  createdCategories.push(res.body.data.category.id);
  return res.body.data.category.id as string;
}

async function newProduct(categoryId: string, suffix: string) {
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({ category_id: categoryId, name: `CAO product ${suffix} ${Date.now()}`, sku: `${PREFIX}${suffix}-${Date.now()}`, unit: '1 pc', purchase_cost: 50 });
  expect(res.status).toBe(201);
  return res.body.data.product as { id: string; sku: string; name: string };
}

beforeAll(async () => {
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  feeRow = (await pool.query("SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = 'delivery_fee'")).rows[0];
});

afterAll(async () => {
  // Orders first (they reference products), then this file's products by SKU.
  await fx.cleanup();
  const products = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${PREFIX}%`])).rows.map((r) => r.id);
  if (products.length) {
    const orders = (await pool.query('SELECT DISTINCT order_id FROM order_items WHERE product_id = ANY($1)', [products])).rows.map((r) => r.order_id);
    if (orders.length) {
      await pool.query('DELETE FROM inventory_adjustments WHERE reference_order_id = ANY($1)', [orders]);
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [orders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [orders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [orders]);
    }
    await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [products]);
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [products]);
  }
  if (createdCategories.length) await pool.query('DELETE FROM categories WHERE id = ANY($1)', [createdCategories]);
  await pool.query(
    `DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])
        OR (action IN ('DELIVERY_FEE_UPDATED', 'PRODUCT_DELETED', 'CATEGORY_DELETED') AND actor_user_id = $2 AND created_at >= $3)`,
    [[...auditEntities, ...products, ...createdCategories], users.admin.id, testStart]
  );
  if (feeRow) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ('delivery_fee', $1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(feeRow.value), feeRow.description, feeRow.created_at, feeRow.updated_at]
    );
  }
});

// ============================================================================
// 1. DELETE
// ============================================================================
describe('Deleting products', () => {
  it('removes a never-ordered product outright, with its stock rows', async () => {
    const t = await fx.product({ onHand: 4 });
    auditEntities.push(t.productId);
    const res = await request(app).delete(`/api/v1/admin/products/${t.productId}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ product_id: t.productId, mode: 'HARD' });
    expect((await pool.query('SELECT 1 FROM products WHERE id = $1', [t.productId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM inventory WHERE product_id = $1', [t.productId])).rowCount).toBe(0);
    const audit = (await pool.query("SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'PRODUCT_DELETED'", [t.productId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toEqual({ mode: 'HARD' });
  });

  it('soft-deletes an ordered product: hidden everywhere, never orderable, SKU reusable', async () => {
    const t = await fx.product({ onHand: 5 });
    await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);
    const { sku } = (await pool.query('SELECT sku FROM products WHERE id = $1', [t.productId])).rows[0];

    const res = await request(app).delete(`/api/v1/admin/products/${t.productId}`).set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('SOFT');

    const row = (await pool.query('SELECT deleted_at, is_active, is_available FROM products WHERE id = $1', [t.productId])).rows[0];
    expect(row.deleted_at).not.toBeNull();
    expect(row.is_active).toBe(false);
    expect(row.is_available).toBe(false);
    // Order history still points at it.
    expect((await pool.query('SELECT 1 FROM order_items WHERE product_id = $1', [t.productId])).rowCount).toBe(1);

    expect((await request(app).get(`/api/v1/products/${t.productId}`)).status).toBe(404);
    const search = await request(app).get('/api/v1/products').query({ search: sku });
    expect(search.body.data.products).toHaveLength(0);
    const adminList = await request(app).get('/api/v1/admin/products').query({ search: sku }).set(auth(tokens.admin));
    expect(adminList.body.data.products).toHaveLength(0);
    const inv = await request(app).get('/api/v1/admin/inventory').query({ search: sku, include_inactive: 'true' }).set(auth(tokens.admin));
    expect(inv.body.data.inventory).toHaveLength(0);

    // Cannot be edited back to life, deleted twice, or ordered.
    const patch = await request(app).patch(`/api/v1/admin/products/${t.productId}`).set(auth(tokens.admin)).send({ is_active: true });
    expect(patch.status).toBe(404);
    expect((await request(app).delete(`/api/v1/admin/products/${t.productId}`).set(auth(tokens.admin))).status).toBe(404);
    const order = await request(app)
      .post('/api/v1/orders')
      .set(auth(tokens.customer))
      .send({ address_id: (await pool.query("SELECT id FROM customer_addresses WHERE label = 'Stock test' AND user_id = $1 LIMIT 1", [users.customer.id])).rows[0].id, items: [{ product_id: t.productId, quantity: 1 }] });
    expect(order.status).toBe(400);
    expect(order.body.error.code).toBe('PRODUCT_UNAVAILABLE');

    // The SKU is free for a new product.
    const categoryId = (await pool.query('SELECT category_id FROM products WHERE id = $1', [t.productId])).rows[0].category_id;
    const again = await request(app)
      .post('/api/v1/admin/products')
      .set(auth(tokens.admin))
      .send({ category_id: categoryId, name: `CAO reuse ${Date.now()}`, sku, unit: '1 pc', purchase_cost: 10 });
    expect(again.status).toBe(201);
  });

  it('is refused to customers and packing staff, and 400s a malformed id', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).delete(`/api/v1/admin/products/${id}`).set(auth(tokens.customer))).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/products/${id}`).set(auth(tokens.staff))).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/products/${id}`).set(auth(tokens.admin))).status).toBe(404);
    expect((await request(app).delete('/api/v1/admin/products/not-a-uuid').set(auth(tokens.admin))).status).toBe(400);
  });
});

describe('Deleting categories', () => {
  it('lists product_count and deletes an empty category', async () => {
    const empty = await newCategory('empty');
    const list = await request(app).get('/api/v1/admin/categories').set(auth(tokens.admin));
    expect(list.body.data.categories.find((c: any) => c.id === empty).product_count).toBe(0);

    const res = await request(app).delete(`/api/v1/admin/categories/${empty}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ category_id: empty, moved_product_count: 0, mode: 'HARD' });
    expect((await pool.query('SELECT 1 FROM categories WHERE id = $1', [empty])).rowCount).toBe(0);
  });

  it('needs a target when it has products, then moves them and deletes', async () => {
    const source = await newCategory('src');
    const target = await newCategory('dst');
    const a = await newProduct(source, 'MA');
    const b = await newProduct(source, 'MB');

    const refused = await request(app).delete(`/api/v1/admin/categories/${source}`).set(auth(tokens.admin));
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('CATEGORY_NOT_EMPTY');
    expect(refused.body.error.details).toEqual({ product_count: 2 });

    const self = await request(app).delete(`/api/v1/admin/categories/${source}`).query({ move_to_category_id: source }).set(auth(tokens.admin));
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('INVALID_MOVE_TARGET');
    const missing = await request(app)
      .delete(`/api/v1/admin/categories/${source}`)
      .query({ move_to_category_id: '00000000-0000-4000-8000-000000000000' })
      .set(auth(tokens.admin));
    expect(missing.body.error.code).toBe('INVALID_MOVE_TARGET');

    const res = await request(app).delete(`/api/v1/admin/categories/${source}`).query({ move_to_category_id: target }).set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ category_id: source, moved_product_count: 2, mode: 'HARD' });
    const moved = (await pool.query('SELECT category_id FROM products WHERE id = ANY($1)', [[a.id, b.id]])).rows;
    expect(moved.every((r) => r.category_id === target)).toBe(true);
  });

  it('accepts the target in a JSON body too', async () => {
    const source = await newCategory('body');
    const target = await newCategory('bodydst');
    await newProduct(source, 'MC');
    const res = await request(app).delete(`/api/v1/admin/categories/${source}`).send({ move_to_category_id: target }).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.moved_product_count).toBe(1);
  });

  it('soft-deletes a category that only holds deleted products', async () => {
    const cat = await newCategory('soft');
    const t = await newProduct(cat, 'SO');
    await pool.query('UPDATE products SET deleted_at = now(), is_active = false WHERE id = $1', [t.id]);

    const res = await request(app).delete(`/api/v1/admin/categories/${cat}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('SOFT');
    const list = await request(app).get('/api/v1/admin/categories').set(auth(tokens.admin));
    expect(list.body.data.categories.find((c: any) => c.id === cat)).toBeUndefined();
    expect((await request(app).get('/api/v1/categories')).body.data.categories.find((c: any) => c.id === cat)).toBeUndefined();
  });
});

// ============================================================================
// 2. DELIVERY FEE
// ============================================================================
describe('Delivery fee setting and GET /store', () => {
  it('GET /store is public and reports real store facts', async () => {
    const res = await request(app).get('/api/v1/store');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      delivery_fee_lkr: expect.any(Number),
      hub_name: expect.any(String),
      delivery_hours: { start: '08:00', end: '21:00', timezone: 'Asia/Colombo' },
      radius_km: expect.any(Number),
      coupons_enabled: expect.any(Boolean),
      new_customer_free_deliveries: { enabled: expect.any(Boolean), count: expect.any(Number), since: expect.any(String) },
      show_offer_savings: expect.any(Boolean),
    });
  });

  it('changes the fee for new orders only, and audits it', async () => {
    const before = (await request(app).get('/api/v1/admin/settings/delivery-fee').set(auth(opsToken))).body.data.fee_lkr;
    const t = await fx.product({ onHand: 5 });
    const oldOrder = await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);

    const res = await request(app).patch('/api/v1/admin/settings/delivery-fee').set(auth(tokens.admin)).send({ fee_lkr: 150.5 });
    expect(res.status).toBe(200);
    expect(res.body.data.fee_lkr).toBe(150.5);
    expect((await request(app).get('/api/v1/store')).body.data.delivery_fee_lkr).toBe(150.5);

    const newOrder = await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);
    const fees = (await pool.query('SELECT id, delivery_fee FROM orders WHERE id = ANY($1)', [[oldOrder.id, newOrder.id]])).rows;
    expect(Number(fees.find((r) => r.id === newOrder.id).delivery_fee)).toBe(150.5);
    expect(Number(fees.find((r) => r.id === oldOrder.id).delivery_fee)).toBe(before);

    const audit = (
      await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'DELIVERY_FEE_UPDATED' ORDER BY created_at DESC LIMIT 1")
    ).rows[0];
    expect(audit.new_values).toEqual({ key: 'delivery_fee', fee_lkr: 150.5 });
    expect(audit.old_values).toEqual({ key: 'delivery_fee', fee_lkr: before });
  });

  it('validates the amount and the role', async () => {
    const send = (body: object, token = tokens.admin) => request(app).patch('/api/v1/admin/settings/delivery-fee').set(auth(token)).send(body);
    expect((await send({ fee_lkr: 1000.01 })).status).toBe(400);
    expect((await send({ fee_lkr: -1 })).status).toBe(400);
    expect((await send({ fee_lkr: 10.555 })).status).toBe(400);
    expect((await send({ fee_lkr: '100' })).status).toBe(400);
    expect((await send({ fee_lkr: 120 }, tokens.staff)).status).toBe(403);
    expect((await send({ fee_lkr: 120 }, tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/delivery-fee')).status).toBe(401);
    expect((await send({ fee_lkr: 0 })).body.data.fee_lkr).toBe(0);
    expect((await send({ fee_lkr: 1000 })).body.data.fee_lkr).toBe(1000);
  });
});

// ============================================================================
// 3. LOW STOCK
// ============================================================================
describe('Low-stock alerts', () => {
  it('lists tracked products at or under their threshold, out-of-stock first', async () => {
    const low = await fx.product({ onHand: 3 });
    const out = await fx.product({ onHand: 0 });
    const fine = await fx.product({ onHand: 10 });
    const untracked = await fx.product({ tracked: false });

    const res = await request(app).get('/api/v1/admin/inventory/low-stock').set(auth(tokens.staff));
    expect(res.status).toBe(200);
    const ours = res.body.data.items.filter((i: any) => [low, out, fine, untracked].some((t) => t.productId === i.product_id));
    expect(ours.map((i: any) => [i.product_id, i.stock_state])).toEqual([
      [out.productId, 'OUT'],
      [low.productId, 'LOW'],
    ]);
    expect(ours[1]).toMatchObject({ quantity_on_hand: 3, quantity_available: 3, low_stock_threshold: 5 });
    const { counts, items } = res.body.data;
    expect(counts.total).toBe(items.length);
    expect(counts.out + counts.low).toBe(counts.total);
    // OUT rows come first.
    const firstLow = items.findIndex((i: any) => i.stock_state === 'LOW');
    expect(items.slice(firstLow === -1 ? items.length : firstLow).every((i: any) => i.stock_state === 'LOW')).toBe(true);
  });

  it('makes the threshold editable for tracked products', async () => {
    const t = await fx.product({ onHand: 8 });
    const set = (body: object, token = tokens.admin, id = t.productId) =>
      request(app).patch(`/api/v1/admin/inventory/${id}/threshold`).set(auth(token)).send(body);

    const res = await set({ low_stock_threshold: 10 }, opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ low_stock_threshold: 10, is_low_stock: true });
    const list = await request(app).get('/api/v1/admin/inventory/low-stock').set(auth(tokens.admin));
    expect(list.body.data.items.some((i: any) => i.product_id === t.productId)).toBe(true);

    expect((await set({ low_stock_threshold: -1 })).status).toBe(400);
    expect((await set({ low_stock_threshold: 2.5 })).status).toBe(400);
    expect((await set({ low_stock_threshold: 3 }, tokens.staff)).status).toBe(403);

    const untracked = await fx.product({ tracked: false });
    const refused = await set({ low_stock_threshold: 3 }, tokens.admin, untracked.productId);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PRODUCT_NOT_TRACKED');
  });
});

// ============================================================================
// 4. BULK IMPORT
// ============================================================================
describe('Bulk product import', () => {
  let categoryName = '';
  const stamp = Date.now();
  const sku = (n: string) => `${PREFIX}IMP-${n}-${stamp}`;
  const importRows = (rows: object[], dry_run = false, token = tokens.admin) =>
    request(app).post('/api/v1/admin/products/import').set(auth(token)).send({ rows, dry_run });

  beforeAll(async () => {
    categoryName = (await pool.query('SELECT name FROM categories WHERE is_active = true AND deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0].name;
  });

  const good = () => [
    { row: 2, name: `Import Milk ${stamp}`, category: categoryName.toUpperCase(), unit: '1 L', cost_price: 400, selling_price: 480, sku: sku('A'), tracked: 'yes', opening_stock: 12 },
    { row: 3, name: `Import Bread ${stamp}`, category: categoryName, unit: '450 g', cost_price: '120.50', sku: sku('B'), description: 'Soft loaf' },
  ];

  it('dry run validates every row and writes nothing', async () => {
    const res = await importRows(
      [
        ...good(),
        { row: 4, name: 'X', category: 'No such category', unit: '', cost_price: 'abc', sku: 'ab' },
        { row: 5, name: `Dup ${stamp}`, category: categoryName, unit: '1 pc', cost_price: 10, sku: sku('A') },
        { row: 6, name: `Opening ${stamp}`, category: categoryName, unit: '1 pc', cost_price: 10, sku: sku('C'), opening_stock: 5 },
        { row: 7, name: `Cheap ${stamp}`, category: categoryName, unit: '1 pc', cost_price: 10, selling_price: 8, sku: sku('D') },
      ],
      true
    );
    expect(res.status).toBe(200);
    expect(res.body.data.dry_run).toBe(true);
    expect(res.body.data.summary).toEqual({ created: 2, updated: 0, skipped: 0, errors: 4 });
    const byRow = Object.fromEntries(res.body.data.results.map((r: any) => [r.row, r]));
    expect(byRow[2].status).toBe('created');
    expect(byRow[4].errors.map((e: any) => e.field).sort()).toEqual(['cost_price', 'name', 'sku', 'unit']);
    expect(byRow[5].errors[0]).toMatchObject({ field: 'sku', message: expect.stringContaining('row 2') });
    expect(byRow[6].errors[0].field).toBe('opening_stock');
    expect(byRow[7].errors[0].field).toBe('selling_price');
    expect((await pool.query('SELECT 1 FROM products WHERE sku LIKE $1', [`${PREFIX}IMP-%-${stamp}`])).rowCount).toBe(0);
  });

  it('creates products with pricing, tracking and opening stock', async () => {
    const res = await importRows(good());
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ created: 2, updated: 0, skipped: 0, errors: 0 });

    const milk = (await pool.query('SELECT * FROM v_product_catalog WHERE sku = $1', [sku('A')])).rows[0];
    expect(Number(milk.custom_markup_percent)).toBe(20);
    expect(Number(milk.calculated_selling_price)).toBe(480);
    const inv = (await pool.query('SELECT id, tracking_mode, quantity_on_hand FROM inventory WHERE product_id = $1', [milk.id])).rows[0];
    expect(inv).toMatchObject({ tracking_mode: 'TRACKED', quantity_on_hand: 12 });
    const ledger = (await pool.query('SELECT adjustment_type, quantity_delta, created_by_user_id FROM inventory_adjustments WHERE inventory_id = $1', [inv.id])).rows;
    expect(ledger).toEqual([{ adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 12, created_by_user_id: users.admin.id }]);

    const bread = (await pool.query('SELECT purchase_cost, custom_markup_percent, description FROM products WHERE sku = $1', [sku('B')])).rows[0];
    expect(Number(bread.purchase_cost)).toBe(120.5);
    expect(bread.custom_markup_percent).toBeNull();
    expect(bread.description).toBe('Soft loaf');
  });

  it('is idempotent on SKU: same file skips, changed rows update, stock is left alone', async () => {
    const again = await importRows(good());
    expect(again.body.data.summary).toEqual({ created: 0, updated: 0, skipped: 2, errors: 0 });

    const changed = good();
    changed[0] = { ...changed[0], cost_price: 500, selling_price: 600, opening_stock: 99 };
    const res = await importRows(changed, false, opsToken);
    expect(res.body.data.summary).toEqual({ created: 0, updated: 1, skipped: 1, errors: 0 });
    expect(res.body.data.results[0].message).toMatch(/Opening stock is ignored/);
    const milk = (await pool.query('SELECT p.purchase_cost, i.quantity_on_hand FROM products p JOIN inventory i ON i.product_id = p.id WHERE p.sku = $1', [sku('A')])).rows[0];
    expect(Number(milk.purchase_cost)).toBe(500);
    expect(milk.quantity_on_hand).toBe(12);
  });

  it('rejects empty uploads and the wrong roles', async () => {
    expect((await importRows([])).status).toBe(400);
    expect((await importRows(good(), true, tokens.staff)).status).toBe(403);
    expect((await importRows(good(), true, tokens.customer)).status).toBe(403);
  });
});
