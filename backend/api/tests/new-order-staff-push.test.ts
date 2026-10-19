import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { stockFixtures, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Owner, 2026-10-19: "Ops app should send notifications when order received" - a "New order"
 * push to every Admin / Operations device when an order is placed (cash on delivery). Everything
 * made here is removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-NOP-');
const people = customerFixtures(app, { idPrefix: 'c0c00051', phoneBase: '+947095100', name: 'New Order Push Customer' });
const DEVICE = `new-order-staff-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
let productId = '';
let testStart: Date;

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  productId = (await fx.product({ tracked: false })).productId;
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [
    users.admin.id,
    DEVICE,
  ]);
});

afterEach(() => setPushSenderForTests(undefined));

afterAll(async () => {
  await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  await people.cleanup();
  await fx.cleanup();
});

const staffPushes = (orderId: string) =>
  pool.query(`SELECT recipient, payload FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND order_id = $1`, [orderId]);

describe('new-order push to staff', () => {
  it('a cash-on-delivery order queues "New order received" for an admin with a device', async () => {
    setPushSenderForTests(fake);
    const me = await people.customer(1);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    const rows = (await staffPushes(order.id)).rows;
    const mine = rows.find((r) => r.recipient === users.admin.id);
    expect(mine, JSON.stringify(rows)).toBeTruthy();
    expect(mine.payload).toMatchObject({ title: 'New order received', data: { type: 'staff_order', order_id: order.id } });
    expect(mine.payload.body).toContain(order.order_number);
    // customers never get it
    expect(rows.some((r) => r.recipient === me.id)).toBe(false);
    // out of the shared outbox at once, so other files' worker batches never meet them
    await pool.query(`DELETE FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND created_at >= $1`, [testStart]);
  });

  it('with push not set up on the server nothing is queued and the order still goes through', async () => {
    setPushSenderForTests(null);
    const me = await people.customer(2);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect((await staffPushes(order.id)).rows).toHaveLength(0);
  });
});
