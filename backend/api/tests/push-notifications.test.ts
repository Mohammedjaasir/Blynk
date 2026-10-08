import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import {
  bestEffort,
  classifyFcmError,
  enqueueOrderStatusPush,
  notificationService,
  orderStatusPush,
  parseServiceAccount,
  setPushSenderForTests,
  type ClaimedNotificationJob,
  type PushMessage,
  type PushSender,
  type PushTokenOutcome,
} from '../src/modules/notifications/index.js';
import { lockInventoryRow, recordStockMovement } from '../src/modules/inventory/stock-ledger.js';
import type { OrderStatus } from '../src/database/types.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Phase 6: app push notifications (FCM), migration 022.
 *
 * Google is never called: a fake PushSender is injected through
 * setPushSenderForTests, and `null` stands for "no Firebase key configured".
 * Everything created here - throwaway customers (their device tokens, stock
 * alerts, orders and outbox rows), the test products and their inventory -
 * is removed in afterAll.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c00006', phoneBase: '+9470996', name: 'Push Test Customer' });
const SKU_PREFIX = 'TST-PUSH-';
const STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
const MILK = 'b0000001-0000-0000-0000-000000000001'; // seeded, UNTRACKED
const admin = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' });
const staff = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

class FakeSender implements PushSender {
  calls: { tokens: string[]; message: PushMessage }[] = [];
  /** Per-token outcome; tokens not listed are delivered. */
  outcome: Record<string, Exclude<PushTokenOutcome, { ok: true }>['error']> = {};
  throws = false;
  async send(tokens: string[], message: PushMessage): Promise<PushTokenOutcome[]> {
    this.calls.push({ tokens: [...tokens], message });
    if (this.throws) throw new Error('network down');
    return tokens.map((token) =>
      this.outcome[token] ? { token, ok: false, error: this.outcome[token]! } : { token, ok: true, messageId: `m-${token}` }
    );
  }
}

let fake = new FakeSender();
const products: string[] = [];
let categoryId = '';

async function purgeProducts() {
  const ids = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${SKU_PREFIX}%`])).rows.map((r) => r.id as string);
  if (!ids.length) return;
  await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [ids]); // ledger cascades
  await pool.query('DELETE FROM products WHERE id = ANY($1)', [ids]); // stock alerts cascade
}

async function product({ available = false } = {}) {
  const sku = `${SKU_PREFIX}${products.length + 1}-${Date.now()}`;
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(admin))
    .send({ category_id: categoryId, name: `Push Test Mango ${sku}`, sku, unit: '1 pc', purchase_cost: 100, is_available: available, is_active: true });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.data.product.id as string;
  products.push(id);
  return { id, name: res.body.data.product.name as string };
}

const registerDevice = (token: string, deviceToken: string, platform = 'android') =>
  request(app).post('/api/v1/me/devices').set(auth(token)).send({ token: deviceToken, platform });
const pushRows = async (userId: string) =>
  (
    await pool.query(
      `SELECT id, notification_type, recipient, payload, status, order_id FROM notifications
        WHERE user_id = $1 AND channel = 'PUSH' ORDER BY created_at, id`,
      [userId]
    )
  ).rows as { id: string; notification_type: string; recipient: string; payload: any; status: string; order_id: string | null }[];
const alertRow = async (userId: string, productId: string) =>
  (await pool.query('SELECT notified_at FROM stock_alerts WHERE user_id = $1 AND product_id = $2', [userId, productId])).rows[0] as
    | { notified_at: Date | null }
    | undefined;
const setAvailable = (productId: string, is_available: boolean) =>
  request(app).patch(`/api/v1/admin/products/${productId}`).set(auth(admin)).send({ is_available });

/** Sends one queued PUSH row the way the worker does, without claiming anyone else's. */
async function dispatch(notificationId: string) {
  const row = (await pool.query('SELECT * FROM notifications WHERE id = $1', [notificationId])).rows[0];
  await pool.query(`UPDATE notifications SET status = 'PROCESSING', attempts = attempts + 1 WHERE id = $1`, [notificationId]);
  const job: ClaimedNotificationJob = { ...row, attempts: row.attempts + 1 };
  return await notificationService.dispatchJob(job);
}

beforeAll(async () => {
  await people.purge();
  await purgeProducts();
  categoryId = (await pool.query('SELECT id FROM categories WHERE is_active = true AND deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0].id;
});

afterEach(() => {
  fake = new FakeSender();
  setPushSenderForTests(undefined);
});

afterAll(async () => {
  setPushSenderForTests(undefined);
  await people.cleanup();
  await purgeProducts();
});

// ============================================================================
describe('Firebase credential (FIREBASE_SERVICE_ACCOUNT_JSON)', () => {
  const key = { type: 'service_account', project_id: 'blynk-test', client_email: 'push@blynk-test.iam.gserviceaccount.com', private_key: 'k' };

  it('accepts the raw JSON', () => {
    expect(parseServiceAccount(JSON.stringify(key))).toEqual({ project_id: 'blynk-test', client_email: key.client_email, private_key: 'k' });
  });

  it('accepts base64 of the JSON', () => {
    expect(parseServiceAccount(Buffer.from(JSON.stringify(key)).toString('base64'))?.project_id).toBe('blynk-test');
  });

  it('is disabled (null) when unset or blank', () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('   ')).toBeNull();
  });

  it('rejects something that is not a service-account key', () => {
    expect(() => parseServiceAccount('not json at all')).toThrow(/neither JSON nor base64/);
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow(/missing/);
  });

  it('classifies FCM errors: dead tokens, transient failures, the rest', () => {
    expect(classifyFcmError('messaging/registration-token-not-registered')).toBe('UNREGISTERED');
    expect(classifyFcmError('messaging/invalid-registration-token')).toBe('INVALID');
    expect(classifyFcmError('messaging/invalid-argument', 'The registration token is not a valid FCM registration token')).toBe('INVALID');
    expect(classifyFcmError('messaging/invalid-argument', 'Bad payload')).toBe('OTHER');
    expect(classifyFcmError('messaging/server-unavailable')).toBe('TRANSIENT');
    expect(classifyFcmError('messaging/mismatched-credential')).toBe('OTHER');
  });
});

// ============================================================================
describe('Device tokens: POST /me/devices, DELETE /me/devices/:token', () => {
  it('registers a token, and re-registering refreshes it (one row)', async () => {
    const c = await people.customer(1);
    const first = await registerDevice(c.token, 'tok-dev-1');
    expect(first.status).toBe(200);
    expect(first.body.data.device.platform).toBe('android');
    const again = await registerDevice(c.token, 'tok-dev-1', 'ios');
    expect(again.status).toBe(200);
    const rows = (await pool.query('SELECT user_id, platform, created_at, last_seen_at FROM device_tokens WHERE token = $1', ['tok-dev-1'])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: c.id, platform: 'ios' });
    expect(rows[0].last_seen_at.getTime()).toBeGreaterThanOrEqual(rows[0].created_at.getTime());
  });

  it('moves a token to whoever registers it last (shared phone, new account)', async () => {
    const a = await people.customer(2);
    const b = await people.customer(3);
    await registerDevice(a.token, 'tok-shared');
    await registerDevice(b.token, 'tok-shared');
    const rows = (await pool.query('SELECT user_id FROM device_tokens WHERE token = $1', ['tok-shared'])).rows;
    expect(rows).toEqual([{ user_id: b.id }]);
  });

  it('any signed-in role can register (staff apps too)', async () => {
    const res = await registerDevice(staff, 'tok-staff-1');
    expect(res.status).toBe(200);
    expect((await request(app).delete('/api/v1/me/devices/tok-staff-1').set(auth(staff))).body.data.removed).toBe(true);
  });

  it('rejects a bad body with 400 and no token with 401', async () => {
    const c = await people.customer(1);
    expect((await registerDevice(c.token, '', 'android')).status).toBe(400);
    expect((await registerDevice(c.token, 'tok-x', 'windows')).status).toBe(400);
    expect((await request(app).post('/api/v1/me/devices').send({ token: 'x', platform: 'android' })).status).toBe(401);
  });

  it('logout deletes only the caller’s own token', async () => {
    const a = await people.customer(4);
    const b = await people.customer(5);
    await registerDevice(a.token, 'tok-a-logout');
    // Someone else cannot remove it.
    const other = await request(app).delete('/api/v1/me/devices/tok-a-logout').set(auth(b.token));
    expect(other.status).toBe(200);
    expect(other.body.data.removed).toBe(false);
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE token = $1', ['tok-a-logout'])).rowCount).toBe(1);
    const own = await request(app).delete('/api/v1/me/devices/tok-a-logout').set(auth(a.token));
    expect(own.body.data.removed).toBe(true);
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE token = $1', ['tok-a-logout'])).rowCount).toBe(0);
  });

  it('a token with URL-reserved characters round-trips through DELETE', async () => {
    const c = await people.customer(6);
    const token = 'fcm:APA91b-x_y/z+1';
    await registerDevice(c.token, token);
    const res = await request(app).delete(`/api/v1/me/devices/${encodeURIComponent(token)}`).set(auth(c.token));
    expect(res.body.data.removed).toBe(true);
  });
});

// ============================================================================
describe('Order status pushes', () => {
  const cases: [OrderStatus, string, string][] = [
    ['PACKED', 'Your order is packed', 'Order BL-TEST is packed and waiting for a rider.'],
    ['OUT_FOR_DELIVERY', 'On the way', 'Your rider is bringing order BL-TEST. Your delivery code is in the app.'],
    ['DELIVERED', 'Delivered', 'Order BL-TEST was delivered. Enjoy!'],
    ['CANCELLED', 'Order cancelled', 'Order BL-TEST was cancelled.'],
    ['FAILED', "We couldn't deliver", "We couldn't deliver order BL-TEST. We'll contact you."],
    ['CUSTOMER_UNAVAILABLE', "We couldn't deliver", "We couldn't deliver order BL-TEST. We'll contact you."],
  ];

  it.each(cases)('%s reads "%s"', (status, title, body) => {
    expect(orderStatusPush(status, 'BL-TEST')).toEqual({ title, body });
  });

  it('PLACED and ITEM_UNAVAILABLE send no push', () => {
    expect(orderStatusPush('PLACED', 'BL-TEST')).toBeNull();
    expect(orderStatusPush('ITEM_UNAVAILABLE', 'BL-TEST')).toBeNull();
  });

  it.each(cases)('queues a %s push for the customer in the transition’s transaction', async (status, title) => {
    setPushSenderForTests(fake);
    const c = await people.customer(10);
    await registerDevice(c.token, 'tok-order-10');
    const order = await expectCreated(await c.placeOrder([{ product_id: MILK, quantity: 1 }]));
    const row = (await pool.query('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0];

    // Queued inside a transaction that is then rolled back: the row exists
    // only with the transition, and leaves nothing behind.
    const seen = await db
      .transaction()
      .execute(async (trx) => {
        await enqueueOrderStatusPush(trx, row, 'PLACED', status);
        const q = await trx.selectFrom('notifications').selectAll().where('order_id', '=', order.id).where('channel', '=', 'PUSH').execute();
        throw Object.assign(new Error('rollback'), { q });
      })
      .catch((e: { q: any[] }) => e.q);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ notification_type: 'PUSH_ORDER_STATUS', recipient: c.id, user_id: c.id, status: 'QUEUED' });
    expect(seen[0].payload).toMatchObject({ title, data: { type: 'order', order_id: order.id } });
    expect(await pushRows(c.id)).toEqual([]);
  });

  it('a real transition (PLACED -> PACKED, then cancel) queues one push each, never with the delivery code', async () => {
    setPushSenderForTests(fake);
    const c = await people.customer(11);
    await registerDevice(c.token, 'tok-order-11');
    const order = await expectCreated(await c.placeOrder([{ product_id: MILK, quantity: 1 }]));
    expect(await pushRows(c.id)).toEqual([]); // PLACED: the SMS covers it

    const packed = await request(app).patch(`/api/v1/admin/orders/${order.id}/status`).set(auth(staff)).send({ status: 'PACKED' });
    expect(packed.status, JSON.stringify(packed.body)).toBe(200);
    const cancel = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(auth(admin))
      .send({ status: 'CANCELLED', notes: 'Push test cancel' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);

    const rows = await pushRows(c.id);
    expect(rows.map((r) => r.payload.title)).toEqual(['Your order is packed', 'Order cancelled']);
    expect(rows.every((r) => r.order_id === order.id)).toBe(true);
    expect(rows[0].payload.body).toBe(`Order ${order.order_number} is packed and waiting for a rider.`);
    const code = (await pool.query('SELECT * FROM order_delivery_codes WHERE order_id = $1', [order.id])).rows[0];
    for (const r of rows) {
      for (const v of Object.values(code ?? {})) {
        if (typeof v === 'string' && /^\d{4,6}$/.test(v)) expect(JSON.stringify(r.payload)).not.toContain(v);
      }
    }

    // The worker sends it to the customer's device with the order data.
    expect((await dispatch(rows[0].id)).success).toBe(true);
    expect(fake.calls).toEqual([
      {
        tokens: ['tok-order-11'],
        message: { title: 'Your order is packed', body: rows[0].payload.body, data: { type: 'order', order_id: order.id } },
      },
    ]);
    expect((await pool.query('SELECT status FROM notifications WHERE id = $1', [rows[0].id])).rows[0].status).toBe('SENT');
  });

  it('queues nothing when push is not configured', async () => {
    setPushSenderForTests(null);
    const c = await people.customer(12);
    await registerDevice(c.token, 'tok-order-12');
    const order = await expectCreated(await c.placeOrder([{ product_id: MILK, quantity: 1 }]));
    const res = await request(app).patch(`/api/v1/admin/orders/${order.id}/status`).set(auth(staff)).send({ status: 'PACKED' });
    expect(res.status).toBe(200);
    expect(await pushRows(c.id)).toEqual([]);
  });

  it('queues nothing for a customer with no registered device', async () => {
    setPushSenderForTests(fake);
    const c = await people.customer(13);
    const order = await expectCreated(await c.placeOrder([{ product_id: MILK, quantity: 1 }]));
    const res = await request(app).patch(`/api/v1/admin/orders/${order.id}/status`).set(auth(staff)).send({ status: 'PACKED' });
    expect(res.status).toBe(200);
    expect(await pushRows(c.id)).toEqual([]);
  });

  it('a failing push step is rolled back to its savepoint and the transaction carries on', async () => {
    const errors: unknown[] = [];
    const after = await db.transaction().execute(async (trx) => {
      await bestEffort(
        trx,
        async () => {
          await trx.insertInto('notifications').values({ channel: 'PUSH', notification_type: 'X', recipient: 'x', payload: {}, status: 'BOGUS' as any }).execute();
        },
        (err) => errors.push(err)
      );
      return (await trx.selectFrom('orders').select('id').limit(1).execute()).length;
    });
    expect(errors).toHaveLength(1);
    expect(after).toBe(1);
  });
});

// ============================================================================
describe('Sending: disabled, dead tokens, transient failures', () => {
  async function queued(n: number, tokens: string[]) {
    setPushSenderForTests(fake);
    const c = await people.customer(n);
    for (const t of tokens) await registerDevice(c.token, t);
    const order = await expectCreated(await c.placeOrder([{ product_id: MILK, quantity: 1 }]));
    await request(app).patch(`/api/v1/admin/orders/${order.id}/status`).set(auth(staff)).send({ status: 'PACKED' });
    const [row] = await pushRows(c.id);
    expect(row).toBeDefined();
    return { c, row: row! };
  }

  it('removes tokens FCM reports as unregistered or invalid, keeps the rest', async () => {
    const { c, row } = await queued(20, ['tok-gone', 'tok-bad', 'tok-good']);
    fake.outcome = { 'tok-gone': 'UNREGISTERED', 'tok-bad': 'INVALID' };
    expect((await dispatch(row.id)).success).toBe(true);
    const left = (await pool.query('SELECT token FROM device_tokens WHERE user_id = $1 ORDER BY token', [c.id])).rows.map((r) => r.token);
    expect(left).toEqual(['tok-good']);
  });

  it('when every token is dead, removes them all and closes the message (nothing left to send to)', async () => {
    const { c, row } = await queued(21, ['tok-dead-1', 'tok-dead-2']);
    fake.outcome = { 'tok-dead-1': 'UNREGISTERED', 'tok-dead-2': 'UNREGISTERED' };
    await dispatch(row.id);
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE user_id = $1', [c.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT status FROM notifications WHERE id = $1', [row.id])).rows[0].status).toBe('SENT');
  });

  it('retries a transient failure and keeps the token', async () => {
    const { c, row } = await queued(22, ['tok-flaky']);
    fake.outcome = { 'tok-flaky': 'TRANSIENT' };
    expect((await dispatch(row.id)).success).toBe(false);
    expect((await pool.query('SELECT status FROM notifications WHERE id = $1', [row.id])).rows[0].status).toBe('QUEUED');
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE user_id = $1', [c.id])).rowCount).toBe(1);
    // An FCM outage (the call itself throws) is retried too.
    fake.outcome = {};
    fake.throws = true;
    expect((await dispatch(row.id)).success).toBe(false);
    await pool.query(`UPDATE notifications SET status = 'FAILED' WHERE id = $1`, [row.id]); // not left queued
  });

  it('is a no-op that counts as sent when push is disabled', async () => {
    const { row } = await queued(23, ['tok-off']);
    setPushSenderForTests(null);
    expect((await dispatch(row.id)).success).toBe(true);
    expect(fake.calls).toEqual([]);
    const sent = (await pool.query('SELECT status, provider_message_id FROM notifications WHERE id = $1', [row.id])).rows[0];
    expect(sent).toEqual({ status: 'SENT', provider_message_id: 'push-disabled' });
  });
});

// ============================================================================
describe('Back in stock: /catalog/products/:id/notify-me', () => {
  const notifyMe = (token: string, productId: string, method: 'post' | 'delete' = 'post') =>
    request(app)[method](`/api/v1/catalog/products/${productId}/notify-me`).set(auth(token));

  it('subscribes and unsubscribes; product detail reports notify_me_subscribed', async () => {
    const c = await people.customer(30);
    const p = await product();
    const sub = await notifyMe(c.token, p.id);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.data.notify_me_subscribed).toBe(true);

    const detail = await request(app).get(`/api/v1/catalog/products/${p.id}`).set(auth(c.token));
    expect(detail.body.data.product).toMatchObject({ is_available: false, notify_me_subscribed: true });
    const anonymous = await request(app).get(`/api/v1/products/${p.id}`);
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data.product.notify_me_subscribed).toBe(false);
    // A bad token on a public read is treated as signed out, not a 401.
    expect((await request(app).get(`/api/v1/products/${p.id}`).set(auth('nonsense'))).status).toBe(200);

    const unsub = await notifyMe(c.token, p.id, 'delete');
    expect(unsub.body.data.notify_me_subscribed).toBe(false);
    expect((await request(app).get(`/api/v1/products/${p.id}`).set(auth(c.token))).body.data.product.notify_me_subscribed).toBe(false);
  });

  it('refuses an available product (409), an unknown one (404), anonymous (401) and staff (403)', async () => {
    const c = await people.customer(31);
    const available = await product({ available: true });
    expect((await notifyMe(c.token, available.id)).body.error.code).toBe('PRODUCT_AVAILABLE');
    expect((await notifyMe(c.token, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await request(app).post(`/api/v1/catalog/products/${available.id}/notify-me`)).status).toBe(401);
    expect((await notifyMe(staff, available.id)).status).toBe(403);
  });

  it('fires once per subscriber when an admin switches the product back on', async () => {
    setPushSenderForTests(fake);
    const a = await people.customer(32);
    const b = await people.customer(33);
    const noDevice = await people.customer(34);
    await registerDevice(a.token, 'tok-stock-a');
    await registerDevice(b.token, 'tok-stock-b');
    const p = await product();
    for (const c of [a, b, noDevice]) expect((await notifyMe(c.token, p.id)).status).toBe(200);

    expect((await setAvailable(p.id, true)).status).toBe(200);
    for (const c of [a, b]) {
      const rows = await pushRows(c.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ notification_type: 'PUSH_BACK_IN_STOCK', order_id: null });
      expect(rows[0].payload).toEqual({
        title: `Back in stock: ${p.name}`,
        body: expect.any(String),
        data: { type: 'product', product_id: p.id },
      });
      expect((await alertRow(c.id, p.id))?.notified_at).toBeInstanceOf(Date);
    }
    // No device: nothing to send, but the alert is spent all the same.
    expect(await pushRows(noDevice.id)).toEqual([]);
    expect((await alertRow(noDevice.id, p.id))?.notified_at).toBeInstanceOf(Date);
    const detail = await request(app).get(`/api/v1/products/${p.id}`).set(auth(a.token));
    expect(detail.body.data.product.notify_me_subscribed).toBe(false);

    // Sold out and back again: the spent alerts do not fire a second time.
    await setAvailable(p.id, false);
    await setAvailable(p.id, true);
    expect(await pushRows(a.id)).toHaveLength(1);
    expect(await pushRows(b.id)).toHaveLength(1);

    // Asking again re-arms it for the next return.
    await setAvailable(p.id, false);
    expect((await notifyMe(a.token, p.id)).status).toBe(200);
    await setAvailable(p.id, true);
    expect(await pushRows(a.id)).toHaveLength(2);
    expect(await pushRows(b.id)).toHaveLength(1);

    // The worker sends it with the product data.
    const [first] = await pushRows(b.id);
    await dispatch(first!.id);
    expect(fake.calls.at(-1)).toEqual({
      tokens: ['tok-stock-b'],
      message: { title: `Back in stock: ${p.name}`, body: expect.any(String), data: { type: 'product', product_id: p.id } },
    });
  });

  it('re-activating a hidden product releases its alerts too', async () => {
    setPushSenderForTests(fake);
    const c = await people.customer(35);
    await registerDevice(c.token, 'tok-stock-35');
    const p = await product();
    await notifyMe(c.token, p.id);
    await request(app).patch(`/api/v1/admin/products/${p.id}`).set(auth(admin)).send({ is_active: false, is_available: true });
    expect(await pushRows(c.id)).toEqual([]); // hidden is not available
    await request(app).patch(`/api/v1/admin/products/${p.id}`).set(auth(admin)).send({ is_active: true });
    expect(await pushRows(c.id)).toHaveLength(1);
  });

  it('with push not configured, nothing is queued and the alert stays pending', async () => {
    setPushSenderForTests(null);
    const c = await people.customer(36);
    await registerDevice(c.token, 'tok-stock-36');
    const p = await product();
    await notifyMe(c.token, p.id);
    await setAvailable(p.id, true);
    expect(await pushRows(c.id)).toEqual([]);
    expect((await alertRow(c.id, p.id))?.notified_at).toBeNull();
  });

  it('tracked stock going from none to some releases pending alerts (through the canonical stock writer)', async () => {
    setPushSenderForTests(fake);
    const c = await people.customer(37);
    await registerDevice(c.token, 'tok-stock-37');
    const p = await product({ available: true });
    expect((await request(app).patch(`/api/v1/admin/inventory/${p.id}/mode`).set(auth(admin)).send({ tracking_mode: 'TRACKED' })).status).toBe(200);
    // Pending from before the product was switched on while push was off.
    await pool.query('INSERT INTO stock_alerts (user_id, product_id) VALUES ($1, $2)', [c.id, p.id]);

    const adjust = (delta: number) =>
      request(app)
        .post(`/api/v1/admin/inventory/${p.id}/adjust`)
        .set(auth(admin))
        .send({ adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: delta, notes: 'Push test restock' });
    expect((await adjust(5)).status).toBe(200);
    expect(await pushRows(c.id)).toHaveLength(1);
    expect((await alertRow(c.id, p.id))?.notified_at).toBeInstanceOf(Date);

    // More stock on top of some is not "back": nothing new.
    await pool.query('UPDATE stock_alerts SET notified_at = NULL WHERE user_id = $1', [c.id]);
    await db.transaction().execute(async (trx) => {
      const inv = await lockInventoryRow(trx, STORE, p.id);
      await recordStockMovement(trx, { inventory: inv!, delta: 2, type: 'PURCHASE_RESTOCK', orderId: null, actorId: null, notes: 'more' });
    });
    expect(await pushRows(c.id)).toHaveLength(1);
  });

  it('a web push (PWA) shows the Blynk icon and opens the web app (2026-10-08)', async () => {
    const { webPushIcon } = await import('../src/modules/notifications/push/push.sender.js');
    const { env } = await import('../src/config/env.js');
    expect(env.WEB_APP_URL).toMatch(/^https?:\/\//);
    expect(webPushIcon()).toBe(new URL('/assets/icon-192.png', env.WEB_APP_URL).toString());
  });
});
