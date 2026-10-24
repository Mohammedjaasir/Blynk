import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { tokens, auth } from './helpers/stock.js';
import { setProductCategoriesReadyForTests } from '../src/modules/catalog/catalog.extra-categories.js';

/**
 * Multi-category products (migration 060; owner, 2026-10-25). A product has ONE primary category
 * (offers, hours, markup, the name on its card) plus up to 5 extra categories used only to LIST it:
 * the customer list / count / search of a category (and of its parent) include it, the staff API
 * reads and writes `extra_category_ids`, Arrange orders only the primary members (extras follow,
 * A-Z), deleting a category drops its extra memberships, the Excel import has an optional
 * "extra_categories" column, and before the migration everything behaves as it did.
 *
 * Everything the file creates is hard-deleted again, with its audit rows.
 */
const app = createApp();
const stamp = Date.now();
const PREFIX = 'T-XCAT-';
const categories: string[] = [];
const BASE = '/api/v1';

async function newCategory(label: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`${BASE}/admin/categories`)
    .set(auth(tokens.admin))
    .send({ name: `XC ${label} ${stamp}`, slug: `test-xcat-${label}-${stamp}`, ...body });
  expect(res.status).toBe(201);
  categories.push(res.body.data.category.id);
  return res.body.data.category as { id: string; name: string; slug: string };
}

async function newProduct(categoryId: string, label: string, extra?: string[], more: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`${BASE}/admin/products`)
    .set(auth(tokens.admin))
    .send({
      category_id: categoryId,
      name: `${label} ${stamp}`,
      sku: `${PREFIX}${label}-${stamp}`,
      unit: '1 pc',
      purchase_cost: 100,
      ...(extra ? { extra_category_ids: extra } : {}),
      ...more,
    });
  return res;
}

type CustomerProduct = { id: string; category_id: string; category_name: string; extra_category_ids: string[]; offer_price: number | null };
async function customerList(query: Record<string, string>) {
  const res = await request(app).get(`${BASE}/catalog/products`).query({ limit: '100', ...query });
  expect(res.status).toBe(200);
  return {
    products: res.body.data.products as CustomerProduct[],
    total: res.body.data.pagination.total as number,
  };
}

afterAll(async () => {
  setProductCategoriesReadyForTests(null);
  const products = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${PREFIX}%`])).rows.map((r) => r.id);
  if (products.length) {
    await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [products]);
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [products]); // product_categories cascade
  }
  if (categories.length) {
    await pool.query('UPDATE categories SET parent_id = NULL WHERE id = ANY($1)', [categories]);
    await pool.query('DELETE FROM categories WHERE id = ANY($1)', [categories]);
  }
  await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [[...products, ...categories]]);
});

describe('Extra categories: listing, count, search', () => {
  it('a product shows in its primary AND extra categories, once, with the primary name', async () => {
    const rice = await newCategory('rice');
    const ready = await newCategory('ready');
    const drinks = await newCategory('drinks');
    const res = await newProduct(rice.id, 'kottu', [ready.id]);
    expect(res.status).toBe(201);
    const id = res.body.data.product.id as string;
    expect(res.body.data.product.extra_category_ids).toEqual([ready.id]);
    expect(res.body.data.product.extra_categories).toEqual([{ id: ready.id, name: ready.name, path: ready.name }]);
    expect(res.body.data.product.extra_categories_ready).toBe(true);

    for (const c of [rice, ready]) {
      const byId = await customerList({ category_id: c.id });
      expect(byId.products.map((p) => p.id)).toEqual([id]);
      expect(byId.total).toBe(1);
      const bySlug = await customerList({ category_slug: c.slug });
      expect(bySlug.products.map((p) => p.id)).toEqual([id]);
      expect(bySlug.total).toBe(1);
    }
    // not in an unrelated category
    expect((await customerList({ category_id: drinks.id })).products).toEqual([]);

    // the card keeps its primary name; the customer DTO tells the app where else it is listed
    const inExtra = (await customerList({ category_id: ready.id })).products[0]!;
    expect(inExtra.category_id).toBe(rice.id);
    expect(inExtra.category_name).toBe(rice.name);
    expect(inExtra.extra_category_ids).toEqual([ready.id]);

    // search without a category: exactly one row, never one per category
    const search = await customerList({ search: `kottu ${stamp}` });
    expect(search.products.map((p) => p.id)).toEqual([id]);
    expect(search.total).toBe(1);
    // search inside an extra category finds it, inside another does not
    expect((await customerList({ search: `kottu ${stamp}`, category_id: ready.id })).total).toBe(1);
    expect((await customerList({ search: `kottu ${stamp}`, category_id: drinks.id })).total).toBe(0);

    // the single product endpoint carries it too
    const one = await request(app).get(`${BASE}/catalog/products/${id}`);
    expect(one.body.data.product.extra_category_ids).toEqual([ready.id]);
  });

  it('a parent category lists a product whose EXTRA category is one of its sub-categories', async () => {
    const parent = await newCategory('par');
    const sub = await newCategory('sub', { parent_id: parent.id });
    const other = await newCategory('oth');
    const res = await newProduct(other.id, 'inkid', [sub.id]);
    expect(res.status).toBe(201);
    const id = res.body.data.product.id as string;
    expect((await customerList({ category_id: parent.id })).products.map((p) => p.id)).toEqual([id]);
    expect((await customerList({ category_slug: parent.slug })).total).toBe(1);
    expect((await customerList({ category_id: sub.id })).products.map((p) => p.id)).toEqual([id]);
    // the staff path is "Parent › Sub"
    const staff = await request(app).get(`${BASE}/admin/products/${id}`).set(auth(tokens.admin));
    expect(staff.body.data.product.extra_categories[0].path).toBe(`${parent.name} › ${sub.name}`);
  });

  it('inside a category the arranged primary products come first, extra-category members follow A-Z', async () => {
    const a = await newCategory('ord-a');
    const b = await newCategory('ord-b');
    const first = (await newProduct(a.id, 'zz-primary-1')).body.data.product.id as string;
    const second = (await newProduct(a.id, 'aa-primary-2')).body.data.product.id as string;
    const guestB = (await newProduct(b.id, 'bb-guest', [a.id])).body.data.product.id as string;
    const guestA = (await newProduct(b.id, 'aa-guest', [a.id])).body.data.product.id as string;
    // Arrange (primary members only): zz first, then aa
    const arranged = await request(app)
      .put(`${BASE}/admin/categories/${a.id}/product-order`)
      .set(auth(tokens.admin))
      .send({ product_ids: [first, second] });
    expect(arranged.status).toBe(200);
    // the Arrange screen lists the category's own products only
    expect((arranged.body.data.products as Array<{ id: string }>).map((p) => p.id)).toEqual([first, second]);
    // an extra-category member cannot be arranged here
    const refused = await request(app)
      .put(`${BASE}/admin/categories/${a.id}/product-order`)
      .set(auth(tokens.admin))
      .send({ product_ids: [guestA] });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('PRODUCT_NOT_IN_CATEGORY');

    const list = await customerList({ category_id: a.id });
    expect(list.products.map((p) => p.id)).toEqual([first, second, guestA, guestB]);
    expect(list.total).toBe(4);
  });

  it('staff category list: product_count stays the primary count, extra_product_count counts the listed-through ones', async () => {
    const a = await newCategory('cnt-a');
    const b = await newCategory('cnt-b');
    await newProduct(a.id, 'cnt-1');
    await newProduct(a.id, 'cnt-2', [b.id]);
    await newProduct(b.id, 'cnt-3', [a.id]);
    const res = await request(app).get(`${BASE}/admin/categories`).set(auth(tokens.admin));
    const rows = res.body.data.categories as Array<{ id: string; product_count: number; extra_product_count: number }>;
    expect(rows.find((c) => c.id === a.id)).toMatchObject({ product_count: 2, extra_product_count: 1 });
    expect(rows.find((c) => c.id === b.id)).toMatchObject({ product_count: 1, extra_product_count: 1 });
  });
});

describe('Extra categories: the primary still decides offers', () => {
  it('a category offer on the PRIMARY applies everywhere; one on the extra category does not', async () => {
    const main = await newCategory('offmain');
    const extra = await newCategory('offextra');
    const id = (await newProduct(main.id, 'offprod', [extra.id])).body.data.product.id as string;
    const before = (await customerList({ category_id: extra.id })).products[0]!;
    expect(before.offer_price).toBeNull();

    // an offer on the extra category: not this product's price
    const onExtra = await request(app).put(`${BASE}/admin/categories/${extra.id}/offer`).set(auth(tokens.admin)).send({ offer_percent: 50 });
    expect(onExtra.status).toBe(200);
    expect((await customerList({ category_id: extra.id })).products.find((p) => p.id === id)!.offer_price).toBeNull();

    // an offer on the primary: shown in both lists
    const onMain = await request(app).put(`${BASE}/admin/categories/${main.id}/offer`).set(auth(tokens.admin)).send({ offer_percent: 20 });
    expect(onMain.status).toBe(200);
    const mainPrice = (await customerList({ category_id: main.id })).products.find((p) => p.id === id)!.offer_price;
    const extraPrice = (await customerList({ category_id: extra.id })).products.find((p) => p.id === id)!.offer_price;
    expect(mainPrice).not.toBeNull();
    expect(extraPrice).toBe(mainPrice);
  });
});

describe('Extra categories: validation and updates', () => {
  it('refuses the primary, duplicates, more than 5, unknown and switched-off categories', async () => {
    const main = await newCategory('val-main');
    const others: string[] = [];
    for (let i = 0; i < 6; i += 1) others.push((await newCategory(`val-o${i}`)).id);
    const off = await newCategory('val-off', { is_active: false });
    const create = (extra: string[], label: string) => newProduct(main.id, label, extra);

    const primary = await create([main.id], 'val-p');
    expect(primary.status).toBe(400);
    expect(primary.body.error.code).toBe('EXTRA_CATEGORIES_INVALID');
    const dup = await create([others[0]!, others[0]!], 'val-d');
    expect(dup.status).toBe(400);
    const tooMany = await create(others, 'val-m');
    expect(tooMany.status).toBe(400);
    const unknown = await create(['11111111-1111-4111-8111-111111111111'], 'val-u');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('EXTRA_CATEGORIES_INVALID');
    const inactive = await create([off.id], 'val-i');
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe('EXTRA_CATEGORIES_INVALID');
    const notIds = await create(['nope'], 'val-n');
    expect(notIds.status).toBe(400);
    // nothing was created
    const left = await pool.query('SELECT 1 FROM products WHERE sku LIKE $1', [`${PREFIX}val-%`]);
    expect(left.rowCount).toBe(0);

    // exactly 5 is fine
    const five = await create(others.slice(0, 5), 'val-five');
    expect(five.status).toBe(201);
    expect(five.body.data.product.extra_category_ids).toHaveLength(5);
  });

  it('update replaces the set (omitted = unchanged, [] clears), audited; the staff list shows it', async () => {
    const main = await newCategory('upd-main');
    const x = await newCategory('upd-x');
    const y = await newCategory('upd-y');
    const z = await newCategory('upd-z');
    const id = (await newProduct(main.id, 'upd', [x.id, y.id])).body.data.product.id as string;
    const patch = (body: Record<string, unknown>) => request(app).patch(`${BASE}/admin/products/${id}`).set(auth(tokens.admin)).send(body);

    // other edits leave the set alone
    const rename = await patch({ description: 'tasty' });
    expect(rename.body.data.product.extra_category_ids.sort()).toEqual([x.id, y.id].sort());

    const swap = await patch({ extra_category_ids: [y.id, z.id] });
    expect(swap.status).toBe(200);
    expect(swap.body.data.product.extra_category_ids.sort()).toEqual([y.id, z.id].sort());
    expect((await customerList({ category_id: x.id })).total).toBe(0);
    expect((await customerList({ category_id: z.id })).total).toBe(1);

    // an unchanged set writes no audit row
    await patch({ extra_category_ids: [z.id, y.id] });
    const audit = await pool.query(`SELECT old_values, new_values FROM audit_logs WHERE action = 'PRODUCT_CATEGORIES_CHANGED' AND entity_id = $1 ORDER BY created_at`, [id]);
    expect(audit.rows).toHaveLength(2); // create + the swap
    expect(audit.rows[1].old_values.extra_category_ids.sort()).toEqual([x.id, y.id].sort());
    expect(audit.rows[1].new_values.extra_category_ids.sort()).toEqual([y.id, z.id].sort());

    // the staff product list carries ids and names
    const list = await request(app).get(`${BASE}/admin/products`).query({ search: `upd ${stamp}` }).set(auth(tokens.admin));
    const row = (list.body.data.products as Array<{ id: string; extra_category_ids: string[]; extra_categories: Array<{ name: string }> }>).find((p) => p.id === id)!;
    expect(row.extra_category_ids.sort()).toEqual([y.id, z.id].sort());
    expect(row.extra_categories.map((c) => c.name).sort()).toEqual([y.name, z.name].sort());

    const clear = await patch({ extra_category_ids: [] });
    expect(clear.body.data.product.extra_category_ids).toEqual([]);
    expect((await customerList({ category_id: y.id })).total).toBe(0);

    // the new primary may not be an extra: validated against the category it is moving to
    const bad = await patch({ category_id: x.id, extra_category_ids: [x.id] });
    expect(bad.status).toBe(400);
  });

  it('moving the product into one of its extra categories makes it the primary only (no duplicate row)', async () => {
    const main = await newCategory('mv-main');
    const extra = await newCategory('mv-extra');
    const id = (await newProduct(main.id, 'mv', [extra.id])).body.data.product.id as string;
    const moved = await request(app).patch(`${BASE}/admin/products/${id}`).set(auth(tokens.admin)).send({ category_id: extra.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.product.extra_category_ids).toEqual([]);
    const rows = await pool.query('SELECT 1 FROM product_categories WHERE product_id = $1', [id]);
    expect(rows.rowCount).toBe(0);
    expect((await customerList({ category_id: extra.id })).total).toBe(1);
    expect((await customerList({ category_id: main.id })).total).toBe(0);
  });

  it('OPERATIONS may set them too; a customer may not', async () => {
    const main = await newCategory('who-main');
    const extra = await newCategory('who-extra');
    const ops = await request(app)
      .post(`${BASE}/admin/products`)
      .set(auth(tokens.admin))
      .send({ category_id: main.id, name: `who ${stamp}`, sku: `${PREFIX}who-${stamp}`, unit: '1 pc', purchase_cost: 10, extra_category_ids: [extra.id] });
    expect(ops.status).toBe(201);
    const denied = await request(app)
      .patch(`${BASE}/admin/products/${ops.body.data.product.id}`)
      .set(auth(tokens.customer))
      .send({ extra_category_ids: [] });
    expect(denied.status).toBe(403);
  });
});

describe('Extra categories: deleting a category', () => {
  it('removes the extra memberships (the product stays in its primary); moving products works', async () => {
    const main = await newCategory('del-main');
    const extra = await newCategory('del-extra');
    const target = await newCategory('del-target');
    const id = (await newProduct(main.id, 'del', [extra.id])).body.data.product.id as string;

    // deleting the EXTRA category: empty of primary products, so it just goes
    const gone = await request(app).delete(`${BASE}/admin/categories/${extra.id}`).set(auth(tokens.admin));
    expect(gone.status).toBe(200);
    const rows = await pool.query('SELECT 1 FROM product_categories WHERE product_id = $1', [id]);
    expect(rows.rowCount).toBe(0);
    expect((await customerList({ category_id: main.id })).products.map((p) => p.id)).toEqual([id]);

    // moving the primary's products: a product already extra-listed in the target ends up with just the primary
    const id2 = (await newProduct(main.id, 'del2', [target.id])).body.data.product.id as string;
    const moved = await request(app).delete(`${BASE}/admin/categories/${main.id}`).query({ move_to_category_id: target.id }).set(auth(tokens.admin));
    expect(moved.status).toBe(200);
    expect(moved.body.data.moved_product_count).toBe(2);
    const after = await customerList({ category_id: target.id });
    expect(after.products.map((p) => p.id).sort()).toEqual([id, id2].sort());
    expect(after.products.find((p) => p.id === id2)!.extra_category_ids).toEqual([]);
    const left = await pool.query('SELECT 1 FROM product_categories WHERE product_id = ANY($1)', [[id, id2]]);
    expect(left.rowCount).toBe(0);
  });
});

describe('Extra categories: Excel import', () => {
  const importRows = (rows: Array<Record<string, unknown>>, dry_run = false) =>
    request(app).post(`${BASE}/admin/products/import`).set(auth(tokens.admin)).send({ rows, dry_run });

  it('an "extra_categories" cell (names, ";"-separated) sets them; blank leaves them alone; the main one is ignored', async () => {
    const main = await newCategory('imp-main');
    const e1 = await newCategory('imp-e1');
    const e2 = await newCategory('imp-e2');
    const row = (extra?: string) => ({
      name: `Imported ${stamp}`,
      category: main.name,
      unit: '1 pc',
      purchase_cost: 40,
      sku: `${PREFIX}imp-${stamp}`,
      ...(extra !== undefined ? { extra_categories: extra } : {}),
    });
    const dry = await importRows([row(`${e1.name}; ${e2.slug} ;${main.name}`)], true);
    expect(dry.body.data.results[0].status).toBe('created');
    expect((await pool.query('SELECT 1 FROM products WHERE sku = $1', [`${PREFIX}imp-${stamp}`])).rowCount).toBe(0);

    const created = await importRows([row(`${e1.name}; ${e2.slug} ;${main.name}`)]);
    expect(created.body.data.results[0].status).toBe('created');
    const id = created.body.data.results[0].product_id as string;
    const ids = (await pool.query('SELECT category_id FROM product_categories WHERE product_id = $1', [id])).rows.map((r) => r.category_id);
    expect(ids.sort()).toEqual([e1.id, e2.id].sort());

    // same file again: nothing changes
    const again = await importRows([row(`${e1.name};${e2.name}`)]);
    expect(again.body.data.results[0].status).toBe('skipped');
    // blank cell: unchanged
    const blank = await importRows([row()]);
    expect(blank.body.data.results[0].status).toBe('skipped');
    expect((await pool.query('SELECT 1 FROM product_categories WHERE product_id = $1', [id])).rowCount).toBe(2);
    // a different list replaces the set (dry run says updated, nothing written)
    const dryChange = await importRows([row(e1.name)], true);
    expect(dryChange.body.data.results[0].status).toBe('updated');
    expect((await pool.query('SELECT 1 FROM product_categories WHERE product_id = $1', [id])).rowCount).toBe(2);
    const change = await importRows([row(e1.name)]);
    expect(change.body.data.results[0].status).toBe('updated');
    expect((await pool.query('SELECT category_id FROM product_categories WHERE product_id = $1', [id])).rows).toEqual([{ category_id: e1.id }]);

    // unknown name and too many are row errors
    const unknown = await importRows([row('No Such Category')]);
    expect(unknown.body.data.results[0].status).toBe('error');
    expect(unknown.body.data.results[0].errors[0].field).toBe('extra_categories');
  });
});

describe('Extra categories: before migration 060', () => {
  it('behaves exactly as today: primary-only lists, [] ids, the staff forms are told to hide the field, a non-empty set is refused', async () => {
    const main = await newCategory('pre-main');
    const extra = await newCategory('pre-extra');
    const id = (await newProduct(main.id, 'pre', [extra.id])).body.data.product.id as string;
    setProductCategoriesReadyForTests(false);
    try {
      // lists: primary only; no SQL against the missing table
      expect((await customerList({ category_id: extra.id })).total).toBe(0);
      const mainList = await customerList({ category_id: main.id });
      expect(mainList.products.map((p) => p.id)).toEqual([id]);
      expect(mainList.products[0]!.extra_category_ids).toEqual([]);
      const staff = await request(app).get(`${BASE}/admin/products/${id}`).set(auth(tokens.admin));
      expect(staff.status).toBe(200);
      expect(staff.body.data.product).toMatchObject({ extra_categories_ready: false, extra_category_ids: [] });
      const cats = await request(app).get(`${BASE}/admin/categories`).set(auth(tokens.admin));
      expect(cats.status).toBe(200);
      expect((cats.body.data.categories as Array<{ extra_product_count: number | null }>).every((c) => c.extra_product_count === null)).toBe(true);
      // an ordinary edit still works; a non-empty set is a clear 503, never a silent drop
      const edit = await request(app).patch(`${BASE}/admin/products/${id}`).set(auth(tokens.admin)).send({ description: 'x' });
      expect(edit.status).toBe(200);
      const set = await request(app).patch(`${BASE}/admin/products/${id}`).set(auth(tokens.admin)).send({ extra_category_ids: [extra.id] });
      expect(set.status).toBe(503);
      expect(set.body.error.code).toBe('EXTRA_CATEGORIES_NOT_READY');
      const empty = await request(app).patch(`${BASE}/admin/products/${id}`).set(auth(tokens.admin)).send({ extra_category_ids: [] });
      expect(empty.status).toBe(200);
      // deleting a category still works
      const del = await request(app).delete(`${BASE}/admin/categories/${extra.id}`).set(auth(tokens.admin));
      expect(del.status).toBe(200);
    } finally {
      setProductCategoriesReadyForTests(null);
    }
  });
});
