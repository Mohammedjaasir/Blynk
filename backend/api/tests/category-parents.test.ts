import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Sub-categories (migration 026): parent_id on every category payload, the
 * one-level rules on create and edit, a parent's product listing including
 * its children's products, the home showing top-level categories only, and
 * a deleted parent releasing its children.
 *
 * Every category and product the file creates is hard-deleted again, with
 * its audit rows (test:hygiene).
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const stamp = Date.now();
const PREFIX = 'T-CP-';
const createdCategories: string[] = [];

type Category = { id: string; name: string; slug: string; parent_id: string | null };

async function newCategory(label: string, body: Record<string, unknown> = {}, token = tokens.admin) {
  const res = await request(app)
    .post('/api/v1/admin/categories')
    .set(auth(token))
    .send({ name: `CP ${label} ${stamp}`, slug: `test-cat-cp-${label}-${stamp}`, ...body });
  expect(res.status).toBe(201);
  createdCategories.push(res.body.data.category.id);
  return res.body.data.category as Category;
}

async function newProduct(categoryId: string, suffix: string) {
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({ category_id: categoryId, name: `CP product ${suffix} ${stamp}`, sku: `${PREFIX}${suffix}-${stamp}`, unit: '1 pc', purchase_cost: 50 });
  expect(res.status).toBe(201);
  return res.body.data.product as { id: string };
}

const patch = (id: string, body: Record<string, unknown>, token = tokens.admin) =>
  request(app).patch(`/api/v1/admin/categories/${id}`).set(auth(token)).send(body);

async function productIds(query: Record<string, string>) {
  const res = await request(app).get('/api/v1/catalog/products').query({ limit: '100', ...query });
  expect(res.status).toBe(200);
  return (res.body.data.products as Array<{ id: string }>).map((p) => p.id);
}

async function homeCategories(): Promise<Category[]> {
  const res = await request(app).get('/api/v1/catalog/home-groups');
  expect(res.status).toBe(200);
  return (res.body.data.groups as Array<{ categories: Category[] }>).flatMap((g) => g.categories);
}

afterAll(async () => {
  const products = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${PREFIX}%`])).rows.map((r) => r.id);
  if (products.length) {
    await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [products]);
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [products]);
  }
  if (createdCategories.length) await pool.query('DELETE FROM categories WHERE id = ANY($1)', [createdCategories]);
  await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [[...products, ...createdCategories]]);
});

describe('Sub-categories: create and edit', () => {
  it('creates a child inside a parent (ADMIN and OPERATIONS); every payload carries parent_id', async () => {
    const bakery = await newCategory('bakery');
    expect(bakery.parent_id).toBeNull();
    const bread = await newCategory('bread', { parent_id: bakery.id }, opsToken);
    expect(bread.parent_id).toBe(bakery.id);

    const admin = await request(app).get('/api/v1/admin/categories').set(auth(tokens.admin));
    const listed = admin.body.data.categories as Category[];
    expect(listed.find((c) => c.id === bread.id)).toMatchObject({ parent_id: bakery.id });
    expect(listed.find((c) => c.id === bakery.id)).toMatchObject({ parent_id: null });

    const pub = await request(app).get('/api/v1/catalog/categories');
    const pubListed = pub.body.data.categories as Category[];
    expect(pubListed.find((c) => c.id === bread.id)).toMatchObject({ parent_id: bakery.id });
    expect(pubListed.find((c) => c.id === bakery.id)).toMatchObject({ parent_id: null });
  });

  it('refuses a missing parent, a parent that is itself a child, and a category inside itself', async () => {
    const top = await newCategory('rules-top');
    const child = await newCategory('rules-child', { parent_id: top.id });

    const missing = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(tokens.admin))
      .send({ name: `CP missing ${stamp}`, slug: `test-cat-cp-missing-${stamp}`, parent_id: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('PARENT_CATEGORY_NOT_FOUND');

    const deep = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(tokens.admin))
      .send({ name: `CP deep ${stamp}`, slug: `test-cat-cp-deep-${stamp}`, parent_id: child.id });
    expect(deep.status).toBe(400);
    expect(deep.body.error.code).toBe('INVALID_PARENT_CATEGORY');
    expect(deep.body.error.message).toMatch(/one level/);

    const self = await patch(top.id, { parent_id: top.id });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('INVALID_PARENT_CATEGORY');

    // A category with children cannot go inside another one.
    const other = await newCategory('rules-other');
    const parentIntoOther = await patch(top.id, { parent_id: other.id });
    expect(parentIntoOther.status).toBe(400);
    expect(parentIntoOther.body.error.code).toBe('INVALID_PARENT_CATEGORY');
    expect(parentIntoOther.body.error.message).toMatch(/sub-categories/);

    const badId = await patch(top.id, { parent_id: 'not-a-uuid' });
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH moves a child to another parent and null clears it; other edits keep it', async () => {
    const a = await newCategory('move-a');
    const b = await newCategory('move-b');
    const c = await newCategory('move-c', { parent_id: a.id });

    const moved = await patch(c.id, { parent_id: b.id }, opsToken);
    expect(moved.status).toBe(200);
    expect(moved.body.data.category.parent_id).toBe(b.id);

    const renamed = await patch(c.id, { description: 'x' });
    expect(renamed.body.data.category.parent_id).toBe(b.id);

    const cleared = await patch(c.id, { parent_id: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.category.parent_id).toBeNull();
  });
});

describe('Sub-categories: customer reads', () => {
  it("a parent's product listing includes its children's products; a child's lists only its own", async () => {
    const parent = await newCategory('list-parent');
    const child = await newCategory('list-child', { parent_id: parent.id });
    const sibling = await newCategory('list-sibling', { parent_id: parent.id });
    const stranger = await newCategory('list-stranger');
    const pOwn = await newProduct(parent.id, 'own');
    const pChild = await newProduct(child.id, 'child');
    const pSibling = await newProduct(sibling.id, 'sibling');
    const pStranger = await newProduct(stranger.id, 'stranger');
    const family = [pOwn.id, pChild.id, pSibling.id].sort();

    expect((await productIds({ category_slug: parent.slug })).sort()).toEqual(family);
    const res = await request(app).get('/api/v1/catalog/products').query({ category_slug: parent.slug });
    expect(res.body.data.pagination.total).toBe(3);

    expect(await productIds({ category_slug: child.slug })).toEqual([pChild.id]);
    expect((await productIds({ category_id: parent.id })).sort()).toEqual(family);
    expect(await productIds({ category_slug: stranger.slug })).toEqual([pStranger.id]);
  });

  it('the home lists top-level categories only', async () => {
    const parent = await newCategory('home-parent');
    const child = await newCategory('home-child', { parent_id: parent.id });
    const flat = await homeCategories();
    expect(flat.map((c) => c.id)).toContain(parent.id);
    expect(flat.map((c) => c.id)).not.toContain(child.id);
    expect(flat.every((c) => c.parent_id === null)).toBe(true);
  });
});

describe('Sub-categories: deleting a parent', () => {
  it('releases its children to the top level', async () => {
    const parent = await newCategory('del-parent');
    const child = await newCategory('del-child', { parent_id: parent.id });

    const res = await request(app).delete(`/api/v1/admin/categories/${parent.id}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('HARD');
    expect((await pool.query('SELECT parent_id FROM categories WHERE id = $1', [child.id])).rows[0].parent_id).toBeNull();

    // The released child shows on the home again, now top level.
    expect((await homeCategories()).map((c) => c.id)).toContain(child.id);
  });

  it('a soft-deleted parent releases them too and cannot be chosen as a parent', async () => {
    const parent = await newCategory('soft-parent');
    const child = await newCategory('soft-child', { parent_id: parent.id });
    const target = await newCategory('soft-target');
    const product = await newProduct(parent.id, 'soft');
    // Leave the product the way migration 017 leaves an ordered, deleted one.
    await pool.query('UPDATE products SET deleted_at = now(), is_active = false WHERE id = $1', [product.id]);

    const res = await request(app).delete(`/api/v1/admin/categories/${parent.id}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('SOFT');
    expect((await pool.query('SELECT parent_id FROM categories WHERE id = $1', [child.id])).rows[0].parent_id).toBeNull();

    const into = await patch(target.id, { parent_id: parent.id });
    expect(into.status).toBe(400);
    expect(into.body.error.code).toBe('PARENT_CATEGORY_NOT_FOUND');
  });
});
