import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { stockFixtures, tokens, auth, users, RIDER_A } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';
import { deliveryCodeForDelivery } from './helpers/delivery-code.js';

/**
 * "Make delivery free" (owner, 2026-10-21): Admin and Operations waive one
 * open cash-on-delivery order's delivery fee. The fee becomes 0, the total
 * and the cash the rider collects drop with it, the wallet part never pays
 * more than is due, and every waive is audited. The delivery_fee setting is
 * pinned to LKR 100 and restored; audit rows this file writes are removed.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-WDF-');
const people = customerFixtures(app, { idPrefix: 'c0c00051', phoneBase: '+947095100', name: 'Waive Fee Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const FEE = 100;
const KEYS = ['delivery_fee', 'wallet'];

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let testStart: Date;
let productId = '';

const waive = (orderId: string, body: object = {}, token = opsToken) =>
  request(app).post(`/api/v1/admin/orders/${orderId}/waive-delivery-fee`).set(auth(token)).send(body);
const money = async (orderId: string) =>
  (
    await pool.query(
      `SELECT o.order_status, o.delivery_fee::float AS fee, o.standard_delivery_fee::float AS standard_fee,
              o.subtotal_amount::float AS subtotal, o.discount_amount::float AS discount,
              o.wallet_amount_used::float AS wallet, o.total_amount::float AS total, p.amount::float AS pay_amount
         FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
      [orderId]
    )
  ).rows[0] as Record<string, any>;
const audits = async (orderId: string) =>
  (
    await pool.query(
      `SELECT actor_user_id, old_values, new_values FROM audit_logs
        WHERE action = 'ORDER_DELIVERY_FEE_WAIVED' AND entity_type = 'ORDER' AND entity_id = $1 ORDER BY created_at`,
      [orderId]
    )
  ).rows;

beforeAll(async () => {
  await people.purge(5);
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  await pool.query(`INSERT INTO system_configurations (key, value, description) VALUES ('delivery_fee', $1, 'test')`, [JSON.stringify({ fee_lkr: FEE })]);
  productId = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  await pool.query(`DELETE FROM audit_logs WHERE action IN ('ORDER_DELIVERY_FEE_WAIVED', 'WALLET_ADJUSTED') AND created_at >= $1`, [testStart]);
});

describe('POST /admin/orders/:id/waive-delivery-fee', () => {
  it('makes an open COD order free: fee 0, total and cash to collect reduced, audited, shown to staff and customer', async () => {
    const order = await fx.placeOrder([{ product_id: productId, quantity: 2 }]);
    const before = await money(order.id);
    expect(before.fee).toBe(FEE);
    expect(before.pay_amount).toBe(before.total);

    const res = await waive(order.id, { reason: 'Late delivery yesterday' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const o = res.body.data.order;
    expect(Number(o.delivery_fee)).toBe(0);
    expect(Number(o.total_amount)).toBeCloseTo(before.total - FEE, 2);
    expect(o.delivery_fee_waiver).toMatchObject({ original_fee: FEE, reason: 'Late delivery yesterday' });
    expect(o.delivery_fee_waiver.waived_at).toBeTruthy();

    const after = await money(order.id);
    expect(after.fee).toBe(0);
    expect(after.total).toBeCloseTo(before.total - FEE, 2);
    expect(after.pay_amount).toBeCloseTo(after.total, 2);
    // The rider-pay basis and the record of what was waived.
    expect(after.standard_fee).toBe(FEE);
    expect(after.order_status).toBe('PLACED');

    const rows = await audits(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(users.admin.id);
    expect(rows[0].old_values).toMatchObject({ delivery_fee: FEE, total_amount: before.total });
    expect(rows[0].new_values).toMatchObject({ delivery_fee: 0, total_amount: after.total, reason: 'Late delivery yesterday' });

    // Staff detail says so; the customer sees fee 0 and the new total, never who waived it.
    const staff = await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(tokens.admin));
    expect(staff.body.data.order.delivery_fee_waiver).toMatchObject({ original_fee: FEE });
    const mine = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(tokens.customer));
    expect(mine.status).toBe(200);
    expect(Number(mine.body.data.order.delivery_fee)).toBe(0);
    expect(Number(mine.body.data.order.total_amount)).toBeCloseTo(after.total, 2);
    expect(mine.body.data.order).not.toHaveProperty('delivery_fee_waiver');
  });

  it('a second waive is a clear 409 and changes nothing', async () => {
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    expect((await waive(order.id, {}, tokens.admin)).status).toBe(200);
    const once = await money(order.id);
    const again = await waive(order.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DELIVERY_ALREADY_FREE');
    expect(await money(order.id)).toEqual(once);
    expect(await audits(order.id)).toHaveLength(1);
  });

  it('the rider collects the new total (the old amount is refused) and is still paid on the standard fee', async () => {
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    const oldTotal = (await money(order.id)).total;
    expect((await fx.pack(order.id)).status).toBe(200);
    const a = await fx.assign(order.id);
    expect(a.status).toBe(200);
    const deliveryId = a.body.data.delivery.id as string;
    expect((await fx.riderStep(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
    expect((await fx.riderStep(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);

    // Waived while the rider is at the door.
    expect((await waive(order.id)).status).toBe(200);
    const newTotal = (await money(order.id)).total;
    expect(newTotal).toBeCloseTo(oldTotal - FEE, 2);

    const view = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(tokens.rider));
    expect(view.status).toBe(200);
    expect(view.body.data.delivery.total_amount).toBeCloseTo(newTotal, 2);

    const code = await deliveryCodeForDelivery(deliveryId);
    const stale = await request(app)
      .post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`)
      .set(auth(tokens.rider))
      .send({ amount: oldTotal, delivery_code: code });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('INVALID_COD_AMOUNT');
    const ok = await request(app)
      .post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`)
      .set(auth(tokens.rider))
      .send({ amount: newTotal, delivery_code: code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const d = (
      await pool.query('SELECT cod_collected_amount::float AS cash, rider_id FROM deliveries WHERE id = $1', [deliveryId])
    ).rows[0];
    expect(d.cash).toBeCloseTo(newTotal, 2);
    expect(d.rider_id).toBe(RIDER_A);
  });

  it('is refused once the order is delivered or cancelled', async () => {
    const delivered = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    expect((await fx.pack(delivered.id)).status).toBe(200);
    await fx.deliver(delivered.id);
    const before = await money(delivered.id);
    const res = await waive(delivered.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_OPEN');
    expect(await money(delivered.id)).toEqual(before);

    const cancelled = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    expect((await fx.adminCancel(cancelled.id)).status).toBe(200);
    expect((await waive(cancelled.id)).body.error.code).toBe('ORDER_NOT_OPEN');
  });

  it('is Admin and Operations only', async () => {
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    expect((await waive(order.id, {}, tokens.customer)).status).toBe(403);
    expect((await waive(order.id, {}, tokens.rider)).status).toBe(403);
    expect((await waive(order.id, {}, tokens.staff)).status).toBe(403);
    expect((await request(app).post(`/api/v1/admin/orders/${order.id}/waive-delivery-fee`).send({})).status).toBe(401);
    expect((await money(order.id)).fee).toBe(FEE);
  });

  it('refuses an order paid online (the fee goes back through Refund to wallet instead)', async () => {
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    await pool.query(`UPDATE payments SET payment_method = 'ONLINE', payment_status = 'PAID' WHERE order_id = $1`, [order.id]);
    await pool.query(`UPDATE orders SET payment_method = 'ONLINE', payment_status = 'PAID' WHERE id = $1`, [order.id]);
    const before = await money(order.id);
    const res = await waive(order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_PAID_ONLINE');
    expect(await money(order.id)).toEqual(before);
    expect(await audits(order.id)).toHaveLength(0);
  });

  it('validates input: unknown order 404, malformed id 400, over-long reason 400', async () => {
    expect((await waive('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await waive('not-a-uuid')).status).toBe(400);
    const order = await fx.placeOrder([{ product_id: productId, quantity: 1 }]);
    expect((await waive(order.id, { reason: 'x'.repeat(201) })).status).toBe(400);
    expect((await money(order.id)).fee).toBe(FEE);
  });

  it('a wallet that paid the whole order gets the fee back; nothing is left to collect', async () => {
    const me = await people.customer(1);
    const credit = await request(app)
      .post(`/api/v1/admin/customers/${me.id}/wallet/adjust`)
      .set(auth(tokens.admin))
      .send({ amount: 100000, reason: 'Test credit' });
    expect(credit.status, JSON.stringify(credit.body)).toBe(200);
    const placed = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { use_wallet: true }));
    const before = await money(placed.id);
    expect(before.total).toBe(0);
    expect(before.wallet).toBeCloseTo(before.subtotal + FEE, 2);

    expect((await waive(placed.id)).status).toBe(200);
    const after = await money(placed.id);
    expect(after.fee).toBe(0);
    expect(after.total).toBe(0);
    expect(after.pay_amount).toBe(0);
    expect(after.wallet).toBeCloseTo(before.wallet - FEE, 2);
    const back = (
      await pool.query(
        `SELECT amount::float AS amount, reason FROM wallet_entries WHERE customer_id = $1 AND order_id = $2 AND kind = 'ORDER_PAYMENT_RETURNED'`,
        [me.id, placed.id]
      )
    ).rows;
    expect(back).toHaveLength(1);
    expect(back[0].amount).toBeCloseTo(FEE, 2);
    expect(back[0].reason).toMatch(/Delivery made free/);
  });
});
