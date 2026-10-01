import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { computeDiscount } from '../src/modules/coupons/coupon.rules.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Coupons (migration 018): admin CRUD, the checkout preview and its error
 * codes, redemption inside order creation (limits under concurrency),
 * release on cancel, the discount following a removed item, and COD cash =
 * the discounted total.
 */
const PREFIX = 'TSTCPN';
const app = createApp();
const fx = stockFixtures(app, 'TST-CPN-');
const people = customerFixtures(app, { idPrefix: 'c0c00001', phoneBase: '+9470990', name: 'Coupon Test Customer' });
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });

let productA = '';
let productB = '';
const PRICE = 120; // purchase_cost 100 at the seeded 20 % markup
const FEE = 100;
let seq = 0;

async function purgeCoupons() {
  const ids = (await pool.query('SELECT id FROM coupons WHERE code LIKE $1', [`${PREFIX}%`])).rows.map((r) => r.id);
  if (!ids.length) return;
  const orders = (await pool.query('SELECT order_id FROM coupon_redemptions WHERE coupon_id = ANY($1)', [ids])).rows.map((r) => r.order_id);
  if (orders.length) {
    await pool.query('DELETE FROM inventory_adjustments WHERE reference_order_id = ANY($1)', [orders]);
    await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [orders]);
    await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [orders]);
    await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [orders]);
    await pool.query('DELETE FROM orders WHERE id = ANY($1)', [orders]);
  }
  await pool.query('DELETE FROM coupons WHERE id = ANY($1)', [ids]);
}

async function coupon(body: Record<string, unknown>) {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/admin/coupons')
    .set(auth(tokens.admin))
    .send({ code: `${PREFIX}${seq}`, discount_type: 'FIXED', discount_value: 50, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.coupon as { id: string; code: string };
}

const preview = (token: string, body: object) =>
  request(app).post('/api/v1/orders/validate-coupon').set(auth(token)).send(body);

beforeAll(async () => {
  await purgeCoupons();
  await people.purge();
  await fx.setup();
  productA = (await fx.product({ tracked: false })).productId;
  productB = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  await people.cleanup();
  await purgeCoupons();
  await fx.cleanup();
});

describe('computeDiscount', () => {
  it('caps a fixed amount at the subtotal', () => {
    expect(computeDiscount({ discount_type: 'FIXED', discount_value: 50, max_discount: null }, 240, 100)).toBe(50);
    expect(computeDiscount({ discount_type: 'FIXED', discount_value: 500, max_discount: null }, 240, 100)).toBe(240);
  });
  it('takes a percentage, capped by max_discount', () => {
    expect(computeDiscount({ discount_type: 'PERCENT', discount_value: 15, max_discount: null }, 333.33, 100)).toBe(50);
    expect(computeDiscount({ discount_type: 'PERCENT', discount_value: 50, max_discount: 30 }, 240, 100)).toBe(30);
    expect(computeDiscount({ discount_type: 'PERCENT', discount_value: 100, max_discount: null }, 240, 100)).toBe(240);
  });
  it('waives the delivery fee', () => {
    expect(computeDiscount({ discount_type: 'FREE_DELIVERY', discount_value: 0, max_discount: null }, 240, 100)).toBe(100);
  });
});

describe('Admin coupons', () => {
  it('creates a code upper-cased, rejects a duplicate in any case, lists usage', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coupons')
      .set(auth(tokens.admin))
      .send({ code: `${PREFIX.toLowerCase()}case`, discount_type: 'PERCENT', discount_value: 10, max_discount: 75, min_subtotal: 200 });
    expect(res.status).toBe(201);
    expect(res.body.data.coupon).toMatchObject({
      code: `${PREFIX}CASE`,
      discount_type: 'PERCENT',
      discount_value: 10,
      max_discount: 75,
      min_subtotal: 200,
      per_customer_limit: 1,
      is_active: true,
      first_order_only: false,
      usage_count: 0,
    });
    const dup = await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send({ code: `${PREFIX}Case`, discount_type: 'FREE_DELIVERY' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('COUPON_CODE_TAKEN');
    const list = await request(app).get('/api/v1/admin/coupons').set(auth(tokens.admin));
    expect(list.status).toBe(200);
    expect(list.body.data.coupons.some((c: { code: string }) => c.code === `${PREFIX}CASE`)).toBe(true);
  });

  it('validates the code and the type rules', async () => {
    const bad = [
      { code: 'ab1', discount_type: 'FIXED', discount_value: 10 },
      { code: `${PREFIX}-X`, discount_type: 'FIXED', discount_value: 10 },
      { code: `${PREFIX}P1`, discount_type: 'PERCENT', discount_value: 150 },
      { code: `${PREFIX}P2`, discount_type: 'PERCENT', discount_value: 0 },
      { code: `${PREFIX}F1`, discount_type: 'FIXED', discount_value: 0 },
      { code: `${PREFIX}F2`, discount_type: 'FIXED', discount_value: 10, max_discount: 5 },
      { code: `${PREFIX}W1`, discount_type: 'FIXED', discount_value: 10, starts_at: '2030-01-02', ends_at: '2030-01-01' },
    ];
    for (const body of bad) {
      const res = await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('is ADMIN only', async () => {
    for (const token of [opsToken, tokens.customer, tokens.staff]) {
      expect((await request(app).get('/api/v1/admin/coupons').set(auth(token))).status).toBe(403);
      expect((await request(app).post('/api/v1/admin/coupons').set(auth(token)).send({})).status).toBe(403);
    }
  });

  it('switches a coupon off and on, and deletes one nobody used', async () => {
    const c = await coupon({});
    const off = await request(app).patch(`/api/v1/admin/coupons/${c.id}`).set(auth(tokens.admin)).send({ is_active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.coupon.is_active).toBe(false);
    const retype = await request(app)
      .patch(`/api/v1/admin/coupons/${c.id}`)
      .set(auth(tokens.admin))
      .send({ discount_type: 'FREE_DELIVERY' });
    expect(retype.body.data.coupon).toMatchObject({ discount_type: 'FREE_DELIVERY', discount_value: 0, max_discount: null });
    const del = await request(app).delete(`/api/v1/admin/coupons/${c.id}`).set(auth(tokens.admin));
    expect(del.status).toBe(200);
    expect((await pool.query('SELECT 1 FROM coupons WHERE id = $1', [c.id])).rowCount).toBe(0);
  });
});

describe('POST /orders/validate-coupon', () => {
  it('previews the discount on the server-priced cart', async () => {
    const c = await coupon({ discount_type: 'PERCENT', discount_value: 10, max_discount: 20 });
    const me = await people.customer(1);
    const res = await preview(me.token, { code: c.code.toLowerCase(), items: [{ product_id: productA, quantity: 3 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.coupon).toMatchObject({
      code: c.code,
      discount_type: 'PERCENT',
      subtotal: 3 * PRICE,
      delivery_fee: FEE,
      discount_amount: 20, // 10 % of 360 = 36, capped at 20
      total: 3 * PRICE + FEE - 20,
    });
    // Previewing uses nothing up.
    expect((await pool.query('SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1', [c.id])).rows[0].n).toBe(0);
  });

  it('answers every refusal with its own code', async () => {
    const me = await people.customer(2);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const cases: Array<[Record<string, unknown> | null, string, number?]> = [
      [null, 'COUPON_NOT_FOUND'],
      [{ is_active: false }, 'COUPON_INACTIVE'],
      [{ starts_at: future }, 'COUPON_NOT_STARTED'],
      [{ starts_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), ends_at: past }, 'COUPON_EXPIRED'],
      [{ min_subtotal: 1000 }, 'COUPON_MIN_SUBTOTAL'],
    ];
    for (const [body, code] of cases) {
      const c = body ? await coupon(body) : { code: `${PREFIX}NOPE` };
      const res = await preview(me.token, { code: c.code, subtotal: 240 });
      expect(res.status, code).toBe(422);
      expect(res.body.error.code).toBe(code);
      if (code === 'COUPON_MIN_SUBTOTAL') expect(res.body.error.details.min_subtotal).toBe(1000);
    }
  });

  it('needs a customer, a valid code and a cart', async () => {
    const me = await people.customer(3);
    expect((await preview(tokens.admin, { code: 'ANYCODE1', subtotal: 1 })).status).toBe(403);
    expect((await preview(me.token, { code: 'no', subtotal: 1 })).status).toBe(400);
    expect((await preview(me.token, { code: 'ANYCODE1' })).status).toBe(400);
  });
});

describe('Coupons at checkout', () => {
  it('discounts the order, records the redemption, and one use per customer by default', async () => {
    const c = await coupon({ discount_type: 'FIXED', discount_value: 75 });
    const me = await people.customer(4);
    const order = await expectCreated(await me.placeOrder([{ product_id: productA, quantity: 2 }], { coupon_code: c.code.toLowerCase() }));
    expect(order).toMatchObject({
      subtotal_amount: 2 * PRICE,
      delivery_fee: FEE,
      discount_amount: 75,
      coupon_code: c.code,
      total_amount: 2 * PRICE + FEE - 75,
    });
    expect(order.payment.amount).toBe(2 * PRICE + FEE - 75);

    const detail = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(me.token));
    expect(detail.body.data.order).toMatchObject({ discount_amount: 75, coupon_code: c.code, total_amount: 2 * PRICE + FEE - 75 });
    const staffView = await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(tokens.admin));
    expect(staffView.body.data.order).toMatchObject({ discount_amount: 75, coupon_code: c.code });

    const again = await me.placeOrder([{ product_id: productA, quantity: 1 }], { coupon_code: c.code });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('COUPON_LIMIT_REACHED');
    const list = await request(app).get('/api/v1/admin/coupons').set(auth(tokens.admin));
    expect(list.body.data.coupons.find((x: { id: string }) => x.id === c.id).usage_count).toBe(1);
  });

  it('a refused coupon places no order', async () => {
    const c = await coupon({ min_subtotal: 5000 });
    const me = await people.customer(5);
    const res = await me.placeOrder([{ product_id: productA, quantity: 1 }], { coupon_code: c.code });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_MIN_SUBTOTAL');
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [me.id])).rows[0].n).toBe(0);
  });

  it('FREE_DELIVERY waives the fee', async () => {
    const c = await coupon({ discount_type: 'FREE_DELIVERY' });
    const me = await people.customer(6);
    const order = await expectCreated(await me.placeOrder([{ product_id: productA, quantity: 1 }], { coupon_code: c.code }));
    expect(order).toMatchObject({ discount_amount: FEE, total_amount: PRICE });
  });

  it('cancelling the order releases the use', async () => {
    const c = await coupon({});
    const me = await people.customer(7);
    const first = await expectCreated(await me.placeOrder([{ product_id: productA, quantity: 1 }], { coupon_code: c.code }));
    const cancel = await request(app).post(`/api/v1/orders/${first.id}/cancel`).set(auth(me.token)).send({});
    expect(cancel.status).toBe(200);
    const row = (await pool.query('SELECT released_at FROM coupon_redemptions WHERE order_id = $1', [first.id])).rows[0];
    expect(row.released_at).not.toBeNull();
    expect((await preview(me.token, { code: c.code, subtotal: PRICE })).status).toBe(200);
    await expectCreated(await me.placeOrder([{ product_id: productA, quantity: 1 }], { coupon_code: c.code }));
  });

  it('first-order-only: a new customer may, one with an earlier (not cancelled) order may not', async () => {
    const c = await coupon({ first_order_only: true, per_customer_limit: 5 });
    const me = await people.customer(8);
    // An earlier cancelled order does not count.
    const cancelled = await expectCreated(await me.placeOrder([{ product_id: productA, quantity: 1 }]));
    await request(app).post(`/api/v1/orders/${cancelled.id}/cancel`).set(auth(me.token)).send({});
    expect((await preview(me.token, { code: c.code, subtotal: PRICE })).status).toBe(200);
    await expectCreated(await me.placeOrder([{ product_id: productA, quantity: 1 }], { coupon_code: c.code }));
    const second = await preview(me.token, { code: c.code, subtotal: PRICE });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('COUPON_FIRST_ORDER_ONLY');
  });

  it('holds the total usage limit when checkouts race', async () => {
    const c = await coupon({ usage_limit: 1 });
    const buyers = [await people.customer(9), await people.customer(10), await people.customer(11)];
    const results = await Promise.all(buyers.map((b) => b.placeOrder([{ product_id: productA, quantity: 1 }], { coupon_code: c.code })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 422, 422]);
    for (const r of results.filter((x) => x.status === 422)) expect(r.body.error.code).toBe('COUPON_LIMIT_REACHED');
    expect((await pool.query('SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1', [c.id])).rows[0].n).toBe(1);
  });

  it('a removed item recomputes a percentage discount; the rider collects the discounted total', async () => {
    const c = await coupon({ discount_type: 'PERCENT', discount_value: 10 });
    const me = await people.customer(12);
    const order = await expectCreated(
      await me.placeOrder(
        [
          { product_id: productA, quantity: 2 },
          { product_id: productB, quantity: 1 },
        ],
        { coupon_code: c.code }
      )
    );
    fx.created.orders.push(order.id as string);
    expect(order.discount_amount).toBe(36); // 10 % of 360
    const itemB = (await pool.query('SELECT id FROM order_items WHERE order_id = $1 AND product_id = $2', [order.id, productB])).rows[0].id;
    expect((await fx.resolve(order.id, itemB)).status).toBe(200);
    const after = (await pool.query('SELECT subtotal_amount::float AS s, discount_amount::float AS d, total_amount::float AS t FROM orders WHERE id = $1', [order.id])).rows[0];
    expect(after).toEqual({ s: 240, d: 24, t: 240 + FEE - 24 });
    expect((await pool.query('SELECT discount_amount::float AS d FROM coupon_redemptions WHERE order_id = $1', [order.id])).rows[0].d).toBe(24);

    expect((await fx.pack(order.id)).status).toBe(200);
    const deliveryId = await fx.deliver(order.id);
    const cash = (await pool.query('SELECT cod_collected_amount::float AS c FROM deliveries WHERE id = $1', [deliveryId])).rows[0].c;
    expect(cash).toBe(240 + FEE - 24);
    // Any other amount is refused (the total is the cash to collect).
    const detail = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(me.token));
    expect(detail.body.data.order).toMatchObject({ order_status: 'DELIVERED', total_amount: 316, discount_amount: 24 });
  });

  it('the database keeps totals honest', async () => {
    const me = await people.customer(13);
    const order = await expectCreated(await me.placeOrder([{ product_id: productA, quantity: 1 }]));
    await expect(pool.query('UPDATE orders SET discount_amount = 10 WHERE id = $1', [order.id])).rejects.toThrow(/chk_order_total_match/);
    await expect(
      pool.query('UPDATE orders SET discount_amount = 500, total_amount = subtotal_amount + delivery_fee - 500 WHERE id = $1', [order.id])
    ).rejects.toThrow(/chk_order_total_nonnegative/);
  });
});
