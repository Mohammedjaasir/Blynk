import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { deliveryCodeForDelivery } from './helpers/delivery-code.js';

/**
 * Staff riders (owner, 2026-10-01: the lead delivers from the Operations
 * app). An OPERATIONS or ADMIN account gets an ordinary riders row - set up by
 * the staff member (POST /riders/me/profile) or by an admin's "Can deliver"
 * toggle (PUT /admin/staff/:id/rider) - and is then listed, suggested,
 * assigned (two-order trips included) and delivers like any rider.
 *
 * Own throwaway users (phones +947700098 6x); every row created here, and the
 * audit rows about them, is removed afterwards.
 */
const PREFIX = '+9477000986';

describe('Staff riders', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const plainAdmin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const packer = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const seededRider = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // UNTRACKED: no stock moves

  const ids: Record<'lead' | 'admin2' | 'ops2' | 'packing2', string> = { lead: '', admin2: '', ops2: '', packing2: '' };
  const tokens: Record<string, string> = {
    customer: generateAccessToken(customer),
    plainAdmin: generateAccessToken(plainAdmin),
    packer: generateAccessToken(packer),
    rider: generateAccessToken(seededRider),
  };
  const createdOrders: string[] = [];
  let addressId = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const myProfile = (token: string) => request(app).get('/api/v1/riders/me/profile').set(auth(token));
  const setUpOwn = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/riders/me/profile').set(auth(token)).send(body);
  const canDeliver = (token: string, staffId: string, body: Record<string, unknown>) =>
    request(app).put(`/api/v1/admin/staff/${staffId}/rider`).set(auth(token)).send(body);

  async function cleanup() {
    const users = `(SELECT id FROM users WHERE phone LIKE '${PREFIX}%')`;
    const riders = `(SELECT id FROM riders WHERE user_id IN ${users})`;
    if (createdOrders.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [createdOrders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [createdOrders]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
    await pool.query(
      `DELETE FROM audit_logs WHERE entity_id IN ${users} OR entity_id IN ${riders} OR actor_user_id IN ${users};
       DELETE FROM deliveries WHERE rider_id IN ${riders};
       DELETE FROM riders WHERE user_id IN ${users};
       DELETE FROM refresh_tokens WHERE user_id IN ${users};
       DELETE FROM users WHERE phone LIKE '${PREFIX}%';`
    );
    // The seeded admin's audit rows for staff it changed here.
    await pool.query(`DELETE FROM audit_logs WHERE actor_user_id = $1 AND action LIKE 'RIDER_PROFILE_%'`, [plainAdmin.id]);
  }

  beforeAll(async () => {
    await cleanup();
    const { rows } = await pool.query<{ id: string; phone: string }>(
      `INSERT INTO users (phone, full_name, role) VALUES
         ('${PREFIX}1', 'Lead Operator', 'OPERATIONS'),
         ('${PREFIX}2', 'Second Admin', 'ADMIN'),
         ('${PREFIX}3', 'Second Operator', 'OPERATIONS'),
         ('${PREFIX}4', 'Second Packer', 'PACKING_STAFF')
       RETURNING id, phone`
    );
    const id = (n: string) => rows.find((r) => r.phone === `${PREFIX}${n}`)!.id;
    ids.lead = id('1');
    ids.admin2 = id('2');
    ids.ops2 = id('3');
    ids.packing2 = id('4');
    tokens.lead = generateAccessToken({ id: ids.lead, phone: `${PREFIX}1`, role: 'OPERATIONS' });
    tokens.admin2 = generateAccessToken({ id: ids.admin2, phone: `${PREFIX}2`, role: 'ADMIN' });
    tokens.ops2 = generateAccessToken({ id: ids.ops2, phone: `${PREFIX}3`, role: 'OPERATIONS' });
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Staff rider test', 'Staff Rider Test', '+94771234567', 'No. 3, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });

  afterAll(cleanup);

  async function packedOrder() {
    const placed = await request(app)
      .post('/api/v1/orders')
      .set(auth(tokens.customer))
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as { id: string; total_amount: number };
    createdOrders.push(order.id);
    const pending = await pool.query(`SELECT id FROM order_items WHERE order_id = $1 AND item_status = 'PENDING'`, [order.id]);
    for (const { id } of pending.rows) {
      await request(app)
        .post(`/api/v1/admin/orders/${order.id}/items/${id}/source`)
        .set(auth(tokens.packer))
        .send({ actual_unit_cost: 450 });
    }
    const packed = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(auth(tokens.packer))
      .send({ status: 'PACKED' });
    expect(packed.status).toBe(200);
    return order;
  }

  const assign = (orderId: string, riderId: string) =>
    request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set(auth(tokens.plainAdmin)).send({ rider_id: riderId });

  // ==========================================================================
  describe('self set-up from the Operations app', () => {
    it('starts with no profile and the rider routes refuse with RIDER_PROFILE_NOT_FOUND', async () => {
      const res = await myProfile(tokens.lead);
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toBeNull();
      const list = await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.lead));
      expect(list.status).toBe(403);
      expect(list.body.error.code).toBe('RIDER_PROFILE_NOT_FOUND');
    });

    it('validates the vehicle', async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ vehicle_type: 'ROCKET', vehicle_registration_number: 'WP-ABC-1234' }, 'vehicle_type'],
        [{ vehicle_type: 'MOTORCYCLE', vehicle_registration_number: ' ' }, 'vehicle_registration_number'],
        [{ vehicle_type: 'MOTORCYCLE' }, 'vehicle_registration_number'],
        [{ vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'X'.repeat(33) }, 'vehicle_registration_number'],
        [{ vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-1', emergency_contact_phone: 'call me' }, 'emergency_contact_phone'],
      ];
      for (const [body, field] of cases) {
        const res = await setUpOwn(tokens.lead, body);
        expect(res.status, field).toBe(400);
        expect(res.body.error.details.map((d: { field: string }) => d.field), field).toContain(field);
      }
      expect((await myProfile(tokens.lead)).body.data.profile).toBeNull();
    });

    it('creates an active profile at once, and the rider routes then work', async () => {
      const res = await setUpOwn(tokens.lead, { vehicle_type: 'MOTORCYCLE', vehicle_registration_number: ' wp-lead-0001 ' });
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toMatchObject({
        vehicle_type: 'MOTORCYCLE',
        vehicle_registration_number: 'WP-LEAD-0001',
        emergency_contact_phone: null,
        is_active: true,
      });
      expect((await myProfile(tokens.lead)).body.data.profile.id).toBe(res.body.data.profile.id);
      const list = await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.lead));
      expect(list.status).toBe(200);
      expect(list.body.data.deliveries).toEqual([]);
      const day = await request(app).get('/api/v1/riders/me/day').set(auth(tokens.lead));
      expect(day.status).toBe(200);
      expect(day.body.data.today.completed).toBe(0);
      const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [res.body.data.profile.id]);
      expect(audit.rows.map((r) => r.action)).toEqual(['RIDER_PROFILE_CREATED']);
    });

    it('a second set-up updates the vehicle on the same row', async () => {
      const before = (await myProfile(tokens.lead)).body.data.profile;
      const res = await setUpOwn(tokens.lead, {
        vehicle_type: 'SCOOTER',
        vehicle_registration_number: 'WP-LEAD-0002',
        emergency_contact_phone: '077 123 4567',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toMatchObject({ id: before.id, vehicle_type: 'SCOOTER', vehicle_registration_number: 'WP-LEAD-0002' });
      const count = await pool.query(`SELECT count(*)::int AS n FROM riders WHERE user_id = $1`, [ids.lead]);
      expect(count.rows[0].n).toBe(1);
    });

    it('an ADMIN can set up their own profile too', async () => {
      const res = await setUpOwn(tokens.admin2, { vehicle_type: 'BICYCLE', vehicle_registration_number: 'NONE-ADMIN2' });
      expect(res.status).toBe(200);
      expect(res.body.data.profile.is_active).toBe(true);
    });

    it('RIDER, PACKING_STAFF and CUSTOMER accounts cannot set up a staff profile', async () => {
      const body = { vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-NOPE-1' };
      for (const token of [tokens.rider, tokens.packer, tokens.customer]) {
        const res = await setUpOwn(token, body);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect((await request(app).post('/api/v1/riders/me/profile').send(body)).status).toBe(401);
      expect((await myProfile(tokens.packer)).status).toBe(403);
    });
  });

  // ==========================================================================
  describe('listed, suggested and assigned like any rider', () => {
    let riderId = '';
    beforeAll(async () => {
      riderId = (await myProfile(tokens.lead)).body.data.profile.id;
    });

    it('appears in GET /admin/riders and in the assign suggestions', async () => {
      const list = await request(app).get('/api/v1/admin/riders').set(auth(tokens.plainAdmin));
      expect(list.status).toBe(200);
      const me = list.body.data.riders.find((r: { id: string }) => r.id === riderId);
      expect(me).toMatchObject({ full_name: 'Lead Operator', vehicle_registration_number: 'WP-LEAD-0002', open_deliveries: 0 });

      const order = await packedOrder();
      const sugg = await request(app)
        .get(`/api/v1/admin/riders/suggestions?order_id=${order.id}`)
        .set(auth(tokens.ops2));
      expect(sugg.status).toBe(200);
      expect(sugg.body.data.riders.map((r: { id: string }) => r.id)).toContain(riderId);
    });

    it('takes a two-order trip and delivers both through the rider routes', async () => {
      const first = createdOrders[createdOrders.length - 1];
      const second = (await packedOrder()).id;
      const a = await assign(first, riderId);
      expect(a.status).toBe(200);
      const b = await assign(second, riderId);
      expect(b.status).toBe(200);

      const list = await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.lead));
      expect(list.body.data.deliveries.map((d: { order_id: string }) => d.order_id).sort()).toEqual([first, second].sort());

      for (const d of list.body.data.deliveries as Array<{ delivery_id: string; total_amount: number }>) {
        const pick = await request(app)
          .patch(`/api/v1/riders/deliveries/${d.delivery_id}/status`)
          .set(auth(tokens.lead))
          .send({ status: 'PICKED_UP' });
        expect(pick.status).toBe(200);
      }
      const [one, two] = list.body.data.deliveries as Array<{ delivery_id: string; total_amount: number }>;
      const loc = await request(app)
        .post(`/api/v1/riders/deliveries/${one.delivery_id}/location`)
        .set(auth(tokens.lead))
        .send({ latitude: 6.436, longitude: 80.026, accuracy: 10, captured_at: new Date().toISOString() });
      expect(loc.status).toBe(202);
      const arrive = await request(app)
        .patch(`/api/v1/riders/deliveries/${one.delivery_id}/status`)
        .set(auth(tokens.lead))
        .send({ status: 'ARRIVED_AT_CUSTOMER' });
      expect(arrive.status).toBe(200);
      const collect = await request(app)
        .post(`/api/v1/riders/deliveries/${one.delivery_id}/collect-cod`)
        .set(auth(tokens.lead))
        .send({ amount: one.total_amount, delivery_code: await deliveryCodeForDelivery(one.delivery_id) });
      expect(collect.status).toBe(200);
      const fail = await request(app)
        .patch(`/api/v1/riders/deliveries/${two.delivery_id}/status`)
        .set(auth(tokens.lead))
        .send({ status: 'FAILED', failure_reason: 'Customer did not answer' });
      expect(fail.status).toBe(200);

      const day = await request(app).get('/api/v1/riders/me/day').set(auth(tokens.lead));
      expect(day.body.data.today).toMatchObject({ completed: 1, failed: 1, cash_collected: one.total_amount });
    });
  });

  // ==========================================================================
  describe('admin "Can deliver" toggle', () => {
    it('is ADMIN-only', async () => {
      for (const token of [tokens.lead, tokens.packer, tokens.rider]) {
        const res = await canDeliver(token, ids.ops2, { can_deliver: true, vehicle_registration_number: 'WP-X' });
        expect(res.status).toBe(403);
      }
    });

    it('refuses Inventory accounts and unknown ids', async () => {
      const packing = await canDeliver(tokens.plainAdmin, ids.packing2, { can_deliver: true, vehicle_registration_number: 'WP-X' });
      expect(packing.status).toBe(422);
      expect(packing.body.error.code).toBe('ROLE_CANNOT_DELIVER');
      const customerRes = await canDeliver(tokens.plainAdmin, customer.id, { can_deliver: true, vehicle_registration_number: 'WP-X' });
      expect(customerRes.status).toBe(404);
      const bad = await canDeliver(tokens.plainAdmin, 'nope', { can_deliver: true });
      expect(bad.status).toBe(400);
    });

    it('needs a registration number to create a profile', async () => {
      const res = await canDeliver(tokens.plainAdmin, ids.ops2, { can_deliver: true });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((await myProfile(tokens.ops2)).body.data.profile).toBeNull();
    });

    it('creates an active profile and the staff list shows it', async () => {
      const res = await canDeliver(tokens.plainAdmin, ids.ops2, {
        can_deliver: true,
        vehicle_type: 'THREE_WHEELER',
        vehicle_registration_number: 'wp-ops2-1',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.rider).toMatchObject({ is_active: true, vehicle_type: 'THREE_WHEELER', vehicle_registration_number: 'WP-OPS2-1' });
      const staff = await request(app).get('/api/v1/admin/staff').set(auth(tokens.plainAdmin));
      const row = staff.body.data.staff.find((s: { id: string }) => s.id === ids.ops2);
      expect(row.rider).toMatchObject({ is_active: true, vehicle_registration_number: 'WP-OPS2-1' });
      const packingRow = staff.body.data.staff.find((s: { id: string }) => s.id === ids.packing2);
      expect(packingRow.rider).toBeNull();
    });

    it('will not switch off a rider who still holds an open delivery', async () => {
      const riderId = (await myProfile(tokens.ops2)).body.data.profile.id;
      const order = await packedOrder();
      expect((await assign(order.id, riderId)).status).toBe(200);
      const res = await canDeliver(tokens.plainAdmin, ids.ops2, { can_deliver: false });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RIDER_HAS_OPEN_DELIVERIES');
      // Hand it back: the store un-assigns by failing the attempt.
      const del = await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.ops2));
      const id = del.body.data.deliveries[0].delivery_id;
      await request(app).patch(`/api/v1/riders/deliveries/${id}/status`).set(auth(tokens.ops2)).send({ status: 'PICKED_UP' });
      const fail = await request(app)
        .patch(`/api/v1/riders/deliveries/${id}/status`)
        .set(auth(tokens.ops2))
        .send({ status: 'FAILED', failure_reason: 'Test hand-back' });
      expect(fail.status).toBe(200);
    });

    it('switches off: no longer listed, the rider routes refuse, and self set-up cannot undo it', async () => {
      const riderId = (await myProfile(tokens.ops2)).body.data.profile.id;
      const res = await canDeliver(tokens.plainAdmin, ids.ops2, { can_deliver: false });
      expect(res.status).toBe(200);
      expect(res.body.data.rider.is_active).toBe(false);
      const list = await request(app).get('/api/v1/admin/riders').set(auth(tokens.plainAdmin));
      expect(list.body.data.riders.map((r: { id: string }) => r.id)).not.toContain(riderId);
      const deliveries = await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.ops2));
      expect(deliveries.body.error.code).toBe('RIDER_INACTIVE');
      const self = await setUpOwn(tokens.ops2, { vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-AGAIN' });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('RIDER_PROFILE_DISABLED');
    });

    it('switches back on with the same row', async () => {
      const before = (await myProfile(tokens.ops2)).body.data.profile;
      const res = await canDeliver(tokens.plainAdmin, ids.ops2, { can_deliver: true });
      expect(res.status).toBe(200);
      expect(res.body.data.rider).toMatchObject({ id: before.id, is_active: true, vehicle_registration_number: 'WP-OPS2-1' });
    });

    it('works on ADMIN accounts, including the caller’s own', async () => {
      const res = await canDeliver(tokens.admin2, ids.admin2, { can_deliver: false });
      expect(res.status).toBe(200);
      expect(res.body.data.rider.is_active).toBe(false);
    });

    it('moving an account to Inventory switches its rider profile off', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/staff/${ids.ops2}`)
        .set(auth(tokens.plainAdmin))
        .send({ role: 'PACKING_STAFF' });
      expect(res.status).toBe(200);
      expect(res.body.data.staff.rider.is_active).toBe(false);
    });

    it('a disabled staff sign-in is not offered for assignment', async () => {
      const riderId = (await myProfile(tokens.lead)).body.data.profile.id;
      await pool.query(`UPDATE users SET staff_disabled_at = now() WHERE id = $1`, [ids.lead]);
      try {
        const list = await request(app).get('/api/v1/admin/riders').set(auth(tokens.plainAdmin));
        expect(list.body.data.riders.map((r: { id: string }) => r.id)).not.toContain(riderId);
      } finally {
        await pool.query(`UPDATE users SET staff_disabled_at = NULL WHERE id = $1`, [ids.lead]);
      }
    });
  });
});
