import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { mediaStorage } from '../src/utils/storage.js';
import { STORE } from './helpers/stock.js';
import { bearer, sellerFixtures } from './helpers/seller.js';

/**
 * The seller-facing API (/api/v1/seller): me, profile, categories, products,
 * submissions (NEW / EDIT / withdraw), image upload. Sellers are made through
 * the real SMS sign-in; their status is then set directly (Admin's approval
 * API is another module). Everything made here is removed afterwards.
 */
const app = createApp();
const fx = sellerFixtures(app, '+947700121');
const api = (token: string) => ({
  get: (p: string) => request(app).get(`/api/v1/seller${p}`).set(bearer(token)),
  put: (p: string, b: object) => request(app).put(`/api/v1/seller${p}`).set(bearer(token)).send(b),
  post: (p: string, b: object) => request(app).post(`/api/v1/seller${p}`).set(bearer(token)).send(b),
  patch: (p: string, b: object) => request(app).patch(`/api/v1/seller${p}`).set(bearer(token)).send(b),
  del: (p: string) => request(app).delete(`/api/v1/seller${p}`).set(bearer(token)),
});

const stamp = Date.now();
let categoryId = '';
let inactiveCategoryId = '';
let activeExtraCategoryId = '';
const uploaded: string[] = [];

// A tiny but real PNG header + padding: the route sniffs the magic number.
const png = (bytes = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes)]);

const newProduct = (over: Record<string, unknown> = {}) => ({
  name: `Seller Jam ${stamp}`,
  category_id: categoryId,
  unit: '1 jar',
  seller_price: 450,
  ...over,
});

beforeAll(async () => {
  await fx.purge();
  categoryId = await fx.activeCategory();
  inactiveCategoryId = (
    await pool.query(`INSERT INTO categories (name, slug, is_active) VALUES ($1, $2, false) RETURNING id`, [`SP Off ${stamp}`, `sp-off-${stamp}`])
  ).rows[0].id;
  activeExtraCategoryId = (
    await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`SP On ${stamp}`, `sp-on-${stamp}`])
  ).rows[0].id;
});

afterAll(async () => {
  await fx.cleanup();
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[inactiveCategoryId, activeExtraCategoryId].filter(Boolean)]);
  for (const url of uploaded) {
    const key = mediaStorage.keyFromUrl(url);
    if (key) await mediaStorage.delete(key);
  }
});

describe('GET /seller/me and PUT /seller/profile', () => {
  it('returns the seller row and the counts', async () => {
    const s = await fx.makeSeller(1, 'APPROVED', 'Me Shop');
    await fx.sellerProduct(s.sellerId, categoryId, 'me');
    expect((await api(s.token).post('/products', newProduct())).status).toBe(201);
    const res = await api(s.token).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.seller).toEqual({
      id: s.sellerId,
      shop_name: 'Me Shop',
      contact_name: null,
      address: null,
      note: null,
      status: 'APPROVED',
      rejection_reason: null,
      commission_percent: 0,
      created_at: expect.any(String),
      // the shop location (migration 053; tests/seller-location.test.ts)
      latitude: null,
      longitude: null,
      location_note: null,
      pending_latitude: null,
      pending_longitude: null,
      pending_location_note: null,
      location_status: 'NONE',
      location_reject_reason: null,
      distance_km_from_store: null,
      pending_distance_km_from_store: null,
    });
    expect(res.body.data.counts).toEqual({ products: 1, pending: 1 });
  });

  it('a SELLER user without a shop row gets 404 SELLER_NOT_FOUND', async () => {
    const userId = await fx.plainUser(2, 'SELLER');
    const token = generateAccessToken({ id: userId, phone: fx.phone(2), role: 'SELLER' });
    const res = await api(token).get('/me');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SELLER_NOT_FOUND');
  });

  it('saves the profile; fields left out are kept, blank ones are cleared', async () => {
    const s = await fx.makeSeller(3, 'PENDING');
    const first = await api(s.token).put('/profile', { shop_name: '  Lanka Spices ', contact_name: 'Nimal', address: '12 Galle Rd', note: 'Home kitchen' });
    expect(first.status).toBe(200);
    expect(first.body.data.seller).toMatchObject({ shop_name: 'Lanka Spices', contact_name: 'Nimal', address: '12 Galle Rd', note: 'Home kitchen', status: 'PENDING' });

    const second = await api(s.token).put('/profile', { shop_name: 'Lanka Spices Ltd', note: '' });
    expect(second.body.data.seller).toMatchObject({ shop_name: 'Lanka Spices Ltd', contact_name: 'Nimal', address: '12 Galle Rd', note: null });
  });

  it('validates the profile', async () => {
    const s = await fx.makeSeller(4, 'PENDING');
    for (const body of [{}, { shop_name: 'A' }, { shop_name: 'x'.repeat(81) }, { shop_name: 'Ok Shop', address: 'a'.repeat(256) }, { shop_name: 'Ok Shop', note: 'n'.repeat(501) }]) {
      const res = await api(s.token).put('/profile', body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('is allowed while PENDING and REJECTED but not SUSPENDED', async () => {
    const s = await fx.makeSeller(5, 'REJECTED');
    expect((await api(s.token).put('/profile', { shop_name: 'Second Try' })).status).toBe(200);
    await pool.query(`UPDATE sellers SET status = 'SUSPENDED' WHERE id = $1`, [s.sellerId]);
    const res = await api(s.token).put('/profile', { shop_name: 'Not Allowed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELLER_SUSPENDED');
    expect((await pool.query('SELECT shop_name FROM sellers WHERE id = $1', [s.sellerId])).rows[0].shop_name).toBe('Second Try');
  });
});

describe('GET /seller/categories', () => {
  it('lists active categories with id, name and parent_id, and not inactive ones', async () => {
    const s = await fx.makeSeller(6, 'PENDING');
    const res = await api(s.token).get('/categories');
    expect(res.status).toBe(200);
    const list = res.body.data.categories as { id: string; name: string; parent_id: string | null }[];
    expect(list.find((c) => c.id === activeExtraCategoryId)).toEqual({ id: activeExtraCategoryId, name: `SP On ${stamp}`, parent_id: null });
    expect(list.some((c) => c.id === inactiveCategoryId)).toBe(false);
    expect(Object.keys(list[0]).sort()).toEqual(['id', 'name', 'parent_id']);
  });
});

describe('Submissions: a new product', () => {
  it('is refused with SELLER_NOT_APPROVED until the seller is APPROVED', async () => {
    for (const [n, status] of [
      [7, 'PENDING'],
      [8, 'REJECTED'],
      [9, 'SUSPENDED'],
    ] as const) {
      const s = await fx.makeSeller(n, status);
      const res = await api(s.token).post('/products', newProduct());
      expect(res.status, status).toBe(403);
      expect(res.body.error.code).toBe('SELLER_NOT_APPROVED');
      expect((await pool.query('SELECT 1 FROM seller_submissions WHERE seller_id = $1', [s.sellerId])).rowCount).toBe(0);
    }
  });

  it('creates a PENDING NEW submission and nothing goes live', async () => {
    const s = await fx.makeSeller(10);
    const res = await api(s.token).post('/products', newProduct({ pack_size: '500 g', description: 'Home made', barcode: '4791234567890', seller_price: 449.5 }));
    expect(res.status).toBe(201);
    expect(res.body.data.submission).toEqual({
      id: expect.any(String),
      kind: 'NEW',
      status: 'PENDING',
      product_id: null,
      payload: {
        name: `Seller Jam ${stamp}`,
        category_id: categoryId,
        unit: '1 jar',
        pack_size: '500 g',
        description: 'Home made',
        image_url: null,
        barcode: '4791234567890',
      },
      seller_price: 449.5,
      approved_selling_price: null,
      reject_reason: null,
      created_at: expect.any(String),
      reviewed_at: null,
    });
    expect((await pool.query('SELECT 1 FROM products WHERE seller_id = $1', [s.sellerId])).rowCount).toBe(0);
  });

  it('validates name, category, unit and price', async () => {
    const s = await fx.makeSeller(11);
    const bad: Record<string, unknown>[] = [
      newProduct({ name: 'A' }),
      newProduct({ unit: '' }),
      newProduct({ category_id: 'not-a-uuid' }),
      newProduct({ seller_price: 0 }),
      newProduct({ seller_price: -5 }),
      newProduct({ seller_price: 1_000_000.01 }),
      newProduct({ seller_price: 10.123 }),
      newProduct({ seller_price: '450' }),
      newProduct({ image_url: 'https://example.com/photo.jpg' }),
      { ...newProduct(), name: undefined },
      { ...newProduct(), seller_price: undefined },
    ];
    for (const body of bad) {
      const res = await api(s.token).post('/products', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    // 1,000,000 itself is allowed.
    expect((await api(s.token).post('/products', newProduct({ seller_price: 1_000_000 }))).status).toBe(201);
  });

  it('the category must exist and be active', async () => {
    const s = await fx.makeSeller(12);
    for (const category_id of [randomUUID(), inactiveCategoryId]) {
      const res = await api(s.token).post('/products', newProduct({ category_id }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    }
  });

  it('accepts a photo uploaded through the seller uploader', async () => {
    const s = await fx.makeSeller(13);
    const up = await request(app).post('/api/v1/seller/uploads/image').set(bearer(s.token)).attach('file', png(), { filename: 'jar.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    uploaded.push(up.body.data.url);
    const res = await api(s.token).post('/products', newProduct({ image_url: up.body.data.url }));
    expect(res.status).toBe(201);
    expect(res.body.data.submission.payload.image_url).toBe(up.body.data.url);
  });
});

describe('GET /seller/products', () => {
  it('lists live products with the full shape, and only the seller\'s own', async () => {
    const a = await fx.makeSeller(14, 'APPROVED', 'List Shop A');
    const b = await fx.makeSeller(15, 'APPROVED', 'List Shop B');
    const tracked = await fx.sellerProduct(a.sellerId, categoryId, 'trk', { cost: 120, fixed: 180 });
    const untracked = await fx.sellerProduct(a.sellerId, categoryId, 'unt', { cost: 60, fixed: 90 });
    const off = await fx.sellerProduct(a.sellerId, categoryId, 'off', { active: false });
    const others = await fx.sellerProduct(b.sellerId, categoryId, 'oth');
    await pool.query(`INSERT INTO inventory (dark_store_id, product_id, tracking_mode, quantity_on_hand) VALUES ($1, $2, 'TRACKED', 7)`, [STORE, tracked]);
    await pool.query(`INSERT INTO inventory (dark_store_id, product_id, tracking_mode, quantity_on_hand) VALUES ($1, $2, 'UNTRACKED', 99)`, [STORE, untracked]);

    const res = await api(a.token).get('/products');
    expect(res.status).toBe(200);
    const list = res.body.data.products as Record<string, unknown>[];
    const byId = new Map(list.map((p) => [p.id as string, p]));
    expect(byId.has(others)).toBe(false);
    expect([...byId.keys()].sort()).toEqual([tracked, untracked, off].sort());

    expect(byId.get(tracked)).toEqual({
      id: tracked,
      name: expect.stringContaining('Seller test trk'),
      category_id: categoryId,
      category_name: expect.any(String),
      unit: '1 kg',
      pack_size: null,
      description: null,
      image_url: null,
      barcode: null,
      is_active: true,
      is_available: true,
      seller_price: 120,
      selling_price: 180,
      stock_on_hand: 7,
      units_sold: 0,
      live: true,
      pending: null,
      last_rejected: null,
    });
    expect(byId.get(untracked)).toMatchObject({ stock_on_hand: null, selling_price: 90, live: true });
    expect(byId.get(off)).toMatchObject({ live: false, is_active: false, selling_price: null });

    const theirs = await api(b.token).get('/products');
    expect((theirs.body.data.products as { id: string }[]).map((p) => p.id)).toEqual([others]);
  });

  it('shows a waiting new product as submission:<id>, and a rejected one with its reason', async () => {
    const s = await fx.makeSeller(16);
    const waiting = (await api(s.token).post('/products', newProduct({ name: 'Waiting Pickle', seller_price: 300 }))).body.data.submission;
    const rejected = (await api(s.token).post('/products', newProduct({ name: 'Rejected Pickle', seller_price: 310 }))).body.data.submission;
    await pool.query(`UPDATE seller_submissions SET status = 'REJECTED', reject_reason = 'Photo is blurry', reviewed_at = now() WHERE id = $1`, [rejected.id]);
    const withdrawn = (await api(s.token).post('/products', newProduct({ name: 'Withdrawn Pickle' }))).body.data.submission;
    await api(s.token).del(`/submissions/${withdrawn.id}`);

    const list = (await api(s.token).get('/products')).body.data.products as Record<string, any>[];
    expect(list.map((p) => p.name).sort()).toEqual(['Rejected Pickle', 'Waiting Pickle']);
    const w = list.find((p) => p.name === 'Waiting Pickle')!;
    expect(w).toMatchObject({
      id: `submission:${waiting.id}`,
      live: false,
      is_active: false,
      selling_price: null,
      stock_on_hand: null,
      units_sold: 0,
      seller_price: 300,
      unit: '1 jar',
      category_id: categoryId,
      last_rejected: null,
    });
    expect(w.pending).toMatchObject({ id: waiting.id, kind: 'NEW', status: 'PENDING' });
    const r = list.find((p) => p.name === 'Rejected Pickle')!;
    expect(r.id).toBe(`submission:${rejected.id}`);
    expect(r.pending).toBeNull();
    expect(r.last_rejected).toMatchObject({ id: rejected.id, status: 'REJECTED', reject_reason: 'Photo is blurry' });
  });
});

describe('Submissions: editing a product', () => {
  async function liveProduct(n: number) {
    const s = await fx.makeSeller(n, 'APPROVED');
    const productId = await fx.sellerProduct(s.sellerId, categoryId, `ed${n}`, { cost: 200, fixed: 260 });
    await pool.query(`UPDATE products SET description = 'Live description', pack_size = '1 kg', barcode = '123' WHERE id = $1`, [productId]);
    return { ...s, productId };
  }

  it('proposes the live values with the sent fields changed; the live product is untouched', async () => {
    const s = await liveProduct(17);
    const before = (await pool.query('SELECT name, purchase_cost::float AS cost, fixed_selling_price::float AS fixed, description FROM products WHERE id = $1', [s.productId])).rows[0];
    const res = await api(s.token).patch(`/products/${s.productId}`, { name: 'Renamed Jam', description: null });
    expect(res.status).toBe(200);
    expect(res.body.data.submission).toMatchObject({
      kind: 'EDIT',
      status: 'PENDING',
      product_id: s.productId,
      seller_price: 200,
      payload: { name: 'Renamed Jam', category_id: categoryId, unit: '1 kg', pack_size: '1 kg', description: null, image_url: null, barcode: '123' },
    });
    const after = (await pool.query('SELECT name, purchase_cost::float AS cost, fixed_selling_price::float AS fixed, description FROM products WHERE id = $1', [s.productId])).rows[0];
    expect(after).toEqual(before);

    const price = await api(s.token).patch(`/products/${s.productId}`, { seller_price: 230.5 });
    expect(price.body.data.submission).toMatchObject({ seller_price: 230.5, payload: { name: expect.stringContaining('Seller test ed17'), description: 'Live description' } });
  });

  it('a newer edit replaces (withdraws) the waiting one: one waiting edit per product', async () => {
    const s = await liveProduct(18);
    const first = (await api(s.token).patch(`/products/${s.productId}`, { name: 'First Edit' })).body.data.submission;
    const second = (await api(s.token).patch(`/products/${s.productId}`, { name: 'Second Edit' })).body.data.submission;
    const rows = (await pool.query('SELECT id, status FROM seller_submissions WHERE product_id = $1 ORDER BY created_at', [s.productId])).rows;
    expect(rows).toEqual([
      { id: first.id, status: 'WITHDRAWN' },
      { id: second.id, status: 'PENDING' },
    ]);
    const list = (await api(s.token).get('/products')).body.data.products as Record<string, any>[];
    expect(list).toHaveLength(1);
    expect(list[0].pending).toMatchObject({ id: second.id, payload: { name: 'Second Edit' } });
    expect(list[0].name).toContain('Seller test ed18'); // live name until Admin approves
    expect((await api(s.token).get('/me')).body.data.counts.pending).toBe(1);
  });

  it('withdrawing the waiting edit clears it; a rejected edit shows as last_rejected', async () => {
    const s = await liveProduct(19);
    const waiting = (await api(s.token).patch(`/products/${s.productId}`, { name: 'Edit A' })).body.data.submission;
    expect((await api(s.token).del(`/submissions/${waiting.id}`)).body.data.submission.status).toBe('WITHDRAWN');
    let p = ((await api(s.token).get('/products')).body.data.products as Record<string, any>[])[0];
    expect(p.pending).toBeNull();
    expect(p.last_rejected).toBeNull();

    const edit = (await api(s.token).patch(`/products/${s.productId}`, { name: 'Edit B' })).body.data.submission;
    await pool.query(`UPDATE seller_submissions SET status = 'REJECTED', reject_reason = 'Too expensive', reviewed_at = now() WHERE id = $1`, [edit.id]);
    p = ((await api(s.token).get('/products')).body.data.products as Record<string, any>[])[0];
    expect(p.pending).toBeNull();
    expect(p.last_rejected).toMatchObject({ id: edit.id, reject_reason: 'Too expensive' });

    // A newer edit after the rejection clears last_rejected.
    await api(s.token).patch(`/products/${s.productId}`, { name: 'Edit C' });
    p = ((await api(s.token).get('/products')).body.data.products as Record<string, any>[])[0];
    expect(p.last_rejected).toBeNull();
    expect(p.pending.payload.name).toBe('Edit C');
  });

  it('is refused unless approved, for other sellers\' products and for unknown ones', async () => {
    const s = await liveProduct(20);
    const other = await liveProduct(21);

    expect((await api(s.token).patch(`/products/${other.productId}`, { name: 'Stolen' })).status).toBe(404);
    expect((await api(s.token).patch(`/products/${randomUUID()}`, { name: 'Nothing' })).status).toBe(404);
    expect((await api(s.token).patch('/products/not-a-uuid', { name: 'Nothing' })).status).toBe(400);
    expect((await pool.query('SELECT 1 FROM seller_submissions WHERE product_id = $1', [other.productId])).rowCount).toBe(0);

    await pool.query('UPDATE products SET deleted_at = now() WHERE id = $1', [s.productId]);
    expect((await api(s.token).patch(`/products/${s.productId}`, { name: 'Deleted' })).status).toBe(404);
    await pool.query('UPDATE products SET deleted_at = NULL WHERE id = $1', [s.productId]);

    await pool.query(`UPDATE sellers SET status = 'SUSPENDED' WHERE id = $1`, [s.sellerId]);
    const res = await api(s.token).patch(`/products/${s.productId}`, { name: 'Suspended' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELLER_NOT_APPROVED');
  });

  it('validates the edit fields', async () => {
    const s = await liveProduct(22);
    for (const body of [{}, { seller_price: 0 }, { seller_price: 2_000_000 }, { name: 'A' }, { category_id: 'nope' }, { image_url: 'https://example.com/x.jpg' }]) {
      const res = await api(s.token).patch(`/products/${s.productId}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const res = await api(s.token).patch(`/products/${s.productId}`, { category_id: inactiveCategoryId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });
});

describe('DELETE /seller/submissions/:id', () => {
  it('withdraws a waiting submission once; later or foreign ones are refused', async () => {
    const a = await fx.makeSeller(23);
    const b = await fx.makeSeller(24);
    const sub = (await api(a.token).post('/products', newProduct())).body.data.submission;

    const foreign = await api(b.token).del(`/submissions/${sub.id}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('SUBMISSION_NOT_FOUND');
    expect((await api(a.token).get('/me')).body.data.counts.pending).toBe(1);

    const ok = await api(a.token).del(`/submissions/${sub.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.submission).toMatchObject({ id: sub.id, status: 'WITHDRAWN' });

    const again = await api(a.token).del(`/submissions/${sub.id}`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBMISSION_NOT_PENDING');

    // An approved one cannot be withdrawn either.
    const done = (await api(a.token).post('/products', newProduct())).body.data.submission;
    await pool.query(`UPDATE seller_submissions SET status = 'APPROVED' WHERE id = $1`, [done.id]);
    expect((await api(a.token).del(`/submissions/${done.id}`)).status).toBe(409);

    expect((await api(a.token).del(`/submissions/${randomUUID()}`)).status).toBe(404);
    expect((await api(a.token).del('/submissions/xyz')).status).toBe(400);
  });
});

describe('POST /seller/uploads/image', () => {
  it('stores a JPEG / PNG / WebP and returns its url (any seller status)', async () => {
    const s = await fx.makeSeller(25, 'PENDING');
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);
    for (const [buf, type, ext] of [
      [png(), 'image/png', 'png'],
      [jpeg, 'image/jpeg', 'jpg'],
      [webp, 'image/webp', 'webp'],
    ] as const) {
      const res = await request(app).post('/api/v1/seller/uploads/image').set(bearer(s.token)).attach('file', buf, { filename: `p.${ext}`, contentType: type });
      expect(res.status, type).toBe(201);
      expect(res.body.data.url).toMatch(new RegExp(`/uploads/products/[0-9a-f-]+\\.${ext}$`));
      uploaded.push(res.body.data.url);
      expect(await mediaStorage.exists(mediaStorage.keyFromUrl(res.body.data.url)!)).toBe(true);
    }
  });

  it('allows up to 5 MB and refuses bigger, other types, fake images and a missing file', async () => {
    const s = await fx.makeSeller(26, 'PENDING');
    const upload = () => request(app).post('/api/v1/seller/uploads/image').set(bearer(s.token));

    const big = await upload().attach('file', png(5 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');

    const three = await upload().attach('file', png(3 * 1024 * 1024), { filename: 'three.png', contentType: 'image/png' });
    expect(three.status).toBe(201);
    uploaded.push(three.body.data.url);

    const text = await upload().attach('file', Buffer.from('hello world, not an image'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(text.status).toBe(400);
    expect(text.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const fake = await upload().attach('file', Buffer.from('this is plain text pretending to be a png'), { filename: 'a.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const none = await upload();
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('NO_FILE');
  });

  it('is for sellers only', async () => {
    const userId = await fx.plainUser(27, 'CUSTOMER');
    const token = generateAccessToken({ id: userId, phone: fx.phone(27), role: 'CUSTOMER' });
    const res = await request(app).post('/api/v1/seller/uploads/image').set(bearer(token)).attach('file', png(), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });
});
