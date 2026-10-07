import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { notificationService } from '../src/modules/notifications/notification.service.js';
import {
  generatePlaceholderPhone,
  isPlaceholderPhone,
  normalizeSriLankanPhone,
  publicPhone,
} from '../src/utils/phone.js';

/**
 * Admin and Inventory accounts sign in with email + password only and have
 * no phone number (owner, 2026-10-07, migration 028). Operations and Rider
 * accounts keep phones and SMS-code sign-in; customers are unchanged.
 *
 * Own throwaway users (phones +9477000993x, emails @email-only.blynk.test);
 * everything they leave behind is removed afterwards.
 */
const PREFIX = '+9477000993';
const EMAIL_DOMAIN = '@email-only.blynk.test';
const PASSWORD = 'Email-only-2026';
const PLACEHOLDER = /^nophone:[0-9a-f]{12}$/;

describe('Admin and Inventory accounts: email + password only, no phone', () => {
  const app = createApp();
  const ids = { admin: '', packer: '', ops: '', rider: '', customer: '' };
  let adminToken = '';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const create = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/admin/staff').set(auth(adminToken)).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/admin/staff/${id}`).set(auth(adminToken)).send(body);
  const account = (n: string, role: string, extra: Record<string, unknown> = {}) => ({
    full_name: `Email Only ${role} ${n}`,
    email: `eo${n}${EMAIL_DOMAIN}`,
    password: PASSWORD,
    role,
    ...extra,
  });
  const mine = `(SELECT id FROM users WHERE phone LIKE '${PREFIX}%' OR email LIKE '%${EMAIL_DOMAIN}')`;

  async function cleanup() {
    await pool.query(
      `DELETE FROM notifications WHERE user_id IN ${mine} OR recipient LIKE '${PREFIX}%';
       DELETE FROM audit_logs WHERE entity_id IN ${mine} OR actor_user_id IN ${mine};
       DELETE FROM riders WHERE user_id IN ${mine};
       DELETE FROM refresh_tokens WHERE user_id IN ${mine};
       DELETE FROM otp_verifications WHERE phone LIKE '${PREFIX}%';
       DELETE FROM users WHERE id IN ${mine};`
    );
  }

  beforeAll(async () => {
    await cleanup();
    // Real numbers on ADMIN / PACKING_STAFF rows: what migration 028 converts,
    // and what the OTP refusal still guards against (defence in depth).
    const { rows } = await pool.query<{ id: string; phone: string }>(
      `INSERT INTO users (phone, email, full_name, role) VALUES
         ('${PREFIX}0', 'admin${EMAIL_DOMAIN}', 'EO Admin', 'ADMIN'),
         ('${PREFIX}1', 'packer${EMAIL_DOMAIN}', 'EO Packer', 'PACKING_STAFF'),
         ('${PREFIX}2', 'ops${EMAIL_DOMAIN}', 'EO Operator', 'OPERATIONS'),
         ('${PREFIX}3', 'rider${EMAIL_DOMAIN}', 'EO Rider', 'RIDER'),
         ('${PREFIX}4', NULL, 'EO Customer', 'CUSTOMER')
       RETURNING id, phone`
    );
    const id = (n: string) => rows.find((r) => r.phone === `${PREFIX}${n}`)!.id;
    Object.assign(ids, { admin: id('0'), packer: id('1'), ops: id('2'), rider: id('3'), customer: id('4') });
    adminToken = generateAccessToken({ id: ids.admin, phone: `${PREFIX}0`, role: 'ADMIN' });
  });

  beforeEach(() => authRateLimiter.reset());
  afterAll(cleanup);

  // ==========================================================================
  describe('the placeholder', () => {
    it('is "nophone:" + 12 lowercase hex (20 chars), never a valid phone, and shown as null', () => {
      for (let i = 0; i < 20; i++) {
        const p = generatePlaceholderPhone();
        expect(p).toMatch(PLACEHOLDER);
        expect(p).toHaveLength(20);
        expect(isPlaceholderPhone(p)).toBe(true);
        expect(() => normalizeSriLankanPhone(p)).toThrow();
        expect(publicPhone(p)).toBeNull();
      }
      expect(isPlaceholderPhone('+94771234567')).toBe(false);
      expect(publicPhone('+94771234567')).toBe('+94771234567');
    });

    it('is never queued for an SMS', async () => {
      const queued = await notificationService.enqueue({
        user_id: ids.admin,
        channel: 'SMS',
        notification_type: 'SMS_OFFER',
        recipient: generatePlaceholderPhone(),
        payload: { text: 'x' },
      });
      expect(queued).toBeNull();
      expect((await pool.query(`SELECT 1 FROM notifications WHERE user_id = $1`, [ids.admin])).rowCount).toBe(0);
    });
  });

  // ==========================================================================
  describe('SMS codes', () => {
    it('are refused for ADMIN and PACKING_STAFF with 403 EMAIL_SIGN_IN_REQUIRED, before any code is made', async () => {
      for (const n of ['0', '1']) {
        const phone = `077000993${n}`;
        const req = await request(app).post('/api/v1/auth/otp/request').send({ phone });
        expect(req.status, n).toBe(403);
        expect(req.body.error).toMatchObject({
          code: 'EMAIL_SIGN_IN_REQUIRED',
          message: 'This account signs in with email and password.',
        });
        expect(req.body.data).toBeUndefined();
        const verify = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp: '123456', create_account: false });
        expect(verify.status, n).toBe(403);
        expect(verify.body.error.code).toBe('EMAIL_SIGN_IN_REQUIRED');
      }
      const otps = await pool.query(`SELECT 1 FROM otp_verifications WHERE phone = ANY($1)`, [[`${PREFIX}0`, `${PREFIX}1`]]);
      expect(otps.rowCount).toBe(0);
    });

    it('still work for OPERATIONS, RIDER and CUSTOMER', async () => {
      for (const [n, role] of [['2', 'OPERATIONS'], ['3', 'RIDER'], ['4', 'CUSTOMER']]) {
        const phone = `077000993${n}`;
        const req = await request(app).post('/api/v1/auth/otp/request').send({ phone });
        expect(req.status, role).toBe(200);
        const verify = await request(app)
          .post('/api/v1/auth/otp/verify')
          .send({ phone, otp: req.body.data.dev_otp, create_account: false });
        expect(verify.status, role).toBe(200);
        expect(verify.body.data.user).toMatchObject({ role, phone: `${PREFIX}${n}` });
      }
    });
  });

  // ==========================================================================
  describe('migration 028', () => {
    it('replaces every ADMIN / PACKING_STAFF phone with a placeholder and leaves other roles alone', async () => {
      const sql = fs.readFileSync(path.resolve('src/database/migrations/028_staff_email_only.sql'), 'utf-8');
      const client = await pool.connect();
      try {
        // Rolled back: the migration is already applied to this database.
        await client.query('BEGIN');
        await client.query(sql);
        const { rows } = await client.query<{ id: string; phone: string }>(`SELECT id, phone FROM users WHERE id = ANY($1)`, [
          Object.values(ids),
        ]);
        const phoneOf = (id: string) => rows.find((r) => r.id === id)!.phone;
        expect(phoneOf(ids.admin)).toMatch(PLACEHOLDER);
        expect(phoneOf(ids.packer)).toMatch(PLACEHOLDER);
        expect(phoneOf(ids.admin)).not.toBe(phoneOf(ids.packer));
        expect(phoneOf(ids.ops)).toBe(`${PREFIX}2`);
        expect(phoneOf(ids.rider)).toBe(`${PREFIX}3`);
        expect(phoneOf(ids.customer)).toBe(`${PREFIX}4`);
        const left = await client.query(
          `SELECT 1 FROM users WHERE role IN ('ADMIN', 'PACKING_STAFF') AND phone NOT LIKE 'nophone:%'`
        );
        expect(left.rowCount).toBe(0);
        // Running it again changes nothing.
        const before = phoneOf(ids.admin);
        await client.query(sql);
        const again = await client.query(`SELECT phone FROM users WHERE id = $1`, [ids.admin]);
        expect(again.rows[0].phone).toBe(before);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  // ==========================================================================
  describe('staff accounts', () => {
    it('creates ADMIN and PACKING_STAFF without a phone (and ignores one if sent)', async () => {
      for (const [n, role, extra] of [
        ['10', 'ADMIN', {}],
        ['11', 'PACKING_STAFF', {}],
        ['12', 'PACKING_STAFF', { phone: '0770009939' }],
      ] as const) {
        const res = await create(account(n, role, extra));
        expect(res.status, `${role} ${n}`).toBe(201);
        expect(res.body.data.staff).toMatchObject({ role, phone: null });
        const { rows } = await pool.query(`SELECT phone FROM users WHERE id = $1`, [res.body.data.staff.id]);
        expect(rows[0].phone).toMatch(PLACEHOLDER);
        const audit = await pool.query(`SELECT new_values FROM audit_logs WHERE entity_id = $1`, [res.body.data.staff.id]);
        expect(JSON.stringify(audit.rows[0].new_values)).not.toContain('nophone');
      }
      expect((await pool.query(`SELECT 1 FROM users WHERE phone = '+94770009939'`)).rowCount).toBe(0);
    });

    it('refuses OPERATIONS without a phone (400, field phone); riders are never made here', async () => {
      const res = await create(account('13', 'OPERATIONS'));
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain('phone');
      const rider = await create(account('14', 'RIDER', { vehicle_registration_number: 'WP-EO-14' }));
      expect(rider.status).toBe(400);
      expect(rider.body.error.code).toBe('RIDERS_JOIN_BY_APPLICATION');
    });

    it('never returns a placeholder: staff list, staff login and /auth/me show phone null', async () => {
      const list = await request(app).get('/api/v1/admin/staff').set(auth(adminToken));
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain('nophone:');
      const created = (list.body.data.staff as Array<{ email: string | null; phone: string | null }>).filter((s) =>
        s.email?.startsWith('eo1')
      );
      expect(created.length).toBeGreaterThanOrEqual(3);
      expect(created.every((s) => s.phone === null)).toBe(true);

      const login = await request(app).post('/api/v1/auth/staff/login').send({ email: `eo11${EMAIL_DOMAIN}`, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.data.user).toMatchObject({ role: 'PACKING_STAFF', phone: null });
      const me = await request(app).get('/api/v1/auth/me').set(auth(login.body.data.access_token));
      expect(me.status).toBe(200);
      expect(me.body.data.phone).toBeNull();
      expect(JSON.stringify(me.body)).not.toContain('nophone:');
    });

    it('moving to Inventory drops the phone; moving to Operations needs one (400 PHONE_REQUIRED)', async () => {
      const ops = await create(account('15', 'OPERATIONS', { phone: '0770009935' }));
      expect(ops.status).toBe(201);
      expect(ops.body.data.staff.phone).toBe(`${PREFIX}5`);
      const id = ops.body.data.staff.id as string;

      const toInventory = await patch(id, { role: 'PACKING_STAFF' });
      expect(toInventory.status).toBe(200);
      expect(toInventory.body.data.staff).toMatchObject({ role: 'PACKING_STAFF', phone: null });
      expect((await pool.query(`SELECT phone FROM users WHERE id = $1`, [id])).rows[0].phone).toMatch(PLACEHOLDER);

      const noPhone = await patch(id, { role: 'OPERATIONS' });
      expect(noPhone.status).toBe(400);
      expect(noPhone.body.error.code).toBe('PHONE_REQUIRED');

      const taken = await patch(id, { role: 'OPERATIONS', phone: '0770009932' });
      expect(taken.status).toBe(409);
      expect(taken.body.error.code).toBe('PHONE_TAKEN');

      const back = await patch(id, { role: 'OPERATIONS', phone: '077 000 9935' });
      expect(back.status).toBe(200);
      expect(back.body.data.staff).toMatchObject({ role: 'OPERATIONS', phone: `${PREFIX}5` });
    });
  });

  // ==========================================================================
  describe('SMS offer test send', () => {
    const send = (body: Record<string, unknown>) =>
      request(app).post('/api/v1/admin/sms-offers/test').set(auth(adminToken)).send({ language: 'en', message: 'EO test', ...body });

    it('goes to the number entered; without one an account with no phone gets 400 NO_TEST_PHONE', async () => {
      // The fixture admin has a real phone: give it a placeholder, as migration 028 would.
      await pool.query(`UPDATE users SET phone = $2 WHERE id = $1`, [ids.admin, generatePlaceholderPhone()]);

      const none = await send({});
      expect(none.status).toBe(400);
      expect(none.body.error).toMatchObject({ code: 'NO_TEST_PHONE', message: 'Enter the number to send the test to.' });

      const bad = await send({ phone: '12345' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');

      const ok = await send({ phone: '077 000 9939' });
      expect(ok.status).toBe(202);
      expect(ok.body.data.sent_to).toBe('+94770****39');
      const rows = await pool.query(`SELECT recipient FROM notifications WHERE user_id = $1 AND idempotency_key LIKE 'sms-offer-test:%'`, [
        ids.admin,
      ]);
      expect(rows.rows.map((r) => r.recipient)).toEqual(['+94770009939']);
    });

    it('still uses the staff member’s own phone when none is entered', async () => {
      const opsToken = generateAccessToken({ id: ids.ops, phone: `${PREFIX}2`, role: 'OPERATIONS' });
      const res = await request(app)
        .post('/api/v1/admin/sms-offers/test')
        .set(auth(opsToken))
        .send({ language: 'en', message: 'EO test' });
      expect(res.status).toBe(202);
      const rows = await pool.query(`SELECT recipient FROM notifications WHERE user_id = $1 AND idempotency_key LIKE 'sms-offer-test:%'`, [
        ids.ops,
      ]);
      expect(rows.rows.map((r) => r.recipient)).toEqual([`${PREFIX}2`]);
    });
  });
});
