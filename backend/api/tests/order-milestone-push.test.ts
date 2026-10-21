import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { isOrderMilestone, ordinal } from '../src/modules/notifications/push/push.events.js';
import { stockFixtures, users } from './helpers/stock.js';

/**
 * Owner, 2026-10-21: "notifications like which order is 1st order, 100th order, 1000 order for
 * marketing things" - staff phones hear about the 1st, 100th, 500th, 1,000th and every 1,000th
 * order. Everything made here is removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-OMP-');
const DEVICE = `order-milestone-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
let productId = '';
let testStart: Date;

beforeAll(async () => {
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
  await pool.query(`DELETE FROM notifications WHERE notification_type IN ('PUSH_ORDER_MILESTONE', 'PUSH_NEW_ORDER') AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  await fx.cleanup();
});

describe('order milestones', () => {
  it('counts the 1st, 100th, 500th, 1,000th and every 1,000th order', () => {
    const hits = Array.from({ length: 5000 }, (_, i) => i + 1).filter(isOrderMilestone);
    expect(hits).toEqual([1, 100, 500, 1000, 2000, 3000, 4000, 5000]);
  });

  it('writes ordinals people read naturally', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 100, 101, 111, 1000].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '100th', '101st', '111th', '1,000th',
    ]);
  });

  it('a placed order is counted, and only a milestone count tells the staff', async () => {
    setPushSenderForTests(fake);
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    const n = Number(
      (await pool.query(`SELECT count(DISTINCT order_id)::int AS n FROM order_status_history WHERE new_status = 'PLACED'`)).rows[0].n
    );
    const rows = (
      await pool.query(`SELECT recipient, payload FROM notifications WHERE notification_type = 'PUSH_ORDER_MILESTONE' AND order_id = $1`, [order.id])
    ).rows;
    if (isOrderMilestone(n)) {
      expect(rows.find((r) => r.recipient === users.admin.id)?.payload.body).toContain(`${ordinal(n)} order`);
    } else {
      expect(rows).toHaveLength(0);
    }
    // the ordinary new-order push still goes
    const newOrder = await pool.query(`SELECT 1 FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND order_id = $1`, [order.id]);
    expect(newOrder.rowCount).toBeGreaterThan(0);
    await pool.query(`DELETE FROM notifications WHERE notification_type IN ('PUSH_ORDER_MILESTONE', 'PUSH_NEW_ORDER') AND created_at >= $1`, [testStart]);
  });
});
