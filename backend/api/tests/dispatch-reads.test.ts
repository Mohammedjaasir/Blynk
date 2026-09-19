import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Read APIs the staff Orders board uses (dispatch plan Task 6):
 * GET /admin/riders (documented, D13), GET /admin/orders with a status list,
 * item progress and the active rider, and the rider's name on the detail.
 * Real rows only; everything created here is removed in afterAll.
 */
describe('Dispatch read APIs', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const rider = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const inactiveUser = { id: 'a0000009-0000-0000-0000-00000000000d', phone: '+94770009903' };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const INACTIVE_RIDER = 'f0000009-0000-0000-0000-00000000000d';
  const DARK_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const BUTTER = 'b0000001-0000-0000-0000-000000000002';
  const t = {
    customer: generateAccessToken(customer),
    admin: generateAccessToken(admin),
    staff: generateAccessToken(staff),
    rider: generateAccessToken(rider),
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    await pool.query(`INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, 'Inactive Rider', 'RIDER')`, [
      inactiveUser.id,
      inactiveUser.phone,
    ]);
    await pool.query(
      `INSERT INTO riders (id, user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
       VALUES ($1, $2, $3, 'TEST-IN-0001', true, false)`,
      [INACTIVE_RIDER, inactiveUser.id, DARK_STORE]
    );
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Dispatch reads test', 'Reads Test', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });

  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    await pool.query('DELETE FROM riders WHERE id = $1', [INACTIVE_RIDER]);
    await pool.query('DELETE FROM users WHERE id = $1', [inactiveUser.id]);
  });

  async function placeOrder(products: string[]) {
    const res = await request(app)
      .post('/api/v1/orders')
      .set(auth(t.customer))
      .send({ address_id: addressId, items: products.map((product_id) => ({ product_id, quantity: 1 })) });
    expect(res.status).toBe(201);
    created.push(res.body.data.order.id);
    const items = (await pool.query('SELECT id, product_id FROM order_items WHERE order_id = $1', [res.body.data.order.id])).rows;
    return { id: res.body.data.order.id as string, itemFor: (p: string) => items.find((r) => r.product_id === p)!.id as string };
  }
  const source = (orderId: string, itemId: string) =>
    request(app).post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`).set(auth(t.staff)).send({ actual_unit_cost: 450 });

  describe('GET /admin/riders', () => {
    it('lists active riders only, with their real open deliveries', async () => {
      const order = await placeOrder([MILK]);
      await source(order.id, order.itemFor(MILK));
      await request(app).patch(`/api/v1/admin/orders/${order.id}/status`).set(auth(t.staff)).send({ status: 'PACKED' });
      await request(app).post(`/api/v1/admin/orders/${order.id}/assign-rider`).set(auth(t.admin)).send({ rider_id: RIDER_A });

      const res = await request(app).get('/api/v1/admin/riders').set(auth(t.admin));
      expect(res.status).toBe(200);
      const riders = res.body.data.riders as Array<Record<string, unknown>>;
      expect(riders.map((r) => r.id)).toContain(RIDER_A);
      expect(riders.map((r) => r.id)).not.toContain(INACTIVE_RIDER);
      const farhan = riders.find((r) => r.id === RIDER_A)!;
      expect(farhan).toMatchObject({
        full_name: 'Farhan Mohamed',
        vehicle_type: 'MOTORCYCLE',
        vehicle_registration_number: 'WP-BCX-8842',
      });
      const open = await pool.query(
        `SELECT count(*)::int n FROM deliveries WHERE rider_id = $1 AND assignment_status IN ('ASSIGNED','ACCEPTED','PICKED_UP','ARRIVED_AT_CUSTOMER')`,
        [RIDER_A]
      );
      expect(farhan.open_deliveries).toBe(open.rows[0].n);
      // No availability system is shown (plan C10).
      expect(Object.keys(farhan)).not.toContain('is_available');
    });

    it.each([
      ['staff', 'staff'],
      ['customer', 'customer'],
      ['rider', 'rider'],
    ] as const)('%s gets 403', async (_l, who) => {
      expect((await request(app).get('/api/v1/admin/riders').set(auth(t[who]))).status).toBe(403);
    });
  });

  describe('GET /admin/orders for the board', () => {
    it('accepts a list of statuses and reports item progress and the active rider', async () => {
      const waiting = await placeOrder([MILK, BUTTER]);
      await source(waiting.id, waiting.itemFor(MILK));
      const packed = await placeOrder([MILK]);
      await source(packed.id, packed.itemFor(MILK));
      await request(app).patch(`/api/v1/admin/orders/${packed.id}/status`).set(auth(t.staff)).send({ status: 'PACKED' });
      await request(app).post(`/api/v1/admin/orders/${packed.id}/assign-rider`).set(auth(t.admin)).send({ rider_id: RIDER_A });

      const res = await request(app).get('/api/v1/admin/orders?status=PLACED,PACKED&limit=100').set(auth(t.staff));
      expect(res.status).toBe(200);
      const orders = res.body.data.orders as Array<Record<string, any>>;
      expect(new Set(orders.map((o) => o.order_status))).toEqual(new Set(['PLACED', 'PACKED']));

      const w = orders.find((o) => o.id === waiting.id)!;
      expect(w.items_summary).toEqual({ total: 2, pending: 1, sourced: 1, packed: 0, unavailable: 0, substituted: 0 });
      expect(w.active_delivery).toBeNull();

      const p = orders.find((o) => o.id === packed.id)!;
      expect(p.items_summary).toMatchObject({ total: 1, packed: 1, pending: 0 });
      expect(p.active_delivery).toMatchObject({ rider_id: RIDER_A, rider_name: 'Farhan Mohamed', assignment_status: 'ASSIGNED' });
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('rejects an unknown status in the list', async () => {
      const res = await request(app).get('/api/v1/admin/orders?status=PLACED,SHIPPED').set(auth(t.staff));
      expect(res.status).toBe(400);
    });

    it('filters to orders changed since a moment (for "done today")', async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const res = await request(app).get(`/api/v1/admin/orders?status=PLACED&since=${encodeURIComponent(future)}`).set(auth(t.staff));
      expect(res.status).toBe(200);
      expect(res.body.data.orders).toEqual([]);
    });

    it('the order detail names the rider', async () => {
      const order = await placeOrder([MILK]);
      await source(order.id, order.itemFor(MILK));
      await request(app).patch(`/api/v1/admin/orders/${order.id}/status`).set(auth(t.staff)).send({ status: 'PACKED' });
      await request(app).post(`/api/v1/admin/orders/${order.id}/assign-rider`).set(auth(t.admin)).send({ rider_id: RIDER_A });
      const res = await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(t.staff));
      expect(res.body.data.order.delivery).toMatchObject({ rider_id: RIDER_A, rider_name: 'Farhan Mohamed' });
      // ...and the customer still sees only the four delivery fields (R7).
      const seen = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(t.customer));
      expect(Object.keys(seen.body.data.order.delivery).sort()).toEqual(['assigned_at', 'assignment_status', 'delivered_at', 'picked_up_at']);
    });
  });
});
