import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { liftRiderTripCap } from './helpers/rider-trips.js';

// Many orders go to one seeded rider here; the trip cap has its own tests (rider-trips.test.ts).
liftRiderTripCap();

describe('Rider location updates', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const riderBUser = { id: 'a0000009-0000-0000-0000-00000000000c', phone: '+94770009902', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const RIDER_B = 'f0000009-0000-0000-0000-00000000000c';
  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = {
    customer: generateAccessToken(customer),
    staff: generateAccessToken(staff),
    admin: generateAccessToken(admin),
    riderA: generateAccessToken(riderAUser),
    riderB: generateAccessToken(riderBUser),
  };
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1,$2,'Test Rider B','RIDER') ON CONFLICT (phone) DO NOTHING`, [riderBUser.id, riderBUser.phone]);
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       VALUES ($1,$2,$3,'TEST-LOC-0001',true,true) ON CONFLICT (id) DO NOTHING`,
      [RIDER_B, riderBUser.id, DARK_STORE]
    );
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1,'Location test','Loc Test','+94771234567','No. 1, Test Lane','Dharga Town',6.4351,80.0243,false) RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });
  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    await pool.query('DELETE FROM riders WHERE id = $1', [RIDER_B]);
    await pool.query('DELETE FROM users WHERE id = $1', [riderBUser.id]);
  });

  /** Places, sources, packs and assigns an order to RIDER_A, ready to pick up. */
  async function assignedOrder(riderId = RIDER_A, riderToken = tokens.riderA) {
    const placed = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${tokens.customer}`)
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    const orderId = placed.body.data.order.id as string;
    created.push(orderId);
    const items = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${tokens.admin}`);
    for (const item of items.body.data.order.items) {
      await request(app).post(`/api/v1/admin/orders/${orderId}/items/${item.id}/source`).set('Authorization', `Bearer ${tokens.staff}`).send({ actual_unit_cost: 450 });
    }
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.staff}`).send({ status: 'PACKED' });
    const assign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: riderId });
    return { orderId, deliveryId: assign.body.data.delivery.id as string };
  }

  const point = (overrides: Partial<Record<'latitude' | 'longitude' | 'accuracy' | 'captured_at', unknown>> = {}) => ({
    latitude: 6.436, longitude: 80.026, accuracy: 12.5, captured_at: new Date().toISOString(), ...overrides,
  });

  const send = (deliveryId: string, token: string, body: unknown) =>
    request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).set('Authorization', `Bearer ${token}`).send(body);

  it('accepts a location once the rider has picked up, not before (plan §D.1)', async () => {
    const { deliveryId } = await assignedOrder();
    const before = await send(deliveryId, tokens.riderA, point());
    expect(before.status).toBe(409);
    expect(before.body.error.code).toBe('DELIVERY_NOT_TRACKABLE');

    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const after = await send(deliveryId, tokens.riderA, point());
    expect(after.status).toBe(202);
    expect(after.body.data.accepted).toBe(true);

    const row = await pool.query('SELECT current_latitude, current_longitude, location_accuracy_m, location_captured_at, location_received_at FROM deliveries WHERE id = $1', [deliveryId]);
    expect(Number(row.rows[0].current_latitude)).toBeCloseTo(6.436, 5);
    expect(row.rows[0].location_received_at).not.toBeNull();
  });

  it('rejects another rider submitting to this delivery (404, not 403 - plan §D.4)', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const res = await send(deliveryId, tokens.riderB, point());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DELIVERY_NOT_FOUND');
  });

  it('rejects a customer or unauthenticated caller', async () => {
    const { deliveryId } = await assignedOrder();
    const asCustomer = await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).set('Authorization', `Bearer ${tokens.customer}`).send(point());
    expect(asCustomer.status).toBe(403);
    const anon = await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).send(point());
    expect(anon.status).toBe(401);
  });

  it('rejects malformed and out-of-range coordinates', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    for (const bad of [point({ latitude: 91 }), point({ longitude: -181 }), point({ accuracy: -1 }), point({ accuracy: 0 }), point({ latitude: 'x' })]) {
      const res = await send(deliveryId, tokens.riderA, bad);
      expect(res.status).toBe(400);
    }
  });

  it('bounds accuracy: an absurd or non-finite value is a 400, never a Postgres overflow 500; the maximum is accepted (m1)', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    for (const bad of [point({ accuracy: 1e7 }), point({ accuracy: 100_000.5 }), point({ accuracy: 1e21 })]) {
      const res = await send(deliveryId, tokens.riderA, bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    // JSON.parse('1e999') is Infinity; supertest cannot serialise it, so send the raw text.
    const body = JSON.stringify(point()).replace(/"accuracy":[^,]+/, '"accuracy":1e999');
    const inf = await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`)
      .set('Authorization', `Bearer ${tokens.riderA}`).set('Content-Type', 'application/json').send(body);
    expect(inf.status).toBe(400);
    expect(inf.body.error.code).toBe('VALIDATION_ERROR');

    const max = await send(deliveryId, tokens.riderA, point({ accuracy: 100_000 }));
    expect(max.status).toBe(202);
    expect(max.body.data.accepted).toBe(true);
    const row = await pool.query('SELECT location_accuracy_m FROM deliveries WHERE id = $1', [deliveryId]);
    expect(Number(row.rows[0].location_accuracy_m)).toBe(100000);
  });

  it('rejects a captured_at far in the future, accepts one only slightly stale', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const future = await send(deliveryId, tokens.riderA, point({ captured_at: new Date(Date.now() + 5 * 60_000).toISOString() }));
    expect(future.status).toBe(400);
    const slightlyOld = await send(deliveryId, tokens.riderA, point({ captured_at: new Date(Date.now() - 30_000).toISOString() }));
    expect(slightlyOld.status).toBe(202);
    expect(slightlyOld.body.data.accepted).toBe(true);
  });

  it('a point no newer than the last accepted one is ignored, never regresses the stored position (duplicate/out-of-order)', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const t0 = new Date();
    await send(deliveryId, tokens.riderA, point({ latitude: 6.5, captured_at: t0.toISOString() }));
    // a small pause so the rate-limit floor (below) isn't what rejects this one
    await new Promise((r) => setTimeout(r, 5100));
    const older = await send(deliveryId, tokens.riderA, point({ latitude: 6.1, captured_at: new Date(t0.getTime() - 1000).toISOString() }));
    expect(older.status).toBe(202);
    expect(older.body.data.accepted).toBe(false);
    expect(older.body.data.reason).toBe('not_newer');
    const row = await pool.query('SELECT current_latitude FROM deliveries WHERE id = $1', [deliveryId]);
    expect(Number(row.rows[0].current_latitude)).toBeCloseTo(6.5, 3);
  });

  it('high-frequency submissions are throttled server-side, independent of the client (plan §D.6, §11)', async () => {
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const first = await send(deliveryId, tokens.riderA, point());
    expect(first.body.data.accepted).toBe(true);
    const immediatelyAfter = await send(deliveryId, tokens.riderA, point({ captured_at: new Date(Date.now() + 1000).toISOString() }));
    expect(immediatelyAfter.status).toBe(202);
    expect(immediatelyAfter.body.data.accepted).toBe(false);
    expect(immediatelyAfter.body.data.reason).toBe('rate_limited');
  });

  it('rejects a location once arrived, delivered, or failed - every closed state (plan §D.2)', async () => {
    for (const close of ['arrive', 'fail'] as const) {
      const { deliveryId } = await assignedOrder();
      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
      if (close === 'arrive') {
        await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
      } else {
        await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'FAILED', failure_reason: 'test' });
      }
      const res = await send(deliveryId, tokens.riderA, point());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DELIVERY_NOT_TRACKABLE');
    }
  });

  it('rejects a location for a cancelled order even though the delivery row is still ASSIGNED (plan §2.2 gotcha #1)', async () => {
    const { orderId, deliveryId } = await assignedOrder();
    await request(app).post(`/api/v1/orders/${orderId}/cancel`).set('Authorization', `Bearer ${tokens.customer}`).send({});
    const res = await send(deliveryId, tokens.riderA, point());
    expect(res.status).toBe(409);
  });

  it('re-stage creates a new delivery; the old FAILED delivery never accepts a location again (plan §2.2 gotcha #2, §D.3)', async () => {
    const { orderId, deliveryId: firstDeliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${firstDeliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    await request(app).patch(`/api/v1/riders/deliveries/${firstDeliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'FAILED', failure_reason: 'test' });
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.admin}`).send({ status: 'PACKED', notes: 'restage' });
    const reassign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: RIDER_A });
    const secondDeliveryId = reassign.body.data.delivery.id as string;
    expect(secondDeliveryId).not.toBe(firstDeliveryId);

    const toOld = await send(firstDeliveryId, tokens.riderA, point());
    expect(toOld.status).toBe(409);

    await request(app).patch(`/api/v1/riders/deliveries/${secondDeliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    const toNew = await send(secondDeliveryId, tokens.riderA, point());
    expect(toNew.status).toBe(202);
    expect(toNew.body.data.accepted).toBe(true);
  });

  it('concurrent writes to the same delivery do not corrupt or deadlock (5 reps)', async () => {
    for (let i = 0; i < 5; i++) {
      const { deliveryId } = await assignedOrder();
      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
      const [a, b] = await Promise.all([
        send(deliveryId, tokens.riderA, point({ latitude: 6.40, captured_at: new Date(Date.now() + 100).toISOString() })),
        send(deliveryId, tokens.riderA, point({ latitude: 6.41, captured_at: new Date(Date.now() + 200).toISOString() })),
      ]);
      expect([a.status, b.status]).toEqual([202, 202]);
    }
  });

  it('an older write that commits after a newer one is already stored can never regress the position (TOCTOU)', async () => {
    // Reproduces the exact race the plain pre-read cannot close on its own:
    // a request for an OLDER point whose own read happens before any other
    // write exists (so its in-service fast path sees nothing to reject),
    // but whose UPDATE is forced - via a held row lock on a second raw
    // connection - to reach Postgres only after a NEWER point has already
    // been committed. The fix (a conditional UPDATE ... WHERE
    // location_captured_at IS NULL OR location_captured_at < $capturedAt in
    // rider.repository.ts's writeLocation) must reject the older write at
    // that point, not from the stale read. Same held-lock-then-delayed-
    // commit technique as rider-delivery.test.ts's "checks the amount
    // against the total read under the lock, not an earlier read".
    const { deliveryId } = await assignedOrder();
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });

    const newerCapturedAt = new Date();
    const olderCapturedAt = new Date(newerCapturedAt.getTime() - 10_000);

    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      // Commits the newer point first, but holds the row lock open until
      // this transaction commits below - the older write's UPDATE (fired
      // concurrently, over the real HTTP API) will block on this same row
      // and only get to evaluate its own WHERE clause once this lock is
      // released and its result is visible.
      await other.query(
        `UPDATE deliveries
           SET current_latitude = 6.99, current_longitude = 80.99, location_accuracy_m = 5,
               location_captured_at = $2, location_received_at = now()
         WHERE id = $1`,
        [deliveryId, newerCapturedAt]
      );

      // supertest's Test object is lazy - it does not actually dispatch the
      // HTTP request until awaited or given a .then handler. Attaching one
      // here (rather than at the final `await pending` below) is what
      // forces the request to fire now, while the lock above is still
      // held, instead of only after COMMIT - matching the technique in
      // rider-delivery.test.ts's own lock-and-delay concurrency test.
      const pending = send(deliveryId, tokens.riderA, point({ latitude: 6.10, captured_at: olderCapturedAt.toISOString() })).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await other.query('COMMIT');
      const res = await pending;

      expect(res.status).toBe(202);
      expect(res.body.data.accepted).toBe(false);
      expect(res.body.data.reason).toBe('not_newer');
    } finally {
      other.release();
    }

    const row = await pool.query(
      'SELECT current_latitude, current_longitude, location_captured_at FROM deliveries WHERE id = $1',
      [deliveryId]
    );
    expect(Number(row.rows[0].current_latitude)).toBeCloseTo(6.99, 3);
    expect(Number(row.rows[0].current_longitude)).toBeCloseTo(80.99, 3);
    expect(new Date(row.rows[0].location_captured_at).getTime()).toBe(newerCapturedAt.getTime());
  });
});
