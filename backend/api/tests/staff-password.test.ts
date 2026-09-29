import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { LOGIN_MAX_ATTEMPTS } from '../src/modules/auth/auth.service.js';

/**
 * Staff email + password sign-in (migration 012, 2026-09-29). Own throwaway
 * users, removed afterwards, so the run leaves no trace.
 */
const ADMIN = { phone: '+94770009901', email: 'test-admin@blynk.test', password: 'Admin-pass-1960' };
const STAFF = { phone: '+94770009902', email: 'test-staff@blynk.test', password: 'Staff-pass-4321' };
const CUSTOMER = { phone: '+94770009903', email: 'test-customer@blynk.test', password: 'Customer-pass-5555' };
const NO_PASSWORD_ADMIN = { phone: '+94770009904', email: 'test-nopass@blynk.test' };

describe('POST /api/v1/auth/staff/login', () => {
  const app = createApp();
  const login = (email: unknown, password: unknown) =>
    request(app).post('/api/v1/auth/staff/login').send({ email, password });

  async function cleanup() {
    await pool.query(
      `DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+9477000990%');
       DELETE FROM users WHERE phone LIKE '+9477000990%';`
    );
  }

  beforeAll(async () => {
    await cleanup();
    await pool.query(
      `INSERT INTO users (phone, email, full_name, role, staff_password_hash) VALUES
         ($1, $2, 'Test Admin', 'ADMIN', crypt($3, gen_salt('bf', 4))),
         ($4, $5, 'Test Staff', 'PACKING_STAFF', crypt($6, gen_salt('bf', 4))),
         ($7, $8, 'Test Customer', 'CUSTOMER', crypt($9, gen_salt('bf', 4))),
         ($10, $11, 'Admin Without Password', 'ADMIN', NULL)`,
      [
        ADMIN.phone, ADMIN.email, ADMIN.password,
        STAFF.phone, STAFF.email, STAFF.password,
        CUSTOMER.phone, CUSTOMER.email, CUSTOMER.password,
        NO_PASSWORD_ADMIN.phone, NO_PASSWORD_ADMIN.email,
      ]
    );
  });

  beforeEach(async () => {
    authRateLimiter.reset();
    await pool.query(
      `UPDATE users SET login_failed_attempts = 0, login_locked_until = NULL WHERE phone LIKE '+9477000990%'`
    );
  });

  afterAll(cleanup);

  it('signs an admin in with the right password, with a normal session', async () => {
    const res = await login(ADMIN.email, ADMIN.password);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ phone: ADMIN.phone, email: ADMIN.email, role: 'ADMIN' });
    expect(res.body.data.access_token).toEqual(expect.any(String));
    expect(res.body.data.refresh_token).toEqual(expect.any(String));
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.access_token}`);
    expect(me.status).toBe(200);
  });

  it('works for packing staff too', async () => {
    const res = await login(STAFF.email, STAFF.password);
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('PACKING_STAFF');
  });

  it('matches the email ignoring case and surrounding spaces', async () => {
    const res = await login('  Test-ADMIN@Blynk.TEST ', ADMIN.password);
    expect(res.status).toBe(200);
    expect(res.body.data.user.phone).toBe(ADMIN.phone);
  });

  it('treats the password as case-sensitive', async () => {
    const res = await login(ADMIN.email, ADMIN.password.toUpperCase());
    expect(res.status).toBe(401);
  });

  it('refuses a wrong password without saying which part was wrong', async () => {
    const res = await login(ADMIN.email, 'not-the-password');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses customers, admins without a password and unknown emails, all the same way', async () => {
    for (const [email, password] of [
      [CUSTOMER.email, CUSTOMER.password],
      [NO_PASSWORD_ADMIN.email, 'Some-password-1'],
      ['nobody@blynk.test', 'Some-password-1'],
    ]) {
      const res = await login(email, password);
      expect(res.status, email).toBe(401);
      expect(res.body.error.code, email).toBe('INVALID_CREDENTIALS');
    }
  });

  it(`locks the account after ${LOGIN_MAX_ATTEMPTS} wrong passwords - even the right one is refused while locked`, async () => {
    for (let i = 1; i < LOGIN_MAX_ATTEMPTS; i++) {
      expect((await login(ADMIN.email, 'wrong-password')).status).toBe(401);
    }
    const locking = await login(ADMIN.email, 'wrong-password');
    expect(locking.status).toBe(429);
    expect(locking.body.error.code).toBe('LOGIN_LOCKED');

    // The lock is committed, not just reported.
    const row = await pool.query('SELECT login_locked_until FROM users WHERE phone = $1', [ADMIN.phone]);
    expect(row.rows[0].login_locked_until).not.toBeNull();

    const right = await login(ADMIN.email, ADMIN.password);
    expect(right.status).toBe(429);
    expect(right.body.error.code).toBe('LOGIN_LOCKED');
  });

  it('unlocks once the lock window has passed', async () => {
    await pool.query(`UPDATE users SET login_locked_until = now() - interval '1 second' WHERE phone = $1`, [
      ADMIN.phone,
    ]);
    expect((await login(ADMIN.email, ADMIN.password)).status).toBe(200);
    const row = await pool.query('SELECT login_locked_until FROM users WHERE phone = $1', [ADMIN.phone]);
    expect(row.rows[0].login_locked_until).toBeNull();
  });

  it('a successful sign-in clears earlier wrong attempts', async () => {
    await login(ADMIN.email, 'wrong-password');
    await login(ADMIN.email, 'wrong-password');
    let row = await pool.query('SELECT login_failed_attempts FROM users WHERE phone = $1', [ADMIN.phone]);
    expect(row.rows[0].login_failed_attempts).toBe(2);
    expect((await login(ADMIN.email, ADMIN.password)).status).toBe(200);
    row = await pool.query('SELECT login_failed_attempts FROM users WHERE phone = $1', [ADMIN.phone]);
    expect(row.rows[0].login_failed_attempts).toBe(0);
  });

  it('never stores the password itself', async () => {
    const row = await pool.query('SELECT staff_password_hash FROM users WHERE phone = $1', [ADMIN.phone]);
    expect(row.rows[0].staff_password_hash).not.toContain(ADMIN.password);
    expect(row.rows[0].staff_password_hash).toMatch(/^\$2[aby]\$/); // bcrypt
  });

  it('rejects malformed input', async () => {
    expect((await login('not-an-email', ADMIN.password)).status).toBe(400);
    expect((await login(ADMIN.email, 'short')).status).toBe(400);
    expect((await login(ADMIN.email, 'x'.repeat(129))).status).toBe(400);
    expect((await login(undefined, ADMIN.password)).status).toBe(400);
    expect((await login(ADMIN.email, undefined)).status).toBe(400);
  });

  it('the old passcode route is gone', async () => {
    const res = await request(app).post('/api/v1/auth/pin/login').send({ phone: ADMIN.phone, pin: '1960' });
    expect(res.status).toBe(404);
  });
});
