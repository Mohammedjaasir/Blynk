import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings, settingsService } from '../src/modules/configuration/settings.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Checkout switches (owner, 2026-10-08): coupon codes on/off and free
 * deliveries for new customers, edited by Admin and Operations, read by the
 * app from GET /store and GET /orders/checkout-info, applied at order
 * placement. Both rows are restored (or removed) afterwards, with the audit
 * entries this file wrote.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-CHK-');
const people = customerFixtures(app, { idPrefix: 'c0c00029', phoneBase: '+947092900', name: 'Checkout Switch Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = ['coupons_enabled', 'new_customer_free_deliveries'];
const FEE = 100;
const COUPON = 'TSTCHKOFF';

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let feeRow: Row | undefined;
let testStart: Date;
let productId = '';
const pinned = checkoutSettings.read;

const patch = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/checkout').set(auth(token)).send(body);
const deleteRows = () => pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);

beforeAll(async () => {
  checkoutSettings.read = () => settingsService.getCheckoutSettings();
  await people.purge();
  await pool.query('DELETE FROM coupons WHERE code = $1', [COUPON]);
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  feeRow = (await pool.query("SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = 'delivery_fee'")).rows[0];
  await pool.query(
    `INSERT INTO system_configurations (key, value, description) VALUES ('delivery_fee', $1, 'test')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ fee_lkr: FEE })]
  );
  productId = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  checkoutSettings.read = pinned;
  await people.cleanup();
  await pool.query('DELETE FROM coupons WHERE code = $1', [COUPON]);
  await fx.cleanup();
  await deleteRows();
  for (const r of [...saved, ...(feeRow ? [feeRow] : [])]) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  if (!feeRow) await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_fee'");
  await pool.query(
    `DELETE FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' AND actor_user_id = $1 AND created_at >= $2`,
    [users.admin.id, testStart]
  );
});

describe('Checkout settings', () => {
  beforeEach(deleteRows);

  it('defaults to coupons off and two free deliveries when the rows are missing', async () => {
    const res = await request(app).get('/api/v1/admin/settings/checkout').set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      coupons_enabled: false,
      new_customer_free_deliveries: { enabled: true, count: 2 },
      updated_at: null,
    });
    const store = await request(app).get('/api/v1/store');
    expect(store.body.data.coupons_enabled).toBe(false);
    expect(store.body.data.new_customer_free_deliveries).toEqual({ enabled: true, count: 2 });
  });

  it('Admin and Operations change each switch on its own, audited', async () => {
    const a = await patch({ coupons_enabled: true });
    expect(a.status).toBe(200);
    expect(a.body.data).toMatchObject({ coupons_enabled: true, new_customer_free_deliveries: { enabled: true, count: 2 } });

    const b = await patch({ new_customer_free_deliveries: { enabled: false, count: 3 } }, opsToken);
    expect(b.status).toBe(200);
    expect(b.body.data).toMatchObject({ coupons_enabled: true, new_customer_free_deliveries: { enabled: false, count: 3 } });
    expect(b.body.data.updated_at).not.toBeNull();

    const store = (await request(app).get('/api/v1/store')).body.data;
    expect(store.coupons_enabled).toBe(true);
    expect(store.new_customer_free_deliveries).toEqual({ enabled: false, count: 3 });

    const audit = (
      await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' ORDER BY created_at DESC LIMIT 2")
    ).rows;
    expect(audit[0].new_values).toEqual({ key: 'checkout', new_customer_free_deliveries: { enabled: false, count: 3 } });
    expect(audit[0].old_values).toEqual({ key: 'checkout', new_customer_free_deliveries: null });
    expect(audit[1].new_values).toEqual({ key: 'checkout', coupons_enabled: { enabled: true } });
  });

  it('validates the body and the role', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ coupons_enabled: 'yes' })).status).toBe(400);
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: 11 } })).status).toBe(400);
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: -1 } })).status).toBe(400);
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: 1.5 } })).status).toBe(400);
    expect((await patch({ new_customer_free_deliveries: { enabled: true } })).status).toBe(400);
    expect((await patch({ coupons_enabled: true }, tokens.staff)).status).toBe(403);
    expect((await patch({ coupons_enabled: true }, tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/checkout')).status).toBe(401);
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: 0 } })).status).toBe(200);
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: 10 } })).status).toBe(200);
  });
});

describe('Free deliveries for new customers', () => {
  beforeAll(deleteRows);

  it('the first two orders go out free; a cancelled one does not use one up', async () => {
    const me = await people.customer(1);
    const info = async () => (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;

    expect(await info()).toEqual({
      delivery_fee_lkr: 0,
      standard_delivery_fee_lkr: FEE,
      coupons_enabled: false,
      free_delivery: { enabled: true, count: 2, used: 0, remaining: 2, applies: true },
    });

    const first = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(first.delivery_fee).toBe(0);
    expect(first.total_amount).toBe(first.subtotal_amount);

    const cancelled = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(cancelled.delivery_fee).toBe(0);
    expect((await request(app).post(`/api/v1/orders/${cancelled.id}/cancel`).set(auth(me.token)).send({})).status).toBe(200);
    expect((await info()).free_delivery).toMatchObject({ used: 1, remaining: 1, applies: true });

    const second = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(second.delivery_fee).toBe(0);
    expect(await info()).toMatchObject({ delivery_fee_lkr: FEE, free_delivery: { used: 2, remaining: 0, applies: false } });

    const third = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(third.delivery_fee).toBe(FEE);
    expect(third.total_amount).toBe(third.subtotal_amount + FEE);
  });

  it('switched off, a new customer pays the fee', async () => {
    expect((await patch({ new_customer_free_deliveries: { enabled: false, count: 2 } })).status).toBe(200);
    const me = await people.customer(2);
    const info = (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;
    expect(info).toMatchObject({ delivery_fee_lkr: FEE, free_delivery: { enabled: false, remaining: 0, applies: false } });
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order.delivery_fee).toBe(FEE);
    await deleteRows();
  });

  it('two checkouts racing for the last free delivery: only one is free', async () => {
    expect((await patch({ new_customer_free_deliveries: { enabled: true, count: 1 } })).status).toBe(200);
    const me = await people.customer(3);
    const both = await Promise.all([
      me.placeOrder([{ product_id: productId, quantity: 1 }]),
      me.placeOrder([{ product_id: productId, quantity: 1 }]),
    ]);
    const fees = (await Promise.all(both.map(expectCreated))).map((o) => o.delivery_fee).sort();
    expect(fees).toEqual([0, FEE]);
    await deleteRows();
  });
});

describe('Coupons switched off', () => {
  beforeAll(async () => {
    await deleteRows();
    const res = await request(app)
      .post('/api/v1/admin/coupons')
      .set(auth(tokens.admin))
      .send({ code: COUPON, discount_type: 'FIXED', discount_value: 50 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('the preview answers COUPONS_DISABLED and an order ignores the code', async () => {
    const me = await people.customer(4);
    const pre = await request(app)
      .post('/api/v1/orders/validate-coupon')
      .set(auth(me.token))
      .send({ code: COUPON, items: [{ product_id: productId, quantity: 1 }] });
    expect(pre.status).toBe(422);
    expect(pre.body.error.code).toBe('COUPONS_DISABLED');

    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { coupon_code: COUPON }));
    expect(order.coupon_code).toBeNull();
    expect(order.discount_amount).toBe(0);
  });

  it('switched on, the code applies on top of a free delivery', async () => {
    expect((await patch({ coupons_enabled: true })).status).toBe(200);
    const me = await people.customer(5);
    const pre = await request(app)
      .post('/api/v1/orders/validate-coupon')
      .set(auth(me.token))
      .send({ code: COUPON, items: [{ product_id: productId, quantity: 1 }] });
    expect(pre.status).toBe(200);
    expect(pre.body.data.coupon).toMatchObject({ delivery_fee: 0, discount_amount: 50 });

    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { coupon_code: COUPON }));
    expect(order).toMatchObject({ coupon_code: COUPON, discount_amount: 50, delivery_fee: 0 });
    expect(order.total_amount).toBe(order.subtotal_amount - 50);
  });
});
