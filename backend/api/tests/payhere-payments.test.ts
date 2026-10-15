import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { logger } from '../src/utils/logger.js';
import { notifySignature, checkoutHash } from '../src/modules/payments/payhere.js';
import { payhereService } from '../src/modules/payments/payhere.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * PayHere online payments (migration 047; owner, 2026-10-14). Settings (Admin
 * + Ops; credentials Admin only; the secret never leaves the server), the
 * online order flow (AWAITING_PAYMENT -> PLACED only on a verified
 * notification), idempotency, expiry, late payments and delivering a paid
 * order without cash. PayHere itself is never called: notifications are
 * posted here, signed with the test secret. Every row this file writes is
 * removed and the settings row restored.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-PAYH-');
const people = customerFixtures(app, { idPrefix: 'c0c00047', phoneBase: '+947094700', name: 'PayHere Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

const MERCHANT = '1211149';
const SECRET = 'TestMerchantSecret-For-Blynk-047';
const KEY = 'test-payment-secret-key-0123456789abcdef';

type Row = Record<string, unknown>;
let savedSettings: Row | undefined;
let savedKey: string | undefined;
let testStart: Date;
let productId = '';

const getSettings = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/payment-gateway').set(auth(token));
const patchSettings = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/payment-gateway').set(auth(token)).send(body);
const checkout = (token: string, orderId: string) =>
  request(app).post('/api/v1/payments/payhere/checkout').set(auth(token)).send({ order_id: orderId });

function signed(orderNumber: string, amount: string, status: string, extra: Record<string, string> = {}) {
  const fields = {
    merchant_id: MERCHANT,
    order_id: orderNumber,
    payment_id: extra.payment_id ?? `32000${Math.floor(Math.random() * 1e6)}`,
    payhere_amount: amount,
    payhere_currency: extra.payhere_currency ?? 'LKR',
    status_code: status,
    method: 'VISA',
    status_message: status === '2' ? 'Successfully completed the payment.' : 'Payment failed',
    card_holder_name: 'TEST HOLDER',
    card_no: '************1292',
  };
  return {
    ...fields,
    md5sig: notifySignature({
      merchantId: fields.merchant_id,
      orderId: fields.order_id,
      payhereAmount: fields.payhere_amount,
      payhereCurrency: fields.payhere_currency,
      statusCode: fields.status_code,
      merchantSecret: SECRET,
    }),
  };
}
const notify = (body: Record<string, string>) => request(app).post('/api/v1/payments/payhere/notify').type('form').send(body);

const orderState = async (orderId: string) =>
  (
    await pool.query(
      `SELECT o.order_status, o.payment_method, o.payment_status AS order_payment_status, o.payment_expires_at,
              p.payment_status, p.payment_method AS pay_method, p.gateway, p.gateway_payment_id, p.refund_required,
              p.gateway_response, o.total_amount::float AS total
         FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
      [orderId]
    )
  ).rows[0];
const historyOf = async (orderId: string) =>
  (await pool.query('SELECT old_status, new_status FROM order_status_history WHERE order_id = $1 ORDER BY created_at', [orderId])).rows;

async function configure() {
  await pool.query('DELETE FROM payment_gateway_settings');
  const res = await patchSettings({ mode: 'sandbox', merchant_id: MERCHANT, merchant_secret: SECRET, enabled: true, payment_window_minutes: 20 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  savedKey = process.env.PAYMENT_SECRET_KEY;
  process.env.PAYMENT_SECRET_KEY = KEY;
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  savedSettings = (await pool.query("SELECT * FROM payment_gateway_settings WHERE provider = 'PAYHERE'")).rows[0];
  productId = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  await pool.query('DELETE FROM payment_notifications WHERE received_at >= $1 AND order_id IS NULL', [testStart]);
  await pool.query('DELETE FROM payment_gateway_settings');
  if (savedSettings) {
    const cols = Object.keys(savedSettings);
    await pool.query(
      `INSERT INTO payment_gateway_settings (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => savedSettings![c])
    );
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'PAYMENT_GATEWAY_UPDATED' AND created_at >= $1`, [testStart]);
  if (savedKey === undefined) delete process.env.PAYMENT_SECRET_KEY;
  else process.env.PAYMENT_SECRET_KEY = savedKey;
});

describe('Payment gateway settings', () => {
  beforeEach(async () => {
    process.env.PAYMENT_SECRET_KEY = KEY;
    await pool.query('DELETE FROM payment_gateway_settings');
  });

  it('defaults to off and not configured; customers and riders cannot read it', async () => {
    const res = await getSettings(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      provider: 'PAYHERE',
      enabled: false,
      mode: 'sandbox',
      merchant_id: null,
      merchant_secret_set: false,
      merchant_secret_masked: null,
      ready: false,
      encryption_key_configured: true,
      checkout_url: 'https://sandbox.payhere.lk/pay/checkout',
      can_edit_credentials: false,
    });
    expect(res.body.data.notify_url).toMatch(/\/api\/v1\/payments\/payhere\/notify$/);
    expect((await getSettings(tokens.customer)).status).toBe(403);
    expect((await getSettings(tokens.rider)).status).toBe(403);
    expect((await patchSettings({ enabled: true }, tokens.staff)).status).toBe(403);
    const store = await request(app).get('/api/v1/store');
    expect(store.body.data.online_payment).toEqual({ enabled: false, provider: 'PAYHERE', methods_note: null, payment_window_minutes: 20 });
  });

  it('only an Admin changes credentials; Operations switch it on/off and edit the window and note', async () => {
    const ops = await patchSettings({ merchant_id: MERCHANT }, opsToken);
    expect(ops.status).toBe(403);
    expect(ops.body.error.code).toBe('CREDENTIALS_ADMIN_ONLY');
    expect((await patchSettings({ merchant_secret: SECRET }, opsToken)).body.error.code).toBe('CREDENTIALS_ADMIN_ONLY');
    expect((await patchSettings({ mode: 'live' }, opsToken)).body.error.code).toBe('CREDENTIALS_ADMIN_ONLY');

    // Enabling before the credentials exist is refused.
    const early = await patchSettings({ enabled: true }, opsToken);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('PAYHERE_NOT_CONFIGURED');

    const admin = await patchSettings({ merchant_id: MERCHANT, merchant_secret: SECRET, mode: 'sandbox' });
    expect(admin.status).toBe(200);
    expect(admin.body.data).toMatchObject({ merchant_id: MERCHANT, merchant_secret_set: true, merchant_secret_masked: '••••••••', ready: true });
    expect(admin.body.data.can_edit_credentials).toBe(true);

    const on = await patchSettings({ enabled: true, payment_window_minutes: 15, allowed_methods: 'Visa, Mastercard' }, opsToken);
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ enabled: true, payment_window_minutes: 15, allowed_methods: 'Visa, Mastercard', merchant_id: MERCHANT });

    const store = await request(app).get('/api/v1/store');
    expect(store.body.data.online_payment).toEqual({ enabled: true, provider: 'PAYHERE', methods_note: 'Visa, Mastercard', payment_window_minutes: 15 });

    expect((await patchSettings({ payment_window_minutes: 2 }, opsToken)).status).toBe(400);
    expect((await patchSettings({ merchant_id: 'abc' })).status).toBe(400);
    expect((await patchSettings({ unknown_field: 1 })).status).toBe(400);
  });

  it('never returns, stores in clear, audits or logs the secret', async () => {
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(logger, m));
    try {
      const saved = await patchSettings({ merchant_id: MERCHANT, merchant_secret: SECRET });
      expect(saved.status).toBe(200);
      const read = await getSettings();
      const stored = (await pool.query("SELECT merchant_secret_encrypted FROM payment_gateway_settings WHERE provider = 'PAYHERE'")).rows[0]
        .merchant_secret_encrypted as string;
      expect(stored).not.toContain(SECRET);
      for (const body of [JSON.stringify(saved.body), JSON.stringify(read.body)]) {
        expect(body).not.toContain(SECRET);
        expect(body).not.toContain(stored);
        expect(body).not.toContain('merchant_secret_encrypted');
      }
      const audit = (
        await pool.query(
          `SELECT old_values, new_values FROM audit_logs WHERE action = 'PAYMENT_GATEWAY_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`,
          [testStart]
        )
      ).rows[0];
      expect(audit.new_values).toEqual({ key: 'payment_gateway', merchant_id: MERCHANT, merchant_secret: 'changed' });
      expect(JSON.stringify(audit)).not.toContain(SECRET);
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain(stored);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it('refuses to save a secret when the server has no PAYMENT_SECRET_KEY', async () => {
    delete process.env.PAYMENT_SECRET_KEY;
    const res = await patchSettings({ merchant_secret: SECRET });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYMENT_SECRET_KEY_MISSING');
    expect((await getSettings()).body.data.encryption_key_configured).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS n FROM payment_gateway_settings')).rows[0].n).toBe(0);
  });

  it('"Generate sample hash" uses the saved secret and returns no secret', async () => {
    const none = await request(app).post('/api/v1/admin/settings/payment-gateway/test-hash').set(auth(opsToken)).send({});
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('PAYHERE_NOT_CONFIGURED');
    await patchSettings({ merchant_id: MERCHANT, merchant_secret: SECRET });
    const res = await request(app).post('/api/v1/admin/settings/payment-gateway/test-hash').set(auth(opsToken)).send({ order_id: 'TEST-1', amount: 1250 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      mode: 'sandbox',
      merchant_id: MERCHANT,
      order_id: 'TEST-1',
      amount: '1250.00',
      currency: 'LKR',
      hash: checkoutHash({ merchantId: MERCHANT, orderId: 'TEST-1', amount: 1250, currency: 'LKR', merchantSecret: SECRET }),
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect((await request(app).post('/api/v1/admin/settings/payment-gateway/test-hash').set(auth(tokens.customer)).send({})).status).toBe(403);
  });
});

describe('Online order flow', () => {
  beforeAll(configure);

  it('COD stays the default and unchanged', async () => {
    const c = await people.customer(1);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order).toMatchObject({ order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING', payment_expires_at: null });
  });

  it('refuses ONLINE while switched off', async () => {
    await patchSettings({ enabled: false }, opsToken);
    try {
      const c = await people.customer(2);
      const res = await c.placeOrder([{ product_id: productId, quantity: 1 }], { payment_method: 'ONLINE' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
    } finally {
      await patchSettings({ enabled: true }, opsToken);
    }
  });

  it('an online order waits for payment, is not packable, and is released only by a verified notification', async () => {
    const c = await people.customer(3);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 2 }], { payment_method: 'ONLINE' }));
    expect(order).toMatchObject({ order_status: 'AWAITING_PAYMENT', payment_method: 'ONLINE', payment_status: 'PENDING', can_cancel: true });
    expect(order.payment_expires_at).not.toBeNull();
    const minutes = (Date.parse(order.payment_expires_at) - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(18);
    expect(minutes).toBeLessThanOrEqual(20.1);

    // Not in the packing queue; packing refused.
    const queue = await request(app).get('/api/v1/admin/packing-queue').set(auth(tokens.admin));
    expect(queue.body.data.queue.map((o: { id: string }) => o.id)).not.toContain(order.id);
    const pack = await fx.pack(order.id);
    expect(pack.status).toBe(422);

    // Checkout form: owner only, hash over the order number and total.
    const other = await people.customer(4);
    expect((await checkout(other.token, order.id)).status).toBe(404);
    const form = await checkout(c.token, order.id);
    expect(form.status).toBe(200);
    const f = form.body.data.fields;
    expect(form.body.data.action_url).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(f).toMatchObject({ merchant_id: MERCHANT, order_id: order.order_number, currency: 'LKR', amount: order.total_amount.toFixed(2), country: 'Sri Lanka', custom_1: order.id });
    expect(f.hash).toBe(checkoutHash({ merchantId: MERCHANT, orderId: order.order_number, amount: order.total_amount, currency: 'LKR', merchantSecret: SECRET }));
    expect(f.return_url).toContain(`order=${order.id}`);
    expect(f.notify_url).toMatch(/\/payments\/payhere\/notify$/);
    expect(JSON.stringify(form.body)).not.toContain(SECRET);

    // Forged / tampered notifications change nothing.
    const amount = order.total_amount.toFixed(2);
    const forged = { ...signed(order.order_number, amount, '2'), md5sig: 'A'.repeat(32) };
    expect((await notify(forged)).status).toBe(400);
    const tampered = { ...signed(order.order_number, amount, '2'), payhere_amount: '1.00' };
    expect((await notify(tampered)).status).toBe(400);
    const wrongMerchant = { ...signed(order.order_number, amount, '2'), merchant_id: '999' };
    expect((await notify(wrongMerchant)).status).toBe(400);
    expect((await orderState(order.id)).order_status).toBe('AWAITING_PAYMENT');

    // Correctly signed but for the wrong amount: recorded, flagged, not released.
    const short = signed(order.order_number, '1.00', '2');
    expect((await notify(short)).status).toBe(200);
    let s = await orderState(order.id);
    expect(s).toMatchObject({ order_status: 'AWAITING_PAYMENT', payment_status: 'PENDING', refund_required: true });
    await pool.query('UPDATE payments SET refund_required = false WHERE order_id = $1', [order.id]);

    // The real payment.
    const good = signed(order.order_number, amount, '2', { payment_id: '320025071278' });
    const ok = await notify(good);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('OK');
    s = await orderState(order.id);
    expect(s).toMatchObject({
      order_status: 'PLACED',
      order_payment_status: 'PAID',
      payment_status: 'PAID',
      gateway: 'PAYHERE',
      gateway_payment_id: '320025071278',
      refund_required: false,
      payment_expires_at: null,
    });
    // No card data kept.
    expect(JSON.stringify(s.gateway_response)).not.toContain('1292');
    expect(JSON.stringify(s.gateway_response)).not.toContain('TEST HOLDER');

    // Idempotent: the same notification again changes nothing.
    const historyBefore = await historyOf(order.id);
    expect((await notify(good)).status).toBe(200);
    expect(await historyOf(order.id)).toEqual(historyBefore);
    expect(historyBefore.map((h) => h.new_status)).toEqual(['AWAITING_PAYMENT', 'PLACED']);
    const outcomes = (await pool.query('SELECT outcome FROM payment_notifications WHERE order_id = $1 ORDER BY received_at', [order.id])).rows.map((r) => r.outcome);
    expect(outcomes.slice(-3)).toEqual(['AMOUNT_MISMATCH', 'CONFIRMED', 'DUPLICATE']);

    // A failure arriving after the payment never undoes it.
    expect((await notify(signed(order.order_number, amount, '-2'))).status).toBe(200);
    expect((await orderState(order.id)).payment_status).toBe('PAID');

    // Now packable; checkout refuses a paid order.
    expect((await checkout(c.token, order.id)).body.error.code).toBe('ORDER_ALREADY_PAID');
    expect((await request(app).get('/api/v1/admin/packing-queue').set(auth(tokens.admin))).body.data.queue.map((o: { id: string }) => o.id)).toContain(order.id);

    // Customer view never carries the raw gateway response.
    const mine = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(c.token));
    expect(mine.body.data.order.payment.gateway_response).toBeUndefined();
    expect(mine.body.data.order.payment.payment_status).toBe('PAID');
  });

  it('a failed attempt keeps the order waiting so the customer can retry', async () => {
    const c = await people.customer(5);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }], { payment_method: 'ONLINE' }));
    const amount = order.total_amount.toFixed(2);
    expect((await notify(signed(order.order_number, amount, '-2'))).status).toBe(200);
    let s = await orderState(order.id);
    expect(s).toMatchObject({ order_status: 'AWAITING_PAYMENT', order_payment_status: 'FAILED', payment_status: 'FAILED' });
    expect((await checkout(c.token, order.id)).status).toBe(200);
    s = await orderState(order.id);
    expect(s).toMatchObject({ order_payment_status: 'PENDING', payment_status: 'PENDING' });
    expect((await notify(signed(order.order_number, amount, '2'))).status).toBe(200);
    expect((await orderState(order.id)).order_status).toBe('PLACED');
  });

  it('unpaid orders expire and are cancelled; a late payment is refunded to the Blynk Wallet', async () => {
    const c = await people.customer(6);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }], { payment_method: 'ONLINE' }));
    // Still inside the window: the sweep leaves it alone.
    expect(await payhereService.expireOne(order.id, c.id)).toBe(false);
    // Move the window into the past (test-only direct write; never order_status).
    await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.id]);
    const expired = await payhereService.expireStalePayments();
    expect(expired).toBeGreaterThanOrEqual(1);
    let s = await orderState(order.id);
    expect(s).toMatchObject({ order_status: 'CANCELLED', order_payment_status: 'FAILED', payment_status: 'FAILED' });
    // No "cancelled" SMS for an order that was never paid.
    const sms = (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE order_id = $1 AND channel = 'SMS'", [order.id])).rows[0].n;
    expect(sms).toBe(0);
    expect((await checkout(c.token, order.id)).body.error.code).toBe('ORDER_NOT_AWAITING_PAYMENT');

    // PayHere confirms after all: recorded as paid, the order stays cancelled, and
    // (Blynk Wallet, migration 049) the payment is credited to the customer's wallet
    // at once instead of being flagged for a portal refund.
    const late = signed(order.order_number, order.total_amount.toFixed(2), '2');
    expect((await notify(late)).status).toBe(200);
    s = await orderState(order.id);
    expect(s).toMatchObject({ order_status: 'CANCELLED', payment_status: 'PAID', refund_required: false });
    const credited = async () =>
      (await pool.query("SELECT kind, amount::float AS amount FROM wallet_entries WHERE order_id = $1 ORDER BY created_at", [order.id])).rows;
    expect(await credited()).toEqual([{ kind: 'REFUND_ORDER_CANCELLED', amount: order.total_amount }]);
    // The same notification again credits nothing more.
    expect((await notify(late)).status).toBe(200);
    expect(await credited()).toHaveLength(1);
  });

  it('checkout on an order past its window expires it', async () => {
    const c = await people.customer(7);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }], { payment_method: 'ONLINE' }));
    await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 second' WHERE id = $1`, [order.id]);
    const res = await checkout(c.token, order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_EXPIRED');
    expect((await orderState(order.id)).order_status).toBe('CANCELLED');
  });

  it('the customer can cancel an unpaid online order; COD orders refuse the checkout endpoint', async () => {
    const c = await people.customer(8);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }], { payment_method: 'ONLINE' }));
    const cancel = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth(c.token)).send({});
    expect(cancel.status).toBe(200);
    expect((await orderState(order.id)).order_status).toBe('CANCELLED');
    const cod = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect((await checkout(c.token, cod.id)).body.error.code).toBe('NOT_ONLINE_ORDER');
  });

  it('stock (migration 045): units in an unpaid online order are held until it is paid, expires or is cancelled', async () => {
    const t = await fx.product({ onHand: 1 });
    const payer = await people.customer(10);
    const other = await people.customer(11);
    const online = await expectCreated(await payer.placeOrder([{ product_id: t.productId, quantity: 1 }], { payment_method: 'ONLINE' }));
    expect(online.order_status).toBe('AWAITING_PAYMENT');
    // While the customer is paying, the last unit is not sold to anyone else.
    const refused = await other.placeOrder([{ product_id: t.productId, quantity: 1 }]);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('OUT_OF_STOCK');
    // The payment window passes: the unit is free again.
    await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [online.id]);
    const cod = await expectCreated(await other.placeOrder([{ product_id: t.productId, quantity: 1 }]));
    expect(cod.order_status).toBe('PLACED');
  });

  it('notifications for unknown orders are logged and change nothing', async () => {
    const res = await notify(signed('BL-19990101-0000', '10.00', '2'));
    expect(res.status).toBe(200);
    const row = (await pool.query("SELECT outcome, signature_valid FROM payment_notifications WHERE gateway_order_id = 'BL-19990101-0000' ORDER BY received_at DESC LIMIT 1")).rows[0];
    expect(row).toEqual({ outcome: 'UNKNOWN_ORDER', signature_valid: true });
  });

  it('a paid order is delivered with the customer code and no cash; COD collection does not apply', async () => {
    const c = await people.customer(9);
    const order = await expectCreated(await c.placeOrder([{ product_id: productId, quantity: 1 }], { payment_method: 'ONLINE' }));
    expect((await notify(signed(order.order_number, order.total_amount.toFixed(2), '2'))).status).toBe(200);
    expect((await fx.pack(order.id)).status).toBe(200);
    const deliveryId = await fx.deliver(order.id);
    const d = (await pool.query('SELECT assignment_status, cod_collected_amount::float AS cod FROM deliveries WHERE id = $1', [deliveryId])).rows[0];
    expect(d).toEqual({ assignment_status: 'DELIVERED', cod: 0 });
    const s = await orderState(order.id);
    expect(s).toMatchObject({ order_status: 'DELIVERED', payment_status: 'PAID' });
    const codSms = (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE order_id = $1 AND notification_type = 'COD_PAYMENT_CONFIRMED'", [order.id])).rows[0].n;
    expect(codSms).toBe(0);
  });
});
