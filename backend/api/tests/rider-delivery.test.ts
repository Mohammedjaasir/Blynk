import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { runTransition } from '../src/modules/orders/lifecycle/engine.js';

/**
 * Rider delivery integrity: ownership, the documented delivery/order state
 * machine (architecture §G, §H, §I), COD settlement and concurrency, all
 * enforced by the backend rather than the Rider app.
 *
 * Every order, delivery, notification, address, rider and user created here
 * is removed in afterAll. Only the seeded UNTRACKED milk is ordered, so no
 * stock is touched. Rider A is the seeded rider; rider B exists only for the
 * duration of this file.
 */
describe('Rider deliveries', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const riderBUser = { id: 'a0000009-0000-0000-0000-00000000000b', phone: '+94770009901', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const RIDER_B = 'f0000009-0000-0000-0000-00000000000b';
  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // Kotmale 1L, Rs. 540, UNTRACKED
  const tokens = {
    customer: generateAccessToken(customer),
    admin: generateAccessToken(admin),
    staff: generateAccessToken(staff),
    riderA: generateAccessToken(riderAUser),
    riderB: generateAccessToken(riderBUser),
  };
  const createdOrders: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, 'Test Rider B', 'RIDER')`, [
      riderBUser.id,
      riderBUser.phone,
    ]);
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       VALUES ($1, $2, $3, 'TEST-RB-0001', true, true)`,
      [RIDER_B, riderBUser.id, DARK_STORE]
    );
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Rider test', 'Rider Test', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });

  afterAll(async () => {
    if (createdOrders.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrders]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    await pool.query('DELETE FROM deliveries WHERE rider_id = $1', [RIDER_B]);
    await pool.query('DELETE FROM riders WHERE id = $1', [RIDER_B]);
    await pool.query('DELETE FROM users WHERE id = $1', [riderBUser.id]);
  });

  async function placeOrder() {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    expect(res.status).toBe(201);
    createdOrders.push(res.body.data.order.id);
    return res.body.data.order as { id: string; total_amount: number };
  }
  /** Sources every pending item (packing requires it, dispatch D7), then packs. */
  async function pack(orderId: string) {
    const pending = await pool.query(`SELECT id FROM order_items WHERE order_id = $1 AND item_status = 'PENDING'`, [orderId]);
    for (const { id } of pending.rows) {
      await request(app)
        .post(`/api/v1/admin/orders/${orderId}/items/${id}/source`)
        .set('Authorization', `Bearer ${tokens.staff}`)
        .send({ actual_unit_cost: 450 });
    }
    return request(app)
      .patch(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${tokens.staff}`)
      .send({ status: 'PACKED' });
  }
  const assign = (orderId: string, riderId: string) =>
    request(app)
      .post(`/api/v1/admin/orders/${orderId}/assign-rider`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ rider_id: riderId });
  const setStatus = (id: string, body: object, token = tokens.riderA) =>
    request(app).patch(`/api/v1/riders/deliveries/${id}/status`).set('Authorization', `Bearer ${token}`).send(body);
  const collect = (id: string, amount: number, token = tokens.riderA) =>
    request(app)
      .post(`/api/v1/riders/deliveries/${id}/collect-cod`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount });
  async function assignedDelivery() {
    const order = await placeOrder();
    expect((await pack(order.id)).status).toBe(200);
    const res = await assign(order.id, RIDER_A);
    expect(res.status).toBe(200);
    return { order, deliveryId: res.body.data.delivery.id as string };
  }

  describe('request hygiene', () => {
    it('rejects a malformed delivery id with 400', async () => {
      for (const res of [
        await request(app).get('/api/v1/riders/deliveries/not-a-uuid').set('Authorization', `Bearer ${tokens.riderA}`),
        await setStatus('not-a-uuid', { status: 'PICKED_UP' }),
        await collect('not-a-uuid', 610),
      ]) {
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('refuses an inactive rider profile with 403 RIDER_INACTIVE', async () => {
      await pool.query('UPDATE riders SET is_active = false WHERE id = $1', [RIDER_B]);
      try {
        const res = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens.riderB}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('RIDER_INACTIVE');
      } finally {
        await pool.query('UPDATE riders SET is_active = true WHERE id = $1', [RIDER_B]);
      }
    });
  });

  describe('lifecycle', () => {
    const historyFor = async (orderId: string, newStatus: string) =>
      (
        await pool.query(
          'SELECT old_status, new_status FROM order_status_history WHERE order_id = $1 AND new_status = $2',
          [orderId, newStatus]
        )
      ).rows;
    const orderStatus = async (orderId: string) =>
      (await pool.query('SELECT order_status FROM orders WHERE id = $1', [orderId])).rows[0].order_status;

    it('walks ASSIGNED → PICKED_UP → ARRIVED_AT_CUSTOMER with the right order state and history', async () => {
      const { order, deliveryId } = await assignedDelivery();
      const up = await setStatus(deliveryId, { status: 'PICKED_UP' });
      expect(up.status).toBe(200);
      expect(up.body.data.delivery.assignment_status).toBe('PICKED_UP');
      expect(up.body.data.delivery.order_status).toBe('OUT_FOR_DELIVERY');
      expect(await historyFor(order.id, 'OUT_FOR_DELIVERY')).toEqual([
        { old_status: 'PACKED', new_status: 'OUT_FOR_DELIVERY' },
      ]);
      const arrived = await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' });
      expect(arrived.status).toBe(200);
      expect(arrived.body.data.delivery.assignment_status).toBe('ARRIVED_AT_CUSTOMER');
      expect(await orderStatus(order.id)).toBe('OUT_FOR_DELIVERY');
    });

    it('refuses pickup of an order that is not packed', async () => {
      const order = await placeOrder();
      // Inserted directly: the assign-rider API itself refuses unpacked orders.
      const d = await pool.query('INSERT INTO deliveries (order_id, rider_id) VALUES ($1, $2) RETURNING id', [
        order.id,
        RIDER_A,
      ]);
      const res = await setStatus(d.rows[0].id, { status: 'PICKED_UP' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_PICKUP');
      expect(await orderStatus(order.id)).toBe('PLACED');
      const row = await pool.query('SELECT assignment_status FROM deliveries WHERE id = $1', [d.rows[0].id]);
      expect(row.rows[0].assignment_status).toBe('ASSIGNED');
    });

    it('refuses pickup of an order the customer cancelled after assignment', async () => {
      const { order, deliveryId } = await assignedDelivery();
      const cancel = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${tokens.customer}`)
        .send({ reason: 'Changed my mind' });
      expect(cancel.status).toBe(200);
      const res = await setStatus(deliveryId, { status: 'PICKED_UP' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_ACTIVE');
      expect(await orderStatus(order.id)).toBe('CANCELLED');
    });

    it('refuses skipping, reversing and repeating transitions', async () => {
      const { deliveryId } = await assignedDelivery();
      const skip = await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' });
      expect(skip.status).toBe(409);
      expect(skip.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
      const again = await setStatus(deliveryId, { status: 'PICKED_UP' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect(again.body.error.details).toMatchObject({ current_status: 'PICKED_UP', requested_status: 'PICKED_UP' });
      expect((await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
      const back = await setStatus(deliveryId, { status: 'PICKED_UP' });
      expect(back.status).toBe(409);
      expect(back.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
    });

    it.each(['ASSIGNED', 'ACCEPTED', 'REJECTED', 'DELIVERED', 'SHIPPED'])(
      'does not accept %s from a rider',
      async (status) => {
        const { deliveryId } = await assignedDelivery();
        const res = await setStatus(deliveryId, { status });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        const row = await pool.query('SELECT assignment_status FROM deliveries WHERE id = $1', [deliveryId]);
        expect(row.rows[0].assignment_status).toBe('ASSIGNED');
      }
    );

    it('FAILED needs a reason, is only allowed after pickup, and fails the order', async () => {
      const { order, deliveryId } = await assignedDelivery();
      const early = await setStatus(deliveryId, { status: 'FAILED', failure_reason: 'Bike broke down' });
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
      expect((await setStatus(deliveryId, { status: 'FAILED' })).status).toBe(400);
      expect((await setStatus(deliveryId, { status: 'FAILED', failure_reason: '   ' })).status).toBe(400);
      const res = await setStatus(deliveryId, { status: 'FAILED', failure_reason: 'Bike broke down' });
      expect(res.status).toBe(200);
      expect(await orderStatus(order.id)).toBe('FAILED');
      expect(await historyFor(order.id, 'FAILED')).toEqual([{ old_status: 'OUT_FOR_DELIVERY', new_status: 'FAILED' }]);
      const row = await pool.query('SELECT assignment_status, failure_reason FROM deliveries WHERE id = $1', [deliveryId]);
      expect(row.rows[0]).toEqual({ assignment_status: 'FAILED', failure_reason: 'Bike broke down' });
    });

    it('concurrent double pickup: exactly one succeeds and one history row is written', async () => {
      const { order, deliveryId } = await assignedDelivery();
      const results = await Promise.all([
        setStatus(deliveryId, { status: 'PICKED_UP' }),
        setStatus(deliveryId, { status: 'PICKED_UP' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await historyFor(order.id, 'OUT_FOR_DELIVERY')).toHaveLength(1);
      const n = await pool.query(
        `SELECT count(*)::int n FROM notifications WHERE order_id = $1 AND notification_type = 'OUT_FOR_DELIVERY'`,
        [order.id]
      );
      expect(n.rows[0].n).toBe(1);
    });
  });

  describe('COD settlement', () => {
    async function arrivedDelivery() {
      const d = await assignedDelivery();
      expect((await setStatus(d.deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
      expect((await setStatus(d.deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
      return d;
    }
    const deliveredHistory = async (orderId: string) =>
      (
        await pool.query(
          `SELECT old_status FROM order_status_history WHERE order_id = $1 AND new_status = 'DELIVERED'`,
          [orderId]
        )
      ).rows;
    const paymentStatus = async (orderId: string) =>
      (await pool.query('SELECT payment_status FROM payments WHERE order_id = $1', [orderId])).rows[0].payment_status;

    it('settles the exact backend total: delivery, payment, order and history agree', async () => {
      const { order, deliveryId } = await arrivedDelivery();
      const res = await collect(deliveryId, order.total_amount);
      expect(res.status).toBe(200);
      expect(res.body.data.settlement).toMatchObject({
        order_status: 'DELIVERED',
        payment_status: 'PAID',
        cod_collected_amount: order.total_amount,
      });
      const row = await pool.query(
        `SELECT o.order_status, o.payment_status, p.payment_status AS pay, d.assignment_status, d.cod_collected_amount, d.delivered_at
           FROM orders o JOIN payments p ON p.order_id = o.id JOIN deliveries d ON d.order_id = o.id WHERE o.id = $1`,
        [order.id]
      );
      expect(row.rows[0]).toMatchObject({
        order_status: 'DELIVERED',
        payment_status: 'PAID',
        pay: 'PAID',
        assignment_status: 'DELIVERED',
      });
      expect(Number(row.rows[0].cod_collected_amount)).toBe(order.total_amount);
      expect(row.rows[0].delivered_at).not.toBeNull();
      expect(await deliveredHistory(order.id)).toEqual([{ old_status: 'OUT_FOR_DELIVERY' }]);
    });

    it('refuses collection before pickup and before arrival', async () => {
      const { order, deliveryId } = await assignedDelivery();
      const beforePickup = await collect(deliveryId, order.total_amount);
      expect(beforePickup.status).toBe(409);
      expect(beforePickup.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
      const beforeArrival = await collect(deliveryId, order.total_amount);
      expect(beforeArrival.status).toBe(409);
      expect(beforeArrival.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect(await paymentStatus(order.id)).toBe('PENDING');
    });

    it('refuses a second collection with 409 COD_ALREADY_COLLECTED and writes nothing new', async () => {
      const { order, deliveryId } = await arrivedDelivery();
      expect((await collect(deliveryId, order.total_amount)).status).toBe(200);
      const again = await collect(deliveryId, order.total_amount);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('COD_ALREADY_COLLECTED');
      expect(await deliveredHistory(order.id)).toHaveLength(1);
    });

    it('concurrent double collection: exactly one succeeds, one settlement is recorded', async () => {
      const { order, deliveryId } = await arrivedDelivery();
      const results = await Promise.all([collect(deliveryId, order.total_amount), collect(deliveryId, order.total_amount)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await deliveredHistory(order.id)).toHaveLength(1);
      const n = await pool.query(
        `SELECT count(*)::int n FROM notifications WHERE order_id = $1 AND notification_type IN ('DELIVERED', 'COD_PAYMENT_CONFIRMED')`,
        [order.id]
      );
      expect(n.rows[0].n).toBe(2);
    });

    it('refuses collection when an operator closed the order meanwhile', async () => {
      const { order, deliveryId } = await arrivedDelivery();
      // An order on the road cannot be cancelled any more (dispatch plan §O);
      // an admin can still close it as failed, which the rider must respect.
      const close = await request(app)
        .patch(`/api/v1/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ status: 'FAILED', notes: 'Customer refused at the door' });
      expect(close.status).toBe(200);
      const res = await collect(deliveryId, order.total_amount);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_ACTIVE');
      expect(await paymentStatus(order.id)).toBe('PENDING');
    });

    it('refuses an amount other than the backend total', async () => {
      const { order, deliveryId } = await arrivedDelivery();
      const res = await collect(deliveryId, order.total_amount - 10);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COD_AMOUNT');
      expect(res.body.error.details).toMatchObject({ expected_amount: order.total_amount });
      expect(await paymentStatus(order.id)).toBe('PENDING');
    });

    it('checks the amount against the total read under the lock, not an earlier read', async () => {
      const { order, deliveryId } = await arrivedDelivery();
      // A second connection holds the order row and lowers the total (as an
      // item resolution would) while the collection is in flight. The
      // collection must wait for the lock and judge the amount on what it
      // reads then, not on a read taken before it waited.
      const other = await pool.connect();
      try {
        await other.query('BEGIN');
        await other.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
        await other.query(
          'UPDATE orders SET subtotal_amount = subtotal_amount - 1, total_amount = total_amount - 1 WHERE id = $1',
          [order.id]
        );
        const pending = collect(deliveryId, order.total_amount).then((r) => r);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await other.query('COMMIT');
        const res = await pending;
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_COD_AMOUNT');
        expect(await paymentStatus(order.id)).toBe('PENDING');
      } finally {
        other.release();
      }
    });

    it('refuses to settle an order that is not cash on delivery', async () => {
      const { order, deliveryId } = await arrivedDelivery();
      await pool.query(`UPDATE orders SET payment_method = 'ONLINE' WHERE id = $1`, [order.id]);
      const res = await collect(deliveryId, order.total_amount);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_COD_ORDER');
    });
  });

  describe('assignment (the admin API the rider depends on)', () => {
    const deliveriesFor = async (orderId: string) =>
      (await pool.query('SELECT rider_id, assignment_status FROM deliveries WHERE order_id = $1', [orderId])).rows;

    it('requires a PACKED order', async () => {
      const order = await placeOrder();
      const res = await assign(order.id, RIDER_A);
      // 422: the documented code for "order not in PACKED status" (dispatch plan D1).
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_ASSIGNMENT');
      expect(res.body.error.details).toMatchObject({ order_status: 'PLACED' });
      expect(await deliveriesFor(order.id)).toEqual([]);
    });

    it('rejects an unknown rider with 404 and a second active assignment with 409', async () => {
      const order = await placeOrder();
      await pack(order.id);
      const unknown = await assign(order.id, '00000000-0000-0000-0000-00000000dead');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('RIDER_NOT_FOUND');
      expect((await assign(order.id, RIDER_A)).status).toBe(200);
      const dup = await assign(order.id, RIDER_B);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('ORDER_ALREADY_ASSIGNED');
      expect(await deliveriesFor(order.id)).toEqual([{ rider_id: RIDER_A, assignment_status: 'ASSIGNED' }]);
    });

    it('refuses an inactive rider', async () => {
      const order = await placeOrder();
      await pack(order.id);
      await pool.query('UPDATE riders SET is_active = false WHERE id = $1', [RIDER_B]);
      try {
        const res = await assign(order.id, RIDER_B);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('RIDER_INACTIVE');
      } finally {
        await pool.query('UPDATE riders SET is_active = true WHERE id = $1', [RIDER_B]);
      }
      expect(await deliveriesFor(order.id)).toEqual([]);
    });

    it('a rider cannot assign, and an unknown order is 404', async () => {
      const order = await placeOrder();
      await pack(order.id);
      const self = await request(app)
        .post(`/api/v1/admin/orders/${order.id}/assign-rider`)
        .set('Authorization', `Bearer ${tokens.riderA}`)
        .send({ rider_id: RIDER_A });
      expect(self.status).toBe(403);
      const missing = await assign('00000000-0000-0000-0000-00000000beef', RIDER_A);
      expect(missing.status).toBe(404);
      expect(await deliveriesFor(order.id)).toEqual([]);
    });

    it('concurrent assignment of one order to two riders: exactly one succeeds', async () => {
      const order = await placeOrder();
      await pack(order.id);
      const results = await Promise.all([assign(order.id, RIDER_A), assign(order.id, RIDER_B)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await deliveriesFor(order.id)).toHaveLength(1);
    });
  });

  describe('customer cancellation vs rider pickup', () => {
    it('the cancellation write itself re-checks the status under a lock', async () => {
      const { order, deliveryId } = await assignedDelivery();
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
      // The service pre-check read PACKED a moment earlier; the repository
      // must not trust it.
      await expect(
        runTransition('CUSTOMER_CANCEL', { actor: customer, orderId: order.id, input: { reason: 'late cancel' } })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'ORDER_ALREADY_OUT_FOR_DELIVERY',
      });
      const row = await pool.query('SELECT order_status FROM orders WHERE id = $1', [order.id]);
      expect(row.rows[0].order_status).toBe('OUT_FOR_DELIVERY');
    });

    it('records the status the order was cancelled from', async () => {
      const { order } = await assignedDelivery();
      const res = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${tokens.customer}`)
        .send({ reason: 'No longer needed' });
      expect(res.status).toBe(200);
      const hist = await pool.query(
        `SELECT old_status FROM order_status_history WHERE order_id = $1 AND new_status = 'CANCELLED'`,
        [order.id]
      );
      expect(hist.rows).toEqual([{ old_status: 'PACKED' }]);
    });

    it('a cancel racing a pickup leaves the order and delivery consistent', async () => {
      for (let i = 0; i < 5; i++) {
        const { order, deliveryId } = await assignedDelivery();
        const [cancel, pickup] = await Promise.all([
          request(app).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${tokens.customer}`).send({}),
          setStatus(deliveryId, { status: 'PICKED_UP' }),
        ]);
        const row = await pool.query(
          'SELECT o.order_status, d.assignment_status FROM orders o JOIN deliveries d ON d.order_id = o.id WHERE o.id = $1',
          [order.id]
        );
        const { order_status, assignment_status } = row.rows[0];
        if (cancel.status === 200) {
          expect(pickup.status).toBe(409);
          expect([order_status, assignment_status]).toEqual(['CANCELLED', 'ASSIGNED']);
        } else {
          expect(pickup.status).toBe(200);
          expect(cancel.status).toBe(400);
          expect(cancel.body.error.code).toBe('ORDER_ALREADY_OUT_FOR_DELIVERY');
          expect([order_status, assignment_status]).toEqual(['OUT_FOR_DELIVERY', 'PICKED_UP']);
        }
      }
    });
  });

  describe('what the rider and the customer see', () => {
    const listFor = async (token: string) =>
      (await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${token}`)).body.data
        .deliveries as Array<{ delivery_id: string; order_status: string }>;

    it('detail lists bag items by name and quantity, with no prices, costs, coordinates or internal notes', async () => {
      const { deliveryId } = await assignedDelivery();
      const res = await request(app)
        .get(`/api/v1/riders/deliveries/${deliveryId}`)
        .set('Authorization', `Bearer ${tokens.riderA}`);
      expect(res.status).toBe(200);
      const d = res.body.data.delivery;
      expect(d.items).toEqual([
        // Packed with the order (dispatch D8).
        { id: expect.any(String), product_name_snapshot: expect.any(String), quantity: 1, item_status: 'PACKED' },
      ]);
      const json = JSON.stringify(d);
      for (const key of [
        'estimated_unit_cost',
        'actual_unit_cost',
        'markup_percentage_applied',
        'internal_notes',
        'supplier',
        'customer_id',
        'unit_selling_price',
      ]) {
        expect(json).not.toContain(key);
      }
    });

    it('omits items resolved as unavailable', async () => {
      const BUTTER = 'b0000001-0000-0000-0000-000000000002';
      const placed = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokens.customer}`)
        .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }, { product_id: BUTTER, quantity: 1 }] });
      expect(placed.status).toBe(201);
      const orderId = placed.body.data.order.id;
      createdOrders.push(orderId);
      const butter = await pool.query('SELECT id FROM order_items WHERE order_id = $1 AND product_id = $2', [orderId, BUTTER]);
      const resolved = await request(app)
        .post(`/api/v1/admin/orders/${orderId}/resolve-item`)
        .set('Authorization', `Bearer ${tokens.staff}`)
        .send({ item_id: butter.rows[0].id, item_status: 'UNAVAILABLE' });
      expect(resolved.status).toBe(200);
      expect((await pack(orderId)).status).toBe(200);
      const a = await assign(orderId, RIDER_A);
      const res = await request(app)
        .get(`/api/v1/riders/deliveries/${a.body.data.delivery.id}`)
        .set('Authorization', `Bearer ${tokens.riderA}`);
      expect(res.body.data.delivery.items.map((i: { product_name_snapshot: string }) => i.product_name_snapshot)).toEqual([
        expect.stringMatching(/milk/i),
      ]);
    });

    it("rider B cannot read, move or settle rider A's delivery, and an order id is not a delivery id", async () => {
      const { order, deliveryId } = await assignedDelivery();
      const read = await request(app)
        .get(`/api/v1/riders/deliveries/${deliveryId}`)
        .set('Authorization', `Bearer ${tokens.riderB}`);
      expect(read.status).toBe(404);
      expect(read.body.error.code).toBe('DELIVERY_NOT_FOUND');
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.riderB)).status).toBe(404);
      expect((await collect(deliveryId, order.total_amount, tokens.riderB)).status).toBe(404);
      const byOrderId = await request(app)
        .get(`/api/v1/riders/deliveries/${order.id}`)
        .set('Authorization', `Bearer ${tokens.riderA}`);
      expect(byOrderId.status).toBe(404);
      expect((await listFor(tokens.riderB)).find((x) => x.delivery_id === deliveryId)).toBeUndefined();
      const row = await pool.query('SELECT assignment_status FROM deliveries WHERE id = $1', [deliveryId]);
      expect(row.rows[0].assignment_status).toBe('ASSIGNED');
    });

    it('ignores a rider_id or amount smuggled into a status update', async () => {
      const { order, deliveryId } = await assignedDelivery();
      const res = await setStatus(deliveryId, { status: 'PICKED_UP', rider_id: RIDER_B, total_amount: 1 });
      expect(res.status).toBe(200);
      const row = await pool.query(
        'SELECT d.rider_id, o.total_amount FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = $1',
        [deliveryId]
      );
      expect(row.rows[0].rider_id).toBe(RIDER_A);
      expect(Number(row.rows[0].total_amount)).toBe(order.total_amount);
    });

    it.each(['customer', 'staff', 'admin'] as const)('%s gets 403 on every rider endpoint', async (who) => {
      const { order, deliveryId } = await assignedDelivery();
      const auth = `Bearer ${tokens[who]}`;
      for (const res of [
        await request(app).get('/api/v1/riders/deliveries').set('Authorization', auth),
        await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set('Authorization', auth),
        await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens[who]),
        await collect(deliveryId, order.total_amount, tokens[who]),
      ]) {
        expect(res.status).toBe(403);
      }
    });

    it("the list holds active work and today's closed deliveries, not older ones", async () => {
      const active = await assignedDelivery();
      const oldDelivered = await assignedDelivery();
      await pool.query(
        `UPDATE deliveries SET assignment_status = 'DELIVERED', delivered_at = now() - interval '2 days' WHERE id = $1`,
        [oldDelivered.deliveryId]
      );
      const cancelledToday = await assignedDelivery();
      await request(app)
        .post(`/api/v1/orders/${cancelledToday.order.id}/cancel`)
        .set('Authorization', `Bearer ${tokens.customer}`)
        .send({});
      const cancelledOld = await assignedDelivery();
      await pool.query(
        `UPDATE orders SET order_status = 'CANCELLED', updated_at = now() - interval '2 days' WHERE id = $1`,
        [cancelledOld.order.id]
      );
      const list = await listFor(tokens.riderA);
      const ids = list.map((x) => x.delivery_id);
      expect(ids).toContain(active.deliveryId);
      expect(ids).toContain(cancelledToday.deliveryId);
      expect(list.find((x) => x.delivery_id === cancelledToday.deliveryId)!.order_status).toBe('CANCELLED');
      expect(ids).not.toContain(oldDelivered.deliveryId);
      expect(ids).not.toContain(cancelledOld.deliveryId);
    });

    it("the customer sees the rider's state change through the existing order API, without rider internals", async () => {
      const { order, deliveryId } = await assignedDelivery();
      await setStatus(deliveryId, { status: 'PICKED_UP' });
      await setStatus(deliveryId, { status: 'FAILED', failure_reason: 'Rider note that is not for the customer' });
      const res = await request(app).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${tokens.customer}`);
      expect(res.status).toBe(200);
      expect(res.body.data.order.order_status).toBe('FAILED');
      expect(JSON.stringify(res.body.data.order)).not.toContain('Rider note that is not for the customer');

      const live = await assignedDelivery();
      await setStatus(live.deliveryId, { status: 'PICKED_UP' });
      const detail = await request(app)
        .get(`/api/v1/orders/${live.order.id}`)
        .set('Authorization', `Bearer ${tokens.customer}`);
      expect(detail.body.data.order.order_status).toBe('OUT_FOR_DELIVERY');
      expect(Object.keys(detail.body.data.order.delivery).sort()).toEqual([
        'assigned_at',
        'assignment_status',
        'delivered_at',
        'picked_up_at',
      ]);
      const list = await request(app).get('/api/v1/orders').set('Authorization', `Bearer ${tokens.customer}`);
      const listed = list.body.data.orders.find((o: { id: string }) => o.id === live.order.id);
      expect(listed.order_status).toBe('OUT_FOR_DELIVERY');
    });
  });
});
