import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { runTransition } from '../src/modules/orders/lifecycle/engine.js';
import { ACTION_NAMES, CATALOGUE } from '../src/modules/orders/lifecycle/catalogue.js';
import { enqueueOrderReadyPush, sellerNewOrderBody, shortOrderNumber } from '../src/modules/notifications/push/seller-order.events.js';
import { db } from '../src/database/connection.js';
import { auth, RIDER_A, stockFixtures, tokens, users, type PlacedOrder, type Tracked } from './helpers/stock.js';
import { bearer, sellerFixtures } from './helpers/seller.js';

/**
 * Seller orders, the "Order is ready" button, the seller / rider / staff pushes and the pickup
 * details (seller portal, 2026-10-30; seller.orders.ts). "Ready" is the lifecycle's PACK run by the
 * seller's user, so the history, the stock ledger and the customer's push are the engine's.
 * Real local Postgres; everything made here is removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'SELORD-');
const sf = sellerFixtures(app, '+947700133');
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const DEVICES = {
  sellerA: `seller-orders-a-${Date.now()}`,
  sellerB: `seller-orders-b-${Date.now()}`,
  admin: `seller-orders-admin-${Date.now()}`,
  customer: `seller-orders-customer-${Date.now()}`,
  rider: `seller-orders-rider-${Date.now()}`,
};
const CUSTOMER_PHONE = users.customer.phone;

let A: Awaited<ReturnType<typeof sf.makeSeller>>;
let B: Awaited<ReturnType<typeof sf.makeSeller>>;
let pending: Awaited<ReturnType<typeof sf.makeSeller>>;
let suspended: Awaited<ReturnType<typeof sf.makeSeller>>;
let jam: Tracked; // seller A, tracked, 120
let tea: Tracked; // seller A, untracked, 80
let foreign: Tracked; // seller B, 50
let own: Tracked; // Blynk's own
const SHOP_A = 'Orders Shop A';

const list = (token: string, qs = '') => request(app).get(`/api/v1/seller/orders${qs}`).set(bearer(token));
const ready = (token: string, id: string) => request(app).post(`/api/v1/seller/orders/${id}/ready`).set(bearer(token));
const sellerPushes = (orderId: string, userId: string) =>
  pool
    .query(`SELECT payload FROM notifications WHERE order_id = $1 AND recipient = $2 AND notification_type = 'PUSH_SELLER' ORDER BY created_at`, [orderId, userId])
    .then((r) => r.rows.map((x) => x.payload));
const pushRows = (orderId: string, type: string) =>
  pool.query(`SELECT recipient, payload FROM notifications WHERE order_id = $1 AND notification_type = $2`, [orderId, type]).then((r) => r.rows);
const clearPushes = () =>
  pool.query(`DELETE FROM notifications WHERE channel = 'PUSH' AND (order_id = ANY($1) OR recipient = ANY($2::text[]))`, [
    fx.created.orders,
    [A?.userId, B?.userId].filter(Boolean),
  ]);
const statusOf = async (id: string) => (await pool.query('SELECT order_status FROM orders WHERE id = $1', [id])).rows[0].order_status as string;
const addressOf = async (id: string) => (await pool.query('SELECT dark_store_id FROM orders WHERE id = $1', [id])).rows[0];

async function device(userId: string, token: string) {
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [userId, token]);
}

beforeAll(async () => {
  await sf.purge();
  await fx.setup();
  A = await sf.makeSeller(1, 'APPROVED', SHOP_A);
  B = await sf.makeSeller(2, 'APPROVED', 'Orders Shop B');
  pending = await sf.makeSeller(3, 'PENDING', 'Orders Shop Pending');
  suspended = await sf.makeSeller(4, 'SUSPENDED', 'Orders Shop Suspended');
  jam = await fx.product({ onHand: 30 });
  tea = await fx.product({ tracked: false });
  foreign = await fx.product({ tracked: false });
  own = await fx.product({ tracked: false });
  await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 120 WHERE id = $1', [jam.productId, A.sellerId]);
  await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 80 WHERE id = $1', [tea.productId, A.sellerId]);
  await pool.query('UPDATE products SET seller_id = $2, purchase_cost = 50 WHERE id = $1', [foreign.productId, B.sellerId]);
  // Shop A: an approved pin, an address and a how-to-find note (the pickup details the rider sees).
  await pool.query(
    `UPDATE sellers SET address = 'No. 5, Main Street, Dharga Town', latitude = 6.4400, longitude = 80.0300,
            location_note = 'Next to the bank', location_status = 'APPROVED' WHERE id = $1`,
    [A.sellerId]
  );
  await device(A.userId, DEVICES.sellerA);
  await device(B.userId, DEVICES.sellerB);
  await device(users.admin.id, DEVICES.admin);
  await device(users.customer.id, DEVICES.customer);
  await device(users.rider.id, DEVICES.rider);
  await clearPushes();
}, 60_000);

afterEach(async () => {
  setPushSenderForTests(undefined);
  await clearPushes();
});

afterAll(async () => {
  await clearPushes();
  await pool.query('DELETE FROM device_tokens WHERE token = ANY($1)', [Object.values(DEVICES)]);
  await fx.cleanup();
  await sf.cleanup();
});

describe('who may use the seller orders routes', () => {
  it('needs a seller account, and an approved shop', async () => {
    expect((await request(app).get('/api/v1/seller/orders')).status).toBe(401);
    for (const token of [tokens.customer, tokens.rider, tokens.admin, tokens.staff]) {
      expect((await list(token)).status).toBe(403);
      expect((await ready(token, '11111111-1111-1111-1111-111111111111')).status).toBe(403);
    }
    for (const s of [pending, suspended]) {
      const res = await list(s.token);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELLER_NOT_APPROVED');
      const r = await ready(s.token, '11111111-1111-1111-1111-111111111111');
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('SELLER_NOT_APPROVED');
    }
  });

  it('refuses a bad status filter and a bad id', async () => {
    expect((await list(A.token, '?status=SHIPPED')).status).toBe(400);
    expect((await ready(A.token, 'not-a-uuid')).status).toBe(400);
  });
});

describe('GET /seller/orders', () => {
  let order: PlacedOrder;

  beforeAll(async () => {
    order = await fx.placeOrder([
      { product_id: jam.productId, quantity: 2 },
      { product_id: tea.productId, quantity: 1 },
    ]);
  });

  it('lists the seller\'s own lines, with what they earn, and nothing about the customer', async () => {
    const res = await list(A.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const mine = res.body.data.orders.find((o: { id: string }) => o.id === order.id);
    expect(mine).toBeTruthy();
    expect(Object.keys(mine).sort()).toEqual(['can_mark_ready', 'id', 'items', 'order_number', 'placed_at', 'ready_at', 'seller_amount', 'status']);
    expect(mine).toMatchObject({ order_number: order.order_number, status: 'NEW', ready_at: null, can_mark_ready: true, seller_amount: 320 });
    expect(mine.items.map((i: { product_id: string; quantity: number }) => [i.product_id, i.quantity]).sort()).toEqual(
      [[jam.productId, 2], [tea.productId, 1]].sort()
    );
    expect(Object.keys(mine.items[0]).sort()).toEqual(['name', 'product_id', 'quantity']);
    expect(Date.parse(mine.placed_at)).not.toBeNaN();

    // No customer or order-total data anywhere in the JSON.
    const json = JSON.stringify(res.body);
    const customer = (await pool.query('SELECT full_name FROM users WHERE id = $1', [users.customer.id])).rows[0];
    for (const secret of [CUSTOMER_PHONE, 'Test Lane', users.customer.id, '"total', 'delivery', 'customer', 'address']) {
      expect(json.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    if (customer.full_name) expect(json).not.toContain(customer.full_name);
  });

  it('shows another seller only their own orders, newest first, and filters by status', async () => {
    expect((await list(B.token)).body.data.orders.some((o: { id: string }) => o.id === order.id)).toBe(false);
    const second = await fx.placeOrder([{ product_id: jam.productId, quantity: 1 }]);
    const orders = (await list(A.token)).body.data.orders as { id: string; placed_at: string }[];
    expect(orders.findIndex((o) => o.id === second.id)).toBeLessThan(orders.findIndex((o) => o.id === order.id));
    for (let i = 1; i < orders.length; i++) expect(Date.parse(orders[i - 1].placed_at)).toBeGreaterThanOrEqual(Date.parse(orders[i].placed_at));
    expect((await list(A.token, '?status=NEW')).body.data.orders.some((o: { id: string }) => o.id === order.id)).toBe(true);
    for (const status of ['READY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED']) {
      expect((await list(A.token, `?status=${status}`)).body.data.orders.some((o: { id: string }) => o.id === order.id), status).toBe(false);
    }
  });

  it('keeps every status group, does not list unpaid online orders and respects the 60 days', async () => {
    const o = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    // an unpaid online order (AWAITING_PAYMENT, never announced) is not listed
    const online = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    await pool.query(`UPDATE orders SET order_status = 'AWAITING_PAYMENT' WHERE id = $1`, [online.id]);
    await pool.query(`DELETE FROM order_status_history WHERE order_id = $1 AND new_status = 'PLACED'`, [online.id]);
    expect((await list(A.token)).body.data.orders.some((x: { id: string }) => x.id === online.id)).toBe(false);

    // an old order falls out of the list
    const old = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    await pool.query(`UPDATE orders SET placed_at = now() - interval '61 days' WHERE id = $1`, [old.id]);
    expect((await list(A.token)).body.data.orders.some((x: { id: string }) => x.id === old.id)).toBe(false);

    // each order status maps to its seller-facing group
    const map: [string, string][] = [
      ['PACKED', 'READY'],
      ['OUT_FOR_DELIVERY', 'ON_THE_WAY'],
      ['DELIVERED', 'DELIVERED'],
      ['CANCELLED', 'CANCELLED'],
      ['FAILED', 'CANCELLED'],
      ['CUSTOMER_UNAVAILABLE', 'CANCELLED'],
      ['ITEM_UNAVAILABLE', 'NEW'],
    ];
    for (const [dbStatus, shown] of map) {
      await pool.query('UPDATE orders SET order_status = $2 WHERE id = $1', [o.id, dbStatus]);
      const found = (await list(A.token, `?status=${shown}`)).body.data.orders.find((x: { id: string }) => x.id === o.id);
      expect(found, dbStatus).toBeTruthy();
      expect(found.status).toBe(shown);
      // only a PLACED order may be marked ready
      expect(found.can_mark_ready).toBe(false);
    }
  });

  it('a mixed order lists only the seller\'s lines and cannot be marked ready', async () => {
    const mixed = await fx.placeOrder([
      { product_id: jam.productId, quantity: 1 },
      { product_id: foreign.productId, quantity: 4 },
    ]);
    const seenByA = (await list(A.token)).body.data.orders.find((o: { id: string }) => o.id === mixed.id);
    expect(seenByA).toMatchObject({ can_mark_ready: false, seller_amount: 120 });
    expect(seenByA.items.map((i: { product_id: string }) => i.product_id)).toEqual([jam.productId]);
    const seenByB = (await list(B.token)).body.data.orders.find((o: { id: string }) => o.id === mixed.id);
    expect(seenByB).toMatchObject({ can_mark_ready: false, seller_amount: 200 });

    const refused = await ready(A.token, mixed.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SELLER_ORDER_MIXED');
    expect(await statusOf(mixed.id)).toBe('PLACED');

    // an order with one of Blynk's own products is mixed too
    const withOwn = await fx.placeOrder([
      { product_id: jam.productId, quantity: 1 },
      { product_id: own.productId, quantity: 1 },
    ]);
    expect((await ready(A.token, withOwn.id)).body.error.code).toBe('SELLER_ORDER_MIXED');
    expect((await list(A.token)).body.data.orders.find((o: { id: string }) => o.id === withOwn.id).can_mark_ready).toBe(false);
  });
});

describe('POST /seller/orders/:id/ready', () => {
  it('packs the order through the lifecycle: status, history, stock ledger, customer push', async () => {
    setPushSenderForTests(fake);
    const order = await fx.placeOrder([{ product_id: jam.productId, quantity: 2 }]);
    await clearPushes();
    const before = await fx.onHand(jam);

    const res = await ready(A.token, order.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: order.id, order_number: order.order_number, status: 'READY', can_mark_ready: false, seller_amount: 240 });
    expect(Date.parse(res.body.data.ready_at)).not.toBeNaN();
    expect(Object.keys(res.body.data).sort()).toEqual(['can_mark_ready', 'id', 'items', 'order_number', 'placed_at', 'ready_at', 'seller_amount', 'status']);
    expect(await statusOf(order.id)).toBe('PACKED');

    // history written by the engine, as the seller's user
    const history = (await pool.query('SELECT old_status, new_status, changed_by_user_id, reason_or_notes FROM order_status_history WHERE order_id = $1 ORDER BY created_at', [order.id])).rows;
    expect(history.map((h) => h.new_status)).toEqual(['PLACED', 'PACKED']);
    expect(history[1]).toMatchObject({ old_status: 'PLACED', changed_by_user_id: A.userId });
    expect(history[1].reason_or_notes).toContain(SHOP_A);
    expect((await pool.query('SELECT packed_at FROM orders WHERE id = $1', [order.id])).rows[0].packed_at).not.toBeNull();

    // the stock went through the ledger
    expect(await fx.onHand(jam)).toBe(before - 2);
    const ledger = await fx.ledgerForOrder(order.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ adjustment_type: 'ORDER_FULFILLMENT', quantity_delta: -2, created_by_user_id: A.userId });
    await fx.expectLedgerChain(jam);
    expect((await pool.query(`SELECT item_status FROM order_items WHERE order_id = $1`, [order.id])).rows.every((r) => r.item_status === 'PACKED')).toBe(true);

    // the customer hears "packed", as for staff packing
    const customerPush = await pushRows(order.id, 'PUSH_ORDER_STATUS');
    expect(customerPush).toHaveLength(1);
    expect(customerPush[0].payload).toMatchObject({ title: 'Your order is packed' });

    // listed as READY with its ready time
    const mine = (await list(A.token, '?status=READY')).body.data.orders.find((o: { id: string }) => o.id === order.id);
    expect(mine).toMatchObject({ status: 'READY', can_mark_ready: false });
    expect(mine.ready_at).not.toBeNull();

    // a second press, or any later state, is 409 ORDER_NOT_NEW
    const again = await ready(A.token, order.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ORDER_NOT_NEW');
    expect(await fx.onHand(jam)).toBe(before - 2);
  });

  it('refuses another seller\'s order and an unknown order with 404, and leaves the order alone', async () => {
    const order = await fx.placeOrder([{ product_id: jam.productId, quantity: 1 }]);
    const other = await ready(B.token, order.id);
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('ORDER_NOT_FOUND');
    expect((await ready(A.token, '99999999-9999-4999-8999-999999999999')).status).toBe(404);
    expect(await statusOf(order.id)).toBe('PLACED');
  });

  it('refuses an order that is not new (cancelled, packed by staff)', async () => {
    const cancelled = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    expect((await fx.customerCancel(cancelled.id)).status).toBe(200);
    const c = await ready(A.token, cancelled.id);
    expect([c.status, c.body.error.code]).toEqual([409, 'ORDER_NOT_NEW']);

    const staffPacked = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    expect((await fx.pack(staffPacked.id)).status).toBe(200);
    const s = await ready(A.token, staffPacked.id);
    expect([s.status, s.body.error.code]).toEqual([409, 'ORDER_NOT_NEW']);
  });

  it('shows the stock refusal as the engine gives it when the seller is short', async () => {
    const short = await fx.product({ onHand: 1 });
    await pool.query('UPDATE products SET seller_id = $2 WHERE id = $1', [short.productId, A.sellerId]);
    const order = await fx.placeOrder([{ product_id: short.productId, quantity: 1 }]);
    await pool.query('UPDATE inventory SET quantity_on_hand = 0, quantity_reserved = 0 WHERE id = $1', [short.inventoryId]);
    const res = await ready(A.token, order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_TRACKED_INVENTORY');
    expect(await statusOf(order.id)).toBe('PLACED');
  });

  it('is the only action a seller can run in the lifecycle, and only with their own shop', async () => {
    expect(ACTION_NAMES.filter((a) => CATALOGUE[a].sellerMayRun)).toEqual(['PACK']);
    expect(CATALOGUE.PACK.roles).not.toContain('SELLER');

    const order = await fx.placeOrder([{ product_id: jam.productId, quantity: 1 }]);
    const mixed = await fx.placeOrder([
      { product_id: jam.productId, quantity: 1 },
      { product_id: foreign.productId, quantity: 1 },
    ]);
    const seller = { id: A.userId, role: 'SELLER' as const };
    // without the sellers row: the engine's role check refuses it
    await expect(runTransition('PACK', { actor: seller, orderId: order.id })).rejects.toMatchObject({ statusCode: 403, code: 'TRANSITION_NOT_PERMITTED_FOR_ROLE' });
    // every other action stays closed to a seller, even with a sellers row
    await expect(runTransition('ADMIN_CANCEL', { actor: seller, orderId: order.id, sellerId: A.sellerId, input: { notes: 'x' } })).rejects.toMatchObject({
      statusCode: 403,
      code: 'TRANSITION_NOT_PERMITTED_FOR_ROLE',
    });
    await expect(
      runTransition('RESOLVE_ITEM', { actor: seller, orderId: order.id, itemId: order.itemIds[0], sellerId: A.sellerId, input: { item_status: 'UNAVAILABLE' } })
    ).rejects.toMatchObject({ statusCode: 403, code: 'TRANSITION_NOT_PERMITTED_FOR_ROLE' });
    // the right shop on someone else's / a mixed order: refused under the lock
    await expect(runTransition('PACK', { actor: { id: B.userId, role: 'SELLER' }, orderId: order.id, sellerId: B.sellerId })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SELLER_ORDER_MIXED',
    });
    await expect(runTransition('PACK', { actor: seller, orderId: mixed.id, sellerId: A.sellerId })).rejects.toMatchObject({ statusCode: 409, code: 'SELLER_ORDER_MIXED' });
    expect(await statusOf(order.id)).toBe('PLACED');
    expect(await statusOf(mixed.id)).toBe('PLACED');
  });
});

describe('pushes', () => {
  it('formats the new-order text (at most 120 characters)', () => {
    expect(shortOrderNumber('BL-20261030-1283')).toBe('1283');
    expect(shortOrderNumber('ODD')).toBe('ODD');
    expect(sellerNewOrderBody('BL-20261030-1283', [{ name: 'Apple Pie', quantity: 2 }, { name: 'Samosa', quantity: 1 }])).toBe('#1283: 2 x Apple Pie, 1 x Samosa');
    const long = sellerNewOrderBody('BL-20261030-1283', Array.from({ length: 30 }, (_, i) => ({ name: `Item number ${i}`, quantity: 3 })));
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('a placed order tells each seller whose products are on it, once, with their own lines', async () => {
    setPushSenderForTests(fake);
    const single = await fx.placeOrder([
      { product_id: jam.productId, quantity: 2 },
      { product_id: tea.productId, quantity: 1 },
    ]);
    const pushes = await sellerPushes(single.id, A.userId);
    expect(pushes).toHaveLength(1);
    const jamName = (await pool.query('SELECT name FROM products WHERE id = $1', [jam.productId])).rows[0].name;
    const teaName = (await pool.query('SELECT name FROM products WHERE id = $1', [tea.productId])).rows[0].name;
    expect(pushes[0]).toMatchObject({
      title: 'New order',
      data: { type: 'SELLER_NEW_ORDER', order_id: single.id, url: '/orders' },
    });
    expect(pushes[0].body).toBe(sellerNewOrderBody(single.order_number, [{ name: jamName, quantity: 2 }, { name: teaName, quantity: 1 }]).slice(0, 120));
    expect(pushes[0].body.startsWith(`#${single.order_number.split('-').pop()}: 2 x `)).toBe(true);
    expect(await sellerPushes(single.id, B.userId)).toHaveLength(0);

    // a mixed order (rule switched off): every seller involved, each with their own lines only
    const mixed = await fx.placeOrder([
      { product_id: jam.productId, quantity: 1 },
      { product_id: foreign.productId, quantity: 4 },
    ]);
    const a = await sellerPushes(mixed.id, A.userId);
    const b = await sellerPushes(mixed.id, B.userId);
    expect([a.length, b.length]).toEqual([1, 1]);
    expect(a[0].body).toContain('1 x ');
    expect(a[0].body).not.toContain('4 x ');
    expect(b[0].body).toContain('4 x ');

    // Blynk's own products only: no seller push
    const blynk = await fx.placeOrder([{ product_id: own.productId, quantity: 1 }]);
    expect((await pushRows(blynk.id, 'PUSH_SELLER')).length).toBe(0);
  });

  it('an online order tells the seller when the payment goes through, not before', async () => {
    setPushSenderForTests(fake);
    const order = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    // make it the state an unpaid online order is in
    await pool.query(`UPDATE orders SET order_status = 'AWAITING_PAYMENT', payment_method = 'ONLINE' WHERE id = $1`, [order.id]);
    await clearPushes();
    expect(await sellerPushes(order.id, A.userId)).toHaveLength(0);

    await runTransition('PAYMENT_CONFIRMED', {
      actor: { id: users.customer.id, role: 'CUSTOMER' },
      orderId: order.id,
      input: { payment: { gateway_payment_id: 'SELORD-1', status_code: 2, method: 'VISA', status_message: 'ok', response: {} } },
    });
    const pushes = await sellerPushes(order.id, A.userId);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ title: 'New order', data: { type: 'SELLER_NEW_ORDER', order_id: order.id, url: '/orders' } });
  });

  it('a cancelled order tells the seller "No need to prepare it"; an expired unpaid one does not', async () => {
    setPushSenderForTests(fake);
    const order = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    await clearPushes();
    expect((await fx.customerCancel(order.id)).status).toBe(200);
    const pushes = await sellerPushes(order.id, A.userId);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      title: 'Order cancelled',
      body: `#${order.order_number.split('-').pop()} was cancelled. No need to prepare it.`,
      data: { type: 'SELLER_ORDER_CANCELLED', order_id: order.id, url: '/orders' },
    });

    // staff cancelling a packed order tells them too
    const packed = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    expect((await fx.pack(packed.id)).status).toBe(200);
    await clearPushes();
    expect((await fx.adminCancel(packed.id)).status).toBe(200);
    expect((await sellerPushes(packed.id, A.userId)).map((p) => p.data.type)).toEqual(['SELLER_ORDER_CANCELLED']);

    // an unpaid online order that expires was never announced: no "cancelled" either
    const unpaid = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    await pool.query(`UPDATE orders SET order_status = 'AWAITING_PAYMENT', payment_method = 'ONLINE' WHERE id = $1`, [unpaid.id]);
    await clearPushes();
    await runTransition('PAYMENT_EXPIRED', { actor: { id: users.customer.id, role: 'CUSTOMER' }, orderId: unpaid.id, input: { now: new Date(Date.now() + 86_400_000) } });
    expect(await sellerPushes(unpaid.id, A.userId)).toHaveLength(0);
  });

  it('with push not set up nothing is queued and the order still goes through', async () => {
    setPushSenderForTests(null);
    const order = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    expect((await pushRows(order.id, 'PUSH_SELLER')).length).toBe(0);
    expect((await ready(A.token, order.id)).status).toBe(200);
    expect(await statusOf(order.id)).toBe('PACKED');
  });

  it('ready with no rider yet tells the staff to assign one, never the seller or customer twice', async () => {
    setPushSenderForTests(fake);
    const order = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    await clearPushes();
    expect((await ready(A.token, order.id)).status).toBe(200);
    const staff = (await pushRows(order.id, 'PUSH_NEW_ORDER')).find((r) => r.recipient === users.admin.id);
    expect(staff, 'staff push').toBeTruthy();
    const short = order.order_number.split('-').pop();
    expect(staff!.payload).toMatchObject({
      title: `Order #${short} is ready at ${SHOP_A}`,
      body: 'Assign a rider.',
      data: { type: 'staff_order', order_id: order.id },
    });
    expect((await pushRows(order.id, 'PUSH_RIDER_ASSIGNED')).length).toBe(0);
  });

  it('ready tells the assigned rider when one holds the delivery', async () => {
    setPushSenderForTests(fake);
    const order = await fx.placeOrder([{ product_id: tea.productId, quantity: 1 }]);
    expect((await fx.pack(order.id)).status).toBe(200);
    const assigned = await fx.assign(order.id, RIDER_A);
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const deliveryId = assigned.body.data.delivery.id as string;
    await clearPushes();
    await db.transaction().execute((trx) => enqueueOrderReadyPush(trx, { order: { id: order.id, order_number: order.order_number }, shopName: SHOP_A }));
    const rows = await pushRows(order.id, 'PUSH_RIDER_ASSIGNED');
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient).toBe(users.rider.id);
    expect(rows[0].payload).toMatchObject({
      title: `Order #${order.order_number.split('-').pop()} is ready`,
      body: `Pick up at ${SHOP_A}.`,
      data: { type: 'rider_order_ready', delivery_id: deliveryId, order_id: order.id },
    });
    // the staff are not asked to assign a rider that already has it
    expect((await pushRows(order.id, 'PUSH_NEW_ORDER')).length).toBe(0);
  });
});

describe('pickups on the rider and staff order details', () => {
  const adminDetail = async (id: string) => {
    const res = await request(app).get(`/api/v1/admin/orders/${id}`).set(auth(tokens.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.data.order ?? res.body.data).pickups as Record<string, unknown>[];
  };

  it('a seller pickup carries the shop details and whether the goods are ready', async () => {
    const order = await fx.placeOrder([{ product_id: jam.productId, quantity: 1 }]);
    const waiting = await adminDetail(order.id);
    expect(waiting).toEqual([
      {
        kind: 'SELLER',
        seller_id: A.sellerId,
        shop_name: SHOP_A,
        lat: 6.44,
        lng: 80.03,
        address: 'No. 5, Main Street, Dharga Town',
        how_to_find: 'Next to the bank',
        phone: A.phone,
        ready: false,
      },
    ]);

    expect((await ready(A.token, order.id)).status).toBe(200);
    expect((await adminDetail(order.id))[0]).toMatchObject({ kind: 'SELLER', seller_id: A.sellerId, ready: true });

    // the rider's delivery detail has the same pickups
    const assigned = await fx.assign(order.id, RIDER_A);
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const detail = await request(app).get(`/api/v1/riders/deliveries/${assigned.body.data.delivery.id}`).set(auth(tokens.rider));
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.delivery.pickups).toEqual([
      expect.objectContaining({ kind: 'SELLER', shop_name: SHOP_A, address: 'No. 5, Main Street, Dharga Town', how_to_find: 'Next to the bank', phone: A.phone, ready: true }),
    ]);
  });

  it('the Blynk store pickup is named, has no contact fields and is always ready', async () => {
    const order = await fx.placeOrder([{ product_id: own.productId, quantity: 1 }]);
    const store = (await pool.query('SELECT latitude::float AS lat, longitude::float AS lng FROM dark_stores WHERE id = $1', [(await addressOf(order.id)).dark_store_id])).rows[0];
    expect(await adminDetail(order.id)).toEqual([
      { kind: 'STORE', shop_name: 'Blynk store', lat: store.lat, lng: store.lng, address: null, how_to_find: null, phone: null, ready: true },
    ]);
  });

  it('a seller without an address, note or phone still gets every field (null)', async () => {
    await pool.query(`UPDATE sellers SET address = NULL, location_note = NULL WHERE id = $1`, [A.sellerId]);
    await pool.query(`UPDATE users SET phone = 'nophone:so-test' WHERE id = $1`, [A.userId]);
    try {
      const order = await fx.placeOrder([{ product_id: jam.productId, quantity: 1 }]);
      expect(await adminDetail(order.id)).toEqual([
        { kind: 'SELLER', seller_id: A.sellerId, shop_name: SHOP_A, lat: 6.44, lng: 80.03, address: null, how_to_find: null, phone: null, ready: false },
      ]);
    } finally {
      await pool.query(`UPDATE users SET phone = $2 WHERE id = $1`, [A.userId, A.phone]);
      await pool.query(
        `UPDATE sellers SET address = 'No. 5, Main Street, Dharga Town', location_note = 'Next to the bank' WHERE id = $1`,
        [A.sellerId]
      );
    }
  });
});
