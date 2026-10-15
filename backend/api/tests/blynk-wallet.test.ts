import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { notifySignature } from '../src/modules/payments/payhere.js';
import { payhereService } from '../src/modules/payments/payhere.service.js';
import {
  DEFAULT_WALLET_SETTING,
  expiredUnspent,
  expiryNote,
  pointsToRemove,
  refundableFor,
  walletSettingFrom,
  walletUseFor,
} from '../src/modules/wallet/wallet.rules.js';
import { expireWallets, refundCancelledOrderToWallet } from '../src/modules/wallet/wallet.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Blynk Wallet (owner, 2026-10-15; migration 049). Every approved refund goes
 * to the customer's wallet; the balance pays for later orders and is never
 * negative. Settings rows (wallet, points_program, the PayHere gateway) are
 * restored afterwards and the audit rows this file writes removed; the test
 * customers (and so their wallet entries) are deleted.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-WAL-');
const people = customerFixtures(app, { idPrefix: 'c0c00049', phoneBase: '+947094900', name: 'Wallet Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = ['wallet', 'points_program'];
const MERCHANT = '1211149';
const SECRET = 'TestMerchantSecret-For-Blynk-049';
const PAY_KEY = 'test-payment-secret-key-0123456789abcdef';

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let savedGateway: Record<string, unknown> | undefined;
let savedPayKey: string | undefined;
let testStart: Date;
let productId = '';
let product2Id = '';

const patchWallet = (body: object, token = tokens.admin) => request(app).patch('/api/v1/admin/settings/wallet').set(auth(token)).send(body);
const walletOf = async (token: string) => (await request(app).get('/api/v1/me/wallet').set(auth(token))).body.data;
const adjust = (customerId: string, body: object, token = tokens.admin) =>
  request(app).post(`/api/v1/admin/customers/${customerId}/wallet/adjust`).set(auth(token)).send(body);
const orderWallet = (orderId: string, token = tokens.admin) => request(app).get(`/api/v1/admin/orders/${orderId}/wallet`).set(auth(token));
const refund = (orderId: string, body: object, token = opsToken) =>
  request(app).post(`/api/v1/admin/orders/${orderId}/wallet-refund`).set(auth(token)).send(body);
const entriesOf = async (customerId: string) =>
  (
    await pool.query(
      'SELECT kind, amount::float AS amount, order_id, reason, expires_at FROM wallet_entries WHERE customer_id = $1 ORDER BY created_at, id',
      [customerId]
    )
  ).rows;
const orderDb = async (orderId: string) =>
  (
    await pool.query(
      `SELECT o.order_status, o.payment_method, o.payment_status, o.subtotal_amount::float AS subtotal, o.delivery_fee::float AS fee,
              o.discount_amount::float AS discount, o.wallet_amount_used::float AS wallet, o.total_amount::float AS total,
              p.amount::float AS pay_amount, p.payment_status AS pay_status
         FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
      [orderId]
    )
  ).rows[0];
const r2 = (n: number) => Math.round(n * 100) / 100;
const credit = async (customerId: string, amount: number) => {
  const res = await adjust(customerId, { amount, reason: 'Test credit' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

function signed(orderNumber: string, amount: string, status = '2') {
  const fields = {
    merchant_id: MERCHANT,
    order_id: orderNumber,
    payment_id: `49000${Math.floor(Math.random() * 1e6)}`,
    payhere_amount: amount,
    payhere_currency: 'LKR',
    status_code: status,
    method: 'VISA',
    status_message: 'ok',
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

beforeAll(async () => {
  savedPayKey = process.env.PAYMENT_SECRET_KEY;
  process.env.PAYMENT_SECRET_KEY = PAY_KEY;
  await people.purge(40);
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  savedGateway = (await pool.query("SELECT * FROM payment_gateway_settings WHERE provider = 'PAYHERE'")).rows[0];
  productId = (await fx.product({ tracked: false })).productId;
  product2Id = (await fx.product({ tracked: false })).productId;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  await pool.query('DELETE FROM payment_notifications WHERE received_at >= $1 AND order_id IS NULL', [testStart]);
  await pool.query('DELETE FROM payment_gateway_settings');
  if (savedGateway) {
    const cols = Object.keys(savedGateway);
    await pool.query(
      `INSERT INTO payment_gateway_settings (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => savedGateway![c])
    );
  }
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const s of saved) {
    await pool.query(`INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`, [
      s.key,
      JSON.stringify(s.value),
      s.description,
      s.created_at,
      s.updated_at,
    ]);
  }
  await pool.query(
    `DELETE FROM audit_logs WHERE action IN ('WALLET_SETTINGS_UPDATED', 'WALLET_ADJUSTED', 'WALLET_ORDER_REFUND', 'POINTS_PROGRAM_UPDATED', 'PAYMENT_GATEWAY_UPDATED') AND created_at >= $1`,
    [testStart]
  );
  if (savedPayKey === undefined) delete process.env.PAYMENT_SECRET_KEY;
  else process.env.PAYMENT_SECRET_KEY = savedPayKey;
});

// ----------------------------------------------------------------------------
describe('Rules', () => {
  it('a missing or damaged setting reads as on, never expiring, up to 100%', () => {
    expect(walletSettingFrom(undefined)).toEqual(DEFAULT_WALLET_SETTING);
    expect(DEFAULT_WALLET_SETTING).toEqual({ enabled: true, expiry_months: 0, max_use_percent: 100 });
    expect(walletSettingFrom({ enabled: 'no', expiry_months: -3, max_use_percent: 500 })).toEqual(DEFAULT_WALLET_SETTING);
    expect(walletSettingFrom({ enabled: false, expiry_months: 12, max_use_percent: 50 })).toEqual({ enabled: false, expiry_months: 12, max_use_percent: 50 });
  });

  it('the wallet pays at most the balance, the % cap and what is due', () => {
    const on = { enabled: true, max_use_percent: 100 };
    expect(walletUseFor(500, 1200, on)).toBe(500);
    expect(walletUseFor(5000, 1200, on)).toBe(1200);
    expect(walletUseFor(5000, 1200, { enabled: true, max_use_percent: 50 })).toBe(600);
    expect(walletUseFor(5000, 333.33, { enabled: true, max_use_percent: 50 })).toBe(166.66); // rounded down, never over the cap
    expect(walletUseFor(500, 1200, { enabled: false, max_use_percent: 100 })).toBe(0);
    expect(walletUseFor(0, 1200, on)).toBe(0);
    expect(walletUseFor(500, 0, on)).toBe(0);
  });

  it('expiry, refundable and points taken back', () => {
    expect(expiredUnspent(100, 60)).toBe(40);
    expect(expiredUnspent(100, 160)).toBe(0);
    expect(expiryNote(0)).toBe('Your balance never expires.');
    expect(expiryNote(1)).toBe('Credits expire 1 month after they are added.');
    expect(expiryNote(12)).toBe('Credits expire 12 months after they are added.');
    expect(refundableFor({ walletDebited: 200, onlinePaid: 800, cashCollected: 0, credited: 150 })).toEqual({ paid: 1000, refundable: 850 });
    expect(refundableFor({ walletDebited: 0, onlinePaid: 0, cashCollected: 500, credited: 600 })).toEqual({ paid: 500, refundable: 0 });
    expect(pointsToRemove({ earned: 10, earnBase: 1000, amount: 250, alreadyRemoved: 0 })).toBe(2);
    expect(pointsToRemove({ earned: 10, earnBase: 1000, amount: 5000, alreadyRemoved: 4 })).toBe(6);
    expect(pointsToRemove({ earned: 0, earnBase: 1000, amount: 250, alreadyRemoved: 0 })).toBe(0);
  });
});

// ----------------------------------------------------------------------------
describe('Settings', () => {
  it('defaults; Admin and Operations change them, audited; validated; other roles refused', async () => {
    const g = await request(app).get('/api/v1/admin/settings/wallet').set(auth(opsToken));
    expect(g.status).toBe(200);
    expect(g.body.data).toEqual({ enabled: true, expiry_months: 0, max_use_percent: 100, updated_at: null });
    const p = await patchWallet({ max_use_percent: 80 }, opsToken);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.data).toMatchObject({ enabled: true, expiry_months: 0, max_use_percent: 80 });
    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'WALLET_SETTINGS_UPDATED' AND created_at >= $1`, [testStart])).rows;
    expect(audit[0].new_values).toMatchObject({ key: 'wallet', max_use_percent: 80 });
    expect((await patchWallet({ max_use_percent: 100 })).status).toBe(200);

    for (const bad of [{}, { max_use_percent: 0 }, { max_use_percent: 101 }, { expiry_months: -1 }, { expiry_months: 1.5 }, { enabled: 'yes' }, { other: 1 }]) {
      expect((await patchWallet(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await patchWallet({ enabled: true }, tokens.staff)).status).toBe(403);
    expect((await patchWallet({ enabled: true }, tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/wallet').set(auth(tokens.rider))).status).toBe(403);
  });
});

// ----------------------------------------------------------------------------
describe('Ledger and adjustments', () => {
  it('an empty wallet; Admin credits and debits with a reason; never below 0; Ops cannot adjust; never your own', async () => {
    const me = await people.customer(1);
    expect(await walletOf(me.token)).toMatchObject({ enabled: true, balance: 0, expiry_months: 0, expiry_note: 'Your balance never expires.', entries: [] });

    await credit(me.id, 500);
    const down = await adjust(me.id, { amount: -120.5, reason: 'Goodwill reversed' });
    expect(down.status).toBe(200);
    expect(down.body.data.balance).toBe(379.5);
    expect(down.body.data.entries[0]).toMatchObject({ kind: 'ADJUSTMENT', amount: -120.5, reason: 'Goodwill reversed', created_by: users.admin.id });

    const over = await adjust(me.id, { amount: -400, reason: 'Too much' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('WALLET_INSUFFICIENT');
    expect((await adjust(me.id, { amount: 10, reason: 'Ops try' }, opsToken)).status).toBe(403);
    expect((await adjust(users.admin.id, { amount: 10, reason: 'Myself' })).status).toBe(403);
    for (const bad of [{ amount: 0, reason: 'zero' }, { amount: 1.234, reason: 'dec' }, { amount: 5, reason: 'x' }, { amount: 5 }]) {
      expect((await adjust(me.id, bad)).status, JSON.stringify(bad)).toBe(400);
    }

    // The customer sees Blynk's words for an adjustment, never the staff reason.
    const mine = await walletOf(me.token);
    expect(mine.balance).toBe(379.5);
    expect(mine.entries.map((e: { reason: string }) => e.reason)).toEqual(['Adjusted by Blynk', 'Adjusted by Blynk']);
    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'WALLET_ADJUSTED' AND entity_id = $1 ORDER BY created_at`, [me.id])).rows;
    expect(audit).toHaveLength(2);

    // Staff view: GET by Ops, with who and why.
    const staff = await request(app).get(`/api/v1/admin/customers/${me.id}/wallet`).set(auth(opsToken));
    expect(staff.status).toBe(200);
    expect(staff.body.data).toMatchObject({ customer_id: me.id, balance: 379.5 });
    expect(staff.body.data.entries[0].reason).toBe('Goodwill reversed');
    expect((await request(app).get(`/api/v1/admin/customers/${me.id}/wallet`).set(auth(tokens.staff))).status).toBe(403);
    // Any shopper (customers, and staff shopping with their own number) has a wallet; signed out, none.
    expect((await request(app).get('/api/v1/me/wallet')).status).toBe(401);
  });

  it('the ledger is append-only', async () => {
    const me = await people.customer(2);
    await credit(me.id, 50);
    await expect(pool.query('UPDATE wallet_entries SET amount = 5000 WHERE customer_id = $1', [me.id])).rejects.toThrow(/append-only/);
  });

  it('never negative under concurrency: racing debits and racing checkouts', async () => {
    const me = await people.customer(3);
    await credit(me.id, 100);
    const results = await Promise.all(Array.from({ length: 5 }, () => adjust(me.id, { amount: -30, reason: 'Race' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(2);
    expect((await walletOf(me.token)).balance).toBe(10);

    await credit(me.id, 90); // 100 again
    const orders = await Promise.all(
      Array.from({ length: 3 }, () => me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true }))
    );
    for (const o of orders) expect(o.status, JSON.stringify(o.body)).toBe(201);
    const used = orders.map((o) => o.body.data.order.wallet_amount_used as number);
    expect(r2(used.reduce((a, b) => a + b, 0))).toBe(100);
    expect((await walletOf(me.token)).balance).toBe(0);
    const sum = (await pool.query('SELECT sum(amount)::float AS s FROM wallet_entries WHERE customer_id = $1', [me.id])).rows[0].s;
    expect(sum).toBe(0);
  });
});

// ----------------------------------------------------------------------------
describe('Checkout', () => {
  it('pays part of a cash order after discounts; total_amount is what is left to collect; checkout-info shows the balance', async () => {
    const me = await people.customer(4);
    await credit(me.id, 75);
    const info = (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;
    expect(info.wallet).toEqual({ enabled: true, balance: 75, max_use_percent: 100 });

    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true }));
    const due = r2(order.subtotal_amount + order.delivery_fee - order.discount_amount);
    expect(order.wallet_amount_used).toBe(75);
    expect(order.total_amount).toBe(r2(due - 75));
    expect(order.payment_method).toBe('COD');
    const row = await orderDb(order.id);
    expect(row.pay_amount).toBe(row.total);
    expect(row.total).toBe(r2(row.subtotal + row.fee - row.discount - row.wallet));
    expect(await entriesOf(me.id)).toEqual([
      expect.objectContaining({ kind: 'ADJUSTMENT', amount: 75 }),
      expect.objectContaining({ kind: 'ORDER_PAYMENT', amount: -75, order_id: order.id }),
    ]);
    const mine = await walletOf(me.token);
    expect(mine.balance).toBe(0);
    expect(mine.entries[0]).toMatchObject({ kind: 'ORDER_PAYMENT', amount: -75, reason: `Paid for order ${order.order_number}` });
    // Points still earn on the items: the preview is the same as without the wallet.
    const plain = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(order.points_earn_preview).toBe(plain.points_earn_preview);
    // Without "use wallet" nothing is taken.
    expect(plain.wallet_amount_used).toBe(0);
  });

  it('covers a whole order: COD with nothing to collect; delivered with 0 cash and no cash SMS; the rider sees it', async () => {
    const me = await people.customer(5);
    await credit(me.id, 100000);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_wallet: true }));
    expect(order).toMatchObject({ order_status: 'PLACED', payment_method: 'COD', total_amount: 0 });
    expect(order.wallet_amount_used).toBe(r2(order.subtotal_amount + order.delivery_fee - order.discount_amount));

    expect((await fx.pack(order.id)).status).toBe(200);
    const assigned = await fx.assign(order.id);
    const deliveryId = assigned.body.data.delivery.id;
    const riderView = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(tokens.rider));
    expect(riderView.status).toBe(200);
    expect(riderView.body.data.delivery).toMatchObject({ total_amount: 0, wallet_amount_used: order.wallet_amount_used });
    expect((await fx.riderStep(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
    expect((await fx.riderStep(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
    expect((await fx.collect(deliveryId, 0)).status).toBe(200);
    expect((await orderDb(order.id)).order_status).toBe('DELIVERED');
    const codSms = (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE order_id = $1 AND notification_type = 'COD_PAYMENT_CONFIRMED'", [order.id])).rows[0].n;
    expect(codSms).toBe(0);
  });

  it('the % cap applies; switched off, "use wallet" is ignored; a replayed checkout takes nothing twice', async () => {
    const me = await people.customer(6);
    await credit(me.id, 100000);
    expect((await patchWallet({ max_use_percent: 50 })).status).toBe(200);
    const half = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true }));
    const due = r2(half.subtotal_amount + half.delivery_fee - half.discount_amount);
    expect(half.wallet_amount_used).toBe(Math.floor(due * 50) / 100);
    expect((await patchWallet({ max_use_percent: 100, enabled: false })).status).toBe(200);
    const off = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_wallet: true }));
    expect(off.wallet_amount_used).toBe(0);
    expect((await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data.wallet.enabled).toBe(false);
    expect((await patchWallet({ enabled: true })).status).toBe(200);

    const key = `wallet-idem-${Date.now()}`;
    const first = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_wallet: true, idempotency_key: key }));
    const again = await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_wallet: true, idempotency_key: key });
    expect(again.body.data.order.id).toBe(first.id);
    expect(again.body.data.is_idempotent_replay).toBe(true);
    const payments = (await pool.query("SELECT count(*)::int AS n FROM wallet_entries WHERE order_id = $1 AND kind = 'ORDER_PAYMENT'", [first.id])).rows[0].n;
    expect(payments).toBe(1);
    expect((await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_wallet: 'yes' })).status).toBe(400);
  });
});

// ----------------------------------------------------------------------------
describe('Automatic refunds on every cancel path (idempotent)', () => {
  it('customer cancel: the wallet part comes back, and the response says so', async () => {
    const me = await people.customer(7);
    await credit(me.id, 60);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true }));
    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth(me.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.order.wallet).toMatchObject({ used: 60, refunded_total: 60 });
    expect(res.body.data.order.wallet.entries[0]).toMatchObject({ kind: 'ORDER_PAYMENT_RETURNED', amount: 60 });
    expect((await walletOf(me.token)).balance).toBe(60);
    // A second pass credits nothing.
    const row = await db.selectFrom('orders').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(await db.transaction().execute((trx) => refundCancelledOrderToWallet(trx, row))).toEqual({ wallet_returned: 0, online_refunded: 0 });
    expect((await walletOf(me.token)).balance).toBe(60);
    // A cash order without the wallet gets nothing back (nothing was paid).
    const cash = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect((await request(app).post(`/api/v1/orders/${cash.id}/cancel`).set(auth(me.token)).send({})).status).toBe(200);
    expect((await entriesOf(me.id)).filter((e) => e.order_id === cash.id)).toEqual([]);
  });

  it('Ops cancel, and a cancel after a failed delivery', async () => {
    const me = await people.customer(8);
    await credit(me.id, 80);
    const a = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true }));
    expect((await request(app).patch(`/api/v1/admin/orders/${a.id}/status`).set(auth(opsToken)).send({ status: 'CANCELLED', notes: 'Out of area' })).status).toBe(200);
    expect((await walletOf(me.token)).balance).toBe(80);

    const b = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true }));
    expect((await fx.pack(b.id)).status).toBe(200);
    const deliveryId = (await fx.assign(b.id)).body.data.delivery.id;
    expect((await fx.riderStep(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
    expect((await fx.setStatus(b.id, 'FAILED', tokens.admin, 'Bike broke down')).status).toBe(200);
    expect((await walletOf(me.token)).balance).toBe(0);
    expect((await fx.setStatus(b.id, 'CANCELLED', opsToken, 'Could not deliver - our fault')).status).toBe(200);
    expect((await walletOf(me.token)).balance).toBe(80);
    expect((await entriesOf(me.id)).filter((e) => e.order_id === b.id).map((e) => [e.kind, e.amount])).toEqual([
      ['ORDER_PAYMENT', -80],
      ['ORDER_PAYMENT_RETURNED', 80],
    ]);
  });
});

// ----------------------------------------------------------------------------
describe('Item unavailable', () => {
  it('the wallet never pays more than is due; the surplus comes back', async () => {
    const me = await people.customer(9);
    await credit(me.id, 100000);
    const order = await expectCreated(
      await me.placeOrder(
        [
          { product_id: productId, quantity: 1 },
          { product_id: product2Id, quantity: 3 },
        ],
        { use_wallet: true }
      )
    );
    expect(order.total_amount).toBe(0);
    const item = order.items.find((i: { product_id: string }) => i.product_id === product2Id);
    expect((await fx.resolve(order.id, item.id)).status).toBe(200);
    const row = await orderDb(order.id);
    expect(row.total).toBe(0);
    expect(row.pay_amount).toBe(0);
    expect(row.wallet).toBe(r2(row.subtotal + row.fee - row.discount));
    expect((await walletOf(me.token)).balance).toBe(r2(100000 - row.wallet));
    const back = (await entriesOf(me.id)).find((e) => e.kind === 'ORDER_PAYMENT_RETURNED');
    expect(back).toMatchObject({ amount: r2(order.wallet_amount_used - row.wallet), order_id: order.id });
  });
});

// ----------------------------------------------------------------------------
describe('PayHere with the wallet', () => {
  beforeAll(async () => {
    await pool.query('DELETE FROM payment_gateway_settings');
    const res = await request(app)
      .patch('/api/v1/admin/settings/payment-gateway')
      .set(auth(tokens.admin))
      .send({ mode: 'sandbox', merchant_id: MERCHANT, merchant_secret: SECRET, enabled: true, payment_window_minutes: 20 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('partial: PayHere is asked for the rest; cancelled after paying, both parts go to the wallet, once', async () => {
    const me = await people.customer(10);
    await credit(me.id, 30);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true, payment_method: 'ONLINE' }));
    expect(order).toMatchObject({ order_status: 'AWAITING_PAYMENT', payment_method: 'ONLINE', wallet_amount_used: 30 });
    const checkout = await request(app).post('/api/v1/payments/payhere/checkout').set(auth(me.token)).send({ order_id: order.id });
    expect(checkout.status).toBe(200);
    expect(checkout.body.data.fields.amount).toBe(order.total_amount.toFixed(2));
    expect((await notify(signed(order.order_number, order.total_amount.toFixed(2)))).status).toBe(200);
    expect(await orderDb(order.id)).toMatchObject({ order_status: 'PLACED', payment_status: 'PAID' });

    expect((await fx.setStatus(order.id, 'CANCELLED', opsToken, 'Out of stock')).status).toBe(200);
    const mine = (await entriesOf(me.id)).filter((e) => e.order_id === order.id);
    expect(mine.map((e) => [e.kind, e.amount])).toEqual([
      ['ORDER_PAYMENT', -30],
      ['ORDER_PAYMENT_RETURNED', 30],
      ['REFUND_ORDER_CANCELLED', order.total_amount],
    ]);
    expect((await walletOf(me.token)).balance).toBe(r2(30 + order.total_amount));
    const refundFlag = (await pool.query('SELECT refund_required FROM payments WHERE order_id = $1', [order.id])).rows[0].refund_required;
    expect(refundFlag).toBe(false);
    const row = await db.selectFrom('orders').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(await db.transaction().execute((trx) => refundCancelledOrderToWallet(trx, row))).toEqual({ wallet_returned: 0, online_refunded: 0 });
    // Nothing left for staff to refund on it.
    const w = await orderWallet(order.id, opsToken);
    expect(w.body.data).toMatchObject({ refundable: 0, paid: { wallet: 30, online: order.total_amount } });
    expect((await refund(order.id, { amount: 1, kind: 'REFUND_ITEM', reason: 'Try again' })).body.error.code).toBe('NOTHING_TO_REFUND');
  });

  it('the wallet covers it all: no PayHere step, a COD order with nothing to collect', async () => {
    const me = await people.customer(11);
    await credit(me.id, 100000);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_wallet: true, payment_method: 'ONLINE' }));
    expect(order).toMatchObject({ order_status: 'PLACED', payment_method: 'COD', total_amount: 0, payment_expires_at: null });
  });

  it('payment expiry after partial wallet use returns the wallet part', async () => {
    const me = await people.customer(12);
    await credit(me.id, 40);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }], { use_wallet: true, payment_method: 'ONLINE' }));
    expect((await walletOf(me.token)).balance).toBe(0);
    await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.id]);
    expect(await payhereService.expireOne(order.id, me.id)).toBe(true);
    expect((await walletOf(me.token)).balance).toBe(40);
    expect((await entriesOf(me.id)).filter((e) => e.order_id === order.id).map((e) => e.kind)).toEqual(['ORDER_PAYMENT', 'ORDER_PAYMENT_RETURNED']);
  });

  it('an item removed from an order paid online: the money for it goes to the wallet', async () => {
    const me = await people.customer(13);
    const order = await expectCreated(
      await me.placeOrder(
        [
          { product_id: productId, quantity: 1 },
          { product_id: product2Id, quantity: 2 },
        ],
        { payment_method: 'ONLINE' }
      )
    );
    expect((await notify(signed(order.order_number, order.total_amount.toFixed(2)))).status).toBe(200);
    const item = order.items.find((i: { product_id: string }) => i.product_id === product2Id);
    expect((await fx.resolve(order.id, item.id)).status).toBe(200);
    const row = await orderDb(order.id);
    expect(row.pay_amount).toBe(order.total_amount); // what PayHere charged
    expect((await entriesOf(me.id)).map((e) => [e.kind, e.amount])).toEqual([['REFUND_ITEM', r2(order.total_amount - row.total)]]);
    expect((await walletOf(me.token)).entries[0].reason).toContain('Item unavailable');
  });
});

// ----------------------------------------------------------------------------
describe('Staff refunds', () => {
  it('caps, kinds, validation, roles and audit', async () => {
    const me = await people.customer(14);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 3 }]));
    // Not paid yet (cash on delivery): nothing to refund.
    expect((await refund(order.id, { amount: 10, kind: 'REFUND_ITEM', reason: 'Damaged milk' })).body.error.code).toBe('NOTHING_TO_REFUND');
    expect((await fx.pack(order.id)).status).toBe(200);
    await fx.deliver(order.id);

    const view = await orderWallet(order.id, opsToken);
    expect(view.status).toBe(200);
    expect(view.body.data).toMatchObject({ paid: { cash: order.total_amount, total: order.total_amount }, refundable: order.total_amount, refunded_total: 0 });

    const ok = await refund(order.id, { amount: 100, kind: 'REFUND_ITEM', reason: 'Damaged: test item' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.refund).toMatchObject({ kind: 'REFUND_ITEM', amount: 100, created_by: users.admin.id });
    expect(ok.body.data.wallet.refundable).toBe(r2(order.total_amount - 100));
    const mine = await walletOf(me.token);
    expect(mine.balance).toBe(100);
    expect(mine.entries[0]).toMatchObject({ kind: 'REFUND_ITEM', reason: 'Damaged: test item', order_number: order.order_number });

    const tooMuch = await refund(order.id, { amount: order.total_amount, kind: 'REFUND_ITEM', reason: 'Everything' });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toMatchObject({ code: 'REFUND_EXCEEDS_REFUNDABLE', details: { refundable: r2(order.total_amount - 100) } });
    if (order.delivery_fee > 0) {
      expect((await refund(order.id, { amount: order.delivery_fee + 1, kind: 'REFUND_DELIVERY_FEE', reason: 'Fee back' })).body.error.code).toBe(
        'REFUND_EXCEEDS_DELIVERY_FEE'
      );
      expect((await refund(order.id, { amount: order.delivery_fee, kind: 'REFUND_DELIVERY_FEE', reason: 'Whole order wrong' }, tokens.admin)).status).toBe(201);
      expect((await refund(order.id, { amount: 1, kind: 'REFUND_DELIVERY_FEE', reason: 'Fee again' })).body.error.code).toBe('REFUND_EXCEEDS_DELIVERY_FEE');
    }
    expect((await refund(order.id, { amount: 5, kind: 'REFUND_ITEM', reason: 'x', return_points: 1 })).status).toBe(400);
    for (const bad of [{ amount: 0, kind: 'REFUND_ITEM', reason: 'Zero' }, { amount: 5, kind: 'ADJUSTMENT', reason: 'Wrong kind' }, { amount: 5, kind: 'REFUND_ITEM', reason: 'ab' }, { amount: 5.555, kind: 'REFUND_ITEM', reason: 'Decimals' }]) {
      expect((await refund(order.id, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await refund(order.id, { amount: 1, kind: 'REFUND_ITEM', reason: 'Points', return_points: 5 })).body.error.code).toBe('POINTS_RETURN_EXCEEDS');
    expect((await refund(order.id, { amount: 1, kind: 'REFUND_ITEM', reason: 'Packer' }, tokens.staff)).status).toBe(403);
    expect((await refund(order.id, { amount: 1, kind: 'REFUND_ITEM', reason: 'Myself' }, me.token)).status).toBe(403);
    expect((await orderWallet(order.id, tokens.rider)).status).toBe(403);
    expect((await refund('00000000-0000-0000-0000-00000000dead', { amount: 1, kind: 'REFUND_ITEM', reason: 'Nobody' })).status).toBe(404);

    const audit = (await pool.query(`SELECT new_values FROM audit_logs WHERE action = 'WALLET_ORDER_REFUND' AND entity_id = $1`, [order.id])).rows;
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0].new_values).toMatchObject({ customer_id: me.id, kind: 'REFUND_ITEM', amount: 100 });
    // Racing refunds never pass the cap.
    const left = (await orderWallet(order.id)).body.data.refundable as number;
    const race = await Promise.all(Array.from({ length: 4 }, () => refund(order.id, { amount: r2(left / 2), kind: 'REFUND_ITEM', reason: 'Race refund' })));
    expect(race.filter((r) => r.status === 201)).toHaveLength(2);
    expect((await orderWallet(order.id)).body.data.refundable).toBe(r2(left - 2 * r2(left / 2)));
  });

  it('points: earned points on a refunded item are taken back; points used may be given back', async () => {
    expect(
      (
        await request(app)
          .patch('/api/v1/admin/settings/points')
          .set(auth(tokens.admin))
          .send({ enabled: true, earn_points: 1, earn_per_lkr: 100, lkr_per_point: 1, min_redeem_points: 1, max_redeem_percent: 10, expiry_months: 0 })
      ).status
    ).toBe(200);
    const me = await people.customer(15);
    expect(
      (await request(app).post(`/api/v1/admin/customers/${me.id}/points/adjust`).set(auth(tokens.admin)).send({ points: 50, reason: 'Gift' })).status
    ).toBe(200);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 4 }], { use_points: true }));
    expect(order.points_redeemed).toBeGreaterThan(0);
    expect((await fx.pack(order.id)).status).toBe(200);
    await fx.deliver(order.id);
    const view = (await orderWallet(order.id)).body.data;
    expect(view.points.earned).toBeGreaterThan(0);
    expect(view.points.returnable).toBe(order.points_redeemed);
    const earnBase = r2(order.subtotal_amount - order.points_discount_amount);
    const amount = r2(earnBase / 2);
    const res = await refund(order.id, { amount, kind: 'REFUND_ITEM', reason: 'Half the bag was wrong', return_points: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.points_returned).toBe(2);
    expect(res.body.data.points_removed).toBe(Math.floor(view.points.earned * (amount / earnBase) + 1e-9));
    expect(res.body.data.wallet.points.returnable).toBe(order.points_redeemed - 2);
    expect((await patchWalletPointsOff()).status).toBe(200);
  });
});

const patchWalletPointsOff = () => request(app).patch('/api/v1/admin/settings/points').set(auth(tokens.admin)).send({ enabled: false });

// ----------------------------------------------------------------------------
describe('Expiry', () => {
  it('credits expire soonest first; spent credits are not expired again; the sweep writes EXPIRED once', async () => {
    expect((await patchWallet({ expiry_months: 6 })).status).toBe(200);
    const me = await people.customer(16);
    await credit(me.id, 25);
    const [given] = await entriesOf(me.id);
    expect(given.expires_at).not.toBeNull();
    expect((await walletOf(me.token)).expiry_note).toBe('Credits expire 6 months after they are added.');
    expect((await patchWallet({ expiry_months: 0 })).status).toBe(200);

    const you = await people.customer(17);
    // An old credit of 100 past its date of which 60 was spent, and a credit that never expires.
    await pool.query(
      `INSERT INTO wallet_entries (customer_id, kind, amount, reason, expires_at, created_at) VALUES
         ($1, 'ADJUSTMENT', 100, 'Old', now() - interval '1 day', now() - interval '200 days'),
         ($1, 'ADJUSTMENT', -60, 'Spent', NULL, now() - interval '100 days'),
         ($1, 'ADJUSTMENT', 50, 'New', NULL, now() - interval '1 day')`,
      [you.id]
    );
    const staff = await request(app).get(`/api/v1/admin/customers/${you.id}/wallet`).set(auth(tokens.admin));
    expect(staff.body.data.balance).toBe(50); // already left out before the sweep
    expect(await expireWallets()).toBeGreaterThanOrEqual(1);
    expect(await expireWallets()).toBe(0);
    const rows = await entriesOf(you.id);
    expect(rows.filter((e) => e.kind === 'EXPIRED').map((e) => e.amount)).toEqual([-40]);
    const mine = await walletOf(you.token);
    expect(mine.balance).toBe(50);
    expect(mine.entries[0]).toMatchObject({ kind: 'EXPIRED', amount: -40, reason: 'Expired' });
  });
});
