import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { setSellerLocationColumnsForTests, sellerPickupPoints } from '../src/modules/sellers/seller.location.js';
import { auth, stockFixtures, tokens, users } from './helpers/stock.js';
import { sellerFixtures, type FixtureSeller } from './helpers/seller-fixtures.js';

/**
 * What a seller and staff can do with a seller's products and shop (owner's brother, 2026-10-30):
 *  - the seller pauses / resumes a product (PATCH /seller/products/:id/availability),
 *  - Admin sees the seller's products (GET /admin/sellers/:id/products) and adds one for them
 *    (POST, photo required, opening stock through the ledger),
 *  - Admin sets the shop location (PUT /admin/sellers/:id/location) and edits the shop's details
 *    (PATCH /admin/sellers/:id).
 * Real local Postgres; everything made here is removed again.
 */
const app = createApp();
const fx = sellerFixtures('spt');
const orders = stockFixtures(app, 'SPT-');
const A = '/api/v1/admin';
const S = '/api/v1/seller';
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const PHOTO = '/uploads/products/seller-product-tools-test.png';
const madeSellerIds: string[] = [];

const seller = async (opts: Parameters<typeof fx.seller>[0] = {}) => {
  const s = await fx.seller(opts);
  madeSellerIds.push(s.id);
  return s;
};
const pause = (s: FixtureSeller | string, productId: string, body: unknown) =>
  request(app)
    .patch(`${S}/products/${productId}/availability`)
    .set(auth(typeof s === 'string' ? s : s.token))
    .send(body as object);
const adminGet = (path: string, token = tokens.admin) => request(app).get(`${A}${path}`).set(auth(token));
const adminPost = (path: string, body: unknown, token = tokens.admin) => request(app).post(`${A}${path}`).set(auth(token)).send(body as object);
const adminPut = (path: string, body: unknown, token = tokens.admin) => request(app).put(`${A}${path}`).set(auth(token)).send(body as object);
const adminPatch = (path: string, body: unknown, token = tokens.admin) => request(app).patch(`${A}${path}`).set(auth(token)).send(body as object);
const customerProduct = (id: string) => request(app).get(`/api/v1/products/${id}`);

beforeAll(async () => {
  await orders.setup();
  await fx.setup();
});

afterAll(async () => {
  setSellerLocationColumnsForTests(null);
  await orders.cleanup();
  if (madeSellerIds.length) {
    await pool.query(
      `DELETE FROM audit_logs WHERE action LIKE 'ADMIN\\_%' AND (entity_id = ANY($1::uuid[]) OR new_values->>'seller_id' = ANY($2::text[]))`,
      [madeSellerIds, madeSellerIds]
    );
    const products = (await pool.query('SELECT id FROM products WHERE seller_id = ANY($1::uuid[])', [madeSellerIds])).rows.map((r) => r.id as string);
    if (products.length) await pool.query(`DELETE FROM audit_logs WHERE action LIKE 'ADMIN\\_%' AND entity_id = ANY($1::uuid[])`, [products]);
  }
  await fx.cleanup();
});

/** A product of the seller that can be ordered: tracked stock, FIXED price 150, the seller's cost 100. */
async function stockedProduct(s: FixtureSeller, onHand = 20) {
  const t = await orders.product({ onHand });
  await pool.query(
    `UPDATE products SET seller_id = $2, purchase_cost = 100, pricing_mode = 'FIXED', fixed_selling_price = 150, image_url = $3 WHERE id = $1`,
    [t.productId, s.id, PHOTO]
  );
  return t;
}

const orderFor = (productId: string, quantity = 1) =>
  request(app).post('/api/v1/orders').set(auth(tokens.customer)).send({ address_id: orders.addressId, items: [{ product_id: productId, quantity }] });

// ----------------------------------------------------------------------------

describe('PATCH /seller/products/:id/availability (pause / resume)', () => {
  it('SELLER only: no token 401; customer, rider, staff and admin 403; nothing changes', async () => {
    const s = await seller();
    const p = await stockedProduct(s);
    const path = `${S}/products/${p.productId}/availability`;
    expect((await request(app).patch(path).send({ available: false })).status).toBe(401);
    for (const token of [tokens.customer, tokens.rider, tokens.staff, tokens.admin]) {
      expect((await request(app).patch(path).set(auth(token)).send({ available: false })).status).toBe(403);
    }
    expect((await pool.query('SELECT is_available FROM products WHERE id = $1', [p.productId])).rows[0].is_available).toBe(true);
  });

  it('pauses and resumes: the product flips, the customer sees it unavailable, an order for it is refused, resuming reverses all of it', async () => {
    const s = await seller();
    const p = await stockedProduct(s);
    expect((await customerProduct(p.productId)).body.data.product).toMatchObject({ id: p.productId, is_available: true });

    const paused = await pause(s, p.productId, { available: false });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    expect(paused.body.data).toEqual({ product: { id: p.productId, name: expect.any(String), is_active: true, is_available: false } });
    expect((await pool.query('SELECT is_active, is_available FROM products WHERE id = $1', [p.productId])).rows[0]).toEqual({ is_active: true, is_available: false });

    // the customer catalog payload says unavailable (greyed out), the product page too
    const page = await customerProduct(p.productId);
    expect(page.status).toBe(200);
    expect(page.body.data.product.is_available).toBe(false);
    const listed = await request(app).get('/api/v1/products').query({ search: (await pool.query('SELECT sku FROM products WHERE id = $1', [p.productId])).rows[0].sku });
    expect(listed.body.data.products[0]).toMatchObject({ id: p.productId, is_available: false });

    // an order for it is refused (nothing is placed)
    const refused = await orderFor(p.productId);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('PRODUCT_UNAVAILABLE');

    // the seller's own list shows it as paused
    const mine = (await request(app).get(`${S}/products`).set(auth(s.token))).body.data.products as { id: string; is_available: boolean; is_active: boolean }[];
    expect(mine.find((x) => x.id === p.productId)).toMatchObject({ is_available: false, is_active: true });

    // resume
    const resumed = await pause(s, p.productId, { available: true });
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.product.is_available).toBe(true);
    expect((await customerProduct(p.productId)).body.data.product.is_available).toBe(true);
    const ordered = await orderFor(p.productId);
    expect(ordered.status, JSON.stringify(ordered.body)).toBe(201);
    orders.created.orders.push(ordered.body.data.order.id);

    // audited both ways
    const audits = await fx.audits('SELLER_PRODUCT_AVAILABILITY', p.productId);
    expect(audits.map((a) => [a.old_values.is_available, a.new_values.is_available])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(audits[0].new_values).toMatchObject({ seller_id: s.id, product_name: expect.any(String) });
    expect(audits[0].actor_user_id).toBe(s.userId);
  });

  it('the same value again is a 200 that writes no audit row', async () => {
    const s = await seller();
    const p = await stockedProduct(s);
    expect((await pause(s, p.productId, { available: true })).status).toBe(200);
    expect((await pause(s, p.productId, { available: false })).status).toBe(200);
    expect((await pause(s, p.productId, { available: false })).status).toBe(200);
    expect(await fx.audits('SELLER_PRODUCT_AVAILABILITY', p.productId)).toHaveLength(1);
  });

  it("another seller's, an unknown and a deleted product are 404 PRODUCT_NOT_FOUND; a proposal that is not a product yet too", async () => {
    const s = await seller();
    const other = await seller();
    const mine = await stockedProduct(s);
    const res = await pause(other, mine.productId, { available: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await pool.query('SELECT is_available FROM products WHERE id = $1', [mine.productId])).rows[0].is_available).toBe(true);
    expect((await pause(s, '00000000-0000-4000-8000-000000000999', { available: false })).body.error.code).toBe('PRODUCT_NOT_FOUND');

    const gone = await stockedProduct(s);
    await pool.query('UPDATE products SET deleted_at = now() WHERE id = $1', [gone.productId]);
    expect((await pause(s, gone.productId, { available: true })).status).toBe(404);
  });

  it('a seller who is not approved (pending, rejected, suspended) gets 403 SELLER_NOT_APPROVED', async () => {
    const s = await seller();
    const p = await stockedProduct(s);
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED']) {
      await pool.query('UPDATE sellers SET status = $2 WHERE id = $1', [s.id, status]);
      const res = await pause(s, p.productId, { available: false });
      expect(res.status, status).toBe(403);
      expect(res.body.error.code).toBe('SELLER_NOT_APPROVED');
    }
    expect((await pool.query('SELECT is_available FROM products WHERE id = $1', [p.productId])).rows[0].is_available).toBe(true);
  });

  it('is strict about the body and the id', async () => {
    const s = await seller();
    const p = await stockedProduct(s);
    for (const bad of [{}, { available: 'false' }, { available: 0 }, { available: null }, { available: false, is_active: false }, { is_active: false }]) {
      const res = await pause(s, p.productId, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await pause(s, 'not-a-uuid', { available: false })).status).toBe(400);
    expect((await pool.query('SELECT is_active, is_available FROM products WHERE id = $1', [p.productId])).rows[0]).toEqual({ is_active: true, is_available: true });
  });

  it('never touches is_active: a product staff switched off stays off whatever the seller sets', async () => {
    const s = await seller();
    const p = await stockedProduct(s);
    await pool.query('UPDATE products SET is_active = false WHERE id = $1', [p.productId]);
    const res = await pause(s, p.productId, { available: true });
    expect(res.status).toBe(200);
    expect(res.body.data.product).toMatchObject({ is_active: false, is_available: true });
    expect((await orderFor(p.productId)).status).toBe(400);
    expect((await pool.query('SELECT is_active FROM products WHERE id = $1', [p.productId])).rows[0].is_active).toBe(false);
  });
});

// ----------------------------------------------------------------------------

describe('GET /admin/sellers/:id/products', () => {
  it('lists the seller\'s products by name with status LIVE / PAUSED / OFF, prices, photo, category and stock; deleted ones left out', async () => {
    const s = await seller();
    const other = await seller();
    const live = await stockedProduct(s, 7);
    const paused = await stockedProduct(s, 3);
    const off = await stockedProduct(s, 0);
    const untracked = await orders.product({ tracked: false });
    const gone = await stockedProduct(s);
    const foreign = await stockedProduct(other);
    await pool.query(`UPDATE products SET name = 'AAA live' WHERE id = $1`, [live.productId]);
    await pool.query(`UPDATE products SET name = 'BBB paused', is_available = false WHERE id = $1`, [paused.productId]);
    await pool.query(`UPDATE products SET name = 'CCC off', is_active = false WHERE id = $1`, [off.productId]);
    await pool.query(`UPDATE products SET name = 'DDD uncounted', seller_id = $2, purchase_cost = 60, pricing_mode = 'FIXED', fixed_selling_price = 90 WHERE id = $1`, [untracked.productId, s.id]);
    await pool.query(`UPDATE products SET deleted_at = now() WHERE id = $1`, [gone.productId]);
    void foreign;

    const res = await adminGet(`/sellers/${s.id}/products`);
    expect(res.status).toBe(200);
    const list = res.body.data.products as Record<string, unknown>[];
    expect(list.map((p) => p.name)).toEqual(['AAA live', 'BBB paused', 'CCC off', 'DDD uncounted']);
    expect(list[0]).toEqual({
      id: live.productId,
      name: 'AAA live',
      image_url: PHOTO,
      category_name: expect.any(String),
      selling_price: 150,
      seller_price: 100,
      is_active: true,
      is_available: true,
      status: 'LIVE',
      stock_on_hand: 7,
    });
    expect(list.map((p) => p.status)).toEqual(['LIVE', 'PAUSED', 'OFF', 'LIVE']);
    expect(list[1]).toMatchObject({ is_active: true, is_available: false, stock_on_hand: 3 });
    expect(list[2]).toMatchObject({ is_active: false, stock_on_hand: 0 });
    expect(list[3]).toMatchObject({ selling_price: 90, seller_price: 60, stock_on_hand: null });
    // no customer or order detail anywhere
    expect(JSON.stringify(res.body)).not.toMatch(/customer|phone|address/i);

    // the sellers list and detail carry the count (deleted left out, paused and off included)
    expect((await adminGet(`/sellers/${s.id}`)).body.data.seller).toMatchObject({ products_total: 4, products_live: 3 });
    const listed = await adminGet(`/sellers?search=${encodeURIComponent(s.shop)}`);
    expect(listed.body.data.sellers.find((r: { id: string }) => r.id === s.id)).toMatchObject({ products_total: 4 });
  });

  it('is for Admin and Operations; unknown seller 404; a seller with no products gets []', async () => {
    const s = await seller();
    expect((await adminGet(`/sellers/${s.id}/products`, opsToken)).body.data).toEqual({ products: [] });
    for (const token of [tokens.customer, tokens.rider, tokens.staff, s.token]) {
      expect((await adminGet(`/sellers/${s.id}/products`, token)).status).toBe(403);
    }
    expect((await request(app).get(`${A}/sellers/${s.id}/products`)).status).toBe(401);
    expect((await adminGet('/sellers/00000000-0000-4000-8000-000000000999/products')).status).toBe(404);
    expect((await adminGet('/sellers/nope/products')).status).toBe(400);
  });
});

// ----------------------------------------------------------------------------

describe('POST /admin/sellers/:id/products', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    name: `Staff Added Pickle ${Date.now()}`,
    category_id: '',
    unit: '1 jar',
    pack_size: '350 g',
    description: 'Home made',
    image_url: PHOTO,
    seller_price: 220,
    selling_price: 280,
    barcode: '4790000000017',
    stock_quantity: 12,
    ...over,
  });
  let categoryId = '';
  beforeAll(() => {
    categoryId = fx.categoryId;
  });
  const create = (id: string, over: Record<string, unknown> = {}, token = tokens.admin) =>
    adminPost(`/sellers/${id}/products`, body({ category_id: categoryId, ...over }), token);

  it('creates a LIVE product owned by the seller: FIXED price, the seller\'s price as cost, tracked stock through the ledger, audited', async () => {
    const s = await seller();
    const res = await create(s.id);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const product = res.body.data.product;
    expect(product).toEqual({
      id: expect.any(String),
      name: expect.stringContaining('Staff Added Pickle'),
      image_url: PHOTO,
      category_name: expect.any(String),
      selling_price: 280,
      seller_price: 220,
      is_active: true,
      is_available: true,
      status: 'LIVE',
      stock_on_hand: 12,
    });

    const row = (await pool.query(`SELECT * FROM products WHERE id = $1`, [product.id])).rows[0];
    expect(row).toMatchObject({
      seller_id: s.id,
      category_id: categoryId,
      unit: '1 jar',
      pack_size: '350 g',
      description: 'Home made',
      barcode: '4790000000017',
      image_url: PHOTO,
      pricing_mode: 'FIXED',
      is_active: true,
      is_available: true,
    });
    expect(Number(row.purchase_cost)).toBe(220);
    expect(Number(row.fixed_selling_price)).toBe(280);
    expect(row.sku).toMatch(/^SLR-/);
    expect(row.slug).toBeTruthy();

    const inv = (await pool.query(`SELECT id, tracking_mode, quantity_on_hand FROM inventory WHERE product_id = $1 AND variant_id IS NULL`, [product.id])).rows;
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ tracking_mode: 'TRACKED', quantity_on_hand: 12 });
    const ledger = (
      await pool.query(`SELECT adjustment_type, quantity_delta, previous_quantity, new_quantity, created_by_user_id, notes FROM inventory_adjustments WHERE inventory_id = $1`, [inv[0].id])
    ).rows;
    expect(ledger).toEqual([
      { adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 12, previous_quantity: 0, new_quantity: 12, created_by_user_id: users.admin.id, notes: expect.stringContaining(s.shop) },
    ]);

    const audits = await pool.query(`SELECT * FROM audit_logs WHERE action = 'ADMIN_CREATED_SELLER_PRODUCT' AND entity_id = $1`, [product.id]);
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].actor_user_id).toBe(users.admin.id);
    expect(audits.rows[0].new_values).toMatchObject({ seller_id: s.id, seller_price: 220, selling_price: 280, stock_quantity: 12 });

    // customers see it (sold by the shop, at the selling price, orderable); the seller sees it live
    const page = await customerProduct(product.id);
    expect(page.status).toBe(200);
    expect(page.body.data.product).toMatchObject({ selling_price: 280, sold_by: s.shop, is_available: true });
    expect(JSON.stringify(page.body)).not.toMatch(/purchase_cost|seller_price/);
    const mine = (await request(app).get(`${S}/products`).set(auth(s.token))).body.data.products as { id: string; live: boolean; stock_on_hand: number }[];
    expect(mine.find((p) => p.id === product.id)).toMatchObject({ live: true, stock_on_hand: 12 });
    expect((await adminGet(`/sellers/${s.id}/products`)).body.data.products.map((p: { id: string }) => p.id)).toContain(product.id);
  });

  it('without opening stock the stock is counted at 0 and no ledger row is written; optional fields can be left out', async () => {
    const s = await seller();
    const res = await adminPost(`/sellers/${s.id}/products`, { name: `Plain ${Date.now()}`, category_id: categoryId, unit: '1 kg', image_url: PHOTO, seller_price: 50.5, selling_price: 70 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.product).toMatchObject({ seller_price: 50.5, selling_price: 70, stock_on_hand: 0, status: 'LIVE' });
    const inv = (await pool.query(`SELECT id FROM inventory WHERE product_id = $1`, [res.body.data.product.id])).rows;
    expect((await pool.query(`SELECT 1 FROM inventory_adjustments WHERE inventory_id = $1`, [inv[0].id])).rowCount).toBe(0);
    const zero = await create(s.id, { stock_quantity: 0 });
    expect(zero.status).toBe(201);
    expect(zero.body.data.product.stock_on_hand).toBe(0);
  });

  it('the photo is mandatory: missing, null or blank is 400 IMAGE_REQUIRED and nothing is created', async () => {
    const s = await seller();
    for (const image_url of [undefined, null, '', '   ']) {
      const res = await create(s.id, { image_url });
      expect(res.status, String(image_url)).toBe(400);
      expect(res.body.error.code).toBe('IMAGE_REQUIRED');
      expect(res.body.error.message).toBe('Add a photo of the product.');
    }
    expect((await pool.query('SELECT 1 FROM products WHERE seller_id = $1', [s.id])).rowCount).toBe(0);
  });

  it('validates the fields', async () => {
    const s = await seller();
    const bad: Record<string, unknown>[] = [
      { name: 'A' },
      { name: undefined },
      { unit: '' },
      { category_id: 'nope' },
      { seller_price: 0 },
      { seller_price: -1 },
      { seller_price: 1_000_001 },
      { seller_price: 10.123 },
      { seller_price: '10' },
      { seller_price: undefined },
      { selling_price: 0 },
      { selling_price: undefined },
      { stock_quantity: -1 },
      { stock_quantity: 1.5 },
      { stock_quantity: 100_001 },
      { image_url: 'javascript:alert(1)' },
      { surprise: true },
    ];
    for (const over of bad) {
      const res = await create(s.id, over);
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const unknownCategory = await create(s.id, { category_id: '00000000-0000-4000-8000-000000000999' });
    expect(unknownCategory.status).toBe(400);
    expect(unknownCategory.body.error.code).toBe('CATEGORY_NOT_FOUND');
    expect((await pool.query('SELECT 1 FROM products WHERE seller_id = $1', [s.id])).rowCount).toBe(0);
  });

  it('only for an APPROVED seller (409 SELLER_NOT_APPROVED); unknown seller 404; Admin and Operations only', async () => {
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED'] as const) {
      const s = await seller({ status });
      const res = await create(s.id);
      expect(res.status, status).toBe(409);
      expect(res.body.error.code).toBe('SELLER_NOT_APPROVED');
      expect((await pool.query('SELECT 1 FROM products WHERE seller_id = $1', [s.id])).rowCount).toBe(0);
    }
    expect((await create('00000000-0000-4000-8000-000000000999')).status).toBe(404);
    const ok = await seller();
    for (const token of [tokens.customer, tokens.rider, tokens.staff, ok.token]) {
      expect((await create(ok.id, {}, token)).status).toBe(403);
    }
    expect((await request(app).post(`${A}/sellers/${ok.id}/products`).send(body({ category_id: categoryId }))).status).toBe(401);
    expect((await pool.query('SELECT 1 FROM products WHERE seller_id = $1', [ok.id])).rowCount).toBe(0);
  });

  it('two products with the same name get different slugs and SKUs', async () => {
    const s = await seller();
    const a = await create(s.id, { name: 'Twin Pickle' });
    const b = await create(s.id, { name: 'Twin Pickle' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const rows = (await pool.query('SELECT slug, sku FROM products WHERE id = ANY($1::uuid[])', [[a.body.data.product.id, b.body.data.product.id]])).rows;
    expect(new Set(rows.map((r) => r.slug)).size).toBe(2);
    expect(new Set(rows.map((r) => r.sku)).size).toBe(2);
  });
});

// ----------------------------------------------------------------------------

describe('PUT /admin/sellers/:id/location', () => {
  const put = (id: string, body: unknown, token = tokens.admin) => adminPut(`/sellers/${id}/location`, body, token);

  it('writes an APPROVED pin at once, with the note, and delivery picks it up', async () => {
    const s = await seller();
    const product = await stockedProduct(s);
    const res = await put(s.id, { latitude: 6.4351, longitude: 80.0243, how_to_find: 'Blue gate next to the temple' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({
      id: s.id,
      latitude: 6.4351,
      longitude: 80.0243,
      location_note: 'Blue gate next to the temple',
      location_status: 'APPROVED',
      pending_latitude: null,
      pending_longitude: null,
      location_reject_reason: null,
    });
    expect(typeof res.body.data.seller.distance_km_from_store === 'number' || res.body.data.seller.distance_km_from_store === null).toBe(true);
    const row = (await pool.query('SELECT location_reviewed_by, location_reviewed_at FROM sellers WHERE id = $1', [s.id])).rows[0];
    expect(row.location_reviewed_by).toBe(users.admin.id);
    expect(row.location_reviewed_at).toBeTruthy();

    // the pickup point riders and the delivery fee use
    const pickups = await sellerPickupPoints([product.productId]);
    expect(pickups.get(product.productId)).toMatchObject({ seller_id: s.id, lat: 6.4351, lng: 80.0243 });
    // the seller sees it as their approved location
    const mine = await request(app).get(`${S}/me`).set(auth(s.token));
    expect(mine.body.data.seller).toMatchObject({ latitude: 6.4351, longitude: 80.0243, location_status: 'APPROVED' });

    const audit = (await pool.query(`SELECT * FROM audit_logs WHERE action = 'ADMIN_SET_SELLER_LOCATION' AND entity_id = $1`, [s.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].old_values).toMatchObject({ latitude: null, longitude: null });
    expect(audit[0].new_values).toMatchObject({ latitude: 6.4351, longitude: 80.0243, location_note: 'Blue gate next to the temple', cleared_pending_request: false });
  });

  it('replaces a pin the seller had waiting (that request is cleared); a note left out is kept, null / blank clears it', async () => {
    const s = await seller();
    await pool.query(
      `UPDATE sellers SET latitude = 6.5, longitude = 80.1, location_note = 'Old note', pending_latitude = 6.6, pending_longitude = 80.2,
              pending_location_note = 'Waiting', location_status = 'PENDING' WHERE id = $1`,
      [s.id]
    );
    const moved = await put(s.id, { latitude: 6.7, longitude: 80.3 });
    expect(moved.status).toBe(200);
    expect(moved.body.data.seller).toMatchObject({
      latitude: 6.7,
      longitude: 80.3,
      location_note: 'Old note',
      location_status: 'APPROVED',
      pending_latitude: null,
      pending_longitude: null,
      pending_location_note: null,
    });
    expect((await fx.row('SELECT location_status FROM sellers WHERE id = $1', [s.id])).location_status).toBe('APPROVED');
    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'ADMIN_SET_SELLER_LOCATION' AND entity_id = $1`, [s.id])).rows;
    expect(audit[0].new_values.cleared_pending_request).toBe(true);

    expect((await put(s.id, { latitude: 6.7, longitude: 80.3, how_to_find: 'New note' })).body.data.seller.location_note).toBe('New note');
    expect((await put(s.id, { latitude: 6.7, longitude: 80.3, how_to_find: '  ' })).body.data.seller.location_note).toBeNull();
    expect((await put(s.id, { latitude: 6.7, longitude: 80.3, how_to_find: 'Again' })).status).toBe(200);
    expect((await put(s.id, { latitude: 6.7, longitude: 80.3, how_to_find: null })).body.data.seller.location_note).toBeNull();
  });

  it('works for a seller who is not approved yet, and for Operations', async () => {
    const s = await seller({ status: 'PENDING' });
    expect((await put(s.id, { latitude: 7.2, longitude: 80.6 }, opsToken)).status).toBe(200);
  });

  it('the pin must be inside Sri Lanka and both coordinates are required; the note is at most 200 characters', async () => {
    const s = await seller();
    const bad: unknown[] = [
      {},
      { latitude: 6.4 },
      { longitude: 80.0 },
      { latitude: 51.5, longitude: -0.12 },
      { latitude: 5.7, longitude: 80 },
      { latitude: 10, longitude: 80 },
      { latitude: 7, longitude: 79.4 },
      { latitude: 7, longitude: 82 },
      { latitude: '6.4', longitude: 80 },
      { latitude: null, longitude: null },
      { latitude: 6.4, longitude: 80, how_to_find: 'x'.repeat(201) },
      { latitude: 6.4, longitude: 80, extra: 1 },
    ];
    for (const b of bad) {
      const res = await put(s.id, b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await fx.row('SELECT latitude, location_status FROM sellers WHERE id = $1', [s.id]))).toEqual({ latitude: null, location_status: 'NONE' });
    // the borders themselves are inside
    expect((await put(s.id, { latitude: 5.8, longitude: 79.5 })).status).toBe(200);
    expect((await put(s.id, { latitude: 9.9, longitude: 81.95 })).status).toBe(200);
  });

  it('Admin and Operations only; unknown seller 404; 503 LOCATION_NOT_READY before migration 053', async () => {
    const s = await seller();
    for (const token of [tokens.customer, tokens.rider, tokens.staff, s.token]) {
      expect((await put(s.id, { latitude: 6.4, longitude: 80 }, token)).status).toBe(403);
    }
    expect((await request(app).put(`${A}/sellers/${s.id}/location`).send({ latitude: 6.4, longitude: 80 })).status).toBe(401);
    expect((await put('00000000-0000-4000-8000-000000000999', { latitude: 6.4, longitude: 80 })).status).toBe(404);
    setSellerLocationColumnsForTests(false);
    try {
      const res = await put(s.id, { latitude: 6.4, longitude: 80 });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('LOCATION_NOT_READY');
    } finally {
      setSellerLocationColumnsForTests(null);
    }
    expect((await fx.row('SELECT latitude FROM sellers WHERE id = $1', [s.id])).latitude).toBeNull();
  });
});

// ----------------------------------------------------------------------------

describe('PATCH /admin/sellers/:id covers the shop profile', () => {
  it("edits everything the seller's own Shop profile has except the pin (that is PUT .../location): shop name, contact, address, note", async () => {
    const s = await seller();
    const res = await adminPatch(`/sellers/${s.id}`, { shop_name: 'Renamed Shop', contact_name: 'Kamal', address: '5 Temple Rd, Dharga Town', note: 'Open after 10' }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({ shop_name: 'Renamed Shop', contact_name: 'Kamal', address: '5 Temple Rd, Dharga Town', note: 'Open after 10' });
    // the seller's own profile endpoint shows the same fields
    const mine = await request(app).get(`${S}/me`).set(auth(s.token));
    expect(mine.body.data.seller).toMatchObject({ shop_name: 'Renamed Shop', contact_name: 'Kamal', address: '5 Temple Rd, Dharga Town', note: 'Open after 10' });
    // the pin and "how to find it" are not PATCH fields (strict schema): they go through PUT /location
    for (const bad of [{ latitude: 6.4 }, { longitude: 80 }, { location_note: 'x' }]) {
      expect((await adminPatch(`/sellers/${s.id}`, bad)).status).toBe(400);
    }
  });
});
