import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';

/**
 * Staff accounts (migration 014): Blynk Admin creates Inventory
 * (PACKING_STAFF) and Operations (OPERATIONS) sign-ins; each reaches only its
 * own app's routes. Own throwaway users (phones +947700097xx), their tokens,
 * OTPs and audit rows are removed afterwards, so the run leaves no trace.
 */
const PREFIX = '+9477000970';
const EMAIL_DOMAIN = '@staff-accounts.blynk.test';

describe('Admin staff accounts', () => {
  const app = createApp();
  let adminId = '';
  let adminToken = '';
  let otherAdminId = '';
  let packingToken = '';
  let opsToken = '';

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const create = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/admin/staff').set(auth(token)).send(body);
  const patch = (token: string, id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/admin/staff/${id}`).set(auth(token)).send(body);
  const login = (email: string, password: string) =>
    request(app).post('/api/v1/auth/staff/login').send({ email, password });

  async function cleanup() {
    await pool.query(
      `DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM users WHERE phone LIKE '${PREFIX}%')
          OR actor_user_id IN (SELECT id FROM users WHERE phone LIKE '${PREFIX}%');
       DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '${PREFIX}%');
       DELETE FROM otp_verifications WHERE phone LIKE '${PREFIX}%';
       DELETE FROM users WHERE phone LIKE '${PREFIX}%';`
    );
  }

  beforeAll(async () => {
    await cleanup();
    const { rows } = await pool.query<{ id: string; phone: string }>(
      `INSERT INTO users (phone, email, full_name, role) VALUES
         ('${PREFIX}1', 'admin${EMAIL_DOMAIN}', 'Staff Test Admin', 'ADMIN'),
         ('${PREFIX}2', 'other-admin${EMAIL_DOMAIN}', 'Other Admin', 'ADMIN'),
         ('${PREFIX}3', NULL, 'Packer', 'PACKING_STAFF'),
         ('${PREFIX}4', NULL, 'Operator', 'OPERATIONS')
       RETURNING id, phone`
    );
    const id = (n: string) => rows.find((r) => r.phone === `${PREFIX}${n}`)!.id;
    adminId = id('1');
    otherAdminId = id('2');
    adminToken = generateAccessToken({ id: adminId, phone: `${PREFIX}1`, role: 'ADMIN' });
    packingToken = generateAccessToken({ id: id('3'), phone: `${PREFIX}3`, role: 'PACKING_STAFF' });
    opsToken = generateAccessToken({ id: id('4'), phone: `${PREFIX}4`, role: 'OPERATIONS' });
  });

  beforeEach(() => authRateLimiter.reset());
  afterAll(cleanup);

  const valid = (n: string, extra: Record<string, unknown> = {}) => ({
    full_name: `Staff ${n}`,
    email: `staff${n}${EMAIL_DOMAIN}`,
    password: 'Correct-horse-1',
    role: 'OPERATIONS',
    phone: `077000970${n}`,
    ...extra,
  });

  // ==========================================================================
  // Create / list / update (ADMIN)
  // ==========================================================================
  describe('ADMIN', () => {
    it('creates an Operations account with a normalised email and phone and a bcrypt hash', async () => {
      const res = await create(adminToken, valid('5', { email: '  Staff5' + EMAIL_DOMAIN.toUpperCase() + ' ' }));
      expect(res.status).toBe(201);
      expect(res.body.data.staff).toMatchObject({
        full_name: 'Staff 5',
        email: `staff5${EMAIL_DOMAIN}`,
        phone: `${PREFIX}5`,
        role: 'OPERATIONS',
        has_password: true,
        disabled: false,
        read_only: false,
      });
      expect(res.body.data.staff).not.toHaveProperty('staff_password_hash');
      const { rows } = await pool.query(`SELECT staff_password_hash FROM users WHERE phone = $1`, [`${PREFIX}5`]);
      expect(rows[0].staff_password_hash).toMatch(/^\$2[aby]\$10\$/);
      const audit = await pool.query(`SELECT action, new_values FROM audit_logs WHERE entity_id = $1`, [
        res.body.data.staff.id,
      ]);
      expect(audit.rows[0].action).toBe('STAFF_CREATED');
      expect(JSON.stringify(audit.rows[0].new_values)).not.toContain('Correct-horse-1');
    });

    it('lists staff and admins newest first, admins read-only, without customers', async () => {
      const res = await request(app).get('/api/v1/admin/staff').set(auth(adminToken));
      expect(res.status).toBe(200);
      const staff = res.body.data.staff as Array<{ phone: string; role: string; read_only: boolean; created_at: string }>;
      const mine = staff.filter((s) => s.phone.startsWith(PREFIX));
      expect(mine.map((s) => s.phone)).toEqual(expect.arrayContaining([`${PREFIX}1`, `${PREFIX}3`, `${PREFIX}4`, `${PREFIX}5`]));
      expect(staff.every((s) => ['ADMIN', 'PACKING_STAFF', 'OPERATIONS'].includes(s.role))).toBe(true);
      expect(mine.find((s) => s.phone === `${PREFIX}1`)!.read_only).toBe(true);
      const times = staff.map((s) => new Date(s.created_at).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(Object.keys(staff[0]).sort()).toEqual(
        ['created_at', 'disabled', 'email', 'full_name', 'has_password', 'id', 'phone', 'read_only', 'role'].sort()
      );
    });

    it('refuses a duplicate email (any case) with 409 EMAIL_TAKEN and a duplicate phone with 409 PHONE_TAKEN', async () => {
      const email = await create(adminToken, valid('6', { email: `STAFF5${EMAIL_DOMAIN}` }));
      expect(email.status).toBe(409);
      expect(email.body.error.code).toBe('EMAIL_TAKEN');
      const phone = await create(adminToken, valid('6', { phone: '+94770009705' }));
      expect(phone.status).toBe(409);
      expect(phone.body.error.code).toBe('PHONE_TAKEN');
    });

    it('validates the body', async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [valid('6', { password: 'short' }), 'password'],
        [valid('6', { password: 'x'.repeat(129) }), 'password'],
        [valid('6', { email: 'not-an-email' }), 'email'],
        [valid('6', { role: 'ADMIN' }), 'role'],
        [valid('6', { role: 'CUSTOMER' }), 'role'],
        [valid('6', { full_name: '   ' }), 'full_name'],
        [valid('6', { phone: '12345' }), 'phone'],
        [{ ...valid('6'), phone: undefined }, 'phone'],
      ];
      for (const [body, field] of cases) {
        const res = await create(adminToken, body);
        expect(res.status, field).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.map((d: { field: string }) => d.field), field).toContain(field);
      }
    });

    it('renames, changes role, and never touches an ADMIN, the caller, or a customer', async () => {
      const { rows } = await pool.query(`SELECT id FROM users WHERE phone = $1`, [`${PREFIX}5`]);
      const id = rows[0].id;
      const res = await patch(adminToken, id, { full_name: 'Renamed', role: 'PACKING_STAFF' });
      expect(res.status).toBe(200);
      expect(res.body.data.staff).toMatchObject({ full_name: 'Renamed', role: 'PACKING_STAFF' });
      expect((await patch(adminToken, id, { role: 'OPERATIONS' })).body.data.staff.role).toBe('OPERATIONS');

      const admin = await patch(adminToken, otherAdminId, { full_name: 'Nope' });
      expect(admin.status).toBe(403);
      expect(admin.body.error.code).toBe('CANNOT_EDIT_ADMIN');
      const self = await patch(adminToken, adminId, { disabled: true });
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('CANNOT_EDIT_SELF');
      const missing = await patch(adminToken, '00000000-0000-0000-0000-000000000000', { full_name: 'x' });
      expect(missing.status).toBe(404);
      expect((await patch(adminToken, id, {})).status).toBe(400);
      expect((await patch(adminToken, id, { role: 'ADMIN' })).status).toBe(400);
      expect((await patch(adminToken, id, { email: 'x@y.z' })).status).toBe(400);
    });
  });

  // ==========================================================================
  // Only ADMIN manages staff
  // ==========================================================================
  it('refuses PACKING_STAFF and OPERATIONS on every staff endpoint with 403', async () => {
    for (const token of [packingToken, opsToken]) {
      expect((await request(app).get('/api/v1/admin/staff').set(auth(token))).status).toBe(403);
      expect((await create(token, valid('7'))).status).toBe(403);
      expect((await patch(token, otherAdminId, { full_name: 'x' })).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/staff')).status).toBe(401);
  });

  // ==========================================================================
  // Sign-in and access per role
  // ==========================================================================
  describe('a created account', () => {
    let opsId = '';

    it('OPERATIONS signs in with email + password, reaches Ops routes, and nothing admin-site-only', async () => {
      const made = await create(adminToken, valid('8'));
      expect(made.status).toBe(201);
      opsId = made.body.data.staff.id;

      const res = await login(`staff8${EMAIL_DOMAIN}`, 'Correct-horse-1');
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('OPERATIONS');
      const token = res.body.data.access_token as string;

      // Routes the Operations app calls.
      for (const path of ['/api/v1/admin/orders?limit=1', '/api/v1/admin/riders', '/api/v1/admin/inventory?limit=1',
        '/api/v1/admin/products?limit=1', '/api/v1/admin/promotions', '/api/v1/admin/dental/clinics']) {
        expect((await request(app).get(path).set(auth(token))).status, path).toBe(200);
      }
      // Admin-site-only routes.
      for (const path of ['/api/v1/admin/feedback', '/api/v1/admin/staff', '/api/v1/admin/notifications',
        '/api/v1/admin/packing-queue']) {
        expect((await request(app).get(path).set(auth(token))).status, path).toBe(403);
      }
    });

    it('PACKING_STAFF still reaches inventory routes but not Ops-only ones', async () => {
      expect((await request(app).get('/api/v1/admin/inventory?limit=1').set(auth(packingToken))).status).toBe(200);
      expect((await request(app).get('/api/v1/admin/suppliers').set(auth(packingToken))).status).toBe(200);
      expect((await request(app).get('/api/v1/admin/orders?limit=1').set(auth(packingToken))).status).toBe(200);
      expect((await request(app).get('/api/v1/admin/riders').set(auth(packingToken))).status).toBe(403);
      expect((await request(app).get('/api/v1/admin/products').set(auth(packingToken))).status).toBe(403);
    });

    it('a disabled account cannot sign in by password, SMS code or refresh; enabling restores it', async () => {
      const first = await login(`staff8${EMAIL_DOMAIN}`, 'Correct-horse-1');
      const refreshToken = first.body.data.refresh_token as string;

      const off = await patch(adminToken, opsId, { disabled: true });
      expect(off.status).toBe(200);
      expect(off.body.data.staff.disabled).toBe(true);

      const pw = await login(`staff8${EMAIL_DOMAIN}`, 'Correct-horse-1');
      expect(pw.status).toBe(401);
      expect(pw.body.error.code).toBe('INVALID_CREDENTIALS');

      const otpReq = await request(app).post('/api/v1/auth/otp/request').send({ phone: '0770009708' });
      expect(otpReq.status).toBe(200);
      const otp = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: '0770009708', otp: otpReq.body.data.dev_otp });
      expect(otp.status).toBe(401);
      expect(otp.body.error).toMatchObject({ code: pw.body.error.code, message: pw.body.error.message });

      const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: refreshToken });
      expect(refreshed.status).toBe(401);

      expect((await patch(adminToken, opsId, { disabled: false })).body.data.staff.disabled).toBe(false);
      expect((await login(`staff8${EMAIL_DOMAIN}`, 'Correct-horse-1')).status).toBe(200);
    });

    it('a password reset replaces the password and clears the lockout', async () => {
      await pool.query(
        `UPDATE users SET login_failed_attempts = 3, login_locked_until = now() + interval '10 minutes' WHERE id = $1`,
        [opsId]
      );
      expect((await login(`staff8${EMAIL_DOMAIN}`, 'Correct-horse-1')).status).toBe(429);
      expect((await patch(adminToken, opsId, { password: 'Brand-new-pass-2' })).status).toBe(200);
      const { rows } = await pool.query(`SELECT login_failed_attempts, login_locked_until FROM users WHERE id = $1`, [opsId]);
      expect(rows[0]).toEqual({ login_failed_attempts: 0, login_locked_until: null });
      expect((await login(`staff8${EMAIL_DOMAIN}`, 'Correct-horse-1')).status).toBe(401);
      expect((await login(`staff8${EMAIL_DOMAIN}`, 'Brand-new-pass-2')).status).toBe(200);
    });
  });
});
