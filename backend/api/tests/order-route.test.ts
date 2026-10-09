import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { AppError } from '../src/middleware/error.middleware.js';
import { routeDeps, clearRouteCache, MIN_RECOMPUTE_MS, MAX_ROUTE_AGE_MS } from '../src/modules/orders/order.route.controller.js';
import { toRiderContact } from '../src/modules/orders/order.service.js';
import { deliveryCodeForDelivery } from './helpers/delivery-code.js';
import { liftRiderTripCap } from './helpers/rider-trips.js';

// Many orders go to one seeded rider here; the trip cap has its own tests (rider-trips.test.ts).
liftRiderTripCap();

/**
 * Rapido-style tracking (owner, 2026-10-10): GET /orders/:id/route (road line
 * + driving time, cached so polling cannot hammer OSRM) and the rider's first
 * name + phone on the customer's own order while it is on the road. OSRM is
 * never called for real here: routeDeps.fetchRoute is replaced.
 */
describe('Customer road route and rider contact (owner, 2026-10-10)', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const customerB = { id: 'a0000005-0000-0000-0000-000000000005', phone: '+94771119999', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = {
    customer: generateAccessToken(customer),
    customerB: generateAccessToken(customerB),
    admin: generateAccessToken(admin),
    staff: generateAccessToken(staff),
    rider: generateAccessToken(riderUser),
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const created: string[] = [];
  let addressId = '';

  // The fake OSRM and clock.
  const realDeps = { ...routeDeps };
  let osrmCalls: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }[] = [];
  let osrmMode: 'ok' | 'down' = 'ok';
  let clockOffset = 0;

  beforeAll(async () => {
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1,'Route test','Route Test','+94771234567','No. 1, Test Lane','Dharga Town',6.4351,80.0243,false) RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });
  afterAll(async () => {
    Object.assign(routeDeps, realDeps);
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });
  beforeEach(() => {
    clearRouteCache();
    osrmCalls = [];
    osrmMode = 'ok';
    clockOffset = 0;
    routeDeps.now = () => Date.now() + clockOffset;
    routeDeps.fetchRoute = async (from, to) => {
      osrmCalls.push({ from, to });
      if (osrmMode === 'down') throw new AppError('The route could not be calculated right now.', 503, 'ROUTING_UNAVAILABLE');
      return { distance_m: 2400, duration_s: 380, coordinates: [[from.lng, from.lat], [to.lng, to.lat]] };
    };
  });

  /** Placed, sourced, packed and assigned (PACKED / ASSIGNED). */
  async function assignedOrder() {
    const placed = await request(app).post('/api/v1/orders').set(auth(tokens.customer))
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const orderId = placed.body.data.order.id as string;
    created.push(orderId);
    const detail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set(auth(tokens.admin));
    for (const item of detail.body.data.order.items) {
      await request(app).post(`/api/v1/admin/orders/${orderId}/items/${item.id}/source`).set(auth(tokens.staff)).send({ actual_unit_cost: 450 });
    }
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set(auth(tokens.staff)).send({ status: 'PACKED' });
    const assign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set(auth(tokens.admin)).send({ rider_id: RIDER_A });
    expect(assign.status).toBe(200);
    return { orderId, deliveryId: assign.body.data.delivery.id as string };
  }

  /** Picked up (OUT_FOR_DELIVERY / PICKED_UP), optionally with a stored rider point. */
  async function onTheRoad({ withPoint = true } = {}) {
    const o = await assignedOrder();
    const pick = await request(app).patch(`/api/v1/riders/deliveries/${o.deliveryId}/status`).set(auth(tokens.rider)).send({ status: 'PICKED_UP' });
    expect(pick.status).toBe(200);
    if (withPoint) {
      const write = await request(app).post(`/api/v1/riders/deliveries/${o.deliveryId}/location`).set(auth(tokens.rider))
        .send({ latitude: 6.44, longitude: 80.03, accuracy: 10, captured_at: new Date().toISOString() });
      expect(write.status).toBe(202);
    }
    return o;
  }

  /** Moves the stored rider point directly (the rider write path has its own rate floor and tests). */
  async function moveRider(deliveryId: string, lat: number, lng: number, capturedAt = new Date()) {
    await pool.query(
      'UPDATE deliveries SET current_latitude = $2, current_longitude = $3, location_captured_at = $4, location_received_at = $4 WHERE id = $1',
      [deliveryId, lat, lng, capturedAt]
    );
  }

  const getRoute = (orderId: string, token = tokens.customer) => request(app).get(`/api/v1/orders/${orderId}/route`).set(auth(token));

  describe('GET /orders/:id/route', () => {
    it('returns the road line from the rider to the delivery point, with distance, time and computed_at', async () => {
      const { orderId } = await onTheRoad();
      const res = await getRoute(orderId);
      expect(res.status).toBe(200);
      const route = res.body.data.route;
      expect(route.distance_m).toBe(2400);
      expect(route.duration_s).toBe(380);
      expect(route.coordinates).toEqual([[80.03, 6.44], [80.0243, 6.4351]]);
      expect(Number.isNaN(Date.parse(route.computed_at))).toBe(false);
      expect(osrmCalls).toHaveLength(1);
      expect(osrmCalls[0]).toEqual({ from: { lat: 6.44, lng: 80.03 }, to: { lat: 6.4351, lng: 80.0243 } });
      // Never the raw location column names.
      expect(JSON.stringify(res.body)).not.toMatch(/current_latitude|location_captured_at/);
    });

    it('requires a signed-in user, and is 404 for another customer (not 403: no enumeration)', async () => {
      const { orderId } = await onTheRoad();
      expect((await request(app).get(`/api/v1/orders/${orderId}/route`)).status).toBe(401);
      const other = await getRoute(orderId, tokens.customerB);
      expect(other.status).toBe(404);
      expect(osrmCalls).toHaveLength(0);
    });

    it('is 409 ORDER_NOT_TRACKABLE before pickup and after delivery, without calling OSRM', async () => {
      const { orderId, deliveryId } = await assignedOrder();
      const before = await getRoute(orderId);
      expect(before.status).toBe(409);
      expect(before.body.error?.code ?? before.body.code).toBe('ORDER_NOT_TRACKABLE');

      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set(auth(tokens.rider)).send({ status: 'PICKED_UP' });
      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set(auth(tokens.rider)).send({ status: 'ARRIVED_AT_CUSTOMER' });
      expect((await getRoute(orderId)).status).toBe(409); // at the door: the map is gone
      const detail = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(tokens.rider));
      const cod = await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`).set(auth(tokens.rider))
        .send({ amount: Number(detail.body.data.delivery.total_amount), delivery_code: await deliveryCodeForDelivery(deliveryId) });
      expect(cod.status).toBe(200);
      expect((await getRoute(orderId)).status).toBe(409);
      expect(osrmCalls).toHaveLength(0);
    });

    it('is route: null while there is no rider point yet, or the latest point is too old to time from', async () => {
      const { orderId, deliveryId } = await onTheRoad({ withPoint: false });
      const none = await getRoute(orderId);
      expect(none.status).toBe(200);
      expect(none.body.data.route).toBeNull();

      await moveRider(deliveryId, 6.44, 80.03, new Date(Date.now() - 5 * 60_000));
      const old = await getRoute(orderId);
      expect(old.status).toBe(200);
      expect(old.body.data.route).toBeNull();
      expect(osrmCalls).toHaveLength(0);
    });

    it('is 503 ROUTING_UNAVAILABLE when OSRM is down - never a made-up time - and the failure is cached too', async () => {
      const { orderId } = await onTheRoad();
      osrmMode = 'down';
      const first = await getRoute(orderId);
      expect(first.status).toBe(503);
      expect(JSON.stringify(first.body)).toContain('ROUTING_UNAVAILABLE');
      expect(JSON.stringify(first.body)).not.toContain('duration_s');
      const second = await getRoute(orderId);
      expect(second.status).toBe(503);
      expect(osrmCalls).toHaveLength(1); // a down OSRM is not asked again within the minimum gap

      osrmMode = 'ok';
      clockOffset = MIN_RECOMPUTE_MS + 1_000;
      const later = await getRoute(orderId);
      expect(later.status).toBe(200);
      expect(osrmCalls).toHaveLength(2);
    });

    it('caching: reused within 25 s even if the rider moved; after that only when moved > 50 m or 2 min old', async () => {
      const { orderId, deliveryId } = await onTheRoad();
      expect((await getRoute(orderId)).status).toBe(200);
      expect((await getRoute(orderId)).status).toBe(200);
      expect(osrmCalls).toHaveLength(1); // polled twice, one OSRM call

      await moveRider(deliveryId, 6.445, 80.03); // ~550 m on
      clockOffset = 10_000;
      await getRoute(orderId);
      expect(osrmCalls).toHaveLength(1); // still inside the 25 s floor

      clockOffset = MIN_RECOMPUTE_MS + 1_000;
      const moved = await getRoute(orderId);
      expect(osrmCalls).toHaveLength(2); // moved > 50 m and past the floor
      expect(moved.body.data.route.coordinates[0]).toEqual([80.03, 6.445]);

      await moveRider(deliveryId, 6.4451, 80.03); // ~11 m: standing at a junction
      clockOffset = 2 * MIN_RECOMPUTE_MS + 2_000;
      await getRoute(orderId);
      expect(osrmCalls).toHaveLength(2); // not moved enough: reuse

      clockOffset = MIN_RECOMPUTE_MS + 1_000 + MAX_ROUTE_AGE_MS + 1_000;
      await moveRider(deliveryId, 6.4451, 80.03, new Date(Date.now() + clockOffset)); // a fresh fix (on the fake clock) at the same spot
      await getRoute(orderId);
      expect(osrmCalls).toHaveLength(3); // too old: refreshed even though the rider stood still
    });

    it('concurrent polls for one order share one OSRM call', async () => {
      const { orderId } = await onTheRoad();
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const inner = routeDeps.fetchRoute;
      routeDeps.fetchRoute = async (from, to) => {
        await gate;
        return inner(from, to);
      };
      const all = Promise.all([getRoute(orderId), getRoute(orderId), getRoute(orderId)]);
      await new Promise((r) => setTimeout(r, 300));
      release();
      const results = await all;
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(osrmCalls).toHaveLength(1);
    });
  });

  describe('rider_contact on the customer order detail', () => {
    it('toRiderContact keeps the first name only', () => {
      expect(toRiderContact({ full_name: '  Kamal  Perera ', phone: '+94770000001' })).toEqual({ first_name: 'Kamal', phone: '+94770000001' });
      expect(toRiderContact({ full_name: null, phone: '+94770000001' })).toEqual({ first_name: null, phone: '+94770000001' });
      expect(toRiderContact(null)).toBeNull();
    });

    it('is the rider first name + phone only while OUT_FOR_DELIVERY, for the owner, and gone after delivery', async () => {
      const riderRow = (await pool.query('SELECT full_name, phone FROM users WHERE id = $1', [riderUser.id])).rows[0];
      const expected = toRiderContact(riderRow);

      const { orderId, deliveryId } = await assignedOrder();
      const packed = await request(app).get(`/api/v1/orders/${orderId}`).set(auth(tokens.customer));
      expect(packed.status).toBe(200);
      expect(packed.body.data.order.rider_contact).toBeNull(); // assigned but not picked up

      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set(auth(tokens.rider)).send({ status: 'PICKED_UP' });
      const onRoad = await request(app).get(`/api/v1/orders/${orderId}`).set(auth(tokens.customer));
      expect(onRoad.body.data.order.rider_contact).toEqual(expected);
      expect(onRoad.body.data.order.rider_contact.phone).toBe(riderRow.phone);
      // The delivery block still never names the rider.
      expect(onRoad.body.data.order.delivery).not.toHaveProperty('rider_name');
      expect(onRoad.body.data.order.delivery).not.toHaveProperty('rider_id');

      // The list never carries it.
      const list = await request(app).get('/api/v1/orders?limit=50').set(auth(tokens.customer));
      expect(JSON.stringify(list.body)).not.toContain('rider_contact');

      // Someone else asking for this order gets nothing.
      expect((await request(app).get(`/api/v1/orders/${orderId}`).set(auth(tokens.customerB))).status).toBe(404);

      await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set(auth(tokens.rider)).send({ status: 'ARRIVED_AT_CUSTOMER' });
      const atDoor = await request(app).get(`/api/v1/orders/${orderId}`).set(auth(tokens.customer));
      expect(atDoor.body.data.order.rider_contact).toEqual(expected); // still callable at the door

      const detail = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(tokens.rider));
      await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`).set(auth(tokens.rider))
        .send({ amount: Number(detail.body.data.delivery.total_amount), delivery_code: await deliveryCodeForDelivery(deliveryId) });
      const delivered = await request(app).get(`/api/v1/orders/${orderId}`).set(auth(tokens.customer));
      expect(delivered.body.data.order.order_status).toBe('DELIVERED');
      expect(delivered.body.data.order.rider_contact).toBeNull();
    });
  });
});
