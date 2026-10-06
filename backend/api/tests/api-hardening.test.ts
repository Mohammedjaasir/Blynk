import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Requests that used to answer 500 now get a clean 4xx (QA 2026-10-06):
 * oversize uploads and bodies, malformed ids, non-numeric paging, numbers
 * past their NUMERIC column, and slugs for Sinhala/Tamil names.
 * Everything created here is removed again (SKU prefix HARD28-).
 */
const app = createApp();
const admin = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' });
const auth = { Authorization: `Bearer ${admin}` };
const PREFIX = 'HARD28-';
const createdCategories: string[] = [];
let categoryId = '';

const product = (extra: object = {}) => ({
  category_id: categoryId,
  name: `Hardening ${Date.now()}`,
  sku: `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  unit: '1 pc',
  purchase_cost: 10,
  ...extra,
});

beforeAll(async () => {
  categoryId = (await pool.query('SELECT id FROM categories WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  const ids = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${PREFIX}%`])).rows.map((r) => r.id);
  if (ids.length) {
    await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM products WHERE id = ANY($1)', [ids]);
  }
  if (createdCategories.length) {
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[])', [createdCategories]);
    await pool.query('DELETE FROM categories WHERE id = ANY($1)', [createdCategories]);
  }
});

describe('oversize requests', () => {
  it('an image over 2 MB is 413 FILE_TOO_LARGE', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, 0);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await request(app)
      .post('/api/v1/admin/media')
      .set(auth)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.error.message).toBe('Images must be 2 MB or smaller.');
  });

  it('a JSON body over 1 MB is 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('malformed ids and paging', () => {
  it('a malformed :id on admin products, categories and promotions is 400 VALIDATION_ERROR', async () => {
    const calls = [
      request(app).get('/api/v1/admin/products/not-a-uuid').set(auth),
      request(app).patch('/api/v1/admin/products/not-a-uuid').set(auth).send({ name: 'Whatever' }),
      request(app).delete('/api/v1/admin/products/not-a-uuid').set(auth),
      request(app).patch('/api/v1/admin/categories/not-a-uuid').set(auth).send({ name: 'Whatever' }),
      request(app).delete('/api/v1/admin/categories/not-a-uuid').set(auth),
      request(app).get('/api/v1/admin/promotions/not-a-uuid').set(auth),
      request(app).patch('/api/v1/admin/promotions/not-a-uuid').set(auth).send({ title: 'Whatever' }),
      request(app).delete('/api/v1/admin/promotions/not-a-uuid').set(auth),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('a non-numeric limit/page on /admin/products falls back to the default; a bad category_id is 400', async () => {
    const res = await request(app).get('/api/v1/admin/products?limit=abc&page=xyz').set(auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data.products)).toBe(true);
    const bad = await request(app).get('/api/v1/admin/products?category_id=nope').set(auth);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('numeric bounds', () => {
  it('markup over 999.99 and purchase cost over 99,999,999.99 are 400, the maxima are accepted', async () => {
    for (const body of [product({ custom_markup_percent: 1000 }), product({ purchase_cost: 100_000_000 })]) {
      const res = await request(app).post('/api/v1/admin/products').set(auth).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const ok = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .send(product({ custom_markup_percent: 999.99, purchase_cost: 99_999_999.99 }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});

describe('slugs', () => {
  it('a Sinhala/Tamil product name gets a product-xxxxxx slug; a repeated name gets -2', async () => {
    const sinhala = await request(app).post('/api/v1/admin/products').set(auth).send(product({ name: 'කිරි පිටි' }));
    expect(sinhala.status, JSON.stringify(sinhala.body)).toBe(201);
    expect(sinhala.body.data.product.slug).toMatch(/^product-[a-z0-9]{6}$/);
    const tamil = await request(app).post('/api/v1/admin/products').set(auth).send(product({ name: 'பால் மா' }));
    expect(tamil.status).toBe(201);
    expect(tamil.body.data.product.slug).toMatch(/^product-[a-z0-9]{6}$/);
    expect(tamil.body.data.product.slug).not.toBe(sinhala.body.data.product.slug);

    const name = `Hardening Same Name ${Date.now()}`;
    const first = await request(app).post('/api/v1/admin/products').set(auth).send(product({ name }));
    const second = await request(app).post('/api/v1/admin/products').set(auth).send(product({ name }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.product.slug).toBe(`${first.body.data.product.slug}-2`);

    // An explicitly chosen slug that is taken is still a 409.
    const taken = await request(app)
      .post('/api/v1/admin/products')
      .set(auth)
      .send(product({ slug: first.body.data.product.slug }));
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('PRODUCT_SLUG_EXISTS');
  });

  it('categories: a Tamil name gets category-xxxxxx; a repeated name gets -2', async () => {
    const tamil = await request(app).post('/api/v1/admin/categories').set(auth).send({ name: 'பால் பொருட்கள்', is_active: false });
    expect(tamil.status, JSON.stringify(tamil.body)).toBe(201);
    createdCategories.push(tamil.body.data.category.id);
    expect(tamil.body.data.category.slug).toMatch(/^category-[a-z0-9]{6}$/);

    const name = `Hardening Cat ${Date.now()}`;
    const first = await request(app).post('/api/v1/admin/categories').set(auth).send({ name, is_active: false });
    createdCategories.push(first.body.data.category.id);
    const second = await request(app).post('/api/v1/admin/categories').set(auth).send({ name, is_active: false });
    expect(second.status).toBe(201);
    createdCategories.push(second.body.data.category.id);
    expect(second.body.data.category.slug).toBe(`${first.body.data.category.slug}-2`);
  });
});
