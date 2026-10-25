import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings, settingsService } from '../src/modules/configuration/settings.service.js';
import {
  DEFAULT_SMALL_ORDER_FEE,
  setSmallOrderFeeReadyForTests,
  smallOrderFeeApplies,
  smallOrderFeeCharged,
  smallOrderFeeFrom,
  smallOrderFeeReady,
  smallOrderFeeStatus,
} from '../src/modules/orders/small-order-fee.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Small-order fee (owner's brother, 2026-10-25): an order whose item total is UNDER an amount (default
 * LKR 1,000) pays a fee (default LKR 50) on top of delivery. Switch, OFF by default; set in Admin / Ops.
 * Free delivery does not waive it; it is not delivery fee, so rider pay never sees it. Treated as off
 * until migration 063 has been run.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-SOF-');
const people = customerFixtures(app, { idPrefix: 'c0c00064', phoneBase: '+947096400', name: 'Small Order Fee Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = ['coupons_enabled', 'new_customer_free_deliveries', 'show_offer_savings', 'basket_free_delivery', 'order_for_someone_else', 'small_order_fee'];
const FEE = 100;

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let testStart: Date;
let productId = '';
let unit = 0; // what one unit of the test product costs the customer
const pinned = checkoutSettings.read;

const patch = (body: object, token = tokens.admin) => request(app).patch('/api/v1/admin/settings/checkout').set(auth(token)).send(body);
const info = async (token: string, subtotal?: number) =>
  (await request(app).get('/api/v1/orders/checkout-info' + (subtotal === undefined ? '' : `?subtotal=${subtotal}`)).set(auth(token))).body.data;
const turnOn = (min: number, fee = 50) => patch({ small_order_fee: { enabled: true, min_subtotal_lkr: min, fee_lkr: fee } });

beforeAll(async () => {
  checkoutSettings.read = () => settingsService.getCheckoutSettings();
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (
    await pool.query("SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = 'delivery_fee' OR key = ANY($1)", [KEYS])
  ).rows;
  await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_fee' OR key = ANY($1)", [KEYS]);
  await pool.query(
    "INSERT INTO system_configurations (key, value, description) VALUES ('delivery_fee', $1, 'test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify({ fee_lkr: FEE })]
  );
  productId = (await fx.product({ tracked: false })).productId;
  const probe = await people.customer(20);
  unit = (await expectCreated(await probe.placeOrder([{ product_id: productId, quantity: 1 }]))).subtotal_amount;
});

afterEach(() => setSmallOrderFeeReadyForTests(null));

afterAll(async () => {
  checkoutSettings.read = pinned;
  setSmallOrderFeeReadyForTests(null);
  await people.cleanup();
  await fx.cleanup();
  await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_fee' OR key = ANY($1)", [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  await pool.query("DELETE FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' AND created_at >= $1", [testStart]);
});

describe('The rule', () => {
  const on = { enabled: true, min_subtotal_lkr: 1000, fee_lkr: 50 };

  it('charges only an item total UNDER the minimum, and only while on', () => {
    expect(smallOrderFeeApplies(on, 999.99)).toBe(true);
    expect(smallOrderFeeApplies(on, 1000)).toBe(false);
    expect(smallOrderFeeApplies(on, 1500)).toBe(false);
    expect(smallOrderFeeApplies({ ...on, enabled: false }, 10)).toBe(false);
    expect(smallOrderFeeApplies(null, 10)).toBe(false);
    expect(smallOrderFeeCharged(on, 400)).toBe(50);
    expect(smallOrderFeeCharged(on, 1000)).toBe(0);
  });

  it('says how much more avoids it', () => {
    expect(smallOrderFeeStatus(on, 800)).toEqual({ ...on, applies: true, charged_lkr: 50, remaining_lkr: 200 });
    expect(smallOrderFeeStatus(on, 1000)).toEqual({ ...on, applies: false, charged_lkr: 0, remaining_lkr: 0 });
    expect(smallOrderFeeStatus(on)).toEqual({ ...on, applies: null, charged_lkr: 0, remaining_lkr: null });
    expect(smallOrderFeeStatus({ ...on, enabled: false }, 10)).toEqual({ ...on, enabled: false, applies: false, charged_lkr: 0, remaining_lkr: null });
  });

  it('reads a stored row, or nothing for a malformed one', () => {
    expect(smallOrderFeeFrom({ enabled: true, min_subtotal_lkr: 1200, fee_lkr: 60 })).toEqual({ enabled: true, min_subtotal_lkr: 1200, fee_lkr: 60 });
    expect(smallOrderFeeFrom({ enabled: true, min_subtotal_lkr: 0, fee_lkr: 60 })).toBeNull();
    expect(smallOrderFeeFrom('x')).toBeNull();
    expect(DEFAULT_SMALL_ORDER_FEE).toEqual({ enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 });
  });

  it('migration 063 has been applied in the test database', async () => {
    expect(await smallOrderFeeReady()).toBe(true);
  });
});

describe('Admin / Ops setting', () => {
  it('is off by default (LKR 1,000 / LKR 50), and saves with an audit entry', async () => {
    const got = await request(app).get('/api/v1/admin/settings/checkout').set(auth(opsToken));
    expect(got.body.data.small_order_fee).toEqual({ enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 });
    expect(got.body.data.small_order_fee_ready).toBe(true);

    const res = await patch({ small_order_fee: { enabled: true, min_subtotal_lkr: 1200, fee_lkr: 60 } }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.small_order_fee).toEqual({ enabled: true, min_subtotal_lkr: 1200, fee_lkr: 60 });
    const audit = (await pool.query("SELECT new_values FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(audit.new_values.small_order_fee).toEqual({ enabled: true, min_subtotal_lkr: 1200, fee_lkr: 60 });
  });

  it('validates the numbers and the role', async () => {
    const bad = (small: object) => patch({ small_order_fee: small });
    expect((await bad({ enabled: true, min_subtotal_lkr: 0, fee_lkr: 50 })).status).toBe(400);
    expect((await bad({ enabled: true, min_subtotal_lkr: 1000, fee_lkr: 0 })).status).toBe(400);
    expect((await bad({ enabled: true, min_subtotal_lkr: 1000, fee_lkr: 1000.01 })).status).toBe(400);
    expect((await bad({ enabled: true, min_subtotal_lkr: 1000.123, fee_lkr: 50 })).status).toBe(400);
    expect((await bad({ enabled: true, min_subtotal_lkr: 1000 })).status).toBe(400);
    expect((await bad({ min_subtotal_lkr: 1000, fee_lkr: 50 })).status).toBe(400);
    expect((await patch({ small_order_fee: DEFAULT_SMALL_ORDER_FEE }, tokens.staff)).status).toBe(403);
    expect((await patch({ small_order_fee: DEFAULT_SMALL_ORDER_FEE }, tokens.customer)).status).toBe(403);
  });

  it('cannot be switched on before migration 063, but can be saved off', async () => {
    setSmallOrderFeeReadyForTests(false);
    const refused = await turnOn(1000);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SMALL_ORDER_FEE_NOT_READY');
    expect(refused.body.error.message).toBe('Run migration 063 in Coolify before switching the small-order fee on.');
    expect((await patch({ small_order_fee: { enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 } })).status).toBe(200);
    const got = await request(app).get('/api/v1/admin/settings/checkout').set(auth(tokens.admin));
    expect(got.body.data.small_order_fee_ready).toBe(false);
  });

  it('is public in GET /store (off while the migration is missing)', async () => {
    expect((await turnOn(1000)).status).toBe(200);
    expect((await request(app).get('/api/v1/store')).body.data.small_order_fee).toEqual({ enabled: true, min_subtotal_lkr: 1000, fee_lkr: 50 });
    setSmallOrderFeeReadyForTests(false);
    expect((await request(app).get('/api/v1/store')).body.data.small_order_fee).toEqual({ enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 });
  });
});

describe('At checkout', () => {
  it('a small order pays the fee on top of delivery, shown as its own line in checkout-info', async () => {
    expect((await turnOn(unit * 2)).status).toBe(200);
    const me = await people.customer(1);
    expect((await info(me.token, unit)).small_order_fee).toEqual({
      enabled: true,
      min_subtotal_lkr: unit * 2,
      fee_lkr: 50,
      applies: true,
      charged_lkr: 50,
      remaining_lkr: unit,
    });
    expect((await info(me.token, unit * 2)).small_order_fee).toMatchObject({ applies: false, charged_lkr: 0, remaining_lkr: 0 });
    expect((await info(me.token)).small_order_fee).toMatchObject({ enabled: true, applies: null, charged_lkr: 0, remaining_lkr: null });

    const small = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(small.small_order_fee).toBe(50);
    expect(small.delivery_fee).toBe(FEE);
    expect(small.total_amount).toBe(small.subtotal_amount + FEE + 50);
    expect(Number((await pool.query('SELECT small_order_fee FROM orders WHERE id = $1', [small.id])).rows[0].small_order_fee)).toBe(50);

    const big = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(big.small_order_fee).toBe(0);
    expect(big.total_amount).toBe(big.subtotal_amount + FEE);
  });

  it('switched off, or before migration 063, no fee is charged', async () => {
    expect((await patch({ small_order_fee: { enabled: false, min_subtotal_lkr: unit * 2, fee_lkr: 50 } })).status).toBe(200);
    const me = await people.customer(2);
    const off = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(off.small_order_fee).toBe(0);
    expect(off.total_amount).toBe(off.subtotal_amount + FEE);

    expect((await turnOn(unit * 2)).status).toBe(200);
    setSmallOrderFeeReadyForTests(false);
    expect((await info(me.token, unit)).small_order_fee).toMatchObject({ enabled: false, applies: false, charged_lkr: 0 });
    const early = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(early.small_order_fee).toBe(0);
    expect(early.total_amount).toBe(early.subtotal_amount + FEE);
  });

  it('free delivery does not waive it, and the rider pay basis is only the standard delivery fee', async () => {
    expect((await turnOn(unit * 2)).status).toBe(200);
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: 5 } })).status).toBe(200);
    const me = await people.customer(3);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order.delivery_fee).toBe(0);
    expect(order.small_order_fee).toBe(50);
    expect(order.total_amount).toBe(order.subtotal_amount + 50);
    const row = (await pool.query('SELECT standard_delivery_fee, delivery_fee FROM orders WHERE id = $1', [order.id])).rows[0];
    expect(Number(row.standard_delivery_fee)).toBe(FEE);
    expect(Number(row.delivery_fee)).toBe(0);
    expect((await patch({ new_customer_free_deliveries: { enabled: false, count: 5 } })).status).toBe(200);

    // Free delivery by basket amount neither.
    expect((await patch({ basket_free_delivery: { enabled: true, min_subtotal_lkr: unit } })).status).toBe(200);
    expect((await patch({ small_order_fee: { enabled: true, min_subtotal_lkr: unit * 2, fee_lkr: 50 } })).status).toBe(200);
    const basketFree = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(basketFree.delivery_fee).toBe(0);
    expect(basketFree.small_order_fee).toBe(50);
  });

  it('the coupon preview total includes it', async () => {
    expect((await patch({ coupons_enabled: true })).status).toBe(200);
    expect((await turnOn(unit * 2)).status).toBe(200);
    const code = 'TSTSOFCP';
    await pool.query('DELETE FROM coupons WHERE code = $1', [code]);
    const made = await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send({ code, discount_type: 'FIXED', discount_value: 5 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    try {
      const me = await people.customer(4);
      const res = await request(app)
        .post('/api/v1/orders/validate-coupon')
        .set(auth(me.token))
        .send({ code, items: [{ product_id: productId, quantity: 1 }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const c = res.body.data.coupon;
      expect(c.small_order_fee_lkr).toBe(50);
      expect(c.total).toBe(Number((c.subtotal + c.delivery_fee + 50 - c.discount_amount).toFixed(2)));
    } finally {
      await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = $1)', [code]);
      await pool.query('DELETE FROM coupons WHERE code = $1', [code]);
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'COUPON' AND coalesce(new_values->>'code', old_values->>'code') = $1", [code]);
    }
  });

  it('removing an unavailable item later keeps the fee as charged and the total adds up', async () => {
    expect((await turnOn(unit * 3)).status).toBe(200);
    const second = (await fx.product({ tracked: false })).productId;
    const me = await people.customer(5);
    const order = await expectCreated(
      await me.placeOrder([
        { product_id: productId, quantity: 1 },
        { product_id: second, quantity: 1 },
      ])
    );
    expect(order.small_order_fee).toBe(50);
    const item = order.items.find((i: { product_id: string }) => i.product_id === second);
    const res = await request(app)
      .post(`/api/v1/admin/orders/${order.id}/resolve-item`)
      .set(auth(tokens.staff))
      .send({ item_id: item.id, item_status: 'UNAVAILABLE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await pool.query('SELECT subtotal_amount, delivery_fee, small_order_fee, discount_amount, total_amount FROM orders WHERE id = $1', [order.id])).rows[0];
    expect(Number(row.small_order_fee)).toBe(50);
    expect(Number(row.total_amount)).toBe(Number((Number(row.subtotal_amount) + Number(row.delivery_fee) + 50 - Number(row.discount_amount)).toFixed(2)));
  });
});
