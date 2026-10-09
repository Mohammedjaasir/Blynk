import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Arrange (owner, 2026-10-10; migration 035): staff decide which categories
 * and which products in a category come first.
 *
 * - PUT /admin/categories/order rewrites one sibling set's display_order
 *   10, 20, 30... (ADMIN and OPERATIONS), audited; the customer
 *   GET /catalog/categories follows it.
 * - GET/PUT /admin/categories/:id/product-order: listed products 1..n, the
 *   rest NULL (A-Z after); the customer product list follows it.
 *
 * Every category and product the file creates is hard-deleted again with its
 * audit rows; top-level categories' display_order is put back as found.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const customerToken = tokens.customer;
const stamp = Date.now();
const PREFIX = 'T-ARR-';
const createdCategories: string[] = [];
let topLevelBefore: Array<{ id: string; display_order: number; updated_at: string }> = [];

type Category = { id: string; name: string; parent_id: string | null; display_order: number };

async function newCategory(label: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/admin/categories')
    .set(auth(tokens.admin))
    .send({ name: `ARR ${label} ${stamp}`, slug: `test-cat-arr-${label}-${stamp}`, ...body });
  expect(res.status).toBe(201);
  createdCategories.push(res.body.data.category.id);
  return res.body.data.category as Category;
}

async function newProduct(categoryId: string, name: string) {
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({ category_id: categoryId, name: `${name} ${stamp}`, sku: `${PREFIX}${name}-${stamp}`, unit: '1 pc', purchase_cost: 50 });
  expect(res.status).toBe(201);
  return res.body.data.product as { id: string; name: string };
}

async function customerProductIds(categoryId: string) {
  const res = await request(app).get('/api/v1/catalog/products').query({ limit: '100', category_id: categoryId });
  expect(res.status).toBe(200);
  return (res.body.data.products as Array<{ id: string }>).map((p) => p.id);
}

const putOrder = (ids: string[], token = tokens.admin) =>
  request(app).put('/api/v1/admin/categories/order').set(auth(token)).send({ ids });
const putProducts = (categoryId: string, productIds: string[], token = tokens.admin) =>
  request(app).put(`/api/v1/admin/categories/${categoryId}/product-order`).set(auth(token)).send({ product_ids: productIds });

beforeAll(async () => {
  topLevelBefore = (
    await pool.query('SELECT id, display_order, updated_at::text AS updated_at FROM categories WHERE parent_id IS NULL AND deleted_at IS NULL')
  ).rows;
});

afterAll(async () => {
  // Top-level categories back exactly as found (order and updated_at).
  for (const row of topLevelBefore) {
    await pool.query('UPDATE categories SET display_order = $2, updated_at = $3::timestamptz WHERE id = $1', [row.id, row.display_order, row.updated_at]);
  }
  const products = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${PREFIX}%`])).rows.map((r) => r.id);
  if (products.length) {
    await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [products]);
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [products]);
  }
  if (createdCategories.length) {
    await pool.query('UPDATE categories SET parent_id = NULL WHERE id = ANY($1)', [createdCategories]);
    await pool.query('DELETE FROM categories WHERE id = ANY($1)', [createdCategories]);
  }
  await pool.query(
    `DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])
        OR (action = 'CATEGORIES_REORDERED' AND created_at > to_timestamp($2::double precision / 1000))`,
    [[...products, ...createdCategories], stamp]
  );
});

describe('Arrange: category order', () => {
  it('rewrites sub-categories 10, 20, 30 in the listed order (OPERATIONS too), audited', async () => {
    const dairy = await newCategory('dairy');
    const milk = await newCategory('milk', { parent_id: dairy.id, display_order: 0 });
    const eggs = await newCategory('eggs', { parent_id: dairy.id, display_order: 0 });
    const curd = await newCategory('curd', { parent_id: dairy.id, display_order: 0 });

    const res = await putOrder([eggs.id, curd.id, milk.id], opsToken);
    expect(res.status).toBe(200);
    expect((res.body.data.categories as Category[]).map((c) => [c.id, c.display_order])).toEqual([
      [eggs.id, 10],
      [curd.id, 20],
      [milk.id, 30],
    ]);

    const audit = await pool.query(
      `SELECT new_values FROM audit_logs WHERE action = 'CATEGORIES_REORDERED' AND entity_id = $1`,
      [dairy.id]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].new_values.ids).toEqual([eggs.id, curd.id, milk.id]);

    // The customer list follows it.
    const customer = await request(app).get('/api/v1/catalog/categories');
    const kids = (customer.body.data.categories as Category[]).filter((c) => c.parent_id === dairy.id).map((c) => c.id);
    expect(kids).toEqual([eggs.id, curd.id, milk.id]);

    // "Move to top": a partial list keeps the others after it, in their order.
    const top = await putOrder([milk.id]);
    expect(top.status).toBe(200);
    expect((top.body.data.categories as Category[]).map((c) => c.id)).toEqual([milk.id, eggs.id, curd.id]);
  });

  it('arranges top-level categories; the customer list follows', async () => {
    const a = await newCategory('top-a', { display_order: 5000 });
    const b = await newCategory('top-b', { display_order: 5000 });
    const res = await putOrder([b.id, a.id]);
    expect(res.status).toBe(200);
    const ids = (res.body.data.categories as Category[]).map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual([b.id, a.id]);
    const customer = await request(app).get('/api/v1/catalog/categories');
    const order = (customer.body.data.categories as Category[]).filter((c) => c.parent_id === null).map((c) => c.id);
    expect(order.indexOf(b.id)).toBeLessThan(order.indexOf(a.id));
    expect(order.indexOf(b.id)).toBe(0);
  });

  it('refuses mixed levels, unknown ids, duplicates and non-staff', async () => {
    const parent = await newCategory('mix-parent');
    const child = await newCategory('mix-child', { parent_id: parent.id });
    const mixed = await putOrder([parent.id, child.id]);
    expect(mixed.status).toBe(400);
    expect(mixed.body.error.code).toBe('MIXED_CATEGORY_LEVELS');

    const unknown = await putOrder(['7d6c1a51-1111-4111-8111-111111111111']);
    expect(unknown.status).toBe(404);

    const dup = await putOrder([child.id, child.id]);
    expect(dup.status).toBe(400);

    const customer = await putOrder([child.id], customerToken);
    expect(customer.status).toBe(403);
    const none = await request(app).put('/api/v1/admin/categories/order').send({ ids: [child.id] });
    expect(none.status).toBe(401);
  });
});

describe('Arrange: product order in a category', () => {
  it('listed products first (1..n), the rest A-Z; the customer list follows, children included', async () => {
    const grocery = await newCategory('grocery');
    const rice = await newCategory('rice', { parent_id: grocery.id });
    const apple = await newProduct(grocery.id, 'Apple');
    const banana = await newProduct(grocery.id, 'Banana');
    const carrot = await newProduct(rice.id, 'Carrot');
    const dates = await newProduct(grocery.id, 'Dates');

    // Before arranging: A-Z.
    expect(await customerProductIds(grocery.id)).toEqual([apple.id, banana.id, carrot.id, dates.id]);

    const res = await putProducts(grocery.id, [dates.id, carrot.id], opsToken);
    expect(res.status).toBe(200);
    expect((res.body.data.products as Array<{ id: string; display_order: number | null }>).map((p) => [p.id, p.display_order])).toEqual([
      [dates.id, 1],
      [carrot.id, 2],
      [apple.id, null],
      [banana.id, null],
    ]);
    expect(await customerProductIds(grocery.id)).toEqual([dates.id, carrot.id, apple.id, banana.id]);

    // GET shows the same order, with price and category for each row.
    const get = await request(app).get(`/api/v1/admin/categories/${grocery.id}/product-order`).set(auth(tokens.admin));
    expect(get.status).toBe(200);
    expect(get.body.data.category.id).toBe(grocery.id);
    const rows = get.body.data.products as Array<{ id: string; selling_price: number; category_name: string }>;
    expect(rows.map((p) => p.id)).toEqual([dates.id, carrot.id, apple.id, banana.id]);
    expect(rows[1].category_name).toBe(rice.name);
    expect(rows[0].selling_price).toBeGreaterThan(0);

    // A new full list replaces the old one; an empty list clears it (A-Z again).
    await putProducts(grocery.id, [banana.id, apple.id, dates.id, carrot.id]);
    expect(await customerProductIds(grocery.id)).toEqual([banana.id, apple.id, dates.id, carrot.id]);
    const cleared = await putProducts(grocery.id, []);
    expect(cleared.status).toBe(200);
    expect(await customerProductIds(grocery.id)).toEqual([apple.id, banana.id, carrot.id, dates.id]);

    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CATEGORY_PRODUCTS_REORDERED' AND entity_id = $1`,
      [grocery.id]
    );
    expect(audit.rows[0].n).toBe(3);
  });

  it('refuses a product from another category, an unknown category and non-staff', async () => {
    const one = await newCategory('one');
    const two = await newCategory('two');
    const elsewhere = await newProduct(two.id, 'Elsewhere');
    const bad = await putProducts(one.id, [elsewhere.id]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('PRODUCT_NOT_IN_CATEGORY');

    const missing = await putProducts('7d6c1a51-1111-4111-8111-111111111111', []);
    expect(missing.status).toBe(404);

    const forbidden = await putProducts(two.id, [elsewhere.id], customerToken);
    expect(forbidden.status).toBe(403);
  });
});
