import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { RIDER_A, stockFixtures, users } from './helpers/stock.js';

/**
 * Owner, 2026-10-21: "if we assign new delivery to the rider, they don't get any notifications" -
 * a "New delivery" push to the rider's phone when Ops / Admin assigns an order. Everything made
 * here is removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-RAP-');
const DEVICE = `rider-assigned-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
let productId = '';
let testStart: Date;

beforeAll(async () => {
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  productId = (await fx.product({ tracked: false })).productId;
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [
    users.rider.id,
    DEVICE,
  ]);
});

afterEach(() => setPushSenderForTests(undefined));

afterAll(async () => {
  await pool.query(`DELETE FROM notifications WHERE notification_type IN ('PUSH_RIDER_ASSIGNED', 'PUSH_NEW_ORDER') AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  await fx.cleanup();
});

const riderPushes = (orderId: string) =>
  pool.query(`SELECT recipient, payload FROM notifications WHERE notification_type = 'PUSH_RIDER_ASSIGNED' AND order_id = $1`, [orderId]);

describe('new-delivery push to the rider', () => {
  it('assigning a packed order queues "New delivery" for that rider', async () => {
    setPushSenderForTests(fake);
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    expect((await fx.pack(order.id)).status).toBe(200);
    const res = await fx.assign(order.id, RIDER_A);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = (await riderPushes(order.id)).rows;
    expect(rows, JSON.stringify(rows)).toHaveLength(1);
    expect(rows[0].recipient).toBe(users.rider.id);
    expect(rows[0].payload).toMatchObject({
      title: 'New delivery assigned',
      data: { type: 'rider_delivery', order_id: order.id, delivery_id: res.body.data.delivery.id },
    });
    expect(rows[0].payload.body).toContain(order.order_number);
    // out of the shared outbox at once, so other files' worker batches never meet them
    await pool.query(`DELETE FROM notifications WHERE notification_type IN ('PUSH_RIDER_ASSIGNED', 'PUSH_NEW_ORDER') AND created_at >= $1`, [testStart]);
  });

  it('with push not set up on the server nothing is queued and the assignment still goes through', async () => {
    setPushSenderForTests(null);
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    expect((await fx.pack(order.id)).status).toBe(200);
    expect((await fx.assign(order.id, RIDER_A)).status).toBe(200);
    expect((await riderPushes(order.id)).rows).toHaveLength(0);
  });
});
