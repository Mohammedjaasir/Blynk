import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { env } from '../src/config/env.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Category groups on the customer home (migration 025): the public
 * GET /catalog/home-groups, staff CRUD / reorder / membership, the Group field
 * on the category form, the audit trail and the catalog_changed NOTIFY.
 * Tiles inside a group follow Arrange (display_order, name), not the group's
 * own list position (owner, 2026-10-10).
 *
 * Every group and category the file creates is hard-deleted again, with its
 * audit rows, and any group that existed before keeps its exact row
 * (test:hygiene).
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const stamp = Date.now();
const createdCategories: string[] = [];
const createdGroups: string[] = [];
let testStart: Date;
let groupsBefore: Array<{ id: string; sort_order: number; updated_at: Date }> = [];

type Group = { id: string; name: string; sort_order: number; is_active: boolean; categories: Array<{ id: string; group_id: string | null; group_sort_order: number }> };
type HomeGroup = { id: string | null; name: string; categories: Array<{ id: string; name: string; slug: string; image_url: string | null; image_focal_x: number; image_focal_y: number }> };

async function newCategory(label: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/admin/categories')
    .set(auth(tokens.admin))
    .send({ name: `CG ${label} ${stamp}`, slug: `test-cat-cg-${label}-${stamp}`, ...body });
  expect(res.status).toBe(201);
  createdCategories.push(res.body.data.category.id);
  return res.body.data.category as { id: string; group_id: string | null; group_sort_order: number };
}

async function newGroup(label: string, body: Record<string, unknown> = {}, token = tokens.admin) {
  const res = await request(app)
    .post('/api/v1/admin/category-groups')
    .set(auth(token))
    .send({ name: `CG group ${label} ${stamp}`, ...body });
  expect(res.status).toBe(201);
  createdGroups.push(res.body.data.group.id);
  return res.body.data.group as Group;
}

const setMembers = (groupId: string, ids: string[], token = tokens.admin) =>
  request(app).put(`/api/v1/admin/category-groups/${groupId}/categories`).set(auth(token)).send({ category_ids: ids });

async function home(): Promise<HomeGroup[]> {
  const res = await request(app).get('/api/v1/catalog/home-groups');
  expect(res.status).toBe(200);
  return res.body.data.groups;
}

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  groupsBefore = (await pool.query('SELECT id, sort_order, updated_at FROM category_groups')).rows;
});

afterAll(async () => {
  if (createdCategories.length) await pool.query('DELETE FROM categories WHERE id = ANY($1)', [createdCategories]);
  if (createdGroups.length) await pool.query('DELETE FROM category_groups WHERE id = ANY($1)', [createdGroups]);
  for (const g of groupsBefore) {
    await pool.query('UPDATE category_groups SET sort_order = $2, updated_at = $3 WHERE id = $1', [g.id, g.sort_order, g.updated_at]);
  }
  await pool.query(
    `DELETE FROM audit_logs
      WHERE entity_id = ANY($1::uuid[])
         OR (entity_type = 'CATEGORY_GROUP' AND actor_user_id = $2 AND created_at >= $3)`,
    [[...createdCategories, ...createdGroups], users.admin.id, testStart]
  );
});

describe('Category groups: staff management', () => {
  it('creates groups at the end, for ADMIN and OPERATIONS, and audits them', async () => {
    const a = await newGroup('a');
    const b = await newGroup('b', {}, opsToken);
    expect(a.is_active).toBe(true);
    expect(a.categories).toEqual([]);
    expect(b.sort_order).toBeGreaterThan(a.sort_order);

    const audit = (await pool.query("SELECT action, entity_type FROM audit_logs WHERE entity_id = $1", [a.id])).rows;
    expect(audit).toEqual([{ action: 'CATEGORY_GROUP_CREATED', entity_type: 'CATEGORY_GROUP' }]);
  });

  it('refuses customers and riders, and anonymous callers', async () => {
    expect((await request(app).get('/api/v1/admin/category-groups').set(auth(tokens.customer))).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/category-groups').set(auth(tokens.rider)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/category-groups')).status).toBe(401);
  });

  it('validates names: required, and unique among live groups ignoring case', async () => {
    const empty = await request(app).post('/api/v1/admin/category-groups').set(auth(tokens.admin)).send({ name: '  ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');

    const g = await newGroup('dup');
    const dup = await request(app)
      .post('/api/v1/admin/category-groups')
      .set(auth(tokens.admin))
      .send({ name: g.name.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CATEGORY_GROUP_NAME_EXISTS');

    const other = await newGroup('dup-other');
    const rename = await request(app)
      .patch(`/api/v1/admin/category-groups/${other.id}`)
      .set(auth(tokens.admin))
      .send({ name: g.name });
    expect(rename.status).toBe(409);
  });

  it('renames and switches a group off and on', async () => {
    const g = await newGroup('rename');
    const res = await request(app)
      .patch(`/api/v1/admin/category-groups/${g.id}`)
      .set(auth(opsToken))
      .send({ name: `CG renamed ${stamp}`, is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.group).toMatchObject({ id: g.id, name: `CG renamed ${stamp}`, is_active: false });

    const missing = await request(app)
      .patch('/api/v1/admin/category-groups/00000000-0000-4000-8000-000000000000')
      .set(auth(tokens.admin))
      .send({ is_active: true });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('CATEGORY_GROUP_NOT_FOUND');
  });

  it('sets membership, moving categories between groups; members list in Arrange order', async () => {
    const g1 = await newGroup('members-1');
    const g2 = await newGroup('members-2');
    // Arrange order (display_order): c2, c3, c1.
    const c1 = await newCategory('m1', { display_order: 30 });
    const c2 = await newCategory('m2', { display_order: 10 });
    const c3 = await newCategory('m3', { display_order: 20 });

    const set = await setMembers(g1.id, [c2.id, c1.id, c3.id]);
    expect(set.status).toBe(200);
    // Owner, 2026-10-10: Arrange decides the order, not the list sent here...
    expect(set.body.data.group.categories.map((c: { id: string }) => c.id)).toEqual([c2.id, c3.id, c1.id]);
    // ...though the list position is still stored for compatibility.
    expect(set.body.data.group.categories.map((c: { group_sort_order: number }) => c.group_sort_order)).toEqual([0, 2, 1]);

    // c3 moves to g2; c1 is dropped from g1 (unassigned).
    expect((await setMembers(g2.id, [c3.id])).status).toBe(200);
    const again = await setMembers(g1.id, [c2.id]);
    expect(again.body.data.group.categories.map((c: { id: string }) => c.id)).toEqual([c2.id]);

    const list = await request(app).get('/api/v1/admin/category-groups').set(auth(opsToken));
    expect(list.status).toBe(200);
    const listed = list.body.data.groups as Group[];
    expect(listed.find((g) => g.id === g2.id)!.categories.map((c) => c.id)).toEqual([c3.id]);
    const unassigned = list.body.data.unassigned as Array<{ id: string; group_id: string | null }>;
    expect(unassigned.find((c) => c.id === c1.id)).toMatchObject({ group_id: null });
    expect(unassigned.some((c) => c.id === c2.id || c.id === c3.id)).toBe(false);

    const bad = await setMembers(g1.id, ['00000000-0000-4000-8000-000000000000']);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CATEGORY_NOT_FOUND');
    const dupes = await setMembers(g1.id, [c2.id, c2.id]);
    expect(dupes.status).toBe(400);
    expect(dupes.body.error.code).toBe('VALIDATION_ERROR');

    const audit = (await pool.query("SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'CATEGORY_GROUP_CATEGORIES_SET' ORDER BY created_at", [g1.id])).rows;
    expect(audit.at(-1)!.new_values).toEqual({ category_ids: [c2.id] });
  });

  it('reorders the groups; the list must name every live group exactly once', async () => {
    const before = (await request(app).get('/api/v1/admin/category-groups').set(auth(tokens.admin))).body.data.groups as Group[];
    const ids = before.map((g) => g.id);
    const reversed = [...ids].reverse();

    const res = await request(app).put('/api/v1/admin/category-groups/order').set(auth(opsToken)).send({ group_ids: reversed });
    expect(res.status).toBe(200);
    expect((res.body.data.groups as Group[]).map((g) => g.id)).toEqual(reversed);
    expect((res.body.data.groups as Group[]).map((g) => g.sort_order)).toEqual(reversed.map((_, i) => i));

    const partial = await request(app).put('/api/v1/admin/category-groups/order').set(auth(tokens.admin)).send({ group_ids: reversed.slice(1) });
    expect(partial.status).toBe(400);
    expect(partial.body.error.code).toBe('INVALID_GROUP_ORDER');
  });

  it('deletes a group softly and releases its categories', async () => {
    const g = await newGroup('delete');
    const c = await newCategory('del');
    await setMembers(g.id, [c.id]);

    const res = await request(app).delete(`/api/v1/admin/category-groups/${g.id}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ group_id: g.id, released_category_count: 1 });

    const row = (await pool.query('SELECT deleted_at, is_active FROM category_groups WHERE id = $1', [g.id])).rows[0];
    expect(row.deleted_at).not.toBeNull();
    expect(row.is_active).toBe(false);
    expect((await pool.query('SELECT group_id FROM categories WHERE id = $1', [c.id])).rows[0].group_id).toBeNull();

    // Gone from the staff list; its name is free again; a second delete 404s.
    const list = (await request(app).get('/api/v1/admin/category-groups').set(auth(tokens.admin))).body.data.groups as Group[];
    expect(list.some((x) => x.id === g.id)).toBe(false);
    await newGroup('delete');
    expect((await request(app).delete(`/api/v1/admin/category-groups/${g.id}`).set(auth(tokens.admin))).status).toBe(404);
  });
});

describe('Category form: Group field', () => {
  it('creates a category straight into a group, appended at the end', async () => {
    const g = await newGroup('form');
    const first = await newCategory('f1', { group_id: g.id });
    const second = await newCategory('f2', { group_id: g.id });
    expect(first).toMatchObject({ group_id: g.id, group_sort_order: 0 });
    expect(second).toMatchObject({ group_id: g.id, group_sort_order: 1 });

    const bad = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(tokens.admin))
      .send({ name: `CG bad ${stamp}`, slug: `test-cat-cg-bad-${stamp}`, group_id: '00000000-0000-4000-8000-000000000000' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CATEGORY_GROUP_NOT_FOUND');
  });

  it('PATCH moves a category between groups, reorders it, and clears it; the list shows the fields', async () => {
    const g1 = await newGroup('patch-1');
    const g2 = await newGroup('patch-2');
    const a = await newCategory('p-a', { group_id: g2.id });
    const c = await newCategory('p-c');

    const moved = await request(app).patch(`/api/v1/admin/categories/${c.id}`).set(auth(opsToken)).send({ group_id: g2.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data.category).toMatchObject({ group_id: g2.id, group_sort_order: 1 });

    const reordered = await request(app).patch(`/api/v1/admin/categories/${c.id}`).set(auth(tokens.admin)).send({ group_sort_order: 0 });
    expect(reordered.body.data.category).toMatchObject({ group_id: g2.id, group_sort_order: 0 });

    // Editing other fields keeps the group untouched.
    const renamed = await request(app).patch(`/api/v1/admin/categories/${a.id}`).set(auth(tokens.admin)).send({ description: 'x' });
    expect(renamed.body.data.category).toMatchObject({ group_id: g2.id, group_sort_order: 0 });

    const toG1 = await request(app).patch(`/api/v1/admin/categories/${c.id}`).set(auth(tokens.admin)).send({ group_id: g1.id });
    expect(toG1.body.data.category).toMatchObject({ group_id: g1.id, group_sort_order: 0 });

    const cleared = await request(app).patch(`/api/v1/admin/categories/${c.id}`).set(auth(tokens.admin)).send({ group_id: null });
    expect(cleared.body.data.category).toMatchObject({ group_id: null });

    const list = await request(app).get('/api/v1/admin/categories').set(auth(tokens.admin));
    expect(list.body.data.categories.find((x: { id: string }) => x.id === a.id)).toMatchObject({ group_id: g2.id, group_sort_order: 0 });

    const audit = (await pool.query("SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'CATEGORY_GROUP_ASSIGNED' ORDER BY created_at", [c.id])).rows;
    expect(audit.map((r) => r.new_values.group_id)).toEqual([g2.id, g2.id, g1.id, null]);
  });
});

describe('GET /catalog/home-groups (public)', () => {
  it('returns active groups in order with active categories in Arrange order, then "More"', async () => {
    const g1 = await newGroup('home-1');
    const g2 = await newGroup('home-2');
    const off = await newGroup('home-off', { is_active: false });
    const empty = await newGroup('home-empty');
    const v = await newCategory('veg', { image_url: 'https://example.com/veg.png', image_focal_x: 20, image_focal_y: 80, display_order: 5 });
    const d = await newCategory('dairy', { display_order: 10 });
    const hidden = await newCategory('hidden', { is_active: false });
    const s = await newCategory('snacks');
    const offCat = await newCategory('offcat');
    const loose = await newCategory('loose');
    await setMembers(g1.id, [d.id, hidden.id, v.id]);
    await setMembers(g2.id, [s.id]);
    await setMembers(off.id, [offCat.id]);

    // Put g2 before g1 (keeping everything else in place).
    const all = ((await request(app).get('/api/v1/admin/category-groups').set(auth(tokens.admin))).body.data.groups as Group[]).map((g) => g.id);
    const order = all.filter((id) => id !== g1.id && id !== g2.id).concat([g2.id, g1.id]);
    expect((await request(app).put('/api/v1/admin/category-groups/order').set(auth(tokens.admin)).send({ group_ids: order })).status).toBe(200);

    const groups = await home();
    const ids = groups.map((g) => g.id);
    expect(ids.indexOf(g2.id)).toBeLessThan(ids.indexOf(g1.id));
    expect(ids).not.toContain(off.id);
    expect(ids).not.toContain(empty.id);

    const first = groups.find((g) => g.id === g1.id)!;
    expect(first.name).toBe(`CG group home-1 ${stamp}`);
    // The group's list says dairy first; Arrange (display_order) puts veg first
    // and wins (owner, 2026-10-10).
    expect(first.categories.map((c) => c.id)).toEqual([v.id, d.id]);
    expect(first.categories[0]).toEqual({
      id: v.id,
      name: `CG veg ${stamp}`,
      slug: `test-cat-cg-veg-${stamp}`,
      description: null,
      image_url: 'https://example.com/veg.png',
      display_order: 5,
      image_focal_x: 20,
      image_focal_y: 80,
      parent_id: null,
      // Migration 033: no category offer running.
      offer_percent: null,
      offer_ends_at: null,
    });

    // A switched-off group hides its whole section; the loose one is in "More", last.
    const flat = groups.flatMap((g) => g.categories.map((c) => c.id));
    expect(flat).not.toContain(offCat.id);
    expect(flat).not.toContain(hidden.id);
    const more = groups.at(-1)!;
    expect(more).toMatchObject({ id: null, name: 'More' });
    expect(more.categories.map((c) => c.id)).toContain(loose.id);
    expect(groups.filter((g) => g.id === null)).toHaveLength(1);
    expect(groups.every((g) => g.categories.length > 0)).toBe(true);
  });

  it('omits "More" when every live category has a group', async () => {
    const res = await pool.query('SELECT count(*)::int AS n FROM categories WHERE deleted_at IS NULL AND is_active AND group_id IS NULL');
    const groups = await home();
    expect(groups.some((g) => g.id === null)).toBe(res.rows[0].n > 0);
  });
});

describe('Live updates', () => {
  it('a group write sends catalog_changed (category_groups)', async () => {
    const listener = new pg.Client({ connectionString: env.DATABASE_URL });
    await listener.connect();
    try {
      const got = new Promise<string>((resolve) => {
        listener.on('notification', (msg) => {
          if (msg.channel === 'catalog_changed' && msg.payload === 'category_groups') resolve(msg.payload);
        });
      });
      await listener.query('LISTEN catalog_changed');
      await newGroup('notify');
      await expect(
        Promise.race([got, new Promise((_, reject) => setTimeout(() => reject(new Error('no NOTIFY')), 5000))])
      ).resolves.toBe('category_groups');
    } finally {
      await listener.end();
    }
  });
});
