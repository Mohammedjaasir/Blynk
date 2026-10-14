import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Promotion banner targets (owner, 2026-10-14: "for the promotion banner we
 * must be able to select sidebar (sub categories as well)"). A banner can open
 * a Main section (category group, stored as CATALOG + group id), a Category,
 * a Sub-category (both CATEGORY + slug) or a product (PRODUCT + id). Targets
 * are validated, stored canonically and described as cta_target to staff and
 * customers. Everything the file creates is hard-deleted again.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const stamp = Date.now();
const SKU = `T-PT-${stamp}`;
let groupId = '';
let parentId = '';
let parentSlug = '';
let childId = '';
let childSlug = '';
let productId = '';
let productSlug = '';

const create = (body: Record<string, unknown>, token = tokens.admin) =>
  request(app).post('/api/v1/admin/promotions').set(auth(token)).send({ title: `TEST-PROMO-PT ${stamp}`, cta_label: 'Shop', ...body });

beforeAll(async () => {
  groupId = (await pool.query(`INSERT INTO category_groups (name) VALUES ($1) RETURNING id`, [`PT Main ${stamp}`])).rows[0].id;
  const parent = (
    await pool.query(`INSERT INTO categories (name, slug, group_id) VALUES ($1, $2, $3) RETURNING id, slug`, [`PT Cat ${stamp}`, `pt-cat-${stamp}`, groupId])
  ).rows[0];
  parentId = parent.id;
  parentSlug = parent.slug;
  const child = (
    await pool.query(`INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id, slug`, [`PT Sub ${stamp}`, `pt-sub-${stamp}`, parentId])
  ).rows[0];
  childId = child.id;
  childSlug = child.slug;
  const product = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({ category_id: childId, name: `PT product ${stamp}`, sku: SKU, unit: '1 pc', purchase_cost: 50 });
  expect(product.status).toBe(201);
  productId = product.body.data.product.id;
  productSlug = product.body.data.product.slug;
});

afterAll(async () => {
  await pool.query(`DELETE FROM promotions WHERE title LIKE $1`, [`TEST-PROMO-PT ${stamp}%`]);
  if (productId) {
    await pool.query('DELETE FROM inventory WHERE product_id = $1', [productId]);
    await pool.query('DELETE FROM products WHERE id = $1', [productId]);
  }
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[childId, parentId].filter(Boolean)]);
  if (groupId) await pool.query('DELETE FROM category_groups WHERE id = $1', [groupId]);
  await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [[productId, childId, parentId, groupId].filter(Boolean)]);
});

describe('Promotion banner targets', () => {
  it('a sub-category (by id) is stored as its slug and described with its parent', async () => {
    const res = await create({ cta_destination_type: 'CATEGORY', cta_destination_value: childId }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const p = res.body.data.promotion;
    expect(p.cta_destination_value).toBe(childSlug);
    expect(p.cta_target).toMatchObject({ level: 'SUB_CATEGORY', id: childId, slug: childSlug, parent_id: parentId, parent_slug: parentSlug });
  });

  it('a top-level category (by slug, any case) is a CATEGORY target', async () => {
    const res = await create({ cta_destination_type: 'CATEGORY', cta_destination_value: parentSlug.toUpperCase() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.promotion.cta_target).toMatchObject({ level: 'CATEGORY', id: parentId, parent_id: null });
  });

  it('a Main section is CATALOG + the category group id', async () => {
    const res = await create({ cta_destination_type: 'CATALOG', cta_destination_value: groupId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.promotion.cta_destination_value).toBe(groupId);
    expect(res.body.data.promotion.cta_target).toMatchObject({ level: 'MAIN', id: groupId, name: `PT Main ${stamp}` });
  });

  it('CATALOG without a value is still the whole catalog', async () => {
    const res = await create({ cta_destination_type: 'CATALOG' });
    expect(res.status).toBe(201);
    expect(res.body.data.promotion.cta_destination_value).toBeNull();
    expect(res.body.data.promotion.cta_target).toMatchObject({ level: 'CATALOG', id: null });
  });

  it('a product (by slug) is stored as its id', async () => {
    const res = await create({ cta_destination_type: 'PRODUCT', cta_destination_value: productSlug });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.promotion.cta_destination_value).toBe(productId);
    expect(res.body.data.promotion.cta_target).toMatchObject({ level: 'PRODUCT', id: productId });
  });

  it('refuses targets that do not exist (400 INVALID_PROMOTION_TARGET)', async () => {
    for (const body of [
      { cta_destination_type: 'CATEGORY', cta_destination_value: 'no-such-category-pt' },
      { cta_destination_type: 'CATEGORY', cta_destination_value: '00000000-0000-0000-0000-00000000abcd' },
      { cta_destination_type: 'PRODUCT', cta_destination_value: '00000000-0000-0000-0000-00000000abcd' },
      { cta_destination_type: 'CATALOG', cta_destination_value: 'not-a-group' },
      { cta_destination_type: 'CATALOG', cta_destination_value: '00000000-0000-0000-0000-00000000abcd' },
    ]) {
      const res = await create(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PROMOTION_TARGET');
    }
  });

  it('the customer carousel carries cta_target', async () => {
    const res = await request(app).get('/api/v1/promotions');
    expect(res.status).toBe(200);
    const mine = (res.body.data.promotions as Array<{ title: string; cta_target: { level: string } | null }>).filter((p) =>
      p.title.startsWith(`TEST-PROMO-PT ${stamp}`)
    );
    expect(mine.map((p) => p.cta_target?.level).sort()).toEqual(['CATALOG', 'CATEGORY', 'MAIN', 'PRODUCT', 'SUB_CATEGORY']);
  });

  it('an update that changes the destination is validated; other edits leave it alone', async () => {
    const created = await create({ cta_destination_type: 'CATEGORY', cta_destination_value: parentSlug });
    const id = created.body.data.promotion.id;
    const bad = await request(app).patch(`/api/v1/admin/promotions/${id}`).set(auth(tokens.admin)).send({ cta_destination_value: 'nope-pt' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PROMOTION_TARGET');

    const toSub = await request(app).patch(`/api/v1/admin/promotions/${id}`).set(auth(tokens.admin)).send({ cta_destination_value: childId });
    expect(toSub.status).toBe(200);
    expect(toSub.body.data.promotion.cta_destination_value).toBe(childSlug);

    // A banner whose stored target vanished can still be edited otherwise.
    await pool.query(`UPDATE promotions SET cta_destination_value = 'gone-pt' WHERE id = $1`, [id]);
    const rename = await request(app)
      .patch(`/api/v1/admin/promotions/${id}`)
      .set(auth(tokens.admin))
      .send({ title: `TEST-PROMO-PT ${stamp} renamed` });
    expect(rename.status).toBe(200);
    expect(rename.body.data.promotion.cta_target).toBeNull();

    const list = await request(app).get('/api/v1/admin/promotions').set(auth(opsToken));
    expect(list.status).toBe(200);
    expect(list.body.data.promotions.find((p: { id: string }) => p.id === id)).toHaveProperty('cta_target', null);
  });
});
