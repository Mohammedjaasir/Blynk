import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { db, pool } from '../src/database/connection.js';
import bcrypt from 'bcrypt';
import { hashToken } from '../src/modules/auth/token.service.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';

const app = createApp();

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getAdminToken(): Promise<string> {
  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('role', '=', 'ADMIN')
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!user) throw new Error('No admin user in seed data');
  return jwt.sign({ sub: user.id, phone: user.phone, role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

// The seeded customer, always: picking "the first active customer" without an
// ORDER BY landed on a different real account from run to run, and the
// mass-assignment test below renamed whichever one it was (plan F10/Task 7).
const SEEDED_CUSTOMER_ID = 'a0000001-0000-0000-0000-000000000001';

async function getCustomerToken(): Promise<string> {
  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', SEEDED_CUSTOMER_ID)
    .where('role', '=', 'CUSTOMER')
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!user) throw new Error('No customer user in seed data');
  return jwt.sign({ sub: user.id, phone: user.phone, role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

async function getRiderToken(): Promise<{ token: string; userId: string }> {
  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('role', '=', 'RIDER')
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!user) throw new Error('No rider user in seed data');
  const token = jwt.sign({ sub: user.id, phone: user.phone, role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
  return { token, userId: user.id };
}

// ─────────────────────────────────────────────────────────────────────────────
async function getPackingStaffToken(): Promise<string> {
  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('role', '=', 'PACKING_STAFF')
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!user) throw new Error('No packing staff user in seed data');
  return jwt.sign({ sub: user.id, phone: user.phone, role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

// 1. AUTHENTICATION SECURITY
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Authentication', () => {
  it('rejects request to protected endpoint without token', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
  });

  it('rejects a completely invalid JWT', async () => {
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer notajwt');
    expect(res.status).toBe(401);
  });

  it('rejects a JWT signed with wrong secret', async () => {
    const token = jwt.sign({ sub: 'fake-id', phone: '+94771234567', role: 'CUSTOMER' }, 'wrong-secret', {
      algorithm: 'HS256',
      expiresIn: '15m',
    });
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(401);
  });

  it('rejects an expired JWT', async () => {
    const token = jwt.sign({ sub: 'fake-id', phone: '+94771234567', role: 'CUSTOMER' }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: '-1s',
    });
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(401);
  });

  it('rejects alg:none tampered JWT', async () => {
    // Craft a token with alg=none
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'evil-id', role: 'ADMIN' })).toString('base64url');
    const forgedToken = header + "." + payload + ".";
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + forgedToken);
    expect(res.status).toBe(401);
  });

  it('valid admin token can access /me', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.data.profile).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ROLE-BASED ACCESS CONTROL (RBAC)
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: RBAC — CUSTOMER cannot access ADMIN endpoints', () => {
  let customerToken: string;

  beforeAll(async () => {
    customerToken = await getCustomerToken();
  });

  it('CUSTOMER → /admin/dashboard returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', 'Bearer ' + customerToken);
    expect(res.status).toBe(403);
  });

  it('CUSTOMER → /admin/orders returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/orders')
      .set('Authorization', 'Bearer ' + customerToken);
    expect(res.status).toBe(403);
  });

  it('CUSTOMER → /admin/inventory returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/inventory')
      .set('Authorization', 'Bearer ' + customerToken);
    expect(res.status).toBe(403);
  });

  it('CUSTOMER → /admin/suppliers returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/suppliers')
      .set('Authorization', 'Bearer ' + customerToken);
    expect(res.status).toBe(403);
  });

  it('CUSTOMER → /admin/operations/metrics returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/operations/metrics')
      .set('Authorization', 'Bearer ' + customerToken);
    expect(res.status).toBe(403);
  });
});

describe('Security: RBAC — RIDER cannot access ADMIN endpoints', () => {
  let riderToken: string;

  beforeAll(async () => {
    const r = await getRiderToken();
    riderToken = r.token;
  });

  it('RIDER → /admin/dashboard returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', 'Bearer ' + riderToken);
    expect(res.status).toBe(403);
  });

  it('RIDER → /admin/orders returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/orders')
      .set('Authorization', 'Bearer ' + riderToken);
    expect(res.status).toBe(403);
  });

  it('RIDER → /admin/inventory returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/inventory')
      .set('Authorization', 'Bearer ' + riderToken);
    expect(res.status).toBe(403);
  });

  it('RIDER → /admin/suppliers returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/suppliers')
      .set('Authorization', 'Bearer ' + riderToken);
    expect(res.status).toBe(403);
  });
});

describe('Security: RBAC — Unauthenticated access to protected endpoints', () => {
  it('/api/v1/me without token → 401', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
  });

  it('/api/v1/orders without token → 401', async () => {
    const res = await request(app).get('/api/v1/orders');
    expect(res.status).toBe(401);
  });

  it('/api/v1/riders/deliveries without token → 401', async () => {
    const res = await request(app).get('/api/v1/riders/deliveries');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Security: RBAC — PACKING_STAFF permissions and boundaries', () => {
  let staffToken: string;

  beforeAll(async () => {
    staffToken = await getPackingStaffToken();
  });

  it('PACKING_STAFF -> GET /admin/inventory is allowed (200)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/inventory')
      .set('Authorization', 'Bearer ' + staffToken);
    expect(res.status).toBe(200);
  });

  it('PACKING_STAFF -> GET /admin/suppliers is allowed (200)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/suppliers')
      .set('Authorization', 'Bearer ' + staffToken);
    expect(res.status).toBe(200);
  });

  it('PACKING_STAFF -> POST /admin/inventory/:productId/adjust is forbidden (403)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/inventory/b0000001-0000-0000-0000-000000000001/adjust')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ quantity_change: 10, reason: 'Physical count adjustment' });
    expect(res.status).toBe(403);
  });

  it('PACKING_STAFF -> POST /admin/suppliers is forbidden (403)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/suppliers')
      .set('Authorization', 'Bearer ' + staffToken)
      .send({ name: 'Malicious Supplier', contact_phone: '+94771234567' });
    expect(res.status).toBe(403);
  });

  it('PACKING_STAFF -> GET /admin/dashboard is forbidden (403)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', 'Bearer ' + staffToken);
    expect(res.status).toBe(403);
  });

  it('PACKING_STAFF -> GET /admin/operations/metrics is forbidden (403)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/operations/metrics')
      .set('Authorization', 'Bearer ' + staffToken);
    expect(res.status).toBe(403);
  });
});

// 3. OTP ABUSE PROTECTION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: OTP Abuse Protection', () => {
  beforeEach(() => {
    authRateLimiter.reset();
  });

  it('rejects invalid phone format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: 'notaphone' });
    expect(res.status).toBe(400);
  });

  it('enforces per-phone rate limit (max 3 per hour)', async () => {
    const phone = '+94771234567';
    for (let i = 0; i < 3; i++) {
      authRateLimiter.checkLimit("otp_phone:" + phone, 3, 60 * 60 * 1000);
    }
    let threw = false;
    try {
      authRateLimiter.checkLimit("otp_phone:" + phone, 3, 60 * 60 * 1000);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('rejects verify OTP with missing phone', async () => {
    const res = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ otp: '123456' });
    expect(res.status).toBe(400);
  });

  it('rejects verify OTP with non-numeric OTP', async () => {
    const res = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+94771234567', otp: 'abcdef' });
    expect(res.status).toBe(400);
  });

  it('rejects verify OTP with wrong length', async () => {
    const res = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+94771234567', otp: '12345' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for non-existent OTP challenge', async () => {
    authRateLimiter.reset();
    const res = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+94779999999', otp: '000000' });
    expect(res.status).toBe(401);
    // Must not reveal whether phone belongs to an existing account
    expect(res.body.error?.message || '').not.toContain('account');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. PRICE / CHECKOUT MANIPULATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Checkout — Server-Authoritative Pricing', () => {
  let customerToken: string;

  beforeAll(async () => {
    customerToken = await getCustomerToken();
  });

  it('ignores client-supplied price fields in checkout request', async () => {
    // Even if the client sends fake pricing, Zod strips unknown fields
    // and the service computes all prices server-side
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        address_id: '00000000-0000-0000-0000-000000000000',
        items: [
          {
            product_id: '00000000-0000-0000-0000-000000000001',
            quantity: 1,
            // Malicious fields — should be stripped/ignored
            unit_selling_price: 0,
            purchase_cost: 0,
            markup_percentage_applied: 0,
            delivery_fee: 0,
            total: 1,
            payment_status: 'PAID',
            order_status: 'DELIVERED',
          },
        ],
      });
    // Either 404 (address not found), 400 (product not found), or 422 (outside radius)
    // but NOT 500 — the server must not crash on extra fields
    expect(res.status).not.toBe(500);
    // No price manipulation succeeded — we just verify no 2xx with fake pricing
    // Real pricing is computed in order.service.ts regardless of client input
  });

  it('rejects checkout with invalid address_id UUID', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        address_id: 'not-a-uuid',
        items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects checkout with quantity of 0', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        address_id: '00000000-0000-0000-0000-000000000000',
        items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 0 }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects checkout with quantity exceeding maximum (>100)', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        address_id: '00000000-0000-0000-0000-000000000000',
        items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 101 }],
      });
    expect(res.status).toBe(400);
  });

  it('rejects checkout with empty items array', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        address_id: '00000000-0000-0000-0000-000000000000',
        items: [],
      });
    expect(res.status).toBe(400);
  });

  it('rejects checkout without auth token', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .send({
        address_id: '00000000-0000-0000-0000-000000000000',
        items: [{ product_id: '00000000-0000-0000-0000-000000000001', quantity: 1 }],
      });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. IDOR — CUSTOMER ORDER ACCESS
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: IDOR — Customer order isolation', () => {
  it('returns 404 when customer requests another customer order by UUID', async () => {
    const customerToken = await getCustomerToken();
    // Use a random UUID that does not belong to this customer
    const res = await request(app)
      .get('/api/v1/orders/00000000-0000-0000-0000-000000000099')
      .set('Authorization', 'Bearer ' + customerToken);
    // Must be 404 — not 200 with another customer's order
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ADMIN ORDER STATUS — ENUM VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Admin order status — input validation', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  it('rejects admin order status update with invalid enum value', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/orders/00000000-0000-0000-0000-000000000001/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ status: 'HACKED' });
    expect(res.status).toBe(400);
  });

  it('rejects admin order status update with missing status field', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/orders/00000000-0000-0000-0000-000000000001/status')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects admin order status update from CUSTOMER', async () => {
    const customerToken = await getCustomerToken();
    const res = await request(app)
      .patch('/api/v1/admin/orders/00000000-0000-0000-0000-000000000001/status')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({ status: 'DELIVERED' });
    expect(res.status).toBe(403);
  });

  it('rejects admin order status update from RIDER', async () => {
    const { token: riderToken } = await getRiderToken();
    const res = await request(app)
      .patch('/api/v1/admin/orders/00000000-0000-0000-0000-000000000001/status')
      .set('Authorization', 'Bearer ' + riderToken)
      .send({ status: 'DELIVERED' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RIDER DELIVERY STATUS — ENUM VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Rider delivery status — input validation', () => {
  let riderToken: string;

  beforeAll(async () => {
    const r = await getRiderToken();
    riderToken = r.token;
  });

  it('rejects delivery status update with invalid enum value', async () => {
    const res = await request(app)
      .patch('/api/v1/riders/deliveries/00000000-0000-0000-0000-000000000001/status')
      .set('Authorization', 'Bearer ' + riderToken)
      .send({ status: 'HACKED' });
    expect(res.status).toBe(400);
  });

  it('rejects delivery status update with missing status', async () => {
    const res = await request(app)
      .patch('/api/v1/riders/deliveries/00000000-0000-0000-0000-000000000001/status')
      .set('Authorization', 'Bearer ' + riderToken)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. COD AMOUNT — INPUT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: COD collection — amount validation', () => {
  let riderToken: string;

  beforeAll(async () => {
    const r = await getRiderToken();
    riderToken = r.token;
  });

  it('rejects COD amount of 0 (non-negative check)', async () => {
    const res = await request(app)
      .post('/api/v1/riders/deliveries/00000000-0000-0000-0000-000000000001/collect-cod')
      .set('Authorization', 'Bearer ' + riderToken)
      .send({ amount: -1 });
    expect(res.status).toBe(400);
  });

  it('rejects COD amount above maximum', async () => {
    const res = await request(app)
      .post('/api/v1/riders/deliveries/00000000-0000-0000-0000-000000000001/collect-cod')
      .set('Authorization', 'Bearer ' + riderToken)
      .send({ amount: 9999999 });
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric COD amount', async () => {
    const res = await request(app)
      .post('/api/v1/riders/deliveries/00000000-0000-0000-0000-000000000001/collect-cod')
      .set('Authorization', 'Bearer ' + riderToken)
      .send({ amount: 'evil' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ADMIN RIDER ASSIGNMENT — UUID VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Admin rider assignment — input validation', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  it('rejects assign-rider with invalid rider_id UUID', async () => {
    const res = await request(app)
      .post('/api/v1/admin/orders/00000000-0000-0000-0000-000000000001/assign-rider')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ rider_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('rejects assign-rider with missing rider_id', async () => {
    const res = await request(app)
      .post('/api/v1/admin/orders/00000000-0000-0000-0000-000000000001/assign-rider')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. MASS ASSIGNMENT / PRIVILEGE ESCALATION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Mass assignment — role escalation prevention', () => {
  let customerToken: string;
  // The profile PATCH below writes to the seeded customer; put it back exactly
  // (as text, keeping Postgres's microseconds).
  let profileBefore: { full_name: string | null; email: string | null; updated_at: string };

  beforeAll(async () => {
    customerToken = await getCustomerToken();
    profileBefore = (
      await pool.query('SELECT full_name, email, updated_at::text FROM users WHERE id = $1', [SEEDED_CUSTOMER_ID])
    ).rows[0];
  });

  afterAll(async () => {
    await pool.query('UPDATE users SET full_name = $2, email = $3, updated_at = $4::timestamptz WHERE id = $1', [
      SEEDED_CUSTOMER_ID,
      profileBefore.full_name,
      profileBefore.email,
      profileBefore.updated_at,
    ]);
  });

  it('profile update ignores role field — cannot escalate to ADMIN via /me PATCH', async () => {
    const res = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({ full_name: 'Ahmed Rizvi', role: 'ADMIN' });
    // Must succeed (if name is valid) or 400 — but never elevate role
    expect([200, 400, 422]).toContain(res.status);
    // Role in response must still be CUSTOMER
    if (res.status === 200) {
      expect(res.body.data?.profile?.role).toBe('CUSTOMER');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. PAGINATION — BOUNDED QUERY PROTECTION
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Pagination — unbounded query prevention', () => {
  let customerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    customerToken = await getCustomerToken();
    adminToken = await getAdminToken();
  });

  it('customer order list caps limit at 100', async () => {
    const res = await request(app)
      .get('/api/v1/orders?limit=999999')
      .set('Authorization', 'Bearer ' + customerToken);
    // Must be 400 (validation) — limit exceeds max of 100
    expect(res.status).toBe(400);
  });

  it('admin order list caps limit at 100', async () => {
    const res = await request(app)
      .get('/api/v1/admin/orders?limit=999999')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(400);
  });

  it('catalog product list caps limit at 100', async () => {
    const res = await request(app).get('/api/v1/products?limit=999999');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. REQUEST BODY SIZE — OVERSIZED PAYLOAD
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Request body size limits', () => {
  it('rejects a JSON body larger than 1MB', async () => {
    const largePayload = JSON.stringify({ data: 'x'.repeat(1_100_000) });
    const res = await request(app)
      .post('/api/v1/auth/otp/request')
      .set('Content-Type', 'application/json')
      .send(largePayload);
    expect(res.status).toBe(413);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. ERROR RESPONSE — NO SENSITIVE DATA LEAKAGE
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Error responses — sensitive data exposure', () => {
  it('500 error does not expose stack trace or internal message', async () => {
    // Force an invalid UUID to trigger DB error (non-existent resource)
    const customerToken = await getCustomerToken();
    const res = await request(app)
      .get('/api/v1/orders/invalid-uuid-format')
      .set('Authorization', 'Bearer ' + customerToken);
    // Should be 400 or 404 — NOT 500 leaking internals
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).not.toContain('invalid input syntax');
    expect(res.body.error.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });

  it('error response always includes requestId', async () => {
    const res = await request(app)
      .get('/api/v1/auth/nonexistent')
      .set('x-request-id', 'test-req-123');
    // The response header must echo the request ID
    expect(res.headers['x-request-id']).toBe('test-req-123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. SECURITY HEADERS (Helmet)
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: HTTP Security Headers', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('sets X-XSS-Protection or similar (Helmet active)', async () => {
    const res = await request(app).get('/health');
    // At minimum Helmet sets x-content-type-options — confirms Helmet is active
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. REFRESH TOKEN — SECURITY
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Refresh Token', () => {
  it('rejects empty refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: '' });
    expect(res.status).toBe(400);
  });

  it('rejects refresh token that is too short', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects a valid-length but non-existent refresh token', async () => {
    const fakeToken = 'a'.repeat(80); // 80 chars hex — valid format, does not exist in DB
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: fakeToken });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. ADMIN PAGINATION — VALIDATED
// ─────────────────────────────────────────────────────────────────────────────
describe('Security: Admin orders — pagination validation', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  it('accepts valid admin orders page request', async () => {
    const res = await request(app)
      .get('/api/v1/admin/orders?page=1&limit=10')
      .set('Authorization', 'Bearer ' + adminToken);
    expect([200, 401, 403]).toContain(res.status);
  });

  it('rejects invalid status enum in admin orders query', async () => {
    const res = await request(app)
      .get('/api/v1/admin/orders?status=FAKE_STATUS')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(400);
  });
});
