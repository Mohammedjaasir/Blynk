import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { deliveryCodeForDelivery } from './helpers/delivery-code.js';
import { DELIVERY_LOCATION_COLUMNS, DELIVERY_PUBLIC_COLUMNS } from '../src/modules/orders/delivery.columns.js';
import { liftRiderTripCap } from './helpers/rider-trips.js';

// Many orders go to one seeded rider here; the trip cap has its own tests (rider-trips.test.ts).
liftRiderTripCap();

/**
 * Final-review finding I1: the rider's live position (migration 006) is
 * delivered to the owning customer over the SSE stream and nowhere else - plan
 * §D.6 has no admin/staff/rider location surface in this phase. Every API
 * response that carries a delivery row is scanned, deeply, for the five
 * location keys while the delivery holds a real stored point. A null-valued
 * key is still a leak of the column, so absence of the KEY is asserted.
 */
describe('Delivery payloads never carry the rider location columns (I1)', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const riderUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = {
    customer: generateAccessToken(customer),
    staff: generateAccessToken(staff),
    admin: generateAccessToken(admin),
    rider: generateAccessToken(riderUser),
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const created: string[] = [];
  let addressId = '';

  const FORBIDDEN = ['current_latitude', 'current_longitude', 'location_accuracy_m', 'location_captured_at', 'location_received_at'];

  /** Every object key anywhere in the JSON, so a nested/renamed copy cannot hide. */
  function allKeys(value: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        out.add(k);
        allKeys(v, out);
      }
    }
    return out;
  }
  function expectNoLocationKeys(label: string, body: unknown) {
    const keys = allKeys(body);
    const leaked = FORBIDDEN.filter((k) => keys.has(k));
    expect(leaked, `${label} leaked ${leaked.join(', ')}`).toEqual([]);
  }

  beforeAll(async () => {
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1,'Privacy test','Priv Test','+94771234567','No. 1, Test Lane','Dharga Town',6.4351,80.0243,false) RETURNING id`,
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
  });

  /** Places, sources, packs and assigns an order; returns the raw assign response too. */
  async function assignedOrder() {
    const placed = await request(app).post('/api/v1/orders').set(auth(tokens.customer))
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    const orderId = placed.body.data.order.id as string;
    created.push(orderId);
    const detail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set(auth(tokens.admin));
    for (const item of detail.body.data.order.items) {
      await request(app).post(`/api/v1/admin/orders/${orderId}/items/${item.id}/source`).set(auth(tokens.staff)).send({ actual_unit_cost: 450 });
    }
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set(auth(tokens.staff)).send({ status: 'PACKED' });
    const assign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set(auth(tokens.admin)).send({ rider_id: RIDER_A });
    return { orderId, deliveryId: assign.body.data.delivery.id as string, assign };
  }

  /** Picks the order up and lands a real stored location on the delivery row. */
  async function pickedUpWithLocation() {
    const o = await assignedOrder();
    const pick = await request(app).patch(`/api/v1/riders/deliveries/${o.deliveryId}/status`).set(auth(tokens.rider)).send({ status: 'PICKED_UP' });
    expect(pick.status).toBe(200);
    const write = await request(app).post(`/api/v1/riders/deliveries/${o.deliveryId}/location`).set(auth(tokens.rider))
      .send({ latitude: 6.436, longitude: 80.026, accuracy: 12.5, captured_at: new Date().toISOString() });
    expect(write.status).toBe(202);
    expect(write.body.data.accepted).toBe(true);
    const row = await pool.query('SELECT current_latitude, location_received_at FROM deliveries WHERE id = $1', [o.deliveryId]);
    expect(row.rows[0].current_latitude).not.toBeNull(); // the point is really stored
    expect(row.rows[0].location_received_at).not.toBeNull();
    return { ...o, pick, write };
  }

  it('the admin assign-rider response has no location keys (fresh row, null-valued keys still leak the column)', async () => {
    const { assign } = await assignedOrder();
    expect(assign.status).toBe(200);
    expectNoLocationKeys('POST /admin/orders/:id/assign-rider', assign.body);
    expect(assign.body.data.delivery.assignment_status).toBe('ASSIGNED'); // the rest is intact
    expect(assign.body.data.delivery.rider_id).toBe(RIDER_A);
  });

  it('every read of an order with a stored location is clean: admin detail, admin lists, packing queue, riders picker, customer detail and list', async () => {
    const { orderId, deliveryId, write } = await pickedUpWithLocation();
    expectNoLocationKeys('POST /riders/deliveries/:id/location (write response)', write.body);

    const adminDetail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set(auth(tokens.admin));
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.data.order.delivery.id).toBe(deliveryId); // there is a delivery to leak from
    expect(adminDetail.body.data.order.delivery.rider_name).toBeTruthy();
    expectNoLocationKeys('GET /admin/orders/:id', adminDetail.body);

    const staffDetail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set(auth(tokens.staff));
    expect(staffDetail.status).toBe(200);
    expectNoLocationKeys('GET /admin/orders/:id (staff)', staffDetail.body);

    const adminList = await request(app).get('/api/v1/admin/orders?status=OUT_FOR_DELIVERY&limit=100').set(auth(tokens.admin));
    expect(adminList.status).toBe(200);
    const mine = adminList.body.data.orders.find((o: { id: string }) => o.id === orderId);
    expect(mine.active_delivery.id).toBe(deliveryId);
    expectNoLocationKeys('GET /admin/orders', adminList.body);

    const queue = await request(app).get('/api/v1/admin/packing-queue').set(auth(tokens.staff));
    expect(queue.status).toBe(200);
    expectNoLocationKeys('GET /admin/packing-queue', queue.body);

    const riders = await request(app).get('/api/v1/admin/riders').set(auth(tokens.admin));
    expect(riders.status).toBe(200);
    expectNoLocationKeys('GET /admin/riders', riders.body);

    const custDetail = await request(app).get(`/api/v1/orders/${orderId}`).set(auth(tokens.customer));
    expect(custDetail.status).toBe(200);
    expect(custDetail.body.data.order.delivery.assignment_status).toBe('PICKED_UP');
    expectNoLocationKeys('GET /orders/:id', custDetail.body);

    const custList = await request(app).get('/api/v1/orders?limit=50').set(auth(tokens.customer));
    expect(custList.status).toBe(200);
    expectNoLocationKeys('GET /orders', custList.body);
  });

  it("the rider's own payloads are clean: today's list, delivery detail, status step, COD settlement", async () => {
    const { deliveryId } = await pickedUpWithLocation();

    const list = await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.rider));
    expect(list.status).toBe(200);
    expect(list.body.data.deliveries.some((d: { delivery_id: string }) => d.delivery_id === deliveryId)).toBe(true);
    expectNoLocationKeys('GET /riders/deliveries', list.body);

    const detail = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(tokens.rider));
    expect(detail.status).toBe(200);
    expectNoLocationKeys('GET /riders/deliveries/:id', detail.body);

    const arrive = await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set(auth(tokens.rider)).send({ status: 'ARRIVED_AT_CUSTOMER' });
    expect(arrive.status).toBe(200);
    expectNoLocationKeys('PATCH /riders/deliveries/:id/status', arrive.body);

    const total = Number(detail.body.data.delivery.total_amount);
    const cod = await request(app)
      .post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`)
      .set(auth(tokens.rider))
      .send({ amount: total, delivery_code: await deliveryCodeForDelivery(deliveryId) });
    expect(cod.status).toBe(200);
    expectNoLocationKeys('POST /riders/deliveries/:id/collect-cod', cod.body);
  });

  it('the admin status-update response is clean, including a terminal delivery that still holds its last point', async () => {
    const { orderId, deliveryId } = await pickedUpWithLocation();
    const res = await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set(auth(tokens.admin)).send({ status: 'DELIVERED', notes: 'Admin marked delivered' });
    expect(res.status).toBe(200);
    expect(res.body.data.order.order_status).toBe('DELIVERED');
    expect(res.body.data.order.delivery.id).toBe(deliveryId);
    expectNoLocationKeys('PATCH /admin/orders/:id/status', res.body);

    // ...and the point really is still stored (I3), so the assertion above is not vacuous.
    const row = await pool.query('SELECT current_latitude FROM deliveries WHERE id = $1', [deliveryId]);
    expect(row.rows[0].current_latitude).not.toBeNull();

    const after = await request(app).get(`/api/v1/admin/orders/${orderId}`).set(auth(tokens.admin));
    expectNoLocationKeys('GET /admin/orders/:id (delivered)', after.body);
  });

  it('the customer-cancel response is clean', async () => {
    const { orderId } = await assignedOrder(); // PACKED with an ASSIGNED delivery: the customer may still cancel
    const res = await request(app).post(`/api/v1/orders/${orderId}/cancel`).set(auth(tokens.customer)).send({ reason: 'changed my mind' });
    expect(res.status).toBe(200);
    expect(res.body.data.order.delivery.assignment_status).toBe('ASSIGNED');
    expectNoLocationKeys('POST /orders/:id/cancel', res.body);
  });

  describe('a future column cannot leak silently', () => {
    it('every deliveries column is classified exactly once: public or location', async () => {
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deliveries'`
      );
      const actual = cols.rows.map((r) => r.column_name as string).sort();
      const classified = [...DELIVERY_PUBLIC_COLUMNS, ...DELIVERY_LOCATION_COLUMNS].sort();
      // Adding a column to `deliveries` fails here until it is put in DELIVERY_PUBLIC_COLUMNS (safe to
      // return to staff) or DELIVERY_LOCATION_COLUMNS (sensitive, dedicated paths only).
      expect(classified).toEqual(actual);
      expect([...DELIVERY_LOCATION_COLUMNS].sort()).toEqual([...FORBIDDEN].sort());
    });
  });
});
