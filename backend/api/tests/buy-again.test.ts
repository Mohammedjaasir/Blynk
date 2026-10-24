import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * "Buy again" (owner, 2026-10-24; contract 2026-10-24-buy-again-repeat.md
 * section 1): GET /me/buy-again ranks the products of the customer's DELIVERED
 * orders of the last 180 days (loose items, not removed/substituted) by times
 * bought, then by when last bought; deleted products left out.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-BAG-');
const people = customerFixtures(app, { idPrefix: 'c0c00254', phoneBase: '+947095420', name: 'Buy Again Customer' });
const p: string[] = [];

const buyAgain = async (token: string) => {
  const res = await request(app).get('/api/v1/me/buy-again').set(auth(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.items as Array<{
    product_id: string;
    variant_id: string | null;
    times_bought: number;
    last_bought_at: string;
    last_quantity: number;
  }>;
};

/** Marks an order DELIVERED, placed `daysAgo` days ago. */
async function delivered(orderId: string, daysAgo: number) {
  await pool.query(
    `UPDATE orders SET order_status = 'DELIVERED', placed_at = now() - make_interval(days => $2), delivered_at = now() - make_interval(days => $2)
      WHERE id = $1`,
    [orderId, daysAgo]
  );
}

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  for (let i = 0; i < 6; i++) p.push((await fx.product({ tracked: false })).productId);
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
});

describe('GET /me/buy-again', () => {
  it('a customer with no delivered orders has nothing', async () => {
    const me = await people.customer(1);
    expect(await buyAgain(me.token)).toEqual([]);
    // A placed (not delivered) order does not count either.
    await expectCreated(await me.placeOrder([{ product_id: p[0], quantity: 1 }]));
    expect(await buyAgain(me.token)).toEqual([]);
  });

  it('ranks by times bought, then last bought; only delivered, last 180 days, loose, kept items', async () => {
    const me = await people.customer(2);
    const o1 = await expectCreated(await me.placeOrder([{ product_id: p[0], quantity: 2 }, { product_id: p[1], quantity: 1 }]));
    await delivered(o1.id, 10);
    const o2 = await expectCreated(await me.placeOrder([{ product_id: p[0], quantity: 3 }, { product_id: p[2], quantity: 1 }]));
    await delivered(o2.id, 5);
    // p[2] was removed from that order as unavailable: it does not count.
    await pool.query(`UPDATE order_items SET item_status = 'UNAVAILABLE' WHERE order_id = $1 AND product_id = $2`, [o2.id, p[2]]);
    const old = await expectCreated(await me.placeOrder([{ product_id: p[1], quantity: 5 }, { product_id: p[3], quantity: 1 }]));
    await delivered(old.id, 200); // outside the 180 days
    const o3 = await expectCreated(await me.placeOrder([{ product_id: p[1], quantity: 4 }, { product_id: p[4], quantity: 1 }]));
    await delivered(o3.id, 1);
    // p[4] in o3 was substituted: it does not count either.
    await pool.query(`UPDATE order_items SET item_status = 'SUBSTITUTED' WHERE order_id = $1 AND product_id = $2`, [o3.id, p[4]]);
    // A product bought inside a combo pack is left out.
    const o4 = await expectCreated(await me.placeOrder([{ product_id: p[5], quantity: 1 }]));
    await delivered(o4.id, 2);
    const combo = (
      await pool.query(
        `INSERT INTO order_combos (order_id, combo_name_snapshot, unit_price, quantity, subtotal, items_regular_total)
         VALUES ($1, 'Test combo', 100, 1, 100, 120) RETURNING id`,
        [o4.id]
      )
    ).rows[0].id;
    await pool.query('UPDATE order_items SET order_combo_id = $2 WHERE order_id = $1', [o4.id, combo]);

    const items = await buyAgain(me.token);
    expect(items.map((i) => i.product_id)).toEqual([p[1], p[0]]);
    expect(items[0]).toMatchObject({ product_id: p[1], variant_id: null, times_bought: 2, last_quantity: 4 });
    expect(items[1]).toMatchObject({ product_id: p[0], variant_id: null, times_bought: 2, last_quantity: 3 });
    expect(Date.parse(items[0].last_bought_at)).toBeGreaterThan(Date.parse(items[1].last_bought_at));

    // Bought once more: p[0] now leads on times bought.
    const o5 = await expectCreated(await me.placeOrder([{ product_id: p[0], quantity: 1 }]));
    await delivered(o5.id, 3);
    const again = await buyAgain(me.token);
    expect(again.map((i) => i.product_id)).toEqual([p[0], p[1]]);
    // last_quantity is from the latest order (1 day ago had none of p[0]; 3 days ago had 1).
    expect(again[0]).toMatchObject({ times_bought: 3, last_quantity: 1 });

    // Switched off: still returned (the app decides). Deleted: left out.
    await pool.query('UPDATE products SET is_active = false WHERE id = $1', [p[0]]);
    await pool.query('UPDATE products SET deleted_at = now() WHERE id = $1', [p[1]]);
    try {
      expect((await buyAgain(me.token)).map((i) => i.product_id)).toEqual([p[0]]);
    } finally {
      await pool.query('UPDATE products SET is_active = true, deleted_at = NULL WHERE id = ANY($1)', [[p[0], p[1]]]);
    }
  });

  it("only the customer's own orders count", async () => {
    const other = await people.customer(3);
    expect(await buyAgain(other.token)).toEqual([]);
  });

  it('needs a signed-in shopper', async () => {
    expect((await request(app).get('/api/v1/me/buy-again')).status).toBe(401);
    expect((await request(app).get('/api/v1/me/buy-again').set(auth(tokens.admin))).status).toBe(403);
  });
});
