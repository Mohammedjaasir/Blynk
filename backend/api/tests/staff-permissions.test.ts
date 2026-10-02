import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';

/**
 * Staff accounts permission matrix and Rider credentials (owner, 2026-10-01:
 * "in the admin and operation add the option to create a new credential for
 * rider, admin, inventory"):
 *
 *   ADMIN      creates ADMIN, OPERATIONS, PACKING_STAFF, RIDER;
 *   OPERATIONS creates and manages only PACKING_STAFF and RIDER;
 *   an existing ADMIN, and the caller's own account, are never changed here.
 *
 * Own throwaway users (phones +9477000975x / 0770009751-9); every row made
 * here - riders, orders, deliveries, audit rows - is removed afterwards.
 */
const PREFIX = '+9477000975';
const EMAIL_DOMAIN = '@staff-permissions.blynk.test';
const PASSWORD = 'Rider-pass-2026';

describe('Staff accounts: permission matrix and rider credentials', () => {
  const app = createApp();
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const seededAdmin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const seededPacker = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const MILK = 'b0000001-0000-0000-0000-000000000001'; // UNTRACKED: no stock moves

  const ids = { admin: '', ops: '', otherOps: '', otherAdmin: '' };
  const tokens = {
    admin: '',
    ops: '',
    packer: generateAccessToken(seededPacker),
    customer: generateAccessToken(customer),
    seededAdmin: generateAccessToken(seededAdmin),
  };
  const createdOrders: string[] = [];
  let addressId = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const create = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/admin/staff').set(auth(token)).send(body);
  const patch = (token: string, id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/admin/staff/${id}`).set(auth(token)).send(body);
  const list = (token: string) => request(app).get('/api/v1/admin/staff').set(auth(token));
  const login = (email: string, password: string) =>
    request(app).post('/api/v1/auth/staff/login').send({ email, password });
  const account = (n: string, role: string, extra: Record<string, unknown> = {}) => ({
    full_name: `Perm ${role} ${n}`,
    email: `perm${n}${EMAIL_DOMAIN}`,
    password: PASSWORD,
    role,
    phone: `077000975${n}`,
    ...extra,
  });
  const rider = (n: string, extra: Record<string, unknown> = {}) =>
    account(n, 'RIDER', { vehicle_type: 'SCOOTER', vehicle_registration_number: `wp-perm-${n}`, ...extra });

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
       DELETE FROM otp_verifications WHERE phone LIKE '${PREFIX}%';
       DELETE FROM users WHERE phone LIKE '${PREFIX}%';`
    );
  }

  beforeAll(async () => {
    await cleanup();
    const { rows } = await pool.query<{ id: string; phone: string }>(
      `INSERT INTO users (phone, email, full_name, role) VALUES
         ('${PREFIX}0', NULL, 'Perm Admin', 'ADMIN'),
         ('${PREFIX}1', NULL, 'Perm Operator', 'OPERATIONS'),
         ('${PREFIX}2', NULL, 'Perm Other Operator', 'OPERATIONS'),
         ('${PREFIX}3', NULL, 'Perm Other Admin', 'ADMIN')
       RETURNING id, phone`
    );
    const id = (n: string) => rows.find((r) => r.phone === `${PREFIX}${n}`)!.id;
    ids.admin = id('0');
    ids.ops = id('1');
    ids.otherOps = id('2');
    ids.otherAdmin = id('3');
    tokens.admin = generateAccessToken({ id: ids.admin, phone: `${PREFIX}0`, role: 'ADMIN' });
    tokens.ops = generateAccessToken({ id: ids.ops, phone: `${PREFIX}1`, role: 'OPERATIONS' });
    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Staff permissions test', 'Staff Permissions Test', '+94771234567', 'No. 5, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    addressId = addr.rows[0].id;
  });

  beforeEach(() => authRateLimiter.reset());
  afterAll(cleanup);

  async function packedOrder() {
    const placed = await request(app)
      .post('/api/v1/orders')
      .set(auth(tokens.customer))
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as { id: string };
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
    request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set(auth(tokens.seededAdmin)).send({ rider_id: riderId });

  // ==========================================================================
  describe('ADMIN', () => {
    it('creates each of the four roles', async () => {
      const made: Array<[Record<string, unknown>, string]> = [
        [account('4', 'ADMIN'), 'ADMIN'],
        [account('5', 'OPERATIONS'), 'OPERATIONS'],
        [account('6', 'PACKING_STAFF'), 'PACKING_STAFF'],
        [rider('7', { emergency_contact_phone: '077 123 4567' }), 'RIDER'],
      ];
      for (const [body, role] of made) {
        const res = await create(tokens.admin, body);
        expect(res.status, role).toBe(201);
        expect(res.body.data.staff).toMatchObject({ role, has_password: true, disabled: false });
        expect(res.body.data.staff.read_only, role).toBe(role === 'ADMIN');
      }
      // The new admin is untouchable like any other.
      const newAdmin = (await pool.query(`SELECT id FROM users WHERE phone = $1`, [`${PREFIX}4`])).rows[0].id;
      expect((await patch(tokens.admin, newAdmin, { disabled: true })).body.error.code).toBe('CANNOT_EDIT_ADMIN');
    });

    it('creates the rider with its riders row in the same go, active and assignable', async () => {
      const { rows } = await pool.query(
        `SELECT r.vehicle_type, r.vehicle_registration_number, r.emergency_contact_phone, r.is_active, u.role
           FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = $1`,
        [`${PREFIX}7`]
      );
      expect(rows).toEqual([
        {
          vehicle_type: 'SCOOTER',
          vehicle_registration_number: 'WP-PERM-7',
          emergency_contact_phone: '077 123 4567',
          is_active: true,
          role: 'RIDER',
        },
      ]);
      const riders = await request(app).get('/api/v1/admin/riders').set(auth(tokens.admin));
      expect(riders.body.data.riders.map((r: { phone: string }) => r.phone)).toContain(`${PREFIX}7`);
      const audit = await pool.query(
        `SELECT action, new_values FROM audit_logs WHERE entity_id = (SELECT id FROM users WHERE phone = $1)`,
        [`${PREFIX}7`]
      );
      expect(audit.rows[0].action).toBe('STAFF_CREATED');
      expect(audit.rows[0].new_values).toMatchObject({ role: 'RIDER', by_role: 'ADMIN', vehicle_registration_number: 'WP-PERM-7' });
      expect(JSON.stringify(audit.rows[0].new_values)).not.toContain(PASSWORD);
    });

    it('lists every role, riders with their vehicle', async () => {
      const res = await list(tokens.admin);
      expect(res.status).toBe(200);
      const mine = (res.body.data.staff as Array<{ phone: string; role: string; rider: unknown }>).filter((s) =>
        s.phone.startsWith(PREFIX)
      );
      expect(new Set(mine.map((s) => s.role))).toEqual(new Set(['ADMIN', 'OPERATIONS', 'PACKING_STAFF', 'RIDER']));
      expect(mine.find((s) => s.phone === `${PREFIX}7`)!.rider).toMatchObject({
        vehicle_type: 'SCOOTER',
        vehicle_registration_number: 'WP-PERM-7',
        is_active: true,
      });
    });

    it('needs a registration number for a rider, and refuses a rider role change', async () => {
      const res = await create(tokens.admin, account('8', 'RIDER'));
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain('vehicle_registration_number');
      const riderId = (await pool.query(`SELECT id FROM users WHERE phone = $1`, [`${PREFIX}7`])).rows[0].id;
      const move = await patch(tokens.admin, riderId, { role: 'OPERATIONS' });
      expect(move.status).toBe(422);
      expect(move.body.error.code).toBe('ROLE_CHANGE_NOT_ALLOWED');
    });
  });

  // ==========================================================================
  describe('OPERATIONS', () => {
    let packerId = '';
    let riderUserId = '';

    it('creates RIDER and PACKING_STAFF accounts', async () => {
      const p = await create(tokens.ops, account('8', 'PACKING_STAFF'));
      expect(p.status).toBe(201);
      packerId = p.body.data.staff.id;
      const r = await create(tokens.ops, rider('9'));
      expect(r.status).toBe(201);
      riderUserId = r.body.data.staff.id;
      expect(r.body.data.staff.rider).toMatchObject({ vehicle_registration_number: 'WP-PERM-9', is_active: true });
      const audit = await pool.query(`SELECT new_values FROM audit_logs WHERE entity_id = $1`, [riderUserId]);
      expect(audit.rows[0].new_values).toMatchObject({ by_role: 'OPERATIONS', role: 'RIDER' });
    });

    it('gets 403 creating ADMIN or OPERATIONS accounts', async () => {
      for (const role of ['ADMIN', 'OPERATIONS']) {
        const res = await create(tokens.ops, account('2', role, { email: `nope-${role}${EMAIL_DOMAIN}`, phone: '0770009760' }));
        expect(res.status, role).toBe(403);
        expect(res.body.error.code).toBe('STAFF_ROLE_FORBIDDEN');
      }
      expect((await pool.query(`SELECT 1 FROM users WHERE email LIKE 'nope-%${EMAIL_DOMAIN}'`)).rowCount).toBe(0);
    });

    it('lists only Inventory and Rider accounts', async () => {
      const res = await list(tokens.ops);
      expect(res.status).toBe(200);
      const roles = new Set((res.body.data.staff as Array<{ role: string }>).map((s) => s.role));
      expect([...roles].every((r) => r === 'PACKING_STAFF' || r === 'RIDER')).toBe(true);
      expect(res.body.data.staff.some((s: { id: string }) => s.id === riderUserId)).toBe(true);
    });

    it('cannot touch ADMIN or OPERATIONS targets, or itself', async () => {
      for (const target of [ids.otherAdmin, ids.admin]) {
        const res = await patch(tokens.ops, target, { disabled: true });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('CANNOT_EDIT_ADMIN');
      }
      const ops = await patch(tokens.ops, ids.otherOps, { password: 'Another-pass-1' });
      expect(ops.status).toBe(403);
      expect(ops.body.error.code).toBe('STAFF_ROLE_FORBIDDEN');
      const self = await patch(tokens.ops, ids.ops, { full_name: 'Me' });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('CANNOT_EDIT_SELF');
      const { rows } = await pool.query(`SELECT staff_disabled_at, staff_password_hash FROM users WHERE id = ANY($1)`, [
        [ids.otherAdmin, ids.otherOps],
      ]);
      expect(rows.every((r) => r.staff_disabled_at === null && r.staff_password_hash === null)).toBe(true);
    });

    it('resets passwords, disables, and edits rider details on Inventory and Rider accounts - but never roles', async () => {
      expect((await patch(tokens.ops, packerId, { password: 'Packer-new-pass-1' })).status).toBe(200);
      expect((await patch(tokens.ops, packerId, { disabled: true })).body.data.staff.disabled).toBe(true);
      expect((await patch(tokens.ops, packerId, { disabled: false })).body.data.staff.disabled).toBe(false);
      const role = await patch(tokens.ops, packerId, { role: 'OPERATIONS' });
      expect(role.status).toBe(403);
      expect(role.body.error.code).toBe('STAFF_ROLE_FORBIDDEN');

      const vehicle = await patch(tokens.ops, riderUserId, { vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'wp-perm-9b' });
      expect(vehicle.status).toBe(200);
      expect(vehicle.body.data.staff.rider).toMatchObject({ vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-PERM-9B' });
      const notRider = await patch(tokens.ops, packerId, { vehicle_registration_number: 'WP-X' });
      expect(notRider.status).toBe(422);
      expect(notRider.body.error.code).toBe('NOT_A_RIDER_ACCOUNT');
    });

    it('PUT /admin/staff/:id/rider ("Can deliver") stays ADMIN only', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/staff/${ids.otherOps}/rider`)
        .set(auth(tokens.ops))
        .send({ can_deliver: true, vehicle_registration_number: 'WP-1' });
      expect(res.status).toBe(403);
    });
  });

  it('PACKING_STAFF and riders get 403 on every staff endpoint', async () => {
    const riderToken = generateAccessToken({ id: ids.admin, phone: `${PREFIX}0`, role: 'RIDER' });
    for (const token of [tokens.packer, riderToken]) {
      expect((await list(token)).status).toBe(403);
      expect((await create(token, rider('2'))).status).toBe(403);
      expect((await patch(token, ids.otherOps, { full_name: 'x' })).status).toBe(403);
    }
  });

  // ==========================================================================
  describe('a rider account', () => {
    const email = `perm9${EMAIL_DOMAIN}`;
    let riderUserId = '';
    let riderRowId = '';

    it('signs in with email + password and reaches the rider routes', async () => {
      const { rows } = await pool.query(
        `SELECT u.id AS user_id, r.id AS rider_id FROM users u JOIN riders r ON r.user_id = u.id WHERE u.phone = $1`,
        [`${PREFIX}9`]
      );
      riderUserId = rows[0].user_id;
      riderRowId = rows[0].rider_id;
      const res = await login(email, PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('RIDER');
      const deliveries = await request(app).get('/api/v1/riders/deliveries').set(auth(res.body.data.access_token));
      expect(deliveries.status).toBe(200);
      expect((await login(email, 'Wrong-pass-123')).status).toBe(401);
    });

    it('cannot be disabled while holding an open delivery (409 RIDER_HAS_OPEN_DELIVERIES)', async () => {
      const order = await packedOrder();
      expect((await assign(order.id, riderRowId)).status).toBe(200);
      const res = await patch(tokens.ops, riderUserId, { disabled: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RIDER_HAS_OPEN_DELIVERIES');
      expect((await pool.query(`SELECT staff_disabled_at FROM users WHERE id = $1`, [riderUserId])).rows[0].staff_disabled_at).toBeNull();

      // Hand it back so the rider can be disabled.
      const token = (await login(email, PASSWORD)).body.data.access_token as string;
      const del = await request(app).get('/api/v1/riders/deliveries').set(auth(token));
      const id = del.body.data.deliveries[0].delivery_id;
      await request(app).patch(`/api/v1/riders/deliveries/${id}/status`).set(auth(token)).send({ status: 'PICKED_UP' });
      const fail = await request(app)
        .patch(`/api/v1/riders/deliveries/${id}/status`)
        .set(auth(token))
        .send({ status: 'FAILED', failure_reason: 'Test hand-back' });
      expect(fail.status).toBe(200);
    });

    it('once disabled: no sign-in, not listed or suggested, and assignment is refused', async () => {
      const off = await patch(tokens.ops, riderUserId, { disabled: true });
      expect(off.status).toBe(200);
      expect(off.body.data.staff.disabled).toBe(true);

      const pw = await login(email, PASSWORD);
      expect(pw.status).toBe(401);
      expect(pw.body.error.code).toBe('INVALID_CREDENTIALS');

      const riders = await request(app).get('/api/v1/admin/riders').set(auth(tokens.admin));
      expect(riders.body.data.riders.map((r: { id: string }) => r.id)).not.toContain(riderRowId);

      const order = await packedOrder();
      const suggestions = await request(app)
        .get(`/api/v1/admin/riders/suggestions?order_id=${order.id}`)
        .set(auth(tokens.admin));
      expect(suggestions.status).toBe(200);
      expect(suggestions.body.data.riders.map((r: { id: string }) => r.id)).not.toContain(riderRowId);

      const refused = await assign(order.id, riderRowId);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('RIDER_INACTIVE');

      // Enabling restores sign-in and assignment.
      expect((await patch(tokens.ops, riderUserId, { disabled: false })).body.data.staff.disabled).toBe(false);
      expect((await login(email, PASSWORD)).status).toBe(200);
      expect((await assign(order.id, riderRowId)).status).toBe(200);
    });
  });
});
