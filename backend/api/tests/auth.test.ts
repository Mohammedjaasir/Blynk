import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, db } from '../src/database/connection.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { requireRoles } from '../src/middleware/role.middleware.js';
import { requireAuth } from '../src/middleware/auth.middleware.js';

describe('Stage 2 Authentication & OTP Module', () => {
  const app = createApp();

  beforeEach(() => {
    // Reset in-memory rate limiter before each test
    authRateLimiter.reset();
  });

  // Two tests sign in as the seeded customer and admin. Signing in records an
  // OTP, a refresh token and last_login_at (and phone_verified_at if unset);
  // they are put back exactly as found, so a run leaves no trace (plan Task 7).
  const SEEDED = [
    { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567' },
    { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122' },
  ];
  let runStart: Date;
  // As text: a JS Date would drop Postgres's microseconds and not restore exactly.
  let seededBefore: { id: string; last_login_at: string | null; phone_verified_at: string | null; updated_at: string }[] = [];

  beforeAll(async () => {
    runStart = (await pool.query('SELECT clock_timestamp() AS t')).rows[0].t;
    seededBefore = (
      await pool.query(
        'SELECT id, last_login_at::text, phone_verified_at::text, updated_at::text FROM users WHERE id = ANY($1)',
        [SEEDED.map((u) => u.id)]
      )
    ).rows;
  });

  afterAll(async () => {
    // Clean up test users and tokens created during testing
    await pool.query(`
      DELETE FROM otp_verifications WHERE phone LIKE '+947700000%';
      DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+947700000%');
      DELETE FROM users WHERE phone LIKE '+947700000%';
    `);
    await pool.query('DELETE FROM otp_verifications WHERE phone = ANY($1) AND created_at >= $2', [SEEDED.map((u) => u.phone), runStart]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1) AND created_at >= $2', [SEEDED.map((u) => u.id), runStart]);
    for (const u of seededBefore) {
      await pool.query('UPDATE users SET last_login_at = $2::timestamptz, phone_verified_at = $3::timestamptz, updated_at = $4::timestamptz WHERE id = $1', [
        u.id,
        u.last_login_at,
        u.phone_verified_at,
        u.updated_at,
      ]);
    }
  });

  // ==========================================================================
  // 1. REQUEST OTP
  // ==========================================================================
  describe('POST /api/v1/auth/otp/request', () => {
    it('accepts valid Sri Lankan mobile numbers and normalizes them', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: '077 000 0001' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('OTP sent successfully');
      expect(res.body.data.expires_in_seconds).toBe(300);
      expect(res.body.data.dev_otp).toMatch(/^[0-9]{6}$/);

      // Verify at-rest hashed storage in PostgreSQL
      const dbRes = await pool.query(
        "SELECT * FROM otp_verifications WHERE phone = '+94770000001' ORDER BY created_at DESC LIMIT 1"
      );
      expect(dbRes.rows.length).toBe(1);
      const row = dbRes.rows[0];
      expect(row.otp_hash).toBeDefined();
      expect(row.otp_hash).not.toBe(res.body.data.dev_otp); // Never stored plaintext
      expect(row.otp_hash.startsWith('$2')).toBe(true); // bcrypt hash format
      expect(row.consumed_at).toBeNull();
    });

    it('supports "phone_number" key as alias for "phone"', async () => {
      const res = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone_number: '+94770000001' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dev_otp).toBeDefined();
    });

    it('rejects invalid or non-mobile phone numbers with 400 VALIDATION_ERROR', async () => {
      const invalidNumbers = [
        '0112345678', // Landline prefix 011
        '12345',      // Too short
        'not-a-phone', // Letters
        '+15551234567', // US number
      ];

      for (const num of invalidNumbers) {
        const res = await request(app)
          .post('/api/v1/auth/otp/request')
          .send({ phone: num });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('enforces rate limiting on repeated OTP requests for same phone', async () => {
      const phone = '0770000002';

      // 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/api/v1/auth/otp/request')
          .send({ phone });
        expect(res.status).toBe(200);
      }

      // 4th request must be rejected with 429
      const blockedRes = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('invalidates prior unconsumed OTPs when a new OTP is requested', async () => {
      const phone = '0770000003';

      const firstReq = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const firstOtp = firstReq.body.data.dev_otp;

      const secondReq = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const secondOtp = secondReq.body.data.dev_otp;

      expect(firstOtp).not.toBe(secondOtp);

      // Attempting to verify the old superseded OTP must fail
      const verifyOldRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: firstOtp });

      expect(verifyOldRes.status).toBe(401);

      // Verifying the latest OTP succeeds
      const verifyNewRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: secondOtp });

      expect(verifyNewRes.status).toBe(200);
    });
  });

  // ==========================================================================
  // 2. VERIFY OTP & REGISTRATION
  // ==========================================================================
  describe('POST /api/v1/auth/otp/verify', () => {
    it('verifies correct OTP, auto-registers new customer with role CUSTOMER, and returns tokens', async () => {
      const phone = '0770000010';

      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const otp = reqRes.body.data.dev_otp;

      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.data.access_token).toBeDefined();
      expect(verifyRes.body.data.refresh_token).toBeDefined();
      expect(verifyRes.body.data.token_type).toBe('Bearer');
      expect(verifyRes.body.data.expires_in).toBe(900);
      expect(verifyRes.body.data.user).toBeDefined();
      expect(verifyRes.body.data.user.role).toBe('CUSTOMER');
      expect(verifyRes.body.data.user.phone).toBe('+94770000010');

      // Check DB user creation
      const userRes = await pool.query("SELECT * FROM users WHERE phone = '+94770000010'");
      expect(userRes.rows.length).toBe(1);
      expect(userRes.rows[0].role).toBe('CUSTOMER');
      expect(userRes.rows[0].phone_verified_at).not.toBeNull();
    });

    it('authenticates existing user without duplicate creation and preserves original role', async () => {
      // +94771234567 is seeded customer Ahmed Rizvi
      const phone = '0771234567';

      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const otp = reqRes.body.data.dev_otp;

      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.user.id).toBe('a0000001-0000-0000-0000-000000000001');
      expect(verifyRes.body.data.user.full_name).toBe('Ahmed Rizvi');
      expect(verifyRes.body.data.user.role).toBe('CUSTOMER');
    });

    it('authenticates staff/admin users and preserves elevated roles', async () => {
      // +94775551122 is seeded ADMIN Nawaz Mansoor
      const phone = '0775551122';

      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const otp = reqRes.body.data.dev_otp;

      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.user.role).toBe('ADMIN');
      expect(verifyRes.body.data.user.full_name).toBe('Nawaz Mansoor');
    });

    it('rejects incorrect OTP and counts attempts', async () => {
      const phone = '0770000020';

      await request(app).post('/api/v1/auth/otp/request').send({ phone });

      // Wrong OTP attempt 1
      const res1 = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: '000000' });

      expect(res1.status).toBe(401);
      expect(res1.body.error.code).toBe('INVALID_OTP');
      expect(res1.body.error.details).toEqual({ remaining_attempts: 2 });

      // Wrong OTP attempt 2
      const res2 = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: '000000' });

      expect(res2.status).toBe(401);
      expect(res2.body.error.details).toEqual({ remaining_attempts: 1 });

      // Wrong OTP attempt 3 -> Lockout
      const res3 = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: '000000' });

      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('OTP_MAX_ATTEMPTS_EXCEEDED');

      // 4th attempt immediately rejected as locked
      const res4 = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: '000000' });

      expect(res4.status).toBe(429);
    });

    it('rejects expired OTP challenge with 410 OTP_EXPIRED', async () => {
      const phone = '0770000030';

      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const otp = reqRes.body.data.dev_otp;

      // Force challenge to be in the past
      await pool.query(
        "UPDATE otp_verifications SET expires_at = NOW() - INTERVAL '1 minute' WHERE phone = '+94770000030'"
      );

      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp });

      expect(verifyRes.status).toBe(410);
      expect(verifyRes.body.error.code).toBe('OTP_EXPIRED');
    });

    it('prevents OTP replay: cannot verify the same OTP challenge twice', async () => {
      const phone = '0770000040';

      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const otp = reqRes.body.data.dev_otp;

      // First verification succeeds
      const firstVerify = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp });
      expect(firstVerify.status).toBe(200);

      // Replay attempt must fail with 401
      const replayVerify = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp });
      expect(replayVerify.status).toBe(401);
      expect(replayVerify.body.error.code).toBe('INVALID_OTP');
    });
  });

  // ==========================================================================
  // 3. AUTHENTICATION MIDDLEWARE & JWT ACCESS TOKENS
  // ==========================================================================
  describe('JWT Access Token & requireAuth Middleware', () => {
    it('allows access to GET /api/v1/auth/me with valid Bearer token', async () => {
      const phone = '0770000050';
      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: reqRes.body.data.dev_otp });

      const token = verifyRes.body.data.access_token;

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.phone).toBe('+94770000050');
      expect(meRes.body.data.role).toBe('CUSTOMER');
    });

    it('rejects requests missing the Authorization header with 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects malformed or non-Bearer authorization headers with 401', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects tampered or invalid JWT signatures with 401', async () => {
      const tamperedToken =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYiLCJyb2xlIjoiQ1VTVE9NRVIifQ.invalid_signature';

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  // ==========================================================================
  // 4. REFRESH TOKEN ROTATION & REPLAY DETECTION
  // ==========================================================================
  describe('POST /api/v1/auth/refresh', () => {
    it('rotates refresh token: issues new access token, new refresh token, and revokes old token', async () => {
      const phone = '0770000060';
      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: reqRes.body.data.dev_otp });

      const initialRefreshToken = verifyRes.body.data.refresh_token;

      // Perform refresh
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: initialRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.data.access_token).toBeDefined();
      expect(refreshRes.body.data.refresh_token).toBeDefined();
      expect(refreshRes.body.data.refresh_token).not.toBe(initialRefreshToken);

      // Verify new access token works
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshRes.body.data.access_token}`);
      expect(meRes.status).toBe(200);

      // Old refresh token must now be rejected (replay detection)
      const replayRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: initialRefreshToken });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('REFRESH_TOKEN_REVOKED');
    });

    it('rejects expired refresh token with 401 REFRESH_TOKEN_EXPIRED', async () => {
      const phone = '0770000070';
      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: reqRes.body.data.dev_otp });

      const refreshToken = verifyRes.body.data.refresh_token;

      // Force refresh token to be expired in DB
      await pool.query(
        "UPDATE refresh_tokens SET expires_at = NOW() - INTERVAL '1 day' WHERE user_id = $1",
        [verifyRes.body.data.user.id]
      );

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
    });
  });

  // ==========================================================================
  // 5. LOGOUT & REVOCATION
  // ==========================================================================
  describe('POST /api/v1/auth/logout', () => {
    it('revokes the refresh token and prevents future refresh calls', async () => {
      const phone = '0770000080';
      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone, otp: reqRes.body.data.dev_otp });

      const refreshToken = verifyRes.body.data.refresh_token;

      // Logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refresh_token: refreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.data.message).toBe('Logged out successfully');

      // Attempting to refresh with logged-out token must fail
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: refreshToken });

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.error.code).toBe('REFRESH_TOKEN_REVOKED');
    });

    it('allows safe/idempotent logout even if already logged out', async () => {
      const res = await request(app).post('/api/v1/auth/logout').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==========================================================================
  // 6. ROLE-BASED ACCESS CONTROL (RBAC)
  // ==========================================================================
  describe('Role-Based Access Control (requireRoles)', () => {
    it('allows ADMIN token to access admin-only endpoint and blocks CUSTOMER with 403', async () => {
      const adminToken = generateAccessToken({
        id: 'a0000001-0000-0000-0000-000000000003',
        phone: '+94775551122',
        role: 'ADMIN',
      });

      const customerToken = generateAccessToken({
        id: 'a0000001-0000-0000-0000-000000000001',
        phone: '+94771234567',
        role: 'CUSTOMER',
      });

      // Admin accesses admin route -> 200 OK
      const adminRes = await request(app)
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.message).toBe('Welcome Admin');

      // Customer accesses admin route -> 403 FORBIDDEN
      const custRes = await request(app)
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(custRes.status).toBe(403);
      expect(custRes.body.error.code).toBe('FORBIDDEN');
    });

    it('allows RIDER token on rider route and blocks other roles with 403', async () => {
      const riderToken = generateAccessToken({
        id: 'a0000001-0000-0000-0000-000000000002',
        phone: '+94779876543',
        role: 'RIDER',
      });

      const customerToken = generateAccessToken({
        id: 'a0000001-0000-0000-0000-000000000001',
        phone: '+94771234567',
        role: 'CUSTOMER',
      });

      const riderRes = await request(app)
        .get('/api/v1/riders/orders')
        .set('Authorization', `Bearer ${riderToken}`);
      expect(riderRes.status).toBe(200);

      const custRes = await request(app)
        .get('/api/v1/riders/orders')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(custRes.status).toBe(403);
    });
  });

  // ==========================================================================
  // 7. CONCURRENCY & RACE CONDITIONS
  // ==========================================================================
  describe('Concurrency & Race Condition Safety', () => {
    it('prevents concurrent double-consumption of the same OTP challenge', async () => {
      const phone = '0770000090';
      const reqRes = await request(app).post('/api/v1/auth/otp/request').send({ phone });
      const otp = reqRes.body.data.dev_otp;

      // Fire 2 simultaneous verification requests with the identical OTP
      const [resA, resB] = await Promise.all([
        request(app).post('/api/v1/auth/otp/verify').send({ phone, otp }),
        request(app).post('/api/v1/auth/otp/verify').send({ phone, otp }),
      ]);

      const statuses = [resA.status, resB.status].sort();

      // Exactly one must succeed (200), and the other must fail (401 invalid/consumed)
      expect(statuses).toEqual([200, 401]);
    });
  });
});
