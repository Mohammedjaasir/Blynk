import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import {
  BASKET_FREE_DELIVERY_KEY,
  FREE_DELIVERIES_KEY,
  checkoutSettings,
  settingsService,
} from '../src/modules/configuration/settings.service.js';
import { basketFreeDeliveryApplies, basketFreeDeliveryStatus } from '../src/modules/orders/free-delivery.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Free delivery above a basket amount (owner, 2026-10-12; migration 043).
 * Admin + Ops: on/off (default off) and the amount. The basket is the item
 * subtotal after item offers, before coupons; at or above the amount the fee
 * is 0, and such an order never uses up one of the customer's free
 * deliveries. Rows and audit entries this file writes are restored / removed.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-BFD-');
const people = customerFixtures(app, { idPrefix: 'c0c00044', phoneBase: '+947094400', name: 'Basket Free Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = [BASKET_FREE_DELIVERY_KEY, FREE_DELIVERIES_KEY, 'delivery_fee', 'coupons_enabled'];
const COUPON = 'TSTBFDOFF';
const FEE = 100;

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let testStart: Date;
let productId = '';
let price = 0;
const pinned = checkoutSettings.read;

const patch = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/checkout').set(auth(token)).send(body);

beforeAll(async () => {
  checkoutSettings.read = () => settingsService.getCheckoutSettings();
  await people.purge();
  await pool.query('DELETE FROM coupons WHERE code = $1', [COUPON]);
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  await pool.query(`INSERT INTO system_configurations (key, value, description) VALUES ('delivery_fee', $1, 'test')`, [JSON.stringify({ fee_lkr: FEE })]);
  productId = (await fx.product({ tracked: false })).productId;
  // The product's selling price, as the server charges it.
  const probe = await people.customer(20);
  await pool.query(
    `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, 'test')`,
    [FREE_DELIVERIES_KEY, JSON.stringify({ enabled: false, count: 0, since: new Date(0).toISOString() })]
  );
  const order = await expectCreated(await probe.placeOrder([{ product_id: productId, quantity: 1 }]));
  price = order.subtotal_amount;
  expect(price).toBeGreaterThan(0);
});

afterAll(async () => {
  checkoutSettings.read = pinned;
  await people.cleanup();
  // After the orders (their redemptions go with them).
  await pool.query('DELETE FROM coupons WHERE code = $1', [COUPON]);
  await pool.query("DELETE FROM audit_logs WHERE entity_type = 'COUPON' AND coalesce(new_values->>'code', old_values->>'code') = $1", [COUPON]);
  await fx.cleanup();
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' AND created_at >= $1`, [testStart]);
});

describe('basket rule (pure)', () => {
  it('at or above the amount applies; below, off or missing does not', () => {
    const on = { enabled: true, min_subtotal_lkr: 3000 };
    expect(basketFreeDeliveryApplies(on, 3000)).toBe(true);
    expect(basketFreeDeliveryApplies(on, 3000.01)).toBe(true);
    expect(basketFreeDeliveryApplies(on, 2999.99)).toBe(false);
    expect(basketFreeDeliveryApplies({ ...on, enabled: false }, 5000)).toBe(false);
    expect(basketFreeDeliveryApplies(null, 5000)).toBe(false);
    expect(basketFreeDeliveryStatus(on, 2500)).toEqual({ ...on, applies: false, remaining_lkr: 500 });
    expect(basketFreeDeliveryStatus(on, 3500)).toEqual({ ...on, applies: true, remaining_lkr: 0 });
    expect(basketFreeDeliveryStatus(on)).toEqual({ ...on, applies: null, remaining_lkr: null });
    expect(basketFreeDeliveryStatus({ ...on, enabled: false }, 3500)).toEqual({ ...on, enabled: false, applies: false, remaining_lkr: null });
  });
});

describe('Free delivery above a basket amount', () => {
  beforeEach(async () => {
    // Free deliveries off unless a test turns them on.
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [FREE_DELIVERIES_KEY, JSON.stringify({ enabled: false, count: 0, since: new Date(0).toISOString() })]
    );
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [BASKET_FREE_DELIVERY_KEY]);
  });

  it('Admin and Operations set it, audited, validated; off by default', async () => {
    const get = await request(app).get('/api/v1/admin/settings/checkout').set(auth(opsToken));
    expect(get.body.data.basket_free_delivery).toEqual({ enabled: false, min_subtotal_lkr: 3000 });
    const on = await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: 2500.5 } }, opsToken);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.data.basket_free_delivery).toEqual({ enabled: true, min_subtotal_lkr: 2500.5 });
    const audit = (
      await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' ORDER BY created_at DESC LIMIT 1")
    ).rows[0];
    expect(audit).toEqual({
      old_values: { key: 'checkout', basket_free_delivery: null },
      new_values: { key: 'checkout', basket_free_delivery: { enabled: true, min_subtotal_lkr: 2500.5 } },
    });
    expect((await patch({ basket_free_delivery: { enabled: true } })).status).toBe(400);
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: 0 } })).status).toBe(400);
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: -5 } })).status).toBe(400);
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: 100_001 } })).status).toBe(400);
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: 10.123 } })).status).toBe(400);
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: 3000 } }, tokens.staff)).status).toBe(403);
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: 3000 } }, tokens.customer)).status).toBe(403);
    // Not on the public store (the landing site reads GET /store).
    expect((await request(app).get('/api/v1/store')).body.data.basket_free_delivery).toBeUndefined();
  });

  it('fee 0 at/above the amount, normal fee below; checkout-info says how much more', async () => {
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: price * 3 } })).status).toBe(200);
    const me = await people.customer(1);
    const info = async (subtotal?: number) =>
      (await request(app).get(`/api/v1/orders/checkout-info${subtotal === undefined ? '' : `?subtotal=${subtotal}`}`).set(auth(me.token))).body.data;

    const below = await info(price * 2);
    expect(below.delivery_fee_lkr).toBe(FEE);
    expect(below.basket_free_delivery).toEqual({ enabled: true, min_subtotal_lkr: price * 3, applies: false, remaining_lkr: Number(price.toFixed(2)) });
    const at = await info(price * 3);
    expect(at).toMatchObject({ delivery_fee_lkr: 0, standard_delivery_fee_lkr: FEE, basket_free_delivery: { applies: true, remaining_lkr: 0 } });
    expect((await info()).basket_free_delivery).toMatchObject({ applies: null });
    expect((await request(app).get('/api/v1/orders/checkout-info?subtotal=abc').set(auth(me.token))).status).toBe(400);

    const cheap = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(cheap).toMatchObject({ delivery_fee: FEE, free_delivery_reason: null });
    expect(cheap.total_amount).toBe(cheap.subtotal_amount + FEE);

    const big = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 3 }]));
    expect(big).toMatchObject({ delivery_fee: 0, free_delivery_reason: 'BASKET_THRESHOLD' });
    // The standard fee is kept for rider pay (a NUMERIC, returned as text here).
    expect(Number(big.standard_delivery_fee)).toBe(FEE);
    expect(big.total_amount).toBe(big.subtotal_amount);
  });

  it('the server decides on its own prices, not the client', async () => {
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: price * 3 } })).status).toBe(200);
    const me = await people.customer(2);
    // A client claiming a big subtotal in checkout-info still pays the fee on a small order.
    expect((await request(app).get(`/api/v1/orders/checkout-info?subtotal=${price * 10}`).set(auth(me.token))).body.data.delivery_fee_lkr).toBe(0);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { subtotal_amount: price * 10 }));
    expect(order.delivery_fee).toBe(FEE);
  });

  it('switched off: unchanged (the fee is charged however big the basket)', async () => {
    expect((await patch({ basket_free_delivery: { enabled: false, min_subtotal_lkr: price } })).status).toBe(200);
    const me = await people.customer(3);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 5 }]));
    expect(order).toMatchObject({ delivery_fee: FEE, free_delivery_reason: null });
  });

  it('with free deliveries on: a basket-free order does not use one up; a small order does', async () => {
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: price * 3 } })).status).toBe(200);
    const since = new Date().toISOString();
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: 1, since } })).status).toBe(200);
    const me = await people.customer(4);
    const info = async () => (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;

    const big = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 3 }]));
    expect(big).toMatchObject({ delivery_fee: 0, free_delivery_reason: 'BASKET_THRESHOLD' });
    expect((await info()).free_delivery).toMatchObject({ used: 0, remaining: 1, applies: true });

    const small = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(small).toMatchObject({ delivery_fee: 0, free_delivery_reason: 'NEW_CUSTOMER' });
    expect((await info()).free_delivery).toMatchObject({ used: 1, remaining: 0, applies: false });

    const paid = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(paid).toMatchObject({ delivery_fee: FEE, free_delivery_reason: null });
    // Still free above the amount after the free deliveries are used up.
    const big2 = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 4 }]));
    expect(big2).toMatchObject({ delivery_fee: 0, free_delivery_reason: 'BASKET_THRESHOLD' });
  });

  it('the basket is the subtotal before coupons: a coupon cannot take it back under the amount', async () => {
    const code = COUPON;
    expect((await patch({ coupons_enabled: true, basket_free_delivery: { enabled: true, min_subtotal_lkr: price * 3 } })).status).toBe(200);
    const created = await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send({ code, discount_type: 'FIXED', discount_value: 1 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    {
      const me = await people.customer(5);
      const preview = await request(app)
        .post('/api/v1/orders/validate-coupon')
        .set(auth(me.token))
        .send({ code, items: [{ product_id: productId, quantity: 3 }] });
      expect(preview.status).toBe(200);
      expect(preview.body.data.coupon).toMatchObject({ delivery_fee: 0, discount_amount: 1 });
      const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 3 }], { coupon_code: code }));
      expect(order).toMatchObject({ delivery_fee: 0, discount_amount: 1, free_delivery_reason: 'BASKET_THRESHOLD' });
      expect(order.total_amount).toBe(Number((order.subtotal_amount - 1).toFixed(2)));
    }
  });
});
