import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { OWNER_CATEGORY_SETUP, displayName, parseCategoryText } from '../src/modules/catalog/catalog.category-import.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Category import (owner, 2026-10-14): Main -> Category -> Sub-category,
 * mapped onto category groups -> top-level categories -> child categories.
 *
 * The apply runs against the shared database with this file's own names
 * only. Because an import puts the listed items first, it shifts the order
 * of every other group and top-level category; this file snapshots those
 * positions first and puts them back afterwards, and hard-deletes every row
 * it created (with its audit entries).
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const stamp = Date.now();
const S = String(stamp).slice(-7);
const SKU = `T-CI-${stamp}`;
let testStart: Date;

type GroupSnap = { id: string; sort_order: number; updated_at: Date };
type CatSnap = { id: string; display_order: number; group_id: string | null; group_sort_order: number; updated_at: Date };
let groupSnap: GroupSnap[] = [];
let catSnap: CatSnap[] = [];

const importApi = (body: Record<string, unknown>, token = tokens.admin) =>
  request(app).post('/api/v1/admin/categories/import').set(auth(token)).send(body);

const TEXT = `TEST CATEGORY SETUP ${S}
1. CI MAIN ALPHA ${S}
- CI Rice & Flour ${S} → CI Rice ${S} | CI Flour ${S}
- CI Dry Fish ${S}
2. CI MAIN BETA ${S}
- CI Drinks ${S} → CI Soft Drinks ${S}
- CI Books ${S} (add later)`;

async function myGroups() {
  return (
    await pool.query(`SELECT id, name, sort_order, is_active FROM category_groups WHERE name LIKE $1 AND deleted_at IS NULL ORDER BY sort_order`, [
      `%${S}`,
    ])
  ).rows;
}
async function myCategories() {
  return (
    await pool.query(
      `SELECT id, name, slug, parent_id, group_id, display_order, is_active FROM categories WHERE name LIKE $1 AND deleted_at IS NULL ORDER BY display_order, name`,
      [`%${S}`]
    )
  ).rows as Array<{ id: string; name: string; slug: string; parent_id: string | null; group_id: string | null; display_order: number; is_active: boolean }>;
}

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  groupSnap = (await pool.query('SELECT id, sort_order, updated_at FROM category_groups')).rows;
  catSnap = (await pool.query('SELECT id, display_order, group_id, group_sort_order, updated_at FROM categories')).rows;
});

afterAll(async () => {
  const cats = (await pool.query(`SELECT id FROM categories WHERE name LIKE $1`, [`%${S}`])).rows.map((r) => r.id);
  const groups = (await pool.query(`SELECT id FROM category_groups WHERE name LIKE $1`, [`%${S}`])).rows.map((r) => r.id);
  const products = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${SKU}%`])).rows.map((r) => r.id);
  if (products.length) {
    await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [products]);
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [products]);
  }
  if (cats.length) {
    await pool.query('UPDATE categories SET parent_id = NULL WHERE id = ANY($1)', [cats]);
    await pool.query('DELETE FROM categories WHERE id = ANY($1)', [cats]);
  }
  if (groups.length) await pool.query('DELETE FROM category_groups WHERE id = ANY($1)', [groups]);
  await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [[...cats, ...groups, ...products]]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'CATEGORIES_IMPORTED' AND created_at >= $1`, [testStart]);
  // Put every other group and category back where it was.
  for (const g of groupSnap) {
    await pool.query('UPDATE category_groups SET sort_order = $2, updated_at = $3 WHERE id = $1', [g.id, g.sort_order, g.updated_at]);
  }
  for (const c of catSnap) {
    await pool.query('UPDATE categories SET display_order = $2, group_id = $3, group_sort_order = $4, updated_at = $5 WHERE id = $1', [
      c.id,
      c.display_order,
      c.group_id,
      c.group_sort_order,
      c.updated_at,
    ]);
  }
});

describe('Category import: parsing the owner list', () => {
  it('reads the owner list: 7 mains in Title Case, categories with their sub-categories, "(add later)" off', () => {
    const parsed = parseCategoryText(OWNER_CATEGORY_SETUP);
    expect(parsed.errors).toEqual([]);
    expect(parsed.ignored.map((i) => i.line)).toEqual([1]);
    expect(parsed.mains.map((m) => m.name)).toEqual([
      'Grocery',
      'Breakfast & Drinks',
      'Snacks',
      'Baby Items',
      'Ladies Items',
      'Personal Care',
      'Household',
    ]);
    const grocery = parsed.mains[0];
    expect(grocery.categories.map((c) => c.name)).toEqual([
      'Rice & Flour',
      'Oil, Sugar & Salt',
      'Spices',
      'Vegetables',
      'Dry Fish & Tin Fish',
      'Noodles & Soup',
    ]);
    expect(grocery.categories[0].subs.map((s) => s.name)).toEqual(['Rice', 'Flour', 'Dhal & Grams']);
    expect(grocery.categories[1].subs.map((s) => s.name)).toEqual(['Oil', 'Sugar & Salt', 'Coconut & Coconut Milk', 'Sauces']);
    const books = parsed.mains[6].categories.find((c) => c.name === 'Books & Pens');
    expect(books).toMatchObject({ active: false });
    expect(parsed.mains[6].categories.filter((c) => !c.active)).toHaveLength(1);
  });

  it('Title Case only for names in capitals', () => {
    expect(displayName('BREAKFAST & DRINKS')).toBe('Breakfast & Drinks');
    expect(displayName('  BABY   ITEMS ')).toBe('Baby Items');
    expect(displayName('Milo & Nestomalt')).toBe('Milo & Nestomalt');
    expect(displayName('iPhone cases')).toBe('iPhone cases');
  });

  it('a category before any main, or one listed under two mains, is an error', () => {
    expect(parseCategoryText('- Lonely').errors[0].message).toMatch(/before any main/);
    expect(parseCategoryText('1. A\n- Same\n2. B\n- same').errors[0].message).toMatch(/two main categories/);
  });
});

describe('Category import: API', () => {
  it('serves the owner list as the template (Admin and Operations)', async () => {
    const res = await request(app).get('/api/v1/admin/categories/import/template').set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data.text).toBe(OWNER_CATEGORY_SETUP);
    expect(res.body.data.columns).toEqual(['main', 'category', 'sub_category', 'active']);
  });

  it('is Admin and Operations only', async () => {
    for (const token of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await importApi({ text: TEXT, dry_run: true }, token)).status).toBe(403);
    }
    expect((await request(app).post('/api/v1/admin/categories/import').send({ text: TEXT })).status).toBe(401);
  });

  it('dry run of the owner list previews the 7 mains without writing anything', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM categories')).rows[0].n;
    const res = await importApi({ text: OWNER_CATEGORY_SETUP, dry_run: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.dry_run).toBe(true);
    expect(res.body.data.tree).toHaveLength(7);
    expect(res.body.data.tree[0].categories[0].sub_categories).toHaveLength(3);
    expect((await pool.query('SELECT count(*)::int AS n FROM categories')).rows[0].n).toBe(before);
  });

  it('dry run of a new list: everything is create, nothing written', async () => {
    const res = await importApi({ text: TEXT, dry_run: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.summary).toMatchObject({
      mains: { create: 2, update: 0, keep: 0 },
      categories: { create: 4, update: 0, keep: 0 },
      sub_categories: { create: 3, update: 0, keep: 0 },
    });
    expect(res.body.data.tree[0].name).toBe(`Ci Main Alpha ${S}`);
    expect(await myCategories()).toHaveLength(0);
    expect(await myGroups()).toHaveLength(0);
  });

  it('apply (Operations) creates groups, categories and sub-categories in list order', async () => {
    const res = await importApi({ text: TEXT }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.dry_run).toBe(false);

    const groups = await myGroups();
    expect(groups.map((g) => [g.name, g.sort_order])).toEqual([
      [`Ci Main Alpha ${S}`, 0],
      [`Ci Main Beta ${S}`, 1],
    ]);
    // Every other group now follows the listed ones.
    const minOther = (await pool.query(`SELECT min(sort_order)::int AS m FROM category_groups WHERE deleted_at IS NULL AND name NOT LIKE $1`, [`%${S}`])).rows[0].m;
    if (minOther !== null) expect(minOther).toBeGreaterThanOrEqual(2);

    const cats = await myCategories();
    const by = (name: string) => cats.find((c) => c.name === `${name} ${S}`)!;
    const alpha = groups[0].id;
    const beta = groups[1].id;
    expect(by('CI Rice & Flour')).toMatchObject({ parent_id: null, group_id: alpha, display_order: 10, is_active: true });
    expect(by('CI Dry Fish')).toMatchObject({ parent_id: null, group_id: alpha, display_order: 20 });
    expect(by('CI Drinks')).toMatchObject({ parent_id: null, group_id: beta, display_order: 30 });
    expect(by('CI Books')).toMatchObject({ parent_id: null, group_id: beta, display_order: 40, is_active: false });
    expect(by('CI Rice')).toMatchObject({ parent_id: by('CI Rice & Flour').id, display_order: 10, group_id: null });
    expect(by('CI Flour')).toMatchObject({ parent_id: by('CI Rice & Flour').id, display_order: 20 });
    expect(by('CI Soft Drinks')).toMatchObject({ parent_id: by('CI Drinks').id });
    expect(by('CI Rice & Flour').slug).toBe(`ci-rice-flour-${S}`);

    // The customer home shows the new sections first (Books is off, so hidden).
    const home = await request(app).get('/api/v1/catalog/home-groups');
    const names = (home.body.data.groups as Array<{ name: string; categories: Array<{ name: string }> }>).map((g) => g.name);
    expect(names.slice(0, 2)).toEqual([`Ci Main Alpha ${S}`, `Ci Main Beta ${S}`]);
    const betaTiles = home.body.data.groups[1].categories.map((c: { name: string }) => c.name);
    expect(betaTiles).toEqual([`CI Drinks ${S}`]);

    const audit = (
      await pool.query(`SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'CATEGORIES_IMPORTED' AND created_at >= $1`, [testStart])
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values.summary.categories.create).toBe(4);
  });

  it('applying the same list again changes nothing (all keep)', async () => {
    const before = await myCategories();
    const res = await importApi({ text: TEXT });
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toMatchObject({
      mains: { create: 0, update: 0, keep: 2 },
      categories: { create: 0, update: 0, keep: 4 },
      sub_categories: { create: 0, update: 0, keep: 3 },
      others_reordered: 0,
    });
    expect(await myCategories()).toEqual(before);
  });

  it('matches by name ignoring case, moves a category, adds a sub-category, keeps products and unlisted items', async () => {
    const cats = await myCategories();
    const dryFish = cats.find((c) => c.name === `CI Dry Fish ${S}`)!;
    const product = await request(app)
      .post('/api/v1/admin/products')
      .set(auth(tokens.admin))
      .send({ category_id: dryFish.id, name: `CI product ${stamp}`, sku: `${SKU}-1`, unit: '1 pc', purchase_cost: 40 });
    expect(product.status).toBe(201);

    const next = `1. ci main beta ${S}
- ci dry fish ${S} → CI Sprats ${S}
- CI Drinks ${S} → ci soft drinks ${S}`;
    const preview = await importApi({ text: next, dry_run: true });
    expect(preview.status).toBe(200);
    const beta = preview.body.data.tree[0];
    expect(beta).toMatchObject({ action: 'update', name: `Ci Main Beta ${S}` });
    const fish = beta.categories[0];
    expect(fish).toMatchObject({ action: 'update', id: dryFish.id, name: `CI Dry Fish ${S}` });
    expect(fish.changes.join(' ')).toMatch(/Moves to/);
    expect(fish.sub_categories[0]).toMatchObject({ action: 'create', name: `CI Sprats ${S}` });
    expect(beta.categories[1].sub_categories[0]).toMatchObject({ action: 'keep', name: `CI Soft Drinks ${S}` });
    expect(preview.body.data.warnings.join(' ')).toMatch(/not in this list/);

    const res = await importApi({ text: next });
    expect(res.status).toBe(200);
    const after = await myCategories();
    const groups = await myGroups();
    expect(groups[0].name).toBe(`Ci Main Beta ${S}`);
    expect(after.find((c) => c.id === dryFish.id)).toMatchObject({ group_id: groups[0].id, display_order: 10 });
    expect(after.find((c) => c.name === `CI Sprats ${S}`)).toMatchObject({ parent_id: dryFish.id });
    // Nothing deleted, nothing renamed, the product is where it was.
    expect(after.filter((c) => c.name.startsWith('CI '))).toHaveLength(8);
    expect(after.find((c) => c.name === `CI Books ${S}`)).toBeTruthy();
    const p = (await pool.query('SELECT category_id, image_url FROM products WHERE sku = $1', [`${SKU}-1`])).rows[0];
    expect(p.category_id).toBe(dryFish.id);
  });

  it('accepts spreadsheet rows (main, category, sub_category, active)', async () => {
    const rows = [
      { row: 2, Main: `CI MAIN ALPHA ${S}`, Category: `CI Rice & Flour ${S}`, 'Sub-category': `CI Rice ${S}` },
      { row: 3, Main: `CI MAIN ALPHA ${S}`, Category: `CI Rice & Flour ${S}`, 'Sub-category': `CI Atta ${S}`, Active: 'no' },
      { row: 4, Main: `CI MAIN ALPHA ${S}`, Category: `CI Tea ${S}` },
    ];
    const preview = await importApi({ rows, dry_run: true });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const alpha = preview.body.data.tree[0];
    expect(alpha.categories.map((c: { name: string; action: string }) => [c.name, c.action])).toEqual([
      [`CI Rice & Flour ${S}`, 'update'],
      [`CI Tea ${S}`, 'create'],
    ]);
    expect(alpha.categories[0].sub_categories.map((s: { name: string; action: string; active: boolean }) => [s.name, s.action, s.active])).toEqual([
      [`CI Rice ${S}`, 'keep', true],
      [`CI Atta ${S}`, 'create', false],
    ]);
  });

  it('a list with errors: dry run reports them, apply refuses (400) and writes nothing', async () => {
    const bad = `- Orphan ${S}\n1. CI MAIN ${S}\n- X`;
    const dry = await importApi({ text: bad, dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.body.data.errors.length).toBeGreaterThanOrEqual(2);
    const apply = await importApi({ text: bad });
    expect(apply.status).toBe(400);
    expect(apply.body.error.code).toBe('CATEGORY_IMPORT_INVALID');
    expect((await myGroups()).find((g) => g.name === `Ci Main ${S}`)).toBeUndefined();
  });

  it('refuses a body with neither or both of text and rows', async () => {
    expect((await importApi({ dry_run: true })).status).toBe(400);
    expect((await importApi({ text: TEXT, rows: [], dry_run: true })).status).toBe(400);
  });
});

describe('Product import can pick a sub-category', () => {
  const row = (extra: Record<string, unknown>) => ({ name: `CI import ${stamp}`, sku: `${SKU}-imp`, unit: '1 pc', purchase_cost: 10, ...extra });
  const dry = (rows: Array<Record<string, unknown>>) =>
    request(app).post('/api/v1/admin/products/import').set(auth(tokens.admin)).send({ rows, dry_run: true });

  it('"Category > Sub-category", the sub_category column, or the slug; an ambiguous name is an error', async () => {
    // A top-level "CI Rice <S>" next to the sub-category of the same name.
    const top = await request(app).post('/api/v1/admin/categories').set(auth(tokens.admin)).send({ name: `CI Rice ${S}` });
    expect(top.status).toBe(201);
    const sub = (await myCategories()).find((c) => c.name === `CI Rice ${S}` && c.parent_id)!;

    const ambiguous = await dry([row({ category: `ci rice ${S}` })]);
    expect(ambiguous.body.data.results[0].status).toBe('error');
    expect(ambiguous.body.data.results[0].message).toMatch(/more than one category/);

    for (const r of [
      row({ category: `CI Rice & Flour ${S} > CI Rice ${S}` }),
      row({ category: `CI Rice & Flour ${S} → ci rice ${S}` }),
      row({ category: `CI Rice & Flour ${S}`, sub_category: `CI Rice ${S}` }),
      row({ category: sub.slug }),
    ]) {
      const res = await dry([r]);
      expect(res.status).toBe(200);
      expect(res.body.data.results[0].status, JSON.stringify(res.body.data.results[0])).toBe('created');
    }

    const missing = await dry([row({ category: `CI Rice & Flour ${S}`, sub_category: 'Nope' })]);
    expect(missing.body.data.results[0].errors[0]).toMatchObject({ field: 'sub_category' });
  });
});
