import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Admin → Customer synchronization, backend half.
 *
 * Proves that an Admin mutation is persisted and served, unchanged, by the
 * exact customer endpoints the Flutter app reads (GET /catalog/products,
 * /catalog/products/:id, /promotions) - with no cache in between. The
 * stale-data bug that prompted this was in the customer app's state, not
 * here; this pins the server side so it cannot regress unnoticed.
 *
 * Fixtures are created in beforeAll and removed in afterAll by id, so a run
 * leaves nothing behind.
 */
describe('Admin → Customer catalog synchronization', () => {
  const app = createApp();
  const adminToken = generateAccessToken({
    id: 'a0000001-0000-0000-0000-000000000003',
    phone: '+94775551122',
    role: 'ADMIN',
  });
  const admin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);

  const SKU = 'TEST-SKU-SYNC-001';
  let productId = '';
  let categoryId = '';
  let categorySlug = '';
  let promotionId = '';

  const customerList = async () => {
    const res = await request(app)
      .get('/api/v1/catalog/products')
      .query({ category_slug: categorySlug, limit: 100 });
    expect(res.status).toBe(200);
    return res.body.data.products.find((p: { id: string }) => p.id === productId);
  };
  const customerDetail = () => request(app).get(`/api/v1/catalog/products/${productId}`);
  const dbRow = async () =>
    (
      await pool.query(
        'SELECT name, purchase_cost, custom_markup_percent, image_url, is_active FROM products WHERE id = $1',
        [productId]
      )
    ).rows[0];
  const patchProduct = (body: object) =>
    admin(request(app).patch(`/api/v1/admin/products/${productId}`)).send(body);

  beforeAll(async () => {
    await pool.query('DELETE FROM products WHERE sku = $1', [SKU]);
    const cat = await pool.query(
      "SELECT id, slug FROM categories WHERE is_active = true ORDER BY display_order LIMIT 1"
    );
    categoryId = cat.rows[0].id;
    categorySlug = cat.rows[0].slug;

    const res = await admin(request(app).post('/api/v1/admin/products')).send({
      category_id: categoryId,
      name: 'Sync Test Fresh Milk 1L',
      sku: SKU,
      unit: '1 L',
      purchase_cost: 450,
      custom_markup_percent: 20,
      is_available: true,
      is_active: true,
    });
    expect(res.status).toBe(201);
    productId = res.body.data.product.id;
  });

  afterAll(async () => {
    if (promotionId) await pool.query('DELETE FROM promotions WHERE id = $1', [promotionId]);
    await pool.query('DELETE FROM products WHERE sku = $1', [SKU]);
  });

  it('serves the newly created product to customers at the calculated price', async () => {
    const listed = await customerList();
    expect(listed.selling_price).toBe(540);
    expect(listed).not.toHaveProperty('purchase_cost');
  });

  it('a price change is persisted and served by the list and the detail endpoint', async () => {
    const res = await patchProduct({ purchase_cost: 625 });
    expect(res.status).toBe(200);

    expect(Number((await dbRow()).purchase_cost)).toBe(625);
    expect((await customerList()).selling_price).toBe(750);
    const detail = await customerDetail();
    expect(detail.status).toBe(200);
    expect(detail.body.data.product.selling_price).toBe(750);
  });

  it('a name change reaches the customer catalog', async () => {
    await patchProduct({ name: 'Sync Test Fresh Milk 1L (New Pack)' });

    expect((await dbRow()).name).toBe('Sync Test Fresh Milk 1L (New Pack)');
    expect((await customerList()).name).toBe('Sync Test Fresh Milk 1L (New Pack)');
  });

  it('an image is added, replaced and removed', async () => {
    const first = 'http://localhost:4000/uploads/products/sync-test-a.webp';
    const second = 'http://localhost:4000/uploads/products/sync-test-b.webp';

    await patchProduct({ image_url: first });
    expect((await customerList()).image_url).toBe(first);

    await patchProduct({ image_url: second });
    expect((await customerList()).image_url).toBe(second);
    expect((await customerDetail()).body.data.product.image_url).toBe(second);

    await patchProduct({ image_url: null });
    expect((await dbRow()).image_url).toBeNull();
    expect((await customerList()).image_url).toBeNull();
  });

  it('ACTIVE → INACTIVE hides it; INACTIVE → ACTIVE brings it back', async () => {
    await patchProduct({ is_active: false });
    expect((await dbRow()).is_active).toBe(false);
    expect(await customerList()).toBeUndefined();
    expect((await customerDetail()).status).toBe(404);

    await patchProduct({ is_active: true });
    expect((await customerList()).name).toBe('Sync Test Fresh Milk 1L (New Pack)');
    expect((await customerDetail()).status).toBe(200);
  });

  it('promotion title, background and visibility reach GET /promotions', async () => {
    const created = await admin(request(app).post('/api/v1/admin/promotions')).send({
      title: 'Sync Test Promotion',
      display_order: 1,
      is_active: true,
      background_type: 'SOLID',
      background_color: '#FFE141',
    });
    expect(created.status).toBe(201);
    promotionId = created.body.data.promotion.id;

    const find = async () =>
      (await request(app).get('/api/v1/promotions')).body.data.promotions.find(
        (p: { id: string }) => p.id === promotionId
      );

    expect((await find()).background_color).toBe('#FFE141');

    await admin(request(app).patch(`/api/v1/admin/promotions/${promotionId}`)).send({
      title: 'Sync Test Promotion (Edited)',
      background_type: 'GRADIENT',
      background_color: '#FFF3C4',
      background_color_end: '#E4F2E6',
    });
    const edited = await find();
    expect(edited.title).toBe('Sync Test Promotion (Edited)');
    expect(edited.background_type).toBe('GRADIENT');
    expect(edited.background_color_end).toBe('#E4F2E6');

    await admin(request(app).patch(`/api/v1/admin/promotions/${promotionId}`)).send({
      is_active: false,
    });
    expect(await find()).toBeUndefined();
  });

  it('sends no caching headers that could make a client reuse an old catalog', async () => {
    const res = await request(app).get('/api/v1/catalog/products').query({ limit: 1 });
    expect(res.headers['cache-control'] ?? '').not.toMatch(/max-age=[1-9]|immutable/);
    expect(res.headers['expires']).toBeUndefined();
  });
});
