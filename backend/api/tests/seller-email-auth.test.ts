import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { LOGIN_MAX_ATTEMPTS } from '../src/modules/auth/auth.service.js';
import { bearer, sellerFixtures } from './helpers/seller.js';
import { tokens } from './helpers/stock.js';

/**
 * Seller portal email + password (owner, 2026-10-24; no email provider, so no
 * verification mail). Sellers are invite-only since 2026-10-24, so
 * POST /auth/seller/register-email is closed (403 SELLER_SIGNUP_CLOSED); email
 * sellers that already exist (made directly here, as the old sign-up did: no
 * phone, a PENDING shop) keep signing in: POST /auth/seller/login-email signs
 * a SELLER in with the staff password rules and lockout; every other account,
 * an unknown email and a wrong password get the same 401. Staff sign-in refuses
 * a seller. An email-only seller is never texted. Own rows only, all removed.
 */
const app = createApp();
const fx = sellerFixtures(app, '+947700123');
const DOMAIN = 'seller-email.blynk.test';
const mail = (name: string) => `${name}@${DOMAIN}`;
const PASSWORD = 'Shop-pass-2026';

const register = (body: Record<string, unknown>) => request(app).post('/api/v1/auth/seller/register-email').send(body);
const login = (email: unknown, password: unknown) => request(app).post('/api/v1/auth/seller/login-email').send({ email, password });
const staffLogin = (email: unknown, password: unknown) => request(app).post('/api/v1/auth/staff/login').send({ email, password });
/** What a refusal says (without its per-request id and time). */
const said = (res: { body: { error: { code: string; message: string; details: unknown } } }) => ({
  code: res.body.error.code,
  message: res.body.error.message,
  details: res.body.error.details,
});

async function purge() {
  const userIds = (
    await pool.query('SELECT id FROM users WHERE email LIKE $1 OR phone LIKE $2', [`%@${DOMAIN}`, '+947700123%'])
  ).rows.map((r) => r.id as string);
  if (userIds.length) {
    const sellerIds = (await pool.query('SELECT id FROM sellers WHERE user_id = ANY($1::uuid[])', [userIds])).rows.map((r) => r.id as string);
    if (sellerIds.length) {
      await pool.query(`DELETE FROM audit_logs WHERE action LIKE 'SELLER\\_%' AND entity_id = ANY($1::uuid[])`, [sellerIds]);
      await pool.query('DELETE FROM seller_submissions WHERE seller_id = ANY($1::uuid[])', [sellerIds]);
      await pool.query('DELETE FROM sellers WHERE id = ANY($1::uuid[])', [sellerIds]);
    }
    await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
  await fx.purge();
}

beforeAll(purge);
afterAll(purge);
beforeEach(() => authRateLimiter.reset());

/** An email-only seller as the closed sign-up used to make one: no phone (placeholder), a hashed password, a PENDING shop. */
async function emailSeller(email: string, shopName: string, password = PASSWORD) {
  const userId = (
    await pool.query(
      `INSERT INTO users (phone, email, role, staff_password_hash)
       VALUES ('nophone:' || substr(md5(random()::text), 1, 12), lower($1), 'SELLER', crypt($2, gen_salt('bf', 4))) RETURNING id`,
      [email, password]
    )
  ).rows[0].id as string;
  const sellerId = (await pool.query('INSERT INTO sellers (user_id, shop_name) VALUES ($1, $2) RETURNING id', [userId, shopName])).rows[0].id as string;
  return { userId, sellerId };
}

/** A user of any role with an email and a password, made directly. */
async function userWithPassword(n: number, role: string, email: string) {
  const row = (
    await pool.query(
      `INSERT INTO users (phone, email, role, staff_password_hash) VALUES ($1, $2, $3, crypt($4, gen_salt('bf', 4))) RETURNING id`,
      [fx.phone(n), email, role, PASSWORD]
    )
  ).rows[0];
  return row.id as string;
}

describe('POST /api/v1/auth/seller/register-email', () => {
  it('is closed: 403 SELLER_SIGNUP_CLOSED for any body, and nothing is created', async () => {
    await emailSeller(mail('taken'), 'Existing Shop');
    for (const body of [
      { email: mail('green.basket'), password: PASSWORD, shop_name: 'Green Basket' },
      { email: 'not-an-email', password: 'short', shop_name: 'A' },
      { email: mail('taken'), password: PASSWORD, shop_name: 'Second' },
      {},
    ]) {
      const res = await register(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe('SELLER_SIGNUP_CLOSED');
    }
    expect((await pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [mail('green.basket')])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM sellers WHERE shop_name IN ('Green Basket', 'Second', 'A')`)).rowCount).toBe(0);
    // an email seller made before the sign-up closed still signs in
    expect((await login(mail('taken'), PASSWORD)).status).toBe(200);
  });
});

describe('POST /api/v1/auth/seller/login-email', () => {
  let sellerId = '';
  let userId = '';

  beforeAll(async () => {
    authRateLimiter.reset();
    ({ userId, sellerId } = await emailSeller(mail('login'), 'Login Shop'));
  });
  beforeEach(async () => {
    await pool.query('UPDATE users SET login_failed_attempts = 0, login_locked_until = NULL WHERE id = $1', [userId]);
  });

  it('signs the seller in (email case and spaces ignored) with the same token shape', async () => {
    const res = await login(`  ${mail('LOGIN')}  `, PASSWORD);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'token_type', 'user']);
    expect(res.body.data.user).toEqual({ id: userId, phone: null, role: 'SELLER', full_name: null, email: mail('login') });
    const me = await request(app).get('/api/v1/seller/me').set(bearer(res.body.data.access_token));
    expect(me.status).toBe(200);
    expect(me.body.data.seller.id).toBe(sellerId);
  });

  it('a wrong password and an unknown email get the identical 401', async () => {
    const wrong = await login(mail('login'), 'Wrong-pass-123');
    const unknown = await login(mail('nobody'), PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(said(unknown)).toEqual(said(wrong));
  });

  it(`locks the account after ${LOGIN_MAX_ATTEMPTS} wrong passwords, then lets it in once the lock ends`, async () => {
    for (let i = 1; i < LOGIN_MAX_ATTEMPTS; i++) {
      const res = await login(mail('login'), `Wrong-pass-${i}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    const locking = await login(mail('login'), 'Wrong-pass-last');
    expect(locking.status).toBe(429);
    expect(locking.body.error.code).toBe('LOGIN_LOCKED');
    expect(locking.body.error.message).not.toContain('SMS'); // no phone to fall back to
    const right = await login(mail('login'), PASSWORD);
    expect(right.status).toBe(429);
    expect(right.body.error.code).toBe('LOGIN_LOCKED');
    expect(right.body.error.details).toMatchObject({ retry_after_minutes: expect.any(Number) });

    await pool.query(`UPDATE users SET login_locked_until = now() - interval '1 second' WHERE id = $1`, [userId]);
    expect((await login(mail('login'), PASSWORD)).status).toBe(200);
    const row = (await pool.query('SELECT login_failed_attempts, login_locked_until FROM users WHERE id = $1', [userId])).rows[0];
    expect(row).toEqual({ login_failed_attempts: 0, login_locked_until: null });
  });

  it('is for SELLER accounts only: every other role gets the same 401 as an unknown email', async () => {
    const unknown = await login(mail('nobody'), PASSWORD);
    const roles: [number, string][] = [
      [20, 'CUSTOMER'],
      [21, 'RIDER'],
      [22, 'OPERATIONS'],
      [23, 'ADMIN'],
      [24, 'PACKING_STAFF'],
    ];
    for (const [n, role] of roles) {
      const email = mail(`role-${role.toLowerCase()}`);
      await userWithPassword(n, role, email);
      const res = await login(email, PASSWORD);
      expect(res.status, role).toBe(401);
      expect(said(res), role).toEqual(said(unknown));
    }
  });

  it('a phone seller without a password cannot use it', async () => {
    const phoneSeller = await fx.makeSeller(30, 'APPROVED');
    await pool.query('UPDATE users SET email = $2 WHERE id = $1', [phoneSeller.userId, mail('phone-seller')]);
    const res = await login(mail('phone-seller'), PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('staff sign-in refuses a seller (401 INVALID_CREDENTIALS), and the seller account is untouched', async () => {
    const res = await staffLogin(mail('login'), PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect((await login(mail('login'), PASSWORD)).status).toBe(200);
  });

  it('a staff account still signs in on staff login, not on the seller one', async () => {
    await userWithPassword(40, 'OPERATIONS', mail('ops-staff'));
    expect((await staffLogin(mail('ops-staff'), PASSWORD)).status).toBe(200);
    expect((await login(mail('ops-staff'), PASSWORD)).status).toBe(401);
  });
});

describe('Admin and SMS for an email-only seller', () => {
  it('lists it with its email (phone null), finds it by email, and queues no SMS on approval or rejection', async () => {
    const { userId: aUser, sellerId: aSeller } = await emailSeller(mail('admin-view'), 'Email Only Shop');
    const { userId: bUser, sellerId: bSeller } = await emailSeller(mail('admin-reject'), 'Email Reject Shop');

    const found = await request(app).get('/api/v1/admin/sellers?search=admin-view%40seller-email').set(bearer(tokens.admin));
    expect(found.status).toBe(200);
    expect(found.body.data.sellers).toHaveLength(1);
    expect(found.body.data.sellers[0]).toMatchObject({ id: aSeller, phone: null, email: mail('admin-view'), shop_name: 'Email Only Shop' });
    // The placeholder is never matched as a phone number.
    const nophone = await request(app).get('/api/v1/admin/sellers?search=nophone').set(bearer(tokens.admin));
    expect((nophone.body.data.sellers as { id: string }[]).some((s) => s.id === aSeller)).toBe(false);

    const approved = await request(app).patch(`/api/v1/admin/sellers/${aSeller}`).set(bearer(tokens.admin)).send({ status: 'APPROVED' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.seller).toMatchObject({ status: 'APPROVED', phone: null, email: mail('admin-view') });
    const rejected = await request(app)
      .patch(`/api/v1/admin/sellers/${bSeller}`)
      .set(bearer(tokens.admin))
      .send({ status: 'REJECTED', rejection_reason: 'Not a food business' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

    const detail = await request(app).get(`/api/v1/admin/sellers/${aSeller}`).set(bearer(tokens.admin));
    expect(detail.body.data.seller).toMatchObject({ phone: null, email: mail('admin-view') });

    const texts = await pool.query('SELECT 1 FROM notifications WHERE user_id = ANY($1::uuid[])', [[aUser, bUser]]);
    expect(texts.rowCount).toBe(0);

    // The approved seller can now work the portal.
    const sess = await login(mail('admin-view'), PASSWORD);
    const me = await request(app).get('/api/v1/seller/me').set(bearer(sess.body.data.access_token));
    expect(me.body.data.seller.status).toBe('APPROVED');
  });

  it('a phone seller is still texted on approval', async () => {
    const s = await fx.makeSeller(50, 'PENDING');
    const res = await request(app).patch(`/api/v1/admin/sellers/${s.sellerId}`).set(bearer(tokens.admin)).send({ status: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.data.seller).toMatchObject({ phone: s.phone, email: null });
    const texts = (await pool.query('SELECT recipient, notification_type FROM notifications WHERE user_id = $1', [s.userId])).rows;
    expect(texts).toEqual([{ recipient: s.phone, notification_type: 'SELLER_APPROVED' }]);
  });
});
