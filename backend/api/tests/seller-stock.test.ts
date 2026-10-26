import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { SmsProvider } from '../src/modules/notifications/providers/sms.provider.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { auth, stockFixtures, tokens, users } from './helpers/stock.js';
import { sellerFixtures, type FixtureSeller } from './helpers/seller-fixtures.js';

/**
 * Sellers set their own stock (owner, 2026-10-26: "stock they must manage themselves"):
 * PUT /seller/products/:id/stock { quantity } makes the number the live on-hand quantity through the
 * stock ledger (PURCHASE_RESTOCK up, INVENTORY_AUDIT_ADJUSTMENT down, nothing for the same number),
 * with the seller as the actor, an audit row, and the rules: own approved products only, counted
 * (tracked) stock only, never below what open orders reserved, no products with sizes. Also: GET
 * /seller/products carries the stock fields, and a seller can register / remove a web push device
 * (POST / DELETE /me/devices). Real local Postgres; everything made here is removed again.
 */
const app = createApp();
const fx = sellerFixtures('stk');
const orders = stockFixtures(app, 'SELSTK-');
const A = '/api/v1/admin';
const S = '/api/v1/seller';
const fakePush: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const customerDevice = `seller-stock-customer-device-${Date.now()}`;
const variantIds: string[] = [];

const putStock = (s: FixtureSeller, productId: string, body: unknown) =>
  request(app).put(`${S}/products/${productId}/stock`).set(auth(s.token)).send(body as object);
const myProducts = async (s: FixtureSeller) =>
  (await request(app).get(`${S}/products`).set(auth(s.token))).body.data.products as Array<Record<string, unknown> & { id: string }>;

/** A live product of the seller (approved through the staff API: a TRACKED stock row at 0). */
async function liveProduct(s: FixtureSeller, name?: string) {
  const sub = await fx.submission(s.id, { price: 100, name });
  const res = await request(app).post(`${A}/seller-submissions/${sub}/approve`).set(auth(tokens.admin)).send({ selling_price: 150 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.product.id as string;
}

const inventoryRow = async (productId: string) =>
  (await pool.query(`SELECT id, tracking_mode, quantity_on_hand, quantity_reserved FROM inventory WHERE product_id = $1 AND variant_id IS NULL`, [productId])).rows[0] as
    | { id: string; tracking_mode: string; quantity_on_hand: number; quantity_reserved: number }
    | undefined;

const ledger = async (productId: string) =>
  (
    await pool.query(
      `SELECT a.adjustment_type, a.quantity_delta, a.previous_quantity, a.new_quantity, a.created_by_user_id, a.notes
         FROM inventory_adjustments a JOIN inventory i ON i.id = a.inventory_id
        WHERE i.product_id = $1 ORDER BY a.created_at, a.id`,
      [productId]
    )
  ).rows;

beforeAll(async () => {
  setPushSenderForTests(fakePush);
  await orders.setup();
  await fx.setup();
});

afterAll(async () => {
  setPushSenderForTests(undefined);
  await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_BACK_IN_STOCK' AND user_id = $1 AND created_at >= $2`, [users.customer.id, fx.testStart]);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [customerDevice]);
  if (variantIds.length) await pool.query('DELETE FROM product_variants WHERE id = ANY($1::uuid[])', [variantIds]);
  await orders.cleanup();
  await fx.cleanup();
});

describe('PUT /seller/products/:id/stock: who may', () => {
  it('SELLER only: no token 401; customer, rider, staff and admin 403', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    expect((await request(app).put(`${S}/products/${productId}/stock`).send({ quantity: 5 })).status).toBe(401);
    for (const token of [tokens.customer, tokens.rider, tokens.staff, tokens.admin]) {
      const res = await request(app).put(`${S}/products/${productId}/stock`).set(auth(token)).send({ quantity: 5 });
      expect(res.status).toBe(403);
    }
    expect((await inventoryRow(productId))!.quantity_on_hand).toBe(0);
    expect(await ledger(productId)).toEqual([]);
  });

  it("another seller's product is 404 PRODUCT_NOT_FOUND and nothing changes; a seller who is not approved is 403", async () => {
    const s = await fx.seller();
    const other = await fx.seller();
    const mine = await liveProduct(s);
    const res = await putStock(other, mine, { quantity: 9 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await inventoryRow(mine))!.quantity_on_hand).toBe(0);

    for (const id of ['00000000-0000-4000-8000-000000000999', 'nope', 'submission:nope', 'submission:00000000-0000-4000-8000-000000000999']) {
      const unknown = await putStock(s, id, { quantity: 1 });
      expect(unknown.status, id).toBe(404);
      expect(unknown.body.error.code).toBe('PRODUCT_NOT_FOUND');
    }

    const pending = await fx.seller({ status: 'PENDING' });
    const notApproved = await putStock(pending, mine, { quantity: 1 });
    expect(notApproved.status).toBe(403);
    expect(notApproved.body.error.code).toBe('SELLER_NOT_APPROVED');
    await pool.query(`UPDATE sellers SET status = 'SUSPENDED' WHERE id = $1`, [other.id]);
    expect((await putStock(other, mine, { quantity: 1 })).body.error.code).toBe('SELLER_NOT_APPROVED');
  });

  it('validates the body: a whole number 0..100000, nothing else', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    for (const bad of [{}, { quantity: -1 }, { quantity: 100_001 }, { quantity: 1.5 }, { quantity: '5' }, { quantity: null }, { quantity: 5, surprise: true }]) {
      const res = await putStock(s, productId, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await putStock(s, productId, { quantity: 100_000 })).status).toBe(200);
    expect((await inventoryRow(productId))!.quantity_on_hand).toBe(100_000);
  });
});

describe('PUT /seller/products/:id/stock: setting the number', () => {
  it('up is a PURCHASE_RESTOCK, down an INVENTORY_AUDIT_ADJUSTMENT, the same number writes nothing; seller is the actor; audited', async () => {
    const s = await fx.seller({ shop: `Stock Shop ${fx.stamp}` });
    const productId = await liveProduct(s);

    const up = await putStock(s, productId, { quantity: 12 });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data).toEqual({ product_id: productId, stock_on_hand: 12, stock_reserved: 0, previous: 0 });
    expect((await inventoryRow(productId))!.quantity_on_hand).toBe(12);

    const down = await putStock(s, productId, { quantity: 5 });
    expect(down.body.data).toEqual({ product_id: productId, stock_on_hand: 5, stock_reserved: 0, previous: 12 });

    const same = await putStock(s, productId, { quantity: 5 });
    expect(same.status).toBe(200);
    expect(same.body.data).toEqual({ product_id: productId, stock_on_hand: 5, stock_reserved: 0, previous: 5 });

    const zero = await putStock(s, productId, { quantity: 0 });
    expect(zero.body.data).toEqual({ product_id: productId, stock_on_hand: 0, stock_reserved: 0, previous: 5 });

    const rows = await ledger(productId);
    expect(rows).toEqual([
      expect.objectContaining({ adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 12, previous_quantity: 0, new_quantity: 12, created_by_user_id: s.userId }),
      expect.objectContaining({ adjustment_type: 'INVENTORY_AUDIT_ADJUSTMENT', quantity_delta: -7, previous_quantity: 12, new_quantity: 5, created_by_user_id: s.userId }),
      expect.objectContaining({ adjustment_type: 'INVENTORY_AUDIT_ADJUSTMENT', quantity_delta: -5, previous_quantity: 5, new_quantity: 0, created_by_user_id: s.userId }),
    ]);
    expect(rows.map((r) => r.notes)).toEqual([
      `Seller ${s.shop} set stock (was 0)`,
      `Seller ${s.shop} set stock (was 12)`,
      `Seller ${s.shop} set stock (was 5)`,
    ]);

    const audit = await fx.audits('SELLER_STOCK_SET', productId);
    expect(audit).toHaveLength(3); // the unchanged save is not audited
    expect(audit[0]).toMatchObject({ actor_user_id: s.userId });
    expect(audit.map((a) => [a.old_values.quantity_on_hand, a.new_values.quantity_on_hand])).toEqual([
      [0, 12],
      [12, 5],
      [5, 0],
    ]);
    expect(audit[0].new_values).toMatchObject({ seller_id: s.id });
  });

  it('a product with no inventory row yet gets a TRACKED one', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    await pool.query('DELETE FROM inventory WHERE product_id = $1', [productId]);
    const res = await putStock(s, productId, { quantity: 4 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ stock_on_hand: 4, previous: 0 });
    expect(await inventoryRow(productId)).toMatchObject({ tracking_mode: 'TRACKED', quantity_on_hand: 4 });
    expect((await ledger(productId)).map((r) => r.adjustment_type)).toEqual(['PURCHASE_RESTOCK']);
  });

  it('never below what open orders reserved: 400 with the friendly message, nothing changes; the floor itself is allowed', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    expect((await putStock(s, productId, { quantity: 10 })).status).toBe(200);
    await pool.query('UPDATE inventory SET quantity_reserved = 4 WHERE product_id = $1', [productId]);

    const refused = await putStock(s, productId, { quantity: 3 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('INSUFFICIENT_AVAILABLE_INVENTORY');
    expect(refused.body.error.message).toBe('4 are already reserved for open orders, so the stock cannot go below 4.');
    expect((await inventoryRow(productId))!.quantity_on_hand).toBe(10);
    expect(await ledger(productId)).toHaveLength(1);

    const floor = await putStock(s, productId, { quantity: 4 });
    expect(floor.status).toBe(200);
    expect(floor.body.data).toEqual({ product_id: productId, stock_on_hand: 4, stock_reserved: 4, previous: 10 });
  });

  it('a product staff switched to UNTRACKED is 409 PRODUCT_NOT_TRACKED', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    await pool.query(`UPDATE inventory SET tracking_mode = 'UNTRACKED' WHERE product_id = $1`, [productId]);
    const res = await putStock(s, productId, { quantity: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_NOT_TRACKED');
    expect(res.body.error.message).toMatch(/not counting/i);
    expect(await ledger(productId)).toEqual([]);
    expect((await inventoryRow(productId))!.quantity_on_hand).toBe(0);
  });

  it('a product that is only a proposal (pending / rejected) is 409 PRODUCT_NOT_APPROVED', async () => {
    const s = await fx.seller();
    const pendingSub = await fx.submission(s.id, { name: `Pending ${fx.stamp}` });
    const rejectedSub = await fx.submission(s.id, { name: `Rejected ${fx.stamp}`, status: 'REJECTED' });
    for (const id of [pendingSub, rejectedSub]) {
      const res = await putStock(s, `submission:${id}`, { quantity: 5 });
      expect(res.status, id).toBe(409);
      expect(res.body.error.code).toBe('PRODUCT_NOT_APPROVED');
    }
    // another seller cannot probe someone else's proposal
    const other = await fx.seller();
    expect((await putStock(other, `submission:${pendingSub}`, { quantity: 5 })).body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('a product with sizes (variants) is 409 PRODUCT_HAS_VARIANTS: staff keep those counts', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    const variant = (
      await pool.query(`INSERT INTO product_variants (product_id, label, purchase_cost, pricing_mode, fixed_selling_price) VALUES ($1, '500 g', 80, 'FIXED', 120) RETURNING id`, [productId])
    ).rows[0].id as string;
    variantIds.push(variant);
    const res = await putStock(s, productId, { quantity: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_HAS_VARIANTS');
    expect(res.body.error.message).toBe("Ask Blynk to update this product's sizes.");
    expect(await ledger(productId)).toEqual([]);
    expect((await myProducts(s)).find((p) => p.id === productId)).toMatchObject({ has_variants: true });
  });

  it('a restock from sold out releases the back-in-stock alerts, like any restock', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s, `Alert jam ${fx.stamp}`);
    await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [
      users.customer.id,
      customerDevice,
    ]);
    await pool.query('INSERT INTO stock_alerts (user_id, product_id) VALUES ($1, $2)', [users.customer.id, productId]);
    expect((await putStock(s, productId, { quantity: 6 })).status).toBe(200);
    const alerts = (
      await pool.query(`SELECT payload FROM notifications WHERE notification_type = 'PUSH_BACK_IN_STOCK' AND user_id = $1 AND created_at >= $2`, [
        users.customer.id,
        fx.testStart,
      ])
    ).rows;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload).toMatchObject({ title: `Back in stock: Alert jam ${fx.stamp}`, data: { type: 'product', product_id: productId } });
    // out of the shared outbox at once, so other files' worker batches never meet it
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_BACK_IN_STOCK' AND user_id = $1 AND created_at >= $2`, [users.customer.id, fx.testStart]);
  });

  it('two saves at once leave one consistent count and a ledger that explains it', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    await pool.query('DELETE FROM inventory WHERE product_id = $1', [productId]); // even the first save races
    const results = await Promise.all([putStock(s, productId, { quantity: 7 }), putStock(s, productId, { quantity: 3 })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const row = (await inventoryRow(productId))!;
    const rows = await ledger(productId);
    expect([3, 7]).toContain(row.quantity_on_hand);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.at(-1)!.new_quantity).toBe(row.quantity_on_hand);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].previous_quantity).toBe(rows[i - 1].new_quantity);
  });
});

describe('GET /seller/products: stock fields', () => {
  it('carries stock_on_hand, stock_reserved and stock_tracked (and has_variants); proposals have no stock', async () => {
    const s = await fx.seller();
    const productId = await liveProduct(s);
    await putStock(s, productId, { quantity: 9 });
    await pool.query('UPDATE inventory SET quantity_reserved = 2 WHERE product_id = $1', [productId]);
    const proposal = await fx.submission(s.id, { name: `Proposal ${fx.stamp}` });

    let list = await myProducts(s);
    expect(list.find((p) => p.id === productId)).toMatchObject({ stock_on_hand: 9, stock_reserved: 2, stock_tracked: true, has_variants: false });
    expect(list.find((p) => p.id === `submission:${proposal}`)).toMatchObject({ stock_on_hand: null, stock_reserved: null, stock_tracked: false });

    await pool.query(`UPDATE inventory SET tracking_mode = 'UNTRACKED' WHERE product_id = $1`, [productId]);
    list = await myProducts(s);
    expect(list.find((p) => p.id === productId)).toMatchObject({ stock_on_hand: null, stock_reserved: null, stock_tracked: false });

    await pool.query('DELETE FROM inventory WHERE product_id = $1', [productId]);
    list = await myProducts(s);
    expect(list.find((p) => p.id === productId)).toMatchObject({ stock_on_hand: null, stock_reserved: null, stock_tracked: true });
  });
});

describe('Seller devices for push (POST / DELETE /me/devices)', () => {
  it('a SELLER can register a web token and remove it; the next notification reaches it', async () => {
    const s = await fx.seller();
    const token = `seller-web-token-${fx.stamp}-${'x'.repeat(120)}`;
    const registered = await request(app).post('/api/v1/me/devices').set(auth(s.token)).send({ token, platform: 'web' });
    expect(registered.status, JSON.stringify(registered.body)).toBe(200);
    expect(registered.body.data.device.platform).toBe('web');
    expect((await pool.query('SELECT user_id, platform FROM device_tokens WHERE token = $1', [token])).rows).toEqual([{ user_id: s.userId, platform: 'web' }]);

    // staff approve a submission: the seller's device is the target of the push row
    const sub = await fx.submission(s.id, { name: `Device test ${fx.stamp}` });
    expect((await request(app).post(`${A}/seller-submissions/${sub}/approve`).set(auth(tokens.admin)).send({ selling_price: 150 })).status).toBe(200);
    expect((await fx.pushes(s.userId)).map((p) => p.payload.data.type)).toEqual(['SELLER_PRODUCT_APPROVED']);

    const removed = await request(app).delete(`/api/v1/me/devices/${encodeURIComponent(token)}`).set(auth(s.token));
    expect(removed.status).toBe(200);
    expect(removed.body.data.removed).toBe(true);
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE token = $1', [token])).rowCount).toBe(0);

    // without a device nothing more is queued
    const sub2 = await fx.submission(s.id, { name: `Device test two ${fx.stamp}` });
    expect((await request(app).post(`${A}/seller-submissions/${sub2}/approve`).set(auth(tokens.admin)).send({ selling_price: 150 })).status).toBe(200);
    expect(await fx.pushes(s.userId)).toHaveLength(1);
    expect(await fx.smsRows(s.userId)).toEqual([]);
  });

  it("a seller cannot remove someone else's device token", async () => {
    const a = await fx.seller();
    const b = await fx.seller();
    const token = `seller-web-token-owned-${fx.stamp}`;
    expect((await request(app).post('/api/v1/me/devices').set(auth(a.token)).send({ token, platform: 'web' })).status).toBe(200);
    const res = await request(app).delete(`/api/v1/me/devices/${token}`).set(auth(b.token));
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(false);
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE token = $1', [token])).rowCount).toBe(1);
  });
});

describe('The sign-in code is still an SMS', () => {
  it('requesting a code texts the seller (the only SMS a seller gets), and the code signs them in', async () => {
    const s = await fx.seller();
    await fx.withDevice(s.userId); // a device does not replace the code
    const send = vi.spyOn(SmsProvider.prototype, 'send');
    try {
      authRateLimiter.reset();
      const asked = await request(app).post('/api/v1/auth/otp/request').send({ phone: s.phone });
      expect(asked.status, JSON.stringify(asked.body)).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
      const call = send.mock.calls[0]![0];
      expect(call.recipient).toBe(s.phone);
      expect(call.message).toContain(asked.body.data.dev_otp);

      const verified = await request(app).post('/api/v1/auth/otp/verify').send({ phone: s.phone, otp: asked.body.data.dev_otp, app: 'seller' });
      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      expect(verified.body.data.user).toMatchObject({ id: s.userId, role: 'SELLER' });
    } finally {
      send.mockRestore();
      authRateLimiter.reset();
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [s.userId]);
      await pool.query('DELETE FROM otp_verifications WHERE phone = $1', [s.phone]);
    }
  });
});
