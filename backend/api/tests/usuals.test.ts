import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * "Your usuals" (owner, 2026-10-10): GET /me/usuals is the customer's most
 * recent not-cancelled order's products, at today's catalog price and
 * availability.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-USU-');
const people = customerFixtures(app, { idPrefix: 'c0c00038', phoneBase: '+947093800', name: 'Usuals Customer' });
let p1 = '';
let p2 = '';
let p3 = '';

const usuals = async (token: string) => {
  const res = await request(app).get('/api/v1/me/usuals').set(auth(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
};

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  p1 = (await fx.product({ tracked: false })).productId;
  p2 = (await fx.product({ tracked: false })).productId;
  p3 = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
});

describe('GET /me/usuals', () => {
  it('a customer with no orders has none', async () => {
    const me = await people.customer(1);
    expect(await usuals(me.token)).toEqual({ order: null, items: [], unavailable: [] });
  });

  it('is the most recent not-cancelled order, with quantities and catalog products', async () => {
    const me = await people.customer(2);
    const older = await expectCreated(
      await me.placeOrder([
        { product_id: p1, quantity: 2 },
        { product_id: p2, quantity: 1 },
      ])
    );
    const newer = await expectCreated(await me.placeOrder([{ product_id: p3, quantity: 4 }]));
    const now = await usuals(me.token);
    expect(now.order).toMatchObject({ id: newer.id, order_number: newer.order_number });
    expect(now.items).toHaveLength(1);
    expect(now.items[0].quantity).toBe(4);
    expect(now.items[0].product).toMatchObject({ id: p3, is_available: true });
    expect(now.items[0].product).toHaveProperty('selling_price');
    expect(now.items[0].product).not.toHaveProperty('purchase_cost');

    // Cancelled orders are skipped.
    expect((await request(app).post(`/api/v1/orders/${newer.id}/cancel`).set(auth(me.token)).send({})).status).toBe(200);
    const back = await usuals(me.token);
    expect(back.order.id).toBe(older.id);
    const pairs = back.items.map((i: { product: { id: string }; quantity: number }) => [i.product.id, i.quantity]);
    expect(pairs).toHaveLength(2);
    expect(pairs).toEqual(expect.arrayContaining([
      [p1, 2],
      [p2, 1],
    ]));
  });

  it('out-of-stock products come back unavailable; deactivated ones are named in unavailable', async () => {
    const me = await people.customer(3);
    await expectCreated(
      await me.placeOrder([
        { product_id: p1, quantity: 1 },
        { product_id: p2, quantity: 2 },
      ])
    );
    await pool.query('UPDATE products SET is_available = false WHERE id = $1', [p1]);
    await pool.query('UPDATE products SET is_active = false WHERE id = $1', [p2]);
    try {
      const data = await usuals(me.token);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].product).toMatchObject({ id: p1, is_available: false });
      expect(data.unavailable).toHaveLength(1);
      expect(data.unavailable[0]).toMatch(/^Stock test TST-USU-2/);
    } finally {
      await pool.query('UPDATE products SET is_available = true, is_active = true WHERE id = ANY($1)', [[p1, p2]]);
    }
  });

  it('needs a signed-in shopper', async () => {
    expect((await request(app).get('/api/v1/me/usuals')).status).toBe(401);
    expect((await request(app).get('/api/v1/me/usuals').set(auth(tokens.admin))).status).toBe(403);
    expect((await request(app).get('/api/v1/me/usuals').set(auth(tokens.staff))).status).toBe(403);
  });
});
