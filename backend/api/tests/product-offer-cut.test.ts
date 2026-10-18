import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Migration 050 (owner, 2026-10-18): per-product "show the offer price cut".
 * On for every existing and new product; Admin and Ops can switch it off; the
 * customer product carries it (list and product page). Display only.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-CUT-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const TAG = `TST-CUT-${Date.now()}`;
let categoryId = '';
let seq = 0;

async function createProduct(body: Record<string, unknown> = {}) {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({ category_id: categoryId, name: `${TAG} P${seq}`, sku: `${TAG}-P${seq}`, unit: '1 pack', purchase_cost: 100, ...body });
  if (res.status === 201) fx.created.products.push(res.body.data.product.id);
  return res;
}
const customerProduct = async (id: string) => (await request(app).get(`/api/v1/products/${id}`)).body.data.product;
const customerListed = async (sku: string) =>
  (await request(app).get('/api/v1/products').query({ search: sku })).body.data.products.find((p: { sku: string }) => p.sku === sku);

beforeAll(async () => {
  await fx.setup();
  categoryId = (await pool.query('SELECT id FROM categories WHERE is_active = true AND deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  if (fx.created.products.length) await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [fx.created.products]);
  await fx.cleanup();
});

describe('show_offer_cut', () => {
  it('a new product starts on, for staff and customers', async () => {
    const res = await createProduct({ offer_price: 110 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const staff = res.body.data.product;
    expect(staff.show_offer_cut).toBe(true);
    expect((await customerProduct(staff.id)).show_offer_cut).toBe(true);
    expect((await customerListed(staff.sku)).show_offer_cut).toBe(true);
  });

  it('Admin can create it off; Ops can switch it back on; prices never change', async () => {
    const res = await createProduct({ offer_price: 110, show_offer_cut: false });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.product.id;
    const off = await customerProduct(id);
    expect(off).toMatchObject({ show_offer_cut: false, offer_price: 110 });

    const patched = await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(opsToken)).send({ show_offer_cut: true });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.product.show_offer_cut).toBe(true);
    const on = await customerProduct(id);
    expect(on).toMatchObject({ show_offer_cut: true, offer_price: 110, selling_price: off.selling_price });
  });

  it('a PATCH without it leaves it alone; a non-boolean is refused', async () => {
    const id = (await createProduct({ show_offer_cut: false })).body.data.product.id;
    await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(opsToken)).send({ name: `${TAG} renamed` });
    expect((await customerProduct(id)).show_offer_cut).toBe(false);
    const bad = await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(opsToken)).send({ show_offer_cut: 'yes' });
    expect(bad.status).toBe(400);
  });
});
