import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { deliveryCodeForDelivery } from './helpers/delivery-code.js';
import { runTransition } from '../src/modules/orders/lifecycle/engine.js';
import { liftRiderTripCap } from './helpers/rider-trips.js';

// Many orders go to one seeded rider here; the trip cap has its own tests (rider-trips.test.ts).
liftRiderTripCap();

/**
 * Operations app RBAC (feature plan §2, §6, §7, §26, §27; task B1).
 *
 * The Operations operator is one users row with role='ADMIN' that may also be
 * linked to one riders row through the existing riders.user_id FK. The five
 * rider delivery routes and the four rider lifecycle actions are widened to
 * ['RIDER','ADMIN'] so that identity can do rider work - and nothing else
 * changes. Every guarantee the Rider app already had must survive intact:
 *
 *   ADMIN + linked, active rider  -> rider actions, own deliveries only
 *   ADMIN, no linked rider        -> 403 RIDER_PROFILE_NOT_FOUND
 *   ADMIN + INACTIVE linked rider -> 403 RIDER_INACTIVE
 *   RIDER-role user               -> completely unaffected
 *   CUSTOMER / PACKING_STAFF      -> 403 FORBIDDEN on all five routes
 *   any actor, another's delivery -> 404 DELIVERY_NOT_FOUND, never 403
 *
 * Rider identity is never read from the request: it is always resolved from
 * the authenticated user's own riders row (riderRepository.findRiderByUserId).
 *
 * Every user, rider, order, delivery, payment, notification and address
 * created here is removed in afterAll.
 */
describe('Operations RBAC: an ADMIN linked to a rider profile', () => {
  const app = createApp();
  // Seeded accounts (same ids the rider/delivery suite uses).
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const plainAdmin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const SEEDED_RIDER = 'f0000001-0000-0000-0000-000000000001';

  // Created here: the Operations operator (ADMIN with a linked rider row) and
  // an unrelated rider whose deliveries the operator must never reach.
  const opsUser = { id: 'a0000009-0000-0000-0000-0000000000a1', phone: '+94770009921', role: 'ADMIN' as const };
  const otherRiderUser = { id: 'a0000009-0000-0000-0000-0000000000a2', phone: '+94770009922', role: 'RIDER' as const };
  const RIDER_OPS = 'f0000009-0000-0000-0000-0000000000a1';
  const RIDER_OTHER = 'f0000009-0000-0000-0000-0000000000a2';

  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // Kotmale 1L, UNTRACKED: no stock moves

  const tokens = {
    customer: generateAccessToken(customer),
    plainAdmin: generateAccessToken(plainAdmin),
    staff: generateAccessToken(staff),
    rider: generateAccessToken(riderUser),
    ops: generateAccessToken(opsUser),
    otherRider: generateAccessToken(otherRiderUser),
  };

  const createdOrders: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, 'Ops Operator', 'ADMIN')`, [
      opsUser.id,
      opsUser.phone,
    ]);
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, 'Other Rider', 'RIDER')`, [
      otherRiderUser.id,
      otherRiderUser.phone,
    ]);
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       VALUES ($1, $2, $3, 'TEST-OPS-0001', true, true)`,
      [RIDER_OPS, opsUser.id, DARK_STORE]
    );
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       VALUES ($1, $2, $3, 'TEST-OTH-0001', true, true)`,
      [RIDER_OTHER, otherRiderUser.id, DARK_STORE]
    );
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Ops RBAC test', 'Ops Test', '+94771234567', 'No. 2, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
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
    await pool.query('DELETE FROM deliveries WHERE rider_id = ANY($1)', [[RIDER_OPS, RIDER_OTHER]]);
    await pool.query('DELETE FROM riders WHERE id = ANY($1)', [[RIDER_OPS, RIDER_OTHER]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[opsUser.id, otherRiderUser.id]]);
  });

  // ── fixtures ──────────────────────────────────────────────────────────────
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
      .set('Authorization', `Bearer ${tokens.plainAdmin}`)
      .send({ rider_id: riderId });

  /** A PACKED order assigned to `riderId`, ready for its first rider step. */
  async function assignedDelivery(riderId: string = RIDER_OPS) {
    const order = await placeOrder();
    expect((await pack(order.id)).status).toBe(200);
    const res = await assign(order.id, riderId);
    expect(res.status).toBe(200);
    return { order, deliveryId: res.body.data.delivery.id as string };
  }

  const detail = (id: string, token: string) =>
    request(app).get(`/api/v1/riders/deliveries/${id}`).set('Authorization', `Bearer ${token}`);
  const setStatus = (id: string, body: object, token: string) =>
    request(app).patch(`/api/v1/riders/deliveries/${id}/status`).set('Authorization', `Bearer ${token}`).send(body);
  // With the customer's proof-of-delivery code (migration 016).
  const collect = async (id: string, amount: number, token: string) =>
    request(app)
      .post(`/api/v1/riders/deliveries/${id}/collect-cod`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount, delivery_code: await deliveryCodeForDelivery(id) });
  const point = (overrides: Record<string, unknown> = {}) => ({
    latitude: 6.436,
    longitude: 80.026,
    accuracy: 12.5,
    captured_at: new Date().toISOString(),
    ...overrides,
  });
  const sendLocation = (id: string, token: string, body: unknown = point()) =>
    request(app).post(`/api/v1/riders/deliveries/${id}/location`).set('Authorization', `Bearer ${token}`).send(body);

  /** Every one of the five widened routes, in one call, with valid payloads. */
  const allFiveRoutes = async (token: string, deliveryId: string, amount: number) => [
    await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${token}`),
    await detail(deliveryId, token),
    await setStatus(deliveryId, { status: 'PICKED_UP' }, token),
    await collect(deliveryId, amount, token),
    await sendLocation(deliveryId, token),
  ];

  const orderStatus = async (orderId: string) =>
    (await pool.query('SELECT order_status FROM orders WHERE id = $1', [orderId])).rows[0].order_status;
  const deliveryRow = async (id: string) =>
    (await pool.query('SELECT rider_id, assignment_status FROM deliveries WHERE id = $1', [id])).rows[0];

  // ── 1. the capability the Operations app needs ────────────────────────────
  describe('ADMIN with a linked, active rider profile', () => {
    it('picks up its own delivery, and the history records the ADMIN user who did it', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      const res = await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.ops);
      expect(res.status).toBe(200);
      expect(res.body.data.delivery.assignment_status).toBe('PICKED_UP');
      expect(res.body.data.delivery.order_status).toBe('OUT_FOR_DELIVERY');
      expect(await orderStatus(order.id)).toBe('OUT_FOR_DELIVERY');
      const hist = await pool.query(
        `SELECT old_status, new_status, changed_by_user_id FROM order_status_history
          WHERE order_id = $1 AND new_status = 'OUT_FOR_DELIVERY'`,
        [order.id]
      );
      expect(hist.rows).toEqual([
        { old_status: 'PACKED', new_status: 'OUT_FOR_DELIVERY', changed_by_user_id: opsUser.id },
      ]);
    });

    it('walks the whole delivery: list, detail, arrive, location and COD settlement', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      const list = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens.ops}`);
      expect(list.status).toBe(200);
      expect(list.body.data.deliveries.map((d: { delivery_id: string }) => d.delivery_id)).toContain(deliveryId);

      const read = await detail(deliveryId, tokens.ops);
      expect(read.status).toBe(200);
      expect(read.body.data.delivery.delivery_id).toBe(deliveryId);

      expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.ops)).status).toBe(200);
      const loc = await sendLocation(deliveryId, tokens.ops);
      expect(loc.status).toBe(202);
      expect(loc.body.data.accepted).toBe(true);

      expect((await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, tokens.ops)).status).toBe(200);
      const cod = await collect(deliveryId, order.total_amount, tokens.ops);
      expect(cod.status).toBe(200);
      expect(cod.body.data.settlement).toMatchObject({ order_status: 'DELIVERED', payment_status: 'PAID' });
      expect(await orderStatus(order.id)).toBe('DELIVERED');
    });

    it('fails a delivery with a reason, exactly as a rider would', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.ops)).status).toBe(200);
      expect((await setStatus(deliveryId, { status: 'FAILED' }, tokens.ops)).status).toBe(400);
      const res = await setStatus(deliveryId, { status: 'FAILED', failure_reason: 'Address not reachable' }, tokens.ops);
      expect(res.status).toBe(200);
      expect(await orderStatus(order.id)).toBe('FAILED');
    });

    it('works through the /rider mount as well as /riders (one shared router)', async () => {
      const { deliveryId } = await assignedDelivery(RIDER_OPS);
      const res = await request(app)
        .patch(`/api/v1/rider/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${tokens.ops}`)
        .send({ status: 'PICKED_UP' });
      expect(res.status).toBe(200);
      expect(res.body.data.delivery.assignment_status).toBe('PICKED_UP');
    });
  });

  // ── 2. it is still only ever THEIR OWN rider's work ───────────────────────
  describe('ADMIN with a linked rider profile, against another rider\'s delivery', () => {
    it('gets 404 DELIVERY_NOT_FOUND - never 403, never a data leak - on every route that names a delivery', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OTHER);
      // Picked up by its real owner first, so the delivery is inside the
      // trackable window and only ownership can be what rejects the ops user.
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.otherRider)).status).toBe(200);

      for (const res of [
        await detail(deliveryId, tokens.ops),
        await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, tokens.ops),
        await collect(deliveryId, order.total_amount, tokens.ops),
        await sendLocation(deliveryId, tokens.ops),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('DELIVERY_NOT_FOUND');
      }
      expect(await deliveryRow(deliveryId)).toEqual({ rider_id: RIDER_OTHER, assignment_status: 'PICKED_UP' });
      expect(await orderStatus(order.id)).toBe('OUT_FOR_DELIVERY');
    });

    it('never sees another rider\'s delivery in its own list', async () => {
      const { deliveryId } = await assignedDelivery(RIDER_OTHER);
      const list = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens.ops}`);
      expect(list.status).toBe(200);
      expect(list.body.data.deliveries.map((d: { delivery_id: string }) => d.delivery_id)).not.toContain(deliveryId);
    });

    it('cannot act as another rider by smuggling rider_id into the request body', async () => {
      // Identity comes from findRiderByUserId(req.user.id) only; a rider_id in
      // the body is not read for identity anywhere on these routes.
      const theirs = await assignedDelivery(RIDER_OTHER);
      const escalate = await setStatus(theirs.deliveryId, { status: 'PICKED_UP', rider_id: RIDER_OTHER }, tokens.ops);
      expect(escalate.status).toBe(404);
      expect(escalate.body.error.code).toBe('DELIVERY_NOT_FOUND');
      expect(await deliveryRow(theirs.deliveryId)).toEqual({ rider_id: RIDER_OTHER, assignment_status: 'ASSIGNED' });

      const mine = await assignedDelivery(RIDER_OPS);
      const ownWithSmuggledId = await setStatus(mine.deliveryId, { status: 'PICKED_UP', rider_id: RIDER_OTHER }, tokens.ops);
      expect(ownWithSmuggledId.status).toBe(200);
      expect(await deliveryRow(mine.deliveryId)).toEqual({ rider_id: RIDER_OPS, assignment_status: 'PICKED_UP' });
    });
  });

  // ── 3./4. an ADMIN alone is still not a rider ─────────────────────────────
  describe('an ADMIN that is not a usable rider', () => {
    it('with no linked rider row at all: 403 RIDER_PROFILE_NOT_FOUND on all five routes', async () => {
      const linked = await pool.query('SELECT id FROM riders WHERE user_id = $1', [plainAdmin.id]);
      expect(linked.rows).toEqual([]); // the premise of this test
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      for (const res of await allFiveRoutes(tokens.plainAdmin, deliveryId, order.total_amount)) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('RIDER_PROFILE_NOT_FOUND');
      }
      expect(await deliveryRow(deliveryId)).toEqual({ rider_id: RIDER_OPS, assignment_status: 'ASSIGNED' });
    });

    it('with an INACTIVE linked rider row: 403 RIDER_INACTIVE on all five routes', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      await pool.query('UPDATE riders SET is_active = false WHERE id = $1', [RIDER_OPS]);
      try {
        for (const res of await allFiveRoutes(tokens.ops, deliveryId, order.total_amount)) {
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('RIDER_INACTIVE');
        }
      } finally {
        await pool.query('UPDATE riders SET is_active = true WHERE id = $1', [RIDER_OPS]);
      }
      expect(await deliveryRow(deliveryId)).toEqual({ rider_id: RIDER_OPS, assignment_status: 'ASSIGNED' });
    });

    it('is still refused on the rider routes that were NOT widened', async () => {
      const res = await request(app).get('/api/v1/riders/orders').set('Authorization', `Bearer ${tokens.ops}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ── 6./7. no other role gained anything ───────────────────────────────────
  describe('roles outside the widened allow-list', () => {
    it.each(['customer', 'staff'] as const)('%s still gets 403 FORBIDDEN on all five routes', async (who) => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      for (const res of await allFiveRoutes(tokens[who], deliveryId, order.total_amount)) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(await deliveryRow(deliveryId)).toEqual({ rider_id: RIDER_OPS, assignment_status: 'ASSIGNED' });
    });

    it('an unauthenticated caller still gets 401 on all five routes', async () => {
      const { deliveryId } = await assignedDelivery(RIDER_OPS);
      for (const res of [
        await request(app).get('/api/v1/riders/deliveries'),
        await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`),
        await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).send({ status: 'PICKED_UP' }),
        await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`).send({ amount: 610 }),
        await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).send(point()),
      ]) {
        expect(res.status).toBe(401);
      }
    });

    it('the lifecycle engine still refuses a role outside the catalogue entry', async () => {
      // The engine's own role check (the second, independent gate) is live:
      // it is not bypassed for rider actions, only widened to ADMIN.
      const { deliveryId } = await assignedDelivery(RIDER_OPS);
      await expect(
        runTransition('RIDER_PICKUP', {
          actor: { id: staff.id, role: 'PACKING_STAFF' },
          deliveryId,
          riderId: RIDER_OPS,
        })
      ).rejects.toMatchObject({ statusCode: 403, code: 'TRANSITION_NOT_PERMITTED_FOR_ROLE' });
      expect(await deliveryRow(deliveryId)).toEqual({ rider_id: RIDER_OPS, assignment_status: 'ASSIGNED' });
    });
  });

  // ── 5. the existing RIDER-role flow, unchanged ────────────────────────────
  describe('a genuine RIDER-role user is completely unaffected', () => {
    it('still walks pickup, location, arrive and COD settlement', async () => {
      const { order, deliveryId } = await assignedDelivery(SEEDED_RIDER);
      expect((await detail(deliveryId, tokens.rider)).status).toBe(200);
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.rider)).status).toBe(200);
      const loc = await sendLocation(deliveryId, tokens.rider);
      expect(loc.status).toBe(202);
      expect(loc.body.data.accepted).toBe(true);
      expect((await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, tokens.rider)).status).toBe(200);
      const cod = await collect(deliveryId, order.total_amount, tokens.rider);
      expect(cod.status).toBe(200);
      expect(await orderStatus(order.id)).toBe('DELIVERED');
      const hist = await pool.query(
        `SELECT changed_by_user_id FROM order_status_history WHERE order_id = $1 AND new_status = 'OUT_FOR_DELIVERY'`,
        [order.id]
      );
      expect(hist.rows).toEqual([{ changed_by_user_id: riderUser.id }]);
    });

    it('still cannot touch the Operations operator\'s delivery (404, not 403)', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      for (const res of [
        await detail(deliveryId, tokens.rider),
        await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.rider),
        await collect(deliveryId, order.total_amount, tokens.rider),
        await sendLocation(deliveryId, tokens.rider),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('DELIVERY_NOT_FOUND');
      }
    });
  });

  // ── 8./9./10. the state machine and the trackable window are untouched ────
  describe('every non-role check behaves identically for both actors', () => {
    it('a malformed delivery id is a clean 400, and an unknown one a clean 404 - never a 500', async () => {
      const UNKNOWN = '00000000-0000-0000-0000-00000000beef';
      for (const token of [tokens.ops, tokens.rider]) {
        for (const res of [
          await detail('not-a-uuid', token),
          await setStatus('not-a-uuid', { status: 'PICKED_UP' }, token),
          await collect('not-a-uuid', 610, token),
          await sendLocation('not-a-uuid', token),
        ]) {
          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe('VALIDATION_ERROR');
        }
        for (const res of [
          await detail(UNKNOWN, token),
          await setStatus(UNKNOWN, { status: 'PICKED_UP' }, token),
          await collect(UNKNOWN, 610, token),
          await sendLocation(UNKNOWN, token),
        ]) {
          expect(res.status).toBe(404);
          expect(res.body.error.code).toBe('DELIVERY_NOT_FOUND');
        }
      }
    });

    it('an invalid state transition gives the same lifecycle error to both actors', async () => {
      const results = [];
      for (const [token, riderId] of [
        [tokens.ops, RIDER_OPS],
        [tokens.rider, SEEDED_RIDER],
      ] as const) {
        const { deliveryId } = await assignedDelivery(riderId);
        // Skipping straight to ARRIVED_AT_CUSTOMER from ASSIGNED.
        const skip = await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, token);
        // Repeating a step that has already happened.
        expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, token)).status).toBe(200);
        const again = await setStatus(deliveryId, { status: 'PICKED_UP' }, token);
        results.push([
          { status: skip.status, code: skip.body.error.code, details: skip.body.error.details },
          { status: again.status, code: again.body.error.code, details: again.body.error.details },
        ]);
      }
      expect(results[0]).toEqual(results[1]);
      expect(results[0][0]).toMatchObject({ status: 409, code: 'INVALID_DELIVERY_TRANSITION' });
      expect(results[0][1]).toMatchObject({ status: 409, code: 'INVALID_DELIVERY_TRANSITION' });
    });

    it('COD is still refused before arrival and for the wrong amount', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      expect((await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.ops)).status).toBe(200);
      const early = await collect(deliveryId, order.total_amount, tokens.ops);
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await setStatus(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, tokens.ops)).status).toBe(200);
      const wrong = await collect(deliveryId, order.total_amount - 10, tokens.ops);
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('INVALID_COD_AMOUNT');
      const pay = await pool.query('SELECT payment_status FROM payments WHERE order_id = $1', [order.id]);
      expect(pay.rows[0].payment_status).toBe('PENDING');
    });

    it('the trackable window still gates location writes for the ADMIN+rider actor', async () => {
      // Before pickup: the delivery is ASSIGNED, the order still PACKED.
      const before = await assignedDelivery(RIDER_OPS);
      const tooEarly = await sendLocation(before.deliveryId, tokens.ops);
      expect(tooEarly.status).toBe(409);
      expect(tooEarly.body.error.code).toBe('DELIVERY_NOT_TRACKABLE');

      // After arrival: no longer PICKED_UP, so the window has closed.
      const after = await assignedDelivery(RIDER_OPS);
      expect((await setStatus(after.deliveryId, { status: 'PICKED_UP' }, tokens.ops)).status).toBe(200);
      expect((await setStatus(after.deliveryId, { status: 'ARRIVED_AT_CUSTOMER' }, tokens.ops)).status).toBe(200);
      const tooLate = await sendLocation(after.deliveryId, tokens.ops);
      expect(tooLate.status).toBe(409);
      expect(tooLate.body.error.code).toBe('DELIVERY_NOT_TRACKABLE');

      // And a cancelled order leaves the delivery untrackable too.
      const cancelled = await assignedDelivery(RIDER_OPS);
      await request(app)
        .post(`/api/v1/orders/${cancelled.order.id}/cancel`)
        .set('Authorization', `Bearer ${tokens.customer}`)
        .send({ reason: 'Changed my mind' });
      const onCancelled = await sendLocation(cancelled.deliveryId, tokens.ops);
      expect(onCancelled.status).toBe(409);
      expect(onCancelled.body.error.code).toBe('DELIVERY_NOT_TRACKABLE');
    });

    it('the ADMIN+rider actor is still refused on a closed order', async () => {
      const { order, deliveryId } = await assignedDelivery(RIDER_OPS);
      const cancel = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${tokens.customer}`)
        .send({ reason: 'Changed my mind' });
      expect(cancel.status).toBe(200);
      const res = await setStatus(deliveryId, { status: 'PICKED_UP' }, tokens.ops);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_ACTIVE');
      expect(await orderStatus(order.id)).toBe('CANCELLED');
    });
  });
});
