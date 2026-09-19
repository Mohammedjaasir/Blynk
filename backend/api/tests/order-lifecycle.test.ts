import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * The canonical order lifecycle (dispatch plan §O.2), end to end through the
 * real routes and database: one describe per catalogue row, every documented
 * error in precedence order (with the database unchanged), side effects,
 * history, what the customer sees, notifications, and concurrent races.
 *
 * Every order, delivery, notification, address, rider and user created here is
 * removed in afterAll. Only seeded UNTRACKED products are ordered.
 */
describe('Order lifecycle', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const riderBUser = { id: 'a0000009-0000-0000-0000-00000000000c', phone: '+94770009902', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const RIDER_B = 'f0000009-0000-0000-0000-00000000000c';
  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // Rs. 540, UNTRACKED
  const BUTTER = 'b0000001-0000-0000-0000-000000000002'; // Rs. 805, UNTRACKED
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
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, 'Lifecycle Rider B', 'RIDER')`, [
      riderBUser.id,
      riderBUser.phone,
    ]);
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       VALUES ($1, $2, $3, 'TEST-LC-0002', true, true)`,
      [RIDER_B, riderBUser.id, DARK_STORE]
    );
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Lifecycle test', 'Lifecycle Test', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
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

  // ---------------------------------------------------------------- helpers
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function placeOrder(products: string[] = [MILK]) {
    const res = await request(app)
      .post('/api/v1/orders')
      .set(auth(tokens.customer))
      .send({ address_id: addressId, items: products.map((product_id) => ({ product_id, quantity: 1 })) });
    expect(res.status).toBe(201);
    const order = res.body.data.order as { id: string; total_amount: number; order_number: string };
    createdOrders.push(order.id);
    const items = (await pool.query('SELECT id, product_id FROM order_items WHERE order_id = $1 ORDER BY id', [order.id])).rows;
    return { ...order, itemIds: items.map((r) => r.id as string), itemFor: (p: string) => items.find((r) => r.product_id === p)!.id as string };
  }
  const source = (orderId: string, itemId: string) =>
    request(app).post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`).set(auth(tokens.staff)).send({ actual_unit_cost: 450 });
  const resolve = (orderId: string, itemId: string, item_status = 'UNAVAILABLE') =>
    request(app).post(`/api/v1/admin/orders/${orderId}/resolve-item`).set(auth(tokens.staff)).send({ item_id: itemId, item_status });
  const setStatus = (orderId: string, status: string, token = tokens.admin, notes?: string) =>
    request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set(auth(token)).send(notes === undefined ? { status } : { status, notes });
  const assign = (orderId: string, riderId = RIDER_A, token = tokens.admin) =>
    request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set(auth(token)).send({ rider_id: riderId });
  const riderStep = (deliveryId: string, body: object, token = tokens.riderA) =>
    request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set(auth(token)).send(body);
  const collect = (deliveryId: string, amount: number, token = tokens.riderA) =>
    request(app).post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`).set(auth(token)).send({ amount });
  const customerCancel = (orderId: string, token = tokens.customer) =>
    request(app).post(`/api/v1/orders/${orderId}/cancel`).set(auth(token)).send({ reason: 'Changed my mind' });

  const row = async (orderId: string) =>
    (
      await pool.query(
        `SELECT o.order_status, o.payment_status, o.total_amount::float AS total, o.cancellation_reason, o.cancelled_by_user_id,
                o.packed_at, o.dispatched_at, o.delivered_at, p.payment_status AS pay, p.amount::float AS pay_amount
           FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
        [orderId]
      )
    ).rows[0];
  const history = async (orderId: string) =>
    (
      await pool.query(
        `SELECT old_status, new_status, changed_by_user_id, reason_or_notes FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id`,
        [orderId]
      )
    ).rows;
  const deliveries = async (orderId: string) =>
    (await pool.query('SELECT id, rider_id, assignment_status, failure_reason FROM deliveries WHERE order_id = $1 ORDER BY assigned_at, id', [orderId])).rows;
  const notifications = async (orderId: string, type: string) =>
    (await pool.query('SELECT count(*)::int n FROM notifications WHERE order_id = $1 AND notification_type = $2', [orderId, type])).rows[0].n;
  const itemStatuses = async (orderId: string) =>
    (await pool.query('SELECT item_status FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])).rows.map((r) => r.item_status);
  const snapshot = async (orderId: string) => ({
    order: await row(orderId),
    history: await history(orderId),
    deliveries: await deliveries(orderId),
    items: await itemStatuses(orderId),
  });

  /** An order whose items are all sourced (ready to pack). */
  async function sourcedOrder(products: string[] = [MILK]) {
    const order = await placeOrder(products);
    for (const id of order.itemIds) expect((await source(order.id, id)).status).toBe(200);
    return order;
  }
  /** A PACKED order. */
  async function packedOrder(products: string[] = [MILK]) {
    const order = await sourcedOrder(products);
    expect((await setStatus(order.id, 'PACKED', tokens.staff)).status).toBe(200);
    return order;
  }
  /** A PACKED order with rider A assigned. */
  async function assignedOrder() {
    const order = await packedOrder();
    const res = await assign(order.id);
    expect(res.status).toBe(200);
    return { order, deliveryId: res.body.data.delivery.id as string };
  }
  /** OUT_FOR_DELIVERY, delivery PICKED_UP (optionally ARRIVED). */
  async function onTheRoad(arrived = false) {
    const a = await assignedOrder();
    expect((await riderStep(a.deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
    if (arrived) expect((await riderStep(a.deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
    return a;
  }
  /** Runs `fn` concurrently `times` times and checks no deadlock was reported. */
  async function race<T extends { status: number; body: any }>(...fns: Array<() => Promise<T>>) {
    const results = await Promise.all(fns.map((f) => f()));
    for (const r of results) expect(r.body?.error?.message ?? '').not.toMatch(/deadlock/i);
    for (const r of results) expect(r.status).not.toBe(500);
    return results;
  }

  // ============================================================ Task 2
  describe('request hygiene on admin order routes', () => {
    it.each([
      ['GET detail', () => request(app).get('/api/v1/admin/orders/not-a-uuid').set(auth(tokens.admin))],
      ['PATCH status', () => setStatus('not-a-uuid', 'PACKED')],
      ['POST assign', () => assign('not-a-uuid')],
    ])('%s with a malformed order id → 400', async (_label, call) => {
      const res = await call();
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('an unknown order → 404 on detail, status and assign', async () => {
      const missing = '00000000-0000-0000-0000-00000000beef';
      expect((await request(app).get(`/api/v1/admin/orders/${missing}`).set(auth(tokens.admin))).status).toBe(404);
      expect((await setStatus(missing, 'CANCELLED', tokens.admin, 'x')).body.error.code).toBe('ORDER_NOT_FOUND');
      expect((await assign(missing)).body.error.code).toBe('ORDER_NOT_FOUND');
    });
  });

  describe('#2 RESOLVE_ITEM', () => {
    it('PLACED → ITEM_UNAVAILABLE records one history row; a second item keeps the status without another', async () => {
      const order = await placeOrder([MILK, BUTTER]);
      expect((await resolve(order.id, order.itemFor(MILK))).status).toBe(200);
      expect((await row(order.id)).order_status).toBe('ITEM_UNAVAILABLE');
      expect((await row(order.id)).total).toBe(805 + 70);
      expect((await history(order.id)).map((h) => [h.old_status, h.new_status])).toEqual([
        [null, 'PLACED'],
        ['PLACED', 'ITEM_UNAVAILABLE'],
      ]);
      expect((await resolve(order.id, order.itemFor(BUTTER), 'SUBSTITUTED')).status).toBe(200);
      expect(await history(order.id)).toHaveLength(2);
      expect(await notifications(order.id, 'ITEM_UNAVAILABLE')).toBe(2);
    });

    it.each(['PACKED', 'OUT_FOR_DELIVERY', 'FAILED'])(
      'is refused once the order is %s (D9), with totals and status unchanged',
      async (state) => {
        const order = await placeOrder([MILK, BUTTER]);
        await source(order.id, order.itemFor(MILK));
        // Put the order in the state directly: the point is what resolve does there.
        await pool.query(`UPDATE orders SET order_status = $2 WHERE id = $1`, [order.id, state]);
        const before = await snapshot(order.id);
        const res = await resolve(order.id, order.itemFor(BUTTER));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('ORDER_NOT_IN_SOURCING_STATE');
        expect(await snapshot(order.id)).toEqual(before);
      }
    );
  });

  describe('#4 ASSIGN_RIDER', () => {
    it('an order that is not PACKED → 422 ORDER_NOT_READY_FOR_ASSIGNMENT (D1)', async () => {
      const order = await placeOrder();
      const res = await assign(order.id);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ORDER_NOT_READY_FOR_ASSIGNMENT');
      expect(await deliveries(order.id)).toEqual([]);
    });

    it('sends one RIDER_ASSIGNED message per assignment', async () => {
      const { order } = await assignedOrder();
      expect(await notifications(order.id, 'RIDER_ASSIGNED')).toBe(1);
    });
  });

  describe('sourcing (item work, not a status change)', () => {
    it('is refused once the order is PACKED (D9)', async () => {
      const order = await placeOrder([MILK, BUTTER]);
      await source(order.id, order.itemFor(MILK));
      await pool.query(`UPDATE orders SET order_status = 'PACKED' WHERE id = $1`, [order.id]);
      const res = await source(order.id, order.itemFor(BUTTER));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_NOT_IN_SOURCING_STATE');
      expect(await itemStatuses(order.id)).toContain('PENDING');
    });
  });

  // ============================================================ Tasks 3-5
  describe('#1 CUSTOMER_CANCEL', () => {
    it("another customer's order is a 404, and nothing changes", async () => {
      const order = await placeOrder();
      const other = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000005', phone: '+94770000005', role: 'CUSTOMER' });
      const before = await snapshot(order.id);
      const res = await customerCancel(order.id, other);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
      expect(await snapshot(order.id)).toEqual(before);
    });

    it('ITEM_UNAVAILABLE stays cancellable only by an admin (D2)', async () => {
      const order = await placeOrder([MILK, BUTTER]);
      await resolve(order.id, order.itemFor(MILK));
      const res = await customerCancel(order.id);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_CANNOT_BE_CANCELLED');
    });
  });

  describe('#3 PACK', () => {
    it('refuses while an item is still to source, and changes nothing', async () => {
      const order = await placeOrder([MILK, BUTTER]);
      await source(order.id, order.itemFor(MILK));
      const before = await snapshot(order.id);
      const res = await setStatus(order.id, 'PACKED', tokens.staff);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ORDER_NOT_PACKABLE');
      expect(res.body.error.details).toEqual({ pending: 1, unsourced_substitutions: 0, packable_items: 1 });
      expect(await snapshot(order.id)).toEqual(before);
    });

    it('packs a fully sourced order: items PACKED, packed_at, one history row by the packer, no SMS', async () => {
      const order = await sourcedOrder([MILK, BUTTER]);
      const res = await setStatus(order.id, 'PACKED', tokens.staff);
      expect(res.status).toBe(200);
      expect(res.body.data.order.order_status).toBe('PACKED');
      expect(await itemStatuses(order.id)).toEqual(['PACKED', 'PACKED']);
      expect((await row(order.id)).packed_at).not.toBeNull();
      const h = await history(order.id);
      expect(h.at(-1)).toMatchObject({ old_status: 'PLACED', new_status: 'PACKED', changed_by_user_id: staff.id });
      const sms = await pool.query('SELECT notification_type FROM notifications WHERE order_id = $1', [order.id]);
      expect(sms.rows.map((r) => r.notification_type)).toEqual(['ORDER_PLACED']);
    });

    it('packs an ITEM_UNAVAILABLE order once the rest is sourced; an all-unavailable order cannot be packed', async () => {
      const order = await placeOrder([MILK, BUTTER]);
      await resolve(order.id, order.itemFor(MILK));
      await source(order.id, order.itemFor(BUTTER));
      expect((await setStatus(order.id, 'PACKED', tokens.staff)).status).toBe(200);
      expect(await itemStatuses(order.id)).toEqual(expect.arrayContaining(['UNAVAILABLE', 'PACKED']));

      const empty = await placeOrder([MILK]);
      await resolve(empty.id, empty.itemFor(MILK));
      const res = await setStatus(empty.id, 'PACKED', tokens.staff);
      expect(res.status).toBe(422);
      expect(res.body.error.details).toMatchObject({ packable_items: 0 });
    });

    it('a second pack is an invalid transition', async () => {
      const order = await packedOrder();
      const res = await setStatus(order.id, 'PACKED', tokens.staff);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        details: { current_status: 'PACKED', requested_status: 'PACKED' },
      });
      expect((await history(order.id)).filter((h) => h.new_status === 'PACKED')).toHaveLength(1);
    });

    it('customers and riders cannot reach the endpoint', async () => {
      const order = await sourcedOrder();
      expect((await setStatus(order.id, 'PACKED', tokens.customer)).status).toBe(403);
      expect((await setStatus(order.id, 'PACKED', tokens.riderA)).status).toBe(403);
      expect((await row(order.id)).order_status).toBe('PLACED');
    });
  });

  describe('admin status endpoint: everything outside the catalogue is refused', () => {
    it.each(['PLACED', 'ITEM_UNAVAILABLE'])('→ %s is never an admin status change', async (target) => {
      const order = await placeOrder();
      const res = await setStatus(order.id, target, tokens.admin, 'note');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('PLACED cannot jump to OUT_FOR_DELIVERY or DELIVERED', async () => {
      const order = await sourcedOrder();
      expect((await setStatus(order.id, 'OUT_FOR_DELIVERY', tokens.admin)).body.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect((await setStatus(order.id, 'DELIVERED', tokens.admin, 'n')).body.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect((await row(order.id)).order_status).toBe('PLACED');
    });

    it('DELIVERED and CANCELLED are terminal', async () => {
      const { order, deliveryId } = await onTheRoad(true);
      expect((await collect(deliveryId, order.total_amount)).status).toBe(200);
      for (const target of ['PACKED', 'CANCELLED', 'FAILED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
        const res = await setStatus(order.id, target, tokens.admin, 'n');
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      }
      const cancelled = await placeOrder();
      await setStatus(cancelled.id, 'CANCELLED', tokens.admin, 'Out of stock everywhere');
      for (const target of ['PACKED', 'CANCELLED']) {
        expect((await setStatus(cancelled.id, target, tokens.admin, 'n')).status).toBe(422);
      }
    });
  });

  describe('#13 ADMIN_CANCEL', () => {
    it('staff may not cancel (403); an admin must give a reason (400)', async () => {
      const order = await placeOrder();
      const staffTry = await setStatus(order.id, 'CANCELLED', tokens.staff, 'reason');
      expect(staffTry.status).toBe(403);
      expect(staffTry.body.error.code).toBe('TRANSITION_NOT_PERMITTED_FOR_ROLE');
      expect((await setStatus(order.id, 'CANCELLED', tokens.admin)).status).toBe(400);
      expect((await setStatus(order.id, 'CANCELLED', tokens.admin, '   ')).status).toBe(400);
      expect((await row(order.id)).order_status).toBe('PLACED');
    });

    it('records the reason the customer sees, who cancelled, and sends ORDER_CANCELLED once', async () => {
      const order = await placeOrder();
      const res = await setStatus(order.id, 'CANCELLED', tokens.admin, 'Supplier closed today');
      expect(res.status).toBe(200);
      const r = await row(order.id);
      expect(r).toMatchObject({ order_status: 'CANCELLED', cancellation_reason: 'Supplier closed today', cancelled_by_user_id: admin.id });
      expect(await notifications(order.id, 'ORDER_CANCELLED')).toBe(1);
      const seen = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(tokens.customer));
      expect(seen.body.data.order).toMatchObject({ order_status: 'CANCELLED', cancellation_reason: 'Supplier closed today' });
    });

    it('a PACKED order with a rider waiting: cancelled, the rider can no longer pick it up', async () => {
      const { order, deliveryId } = await assignedOrder();
      expect((await setStatus(order.id, 'CANCELLED', tokens.admin, 'Customer asked by phone')).status).toBe(200);
      const pickup = await riderStep(deliveryId, { status: 'PICKED_UP' });
      expect(pickup.status).toBe(409);
      expect(pickup.body.error.code).toBe('ORDER_NOT_ACTIVE');
    });

    it('cannot cancel an order that is on the road', async () => {
      const { order } = await onTheRoad();
      const res = await setStatus(order.id, 'CANCELLED', tokens.admin, 'late');
      expect(res.status).toBe(422);
      expect((await row(order.id)).order_status).toBe('OUT_FOR_DELIVERY');
    });
  });

  describe('#5 HAND_TO_RIDER (D3)', () => {
    it('needs an assigned rider', async () => {
      const order = await packedOrder();
      const res = await setStatus(order.id, 'OUT_FOR_DELIVERY', tokens.staff);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NO_ACTIVE_DELIVERY');
      expect((await row(order.id)).order_status).toBe('PACKED');
    });

    it('staff hand the bag over: order OUT_FOR_DELIVERY, delivery PICKED_UP, the rider continues at "arrived"', async () => {
      const { order, deliveryId } = await assignedOrder();
      const res = await setStatus(order.id, 'OUT_FOR_DELIVERY', tokens.staff);
      expect(res.status).toBe(200);
      expect((await row(order.id)).order_status).toBe('OUT_FOR_DELIVERY');
      expect((await row(order.id)).dispatched_at).not.toBeNull();
      expect((await deliveries(order.id))[0].assignment_status).toBe('PICKED_UP');
      expect(await notifications(order.id, 'OUT_FOR_DELIVERY')).toBe(1);
      expect((await history(order.id)).at(-1)).toMatchObject({ old_status: 'PACKED', new_status: 'OUT_FOR_DELIVERY', changed_by_user_id: staff.id });

      const pickup = await riderStep(deliveryId, { status: 'PICKED_UP' });
      expect(pickup.status).toBe(409);
      expect(pickup.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await riderStep(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
      expect((await collect(deliveryId, order.total_amount)).status).toBe(200);
      expect(await notifications(order.id, 'OUT_FOR_DELIVERY')).toBe(1);
    });
  });

  describe('#10 ADMIN_MARK_DELIVERED (D4, shared settlement)', () => {
    it('admin only, with a note', async () => {
      const { order } = await onTheRoad(true);
      expect((await setStatus(order.id, 'DELIVERED', tokens.staff, 'x')).status).toBe(403);
      expect((await setStatus(order.id, 'DELIVERED', tokens.admin)).status).toBe(400);
      expect((await row(order.id)).order_status).toBe('OUT_FOR_DELIVERY');
    });

    it('settles exactly like the rider: delivery, payment, order, history and messages', async () => {
      const { order, deliveryId } = await onTheRoad(false);
      const res = await setStatus(order.id, 'DELIVERED', tokens.admin, 'Rider phone died; cash counted at the store');
      expect(res.status).toBe(200);
      const r = await row(order.id);
      expect(r).toMatchObject({ order_status: 'DELIVERED', payment_status: 'PAID', pay: 'PAID' });
      expect(r.delivered_at).not.toBeNull();
      const d = (await pool.query('SELECT assignment_status, cod_collected_amount::float amt FROM deliveries WHERE id = $1', [deliveryId])).rows[0];
      expect(d).toEqual({ assignment_status: 'DELIVERED', amt: order.total_amount });
      expect((await history(order.id)).at(-1)).toMatchObject({ old_status: 'OUT_FOR_DELIVERY', new_status: 'DELIVERED', changed_by_user_id: admin.id });
      expect(await notifications(order.id, 'DELIVERED')).toBe(1);
      expect(await notifications(order.id, 'COD_PAYMENT_CONFIRMED')).toBe(1);

      const again = await setStatus(order.id, 'DELIVERED', tokens.admin, 'again');
      expect(again.status).toBe(422);
      expect((await collect(deliveryId, order.total_amount)).body.error.code).toBe('COD_ALREADY_COLLECTED');
    });

    it('needs a rider on the road', async () => {
      const order = await packedOrder();
      await pool.query(`UPDATE orders SET order_status = 'OUT_FOR_DELIVERY' WHERE id = $1`, [order.id]);
      const res = await setStatus(order.id, 'DELIVERED', tokens.admin, 'n');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NO_ACTIVE_DELIVERY');
      expect((await row(order.id)).pay).toBe('PENDING');
    });
  });

  describe.each([
    ['FAILED', 'Customer refused the order'],
    ['CUSTOMER_UNAVAILABLE', 'No answer after three calls'],
  ])('#11/#12 admin marks %s (D5)', (target, note) => {
    it('admin only, with a note; closes the rider attempt and records the note for staff', async () => {
      const { order, deliveryId } = await onTheRoad(true);
      expect((await setStatus(order.id, target, tokens.staff, note)).status).toBe(403);
      expect((await setStatus(order.id, target, tokens.admin)).status).toBe(400);
      const res = await setStatus(order.id, target, tokens.admin, note);
      expect(res.status).toBe(200);
      expect((await row(order.id)).order_status).toBe(target);
      const d = (await deliveries(order.id))[0];
      expect(d).toMatchObject({ id: deliveryId, assignment_status: 'FAILED', failure_reason: note });
      expect((await history(order.id)).at(-1)).toMatchObject({ old_status: 'OUT_FOR_DELIVERY', new_status: target, reason_or_notes: note });
      expect((await row(order.id)).pay).toBe('PENDING');
      // The rider's app now shows it closed.
      expect((await collect(deliveryId, order.total_amount)).body.error.code).toBe('ORDER_NOT_ACTIVE');
    });
  });

  describe('#14 RESTAGE (D6 = B)', () => {
    async function failedOrder() {
      const a = await onTheRoad(true);
      expect((await riderStep(a.deliveryId, { status: 'FAILED', failure_reason: 'Bike broke down' })).status).toBe(200);
      return a;
    }

    it('admin only, with a note', async () => {
      const { order } = await failedOrder();
      expect((await setStatus(order.id, 'PACKED', tokens.staff, 'back')).status).toBe(403);
      expect((await setStatus(order.id, 'PACKED', tokens.admin)).status).toBe(400);
      expect((await row(order.id)).order_status).toBe('FAILED');
    });

    it('recovers a failed delivery: re-stage, replacement rider, delivered; the customer sees each step', async () => {
      const { order } = await failedOrder();
      expect((await assign(order.id, RIDER_B)).body.error.code).toBe('ORDER_NOT_READY_FOR_ASSIGNMENT');

      const res = await setStatus(order.id, 'PACKED', tokens.admin, 'Bag back at the store; reassigning');
      expect(res.status).toBe(200);
      expect((await history(order.id)).at(-1)).toMatchObject({ old_status: 'FAILED', new_status: 'PACKED', changed_by_user_id: admin.id });
      expect(await itemStatuses(order.id)).toEqual(['PACKED']);

      const again = await assign(order.id, RIDER_B);
      expect(again.status).toBe(200);
      const riderBDelivery = again.body.data.delivery.id;
      expect(await notifications(order.id, 'RIDER_ASSIGNED')).toBe(2);
      expect((await riderStep(riderBDelivery, { status: 'PICKED_UP' }, tokens.riderB)).status).toBe(200);
      expect(await notifications(order.id, 'OUT_FOR_DELIVERY')).toBe(2);
      expect((await riderStep(riderBDelivery, { status: 'ARRIVED_AT_CUSTOMER' }, tokens.riderB)).status).toBe(200);
      expect((await collect(riderBDelivery, order.total_amount, tokens.riderB)).status).toBe(200);

      expect((await history(order.id)).map((h) => h.new_status)).toEqual([
        'PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'FAILED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED',
      ]);
      const seen = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(tokens.customer));
      expect(seen.body.data.order.order_status).toBe('DELIVERED');
    });

    it('CUSTOMER_UNAVAILABLE can be re-staged too', async () => {
      const { order } = await onTheRoad(true);
      await setStatus(order.id, 'CUSTOMER_UNAVAILABLE', tokens.admin, 'No answer');
      expect((await setStatus(order.id, 'PACKED', tokens.admin, 'Try again tomorrow morning')).status).toBe(200);
      expect((await row(order.id)).order_status).toBe('PACKED');
    });

    it('refuses while a rider attempt is still active', async () => {
      const { order } = await onTheRoad(true);
      await pool.query(`UPDATE orders SET order_status = 'FAILED' WHERE id = $1`, [order.id]);
      const res = await setStatus(order.id, 'PACKED', tokens.admin, 'n');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ACTIVE_DELIVERY_EXISTS');
      expect((await row(order.id)).order_status).toBe('FAILED');
    });
  });

  // ============================================================ races
  describe('concurrency (5 repetitions each; no deadlock, consistent end state)', () => {
    const REPEAT = 5;

    it('pack ∥ pack → one PACKED, one 422', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const order = await sourcedOrder();
        const results = await race(() => setStatus(order.id, 'PACKED', tokens.staff), () => setStatus(order.id, 'PACKED', tokens.admin));
        expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
        expect((await history(order.id)).filter((h) => h.new_status === 'PACKED')).toHaveLength(1);
      }
    });

    it('pack ∥ customer cancel → cancelled either way, with an honest history', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const order = await sourcedOrder();
        const [p, c] = await race(() => setStatus(order.id, 'PACKED', tokens.staff), () => customerCancel(order.id));
        expect(c.status).toBe(200); // PLACED and PACKED are both cancellable by the customer (D2)
        expect((await row(order.id)).order_status).toBe('CANCELLED');
        const path = (await history(order.id)).map((h) => h.new_status);
        expect(path).toEqual(p.status === 200 ? ['PLACED', 'PACKED', 'CANCELLED'] : ['PLACED', 'CANCELLED']);
      }
    });

    it('pack ∥ sourcing the last item → never PACKED with an item still pending', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const order = await placeOrder([MILK, BUTTER]);
        await source(order.id, order.itemFor(MILK));
        const [s, p] = await race(() => source(order.id, order.itemFor(BUTTER)), () => setStatus(order.id, 'PACKED', tokens.staff));
        const status = (await row(order.id)).order_status;
        const items = await itemStatuses(order.id);
        if (p.status === 200) {
          expect(s.status).toBe(200);
          expect(items).toEqual(['PACKED', 'PACKED']);
        } else {
          expect(p.body.error.code).toBe('ORDER_NOT_PACKABLE');
          expect(status).toBe('PLACED');
        }
        expect(status === 'PACKED' && items.includes('PENDING')).toBe(false);
      }
    });

    it('pack ∥ resolve → totals and status agree whichever wins', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const order = await placeOrder([MILK, BUTTER]);
        await source(order.id, order.itemFor(MILK));
        const [p, rsv] = await race(() => setStatus(order.id, 'PACKED', tokens.staff), () => resolve(order.id, order.itemFor(BUTTER)));
        expect(rsv.status).toBe(200); // the pending item can always be resolved; pack cannot pass it
        const r = await row(order.id);
        expect(r.total).toBe(540 + 70);
        expect(r.pay_amount).toBe(540 + 70);
        expect(r.order_status).toBe(p.status === 200 ? 'PACKED' : 'ITEM_UNAVAILABLE');
      }
    });

    it('assign ∥ assign → one delivery', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const order = await packedOrder();
        const results = await race(() => assign(order.id, RIDER_A), () => assign(order.id, RIDER_B));
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(await deliveries(order.id)).toHaveLength(1);
      }
    });

    it('assign ∥ customer cancel, assign ∥ admin cancel → CANCELLED, at most one waiting delivery', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const order = await packedOrder();
        const [a, c] = await race(
          () => assign(order.id),
          () => (i % 2 ? customerCancel(order.id) : setStatus(order.id, 'CANCELLED', tokens.admin, 'n'))
        );
        expect(c.status).toBe(200);
        expect((await row(order.id)).order_status).toBe('CANCELLED');
        expect(await deliveries(order.id)).toHaveLength(a.status === 200 ? 1 : 0);
      }
    });

    it('admin cancel ∥ rider pickup → exactly one wins', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { order, deliveryId } = await assignedOrder();
        const [c, p] = await race(() => setStatus(order.id, 'CANCELLED', tokens.admin, 'n'), () => riderStep(deliveryId, { status: 'PICKED_UP' }));
        expect([c.status, p.status].filter((s) => s === 200)).toHaveLength(1);
        expect((await row(order.id)).order_status).toBe(c.status === 200 ? 'CANCELLED' : 'OUT_FOR_DELIVERY');
      }
    });

    it('hand-to-rider ∥ rider pickup → one dispatch, one OUT_FOR_DELIVERY message', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { order, deliveryId } = await assignedOrder();
        const results = await race(() => setStatus(order.id, 'OUT_FOR_DELIVERY', tokens.staff), () => riderStep(deliveryId, { status: 'PICKED_UP' }));
        expect(results.filter((r) => r.status === 200)).toHaveLength(1);
        expect(await notifications(order.id, 'OUT_FOR_DELIVERY')).toBe(1);
        expect((await history(order.id)).filter((h) => h.new_status === 'OUT_FOR_DELIVERY')).toHaveLength(1);
      }
    });

    it('admin FAILED ∥ rider collect → DELIVERED+PAID or FAILED+PENDING, never a mix', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { order, deliveryId } = await onTheRoad(true);
        await race(() => setStatus(order.id, 'FAILED', tokens.admin, 'n'), () => collect(deliveryId, order.total_amount));
        const r = await row(order.id);
        expect(`${r.order_status}/${r.pay}`).toBe(r.order_status === 'DELIVERED' ? 'DELIVERED/PAID' : 'FAILED/PENDING');
      }
    });

    it('admin DELIVERED ∥ rider collect → exactly one settlement', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { order, deliveryId } = await onTheRoad(true);
        const results = await race(() => setStatus(order.id, 'DELIVERED', tokens.admin, 'n'), () => collect(deliveryId, order.total_amount));
        expect(results.filter((r) => r.status === 200)).toHaveLength(1);
        expect((await history(order.id)).filter((h) => h.new_status === 'DELIVERED')).toHaveLength(1);
        expect(await notifications(order.id, 'DELIVERED')).toBe(1);
      }
    });

    it('restage ∥ assign → never an assignment on a FAILED order', async () => {
      for (let i = 0; i < REPEAT; i++) {
        const { order, deliveryId } = await onTheRoad(true);
        await riderStep(deliveryId, { status: 'FAILED', failure_reason: 'Flat tyre' });
        const [rs, as] = await race(() => setStatus(order.id, 'PACKED', tokens.admin, 'n'), () => assign(order.id, RIDER_B));
        expect(rs.status).toBe(200);
        const waiting = (await deliveries(order.id)).filter((d) => d.assignment_status === 'ASSIGNED');
        expect(waiting).toHaveLength(as.status === 200 ? 1 : 0);
        expect((await row(order.id)).order_status).toBe('PACKED');
      }
    });
  });
});
