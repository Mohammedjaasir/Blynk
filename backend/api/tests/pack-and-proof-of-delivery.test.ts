import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { auth, tokens, users, stockFixtures } from './helpers/stock.js';
import { deliveryCodeForOrder, wrongCode } from './helpers/delivery-code.js';

/**
 * Two owner decisions of 2026-09-30:
 *
 *  - Pack without sourcing ("my lead is only going to fill out the
 *    products"): PACK works straight from PLACED and does what sourcing did
 *    for every PENDING item - actual cost = estimated cost, a sourcing
 *    record, and for a TRACKED product the stock leaves the shelf
 *    (ORDER_FULFILLMENT) through the canonical stock writer. Cancelling
 *    still returns it (RESTORE_ORDER_STOCK nets the ledger).
 *
 *  - Proof of delivery with a customer code (migration 016): a 4-digit code
 *    issued at dispatch, shown only to the order's customer, required to
 *    complete the delivery (or, for an admin, a written override note).
 *    5 wrong codes lock the handover for 15 minutes.
 */
describe('Pack without sourcing', () => {
  const app = createApp();
  const fx = stockFixtures(app, 'INTEG-PACKSRC-');

  beforeAll(fx.setup);
  afterAll(fx.cleanup);

  it('takes TRACKED stock for every pending item in the pack, once, and records the sourcing', async () => {
    const tracked = await fx.product({ onHand: 10 });
    const untracked = await fx.product({ tracked: false });
    const order = await fx.placeOrder([
      { product_id: tracked.productId, quantity: 3 },
      { product_id: untracked.productId, quantity: 2 },
    ]);

    const res = await fx.pack(order.id);
    expect(res.status).toBe(200);
    expect(res.body.data.order.order_status).toBe('PACKED');

    expect(await fx.onHand(tracked)).toBe(7);
    const ledger = await fx.ledgerForOrder(order.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      inventory_id: tracked.inventoryId,
      adjustment_type: 'ORDER_FULFILLMENT',
      quantity_delta: -3,
      previous_quantity: 10,
      new_quantity: 7,
      created_by_user_id: users.staff.id,
    });
    await fx.expectLedgerChain(tracked);

    const items = (
      await pool.query(
        'SELECT item_status, estimated_unit_cost::float est, actual_unit_cost::float act FROM order_items WHERE order_id = $1',
        [order.id]
      )
    ).rows;
    expect(items.map((i) => i.item_status)).toEqual(['PACKED', 'PACKED']);
    for (const i of items) expect(i.act).toBe(i.est);
    const records = await pool.query('SELECT quantity_sourced FROM sourcing_records WHERE order_id = $1 ORDER BY quantity_sourced', [order.id]);
    expect(records.rows.map((r) => r.quantity_sourced)).toEqual([2, 3]);
  });

  it('refuses the whole pack with a 409 naming the product that is short, and changes nothing', async () => {
    const short = await fx.product({ onHand: 1 });
    const fine = await fx.product({ onHand: 5 });
    const order = await fx.placeOrder([
      { product_id: fine.productId, quantity: 2 },
      { product_id: short.productId, quantity: 2 },
    ]);
    const name = (await pool.query('SELECT name FROM products WHERE id = $1', [short.productId])).rows[0].name;

    const res = await fx.pack(order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_TRACKED_INVENTORY');
    expect(res.body.error.message).toContain(name);
    expect(res.body.error.details).toMatchObject({ product_id: short.productId, product_name: name, on_hand: 1, requested: 2 });

    expect((await fx.orderRow(order.id)).order_status).toBe('PLACED');
    expect(await fx.onHand(fine)).toBe(5);
    expect(await fx.onHand(short)).toBe(1);
    expect(await fx.ledgerForOrder(order.id)).toHaveLength(0);
    expect((await pool.query('SELECT 1 FROM sourcing_records WHERE order_id = $1', [order.id])).rowCount).toBe(0);
  });

  it('an item already sourced is not taken twice; cancelling returns exactly what the order took', async () => {
    const a = await fx.product({ onHand: 10 });
    const b = await fx.product({ onHand: 10 });
    const order = await fx.placeOrder([
      { product_id: a.productId, quantity: 2 },
      { product_id: b.productId, quantity: 3 },
    ]);
    // One line sourced the old way (the Inventory website still can), the other left to the pack.
    expect((await fx.source(order.id, order.itemFor(a.productId))).status).toBe(200);
    expect(await fx.onHand(a)).toBe(8);

    expect((await fx.pack(order.id)).status).toBe(200);
    expect(await fx.onHand(a)).toBe(8);
    expect(await fx.onHand(b)).toBe(7);

    expect((await fx.adminCancel(order.id)).status).toBe(200);
    expect(await fx.onHand(a)).toBe(10);
    expect(await fx.onHand(b)).toBe(10);
    const ledger = await fx.ledgerForOrder(order.id);
    const net = (t: { inventoryId: string }) =>
      ledger.filter((r) => r.inventory_id === t.inventoryId).map((r) => [r.adjustment_type, r.quantity_delta]);
    expect(net(a)).toEqual([['ORDER_FULFILLMENT', -2], ['ORDER_CANCELLATION_RESTORE', 2]]);
    expect(net(b)).toEqual([['ORDER_FULFILLMENT', -3], ['ORDER_CANCELLATION_RESTORE', 3]]);
    await fx.expectLedgerChain(a);
    await fx.expectLedgerChain(b);
  });
});

describe('Proof of delivery with a customer code', () => {
  const app = createApp();
  const fx = stockFixtures(app, 'INTEG-POD-');

  beforeAll(fx.setup);
  afterAll(fx.cleanup);

  const customerDetail = (orderId: string) => request(app).get(`/api/v1/orders/${orderId}`).set(auth(tokens.customer));
  const collectWith = (deliveryId: string, amount: number, delivery_code?: string) =>
    request(app)
      .post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`)
      .set(auth(tokens.rider))
      .send(delivery_code === undefined ? { amount } : { amount, delivery_code });
  const markDelivered = (orderId: string, body: object) =>
    request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set(auth(tokens.admin)).send({ status: 'DELIVERED', ...body });
  const proof = async (orderId: string) =>
    (await pool.query('SELECT confirmed_via, override_note, failed_attempts FROM order_delivery_codes WHERE order_id = $1', [orderId])).rows[0];

  /** A packed order, assigned, picked up and (optionally) at the door. */
  async function atTheDoor(arrived = true) {
    const t = await fx.product({ tracked: false });
    const order = await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);
    expect((await fx.pack(order.id)).status).toBe(200);
    const a = await fx.assign(order.id);
    expect(a.status).toBe(200);
    const deliveryId = a.body.data.delivery.id as string;
    expect((await fx.riderStep(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
    if (arrived) expect((await fx.riderStep(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
    const total = (await fx.orderRow(order.id)).total;
    return { order, deliveryId, total, code: (await deliveryCodeForOrder(order.id))! };
  }

  it('is issued at dispatch and shown only to the customer, only while the order is on the road', async () => {
    const t = await fx.product({ tracked: false });
    const order = await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);
    expect((await customerDetail(order.id)).body.data.order.delivery_code).toBeNull();
    expect((await fx.pack(order.id)).status).toBe(200);
    expect(await deliveryCodeForOrder(order.id)).toBeNull();
    const deliveryId = (await fx.assign(order.id)).body.data.delivery.id as string;
    expect((await customerDetail(order.id)).body.data.order.delivery_code).toBeNull();
    expect((await fx.riderStep(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);

    const code = await deliveryCodeForOrder(order.id);
    expect(code).toMatch(/^[0-9]{4}$/);
    const mine = await customerDetail(order.id);
    expect(mine.status).toBe(200);
    expect(mine.body.data.order.delivery_code).toBe(code);

    // Never to staff or the rider.
    const staffViews = [
      await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(tokens.admin)),
      await request(app).get('/api/v1/admin/orders?status=OUT_FOR_DELIVERY').set(auth(tokens.admin)),
      await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(tokens.rider)),
      await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.rider)),
    ];
    for (const res of staffViews) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/delivery_code|order_delivery_codes/);
    }
    // Nor in the customer's order list.
    const list = await request(app).get('/api/v1/orders').set(auth(tokens.customer));
    expect(JSON.stringify(list.body)).not.toContain('delivery_code');
  });

  it('the rider completes with the right code; the history says how it was confirmed', async () => {
    const { order, deliveryId, total, code } = await atTheDoor();
    const res = await collectWith(deliveryId, total, code);
    expect(res.status).toBe(200);
    expect(res.body.data.settlement.order_status).toBe('DELIVERED');
    expect(await proof(order.id)).toMatchObject({ confirmed_via: 'CODE', override_note: null });
    const last = (await pool.query(`SELECT reason_or_notes FROM order_status_history WHERE order_id = $1 AND new_status = 'DELIVERED'`, [order.id])).rows[0];
    expect(last.reason_or_notes).toContain('customer code confirmed');
    // The customer no longer sees a code once delivered.
    expect((await customerDetail(order.id)).body.data.order.delivery_code).toBeNull();
  });

  it('a missing or malformed code is a 400', async () => {
    const { deliveryId, total } = await atTheDoor();
    for (const bad of [undefined, '12', '12345', 'abcd']) {
      const res = await collectWith(deliveryId, total, bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('wrong codes: 422 WRONG_DELIVERY_CODE with tries left, the 5th locks for 15 minutes, then 429 even for the right code', async () => {
    const { order, deliveryId, total, code } = await atTheDoor();
    for (let i = 1; i <= 5; i++) {
      const res = await collectWith(deliveryId, total, wrongCode(code));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('WRONG_DELIVERY_CODE');
      expect(res.body.error.details.attempts_remaining).toBe(5 - i);
    }
    expect((await fx.orderRow(order.id)).order_status).toBe('OUT_FOR_DELIVERY');
    expect((await proof(order.id)).failed_attempts).toBe(5);

    const locked = await collectWith(deliveryId, total, code);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('DELIVERY_CODE_LOCKED');
    expect(locked.body.error.details.retry_after_seconds).toBeGreaterThan(14 * 60);
    expect(locked.body.error.details.retry_after_seconds).toBeLessThanOrEqual(15 * 60);
    // The lock is per order and holds for the admin too.
    expect((await markDelivered(order.id, { delivery_code: code })).status).toBe(429);

    // Once the 15 minutes are up, the right code works and a fresh count starts.
    await pool.query(`UPDATE order_delivery_codes SET locked_until = now() - interval '1 second' WHERE order_id = $1`, [order.id]);
    const res = await collectWith(deliveryId, total, code);
    expect(res.status).toBe(200);
    expect((await proof(order.id)).confirmed_via).toBe('CODE');
  });

  it("admin 'Mark delivered': the customer's code, or a written override note - and which one is recorded", async () => {
    const withCode = await atTheDoor(false);
    const wrong = await markDelivered(withCode.order.id, { delivery_code: wrongCode(withCode.code) });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('WRONG_DELIVERY_CODE');
    expect((await markDelivered(withCode.order.id, { delivery_code: withCode.code })).status).toBe(200);
    expect(await proof(withCode.order.id)).toMatchObject({ confirmed_via: 'CODE', override_note: null, failed_attempts: 1 });

    const override = await atTheDoor(false);
    const res = await markDelivered(override.order.id, { notes: "Customer's phone is dead; ID checked at the door" });
    expect(res.status).toBe(200);
    expect(await proof(override.order.id)).toMatchObject({
      confirmed_via: 'OVERRIDE',
      override_note: "Customer's phone is dead; ID checked at the door",
    });
    const last = (await pool.query(`SELECT reason_or_notes FROM order_status_history WHERE order_id = $1 AND new_status = 'DELIVERED'`, [override.order.id])).rows[0];
    expect(last.reason_or_notes).toBe("Delivered without the customer code (override): Customer's phone is dead; ID checked at the door");
  });

  it('a re-dispatch after a failed attempt issues a new code and clears the count', async () => {
    const { order, deliveryId, total, code } = await atTheDoor();
    expect((await collectWith(deliveryId, total, wrongCode(code))).status).toBe(422);
    expect((await fx.riderStep(deliveryId, { status: 'FAILED', failure_reason: 'Nobody home' })).status).toBe(200);
    expect((await fx.setStatus(order.id, 'PACKED', tokens.admin, 'Bag back at the store')).status).toBe(200);
    const again = (await fx.assign(order.id)).body.data.delivery.id as string;
    expect((await fx.riderStep(again, { status: 'PICKED_UP' })).status).toBe(200);
    expect((await proof(order.id)).failed_attempts).toBe(0);
    expect((await customerDetail(order.id)).body.data.order.delivery_code).toBe(await deliveryCodeForOrder(order.id));
  });
});
