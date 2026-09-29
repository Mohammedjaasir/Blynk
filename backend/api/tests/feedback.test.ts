import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { FEEDBACK_HOURLY_LIMIT } from '../src/modules/feedback/feedback.service.js';

/**
 * Customer feedback (migration 013): customers send it from the app, Blynk
 * Admin reads it and marks it read. Own throwaway users (and their feedback,
 * by cascade) are removed afterwards, so the run leaves no trace.
 */
const PHONE_PREFIX = '+9477000980';

describe('Customer feedback', () => {
  const app = createApp();
  let customerId = '';
  let otherCustomerId = '';
  let customerToken = '';
  let otherCustomerToken = '';
  let adminToken = '';

  async function cleanup() {
    await pool.query(`DELETE FROM users WHERE phone LIKE '${PHONE_PREFIX}%'`);
  }

  const send = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/feedback').set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    await cleanup();
    const { rows } = await pool.query<{ id: string; phone: string; role: string }>(
      `INSERT INTO users (phone, full_name, role) VALUES
         ('${PHONE_PREFIX}1', 'Feedback Customer', 'CUSTOMER'),
         ('${PHONE_PREFIX}2', 'Other Customer', 'CUSTOMER'),
         ('${PHONE_PREFIX}3', 'Feedback Admin', 'ADMIN')
       RETURNING id, phone, role`
    );
    const byPhone = (suffix: string) => rows.find((r) => r.phone === `${PHONE_PREFIX}${suffix}`)!;
    customerId = byPhone('1').id;
    otherCustomerId = byPhone('2').id;
    customerToken = generateAccessToken({ id: customerId, phone: `${PHONE_PREFIX}1`, role: 'CUSTOMER' });
    otherCustomerToken = generateAccessToken({ id: otherCustomerId, phone: `${PHONE_PREFIX}2`, role: 'CUSTOMER' });
    adminToken = generateAccessToken({ id: byPhone('3').id, phone: `${PHONE_PREFIX}3`, role: 'ADMIN' });
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM customer_feedback WHERE user_id IN ($1, $2)`, [customerId, otherCustomerId]);
  });

  afterAll(cleanup);

  // ==========================================================================
  // 1. CUSTOMER: POST /api/v1/feedback
  // ==========================================================================
  describe('POST /api/v1/feedback', () => {
    it('stores trimmed feedback with a rating and returns it as NEW', async () => {
      const res = await send(customerToken, { rating: 4, category: 'DELIVERY', message: '  Rider was quick  ' });
      expect(res.status).toBe(201);
      expect(res.body.data.feedback).toMatchObject({
        rating: 4,
        category: 'DELIVERY',
        message: 'Rider was quick',
        status: 'NEW',
      });
      const { rows } = await pool.query('SELECT user_id, message FROM customer_feedback WHERE id = $1', [
        res.body.data.feedback.id,
      ]);
      expect(rows[0]).toEqual({ user_id: customerId, message: 'Rider was quick' });
    });

    it('accepts feedback without a rating', async () => {
      const res = await send(customerToken, { category: 'APP', message: 'Please add dark mode' });
      expect(res.status).toBe(201);
      expect(res.body.data.feedback.rating).toBeNull();
    });

    it('rejects an anonymous request with 401', async () => {
      const res = await request(app).post('/api/v1/feedback').send({ category: 'APP', message: 'Hello' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it.each([
      ['a blank message', { category: 'APP', message: '    ' }, 'message'],
      ['a missing message', { category: 'APP' }, 'message'],
      ['a message over 2000 characters', { category: 'APP', message: 'x'.repeat(2001) }, 'message'],
      ['an unknown category', { category: 'PRICING', message: 'Hi' }, 'category'],
      ['a rating of 0', { rating: 0, category: 'APP', message: 'Hi' }, 'rating'],
      ['a rating of 6', { rating: 6, category: 'APP', message: 'Hi' }, 'rating'],
      ['a fractional rating', { rating: 3.5, category: 'APP', message: 'Hi' }, 'rating'],
    ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body, field) => {
      const res = await send(customerToken, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    });

    it('accepts exactly 2000 characters', async () => {
      const res = await send(customerToken, { category: 'OTHER', message: 'y'.repeat(2000) });
      expect(res.status).toBe(201);
    });

    it(`allows ${FEEDBACK_HOURLY_LIMIT} an hour per customer, then answers 429 FEEDBACK_RATE_LIMITED`, async () => {
      for (let i = 0; i < FEEDBACK_HOURLY_LIMIT; i++) {
        const ok = await send(customerToken, { category: 'APP', message: `Message ${i}` });
        expect(ok.status).toBe(201);
      }
      const limited = await send(customerToken, { category: 'APP', message: 'One too many' });
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('FEEDBACK_RATE_LIMITED');
      expect(limited.body.error.message).toMatch(/try again later/i);

      // The limit is per customer: someone else can still send.
      const other = await send(otherCustomerToken, { category: 'APP', message: 'Mine is fine' });
      expect(other.status).toBe(201);
    });

    it('counts only the last hour', async () => {
      await pool.query(
        `INSERT INTO customer_feedback (user_id, category, message, created_at)
         SELECT $1, 'APP', 'old', now() - interval '61 minutes' FROM generate_series(1, $2::int)`,
        [customerId, FEEDBACK_HOURLY_LIMIT]
      );
      const res = await send(customerToken, { category: 'APP', message: 'Fresh' });
      expect(res.status).toBe(201);
    });
  });

  // ==========================================================================
  // 2. ADMIN: GET /api/v1/admin/feedback, PATCH /api/v1/admin/feedback/:id
  // ==========================================================================
  describe('Admin feedback inbox', () => {
    const listAs = (token: string, query = '') =>
      request(app).get(`/api/v1/admin/feedback${query}`).set('Authorization', `Bearer ${token}`);

    async function seed() {
      const { rows } = await pool.query<{ id: string; message: string }>(
        `INSERT INTO customer_feedback (user_id, rating, category, message, status, created_at) VALUES
           ($1, 5, 'PRODUCTS', 'oldest read', 'READ', now() - interval '3 minutes'),
           ($1, NULL, 'APP', 'middle new', 'NEW', now() - interval '2 minutes'),
           ($2, 2, 'DELIVERY', 'newest new', 'NEW', now() - interval '1 minute')
         RETURNING id, message`,
        [customerId, otherCustomerId]
      );
      return Object.fromEntries(rows.map((r) => [r.message, r.id]));
    }

    /** Only this test's rows - the dev database may hold real feedback too. */
    const ours = (items: { user_id: string }[]) =>
      items.filter((f) => f.user_id === customerId || f.user_id === otherCustomerId);

    it('lists newest first with the customer name and phone, paginated', async () => {
      await seed();
      const res = await listAs(adminToken);
      expect(res.status).toBe(200);
      const items = ours(res.body.data.feedback);
      expect(items.map((f: { message: string }) => f.message)).toEqual(['newest new', 'middle new', 'oldest read']);
      expect(items[0]).toMatchObject({
        rating: 2,
        category: 'DELIVERY',
        status: 'NEW',
        full_name: 'Other Customer',
        phone: `${PHONE_PREFIX}2`,
      });
      expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 50 });
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(3);
    });

    it('filters by status', async () => {
      await seed();
      const fresh = await listAs(adminToken, '?status=NEW');
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.feedback.every((f: { status: string }) => f.status === 'NEW')).toBe(true);
      expect(ours(fresh.body.data.feedback).map((f: { message: string }) => f.message)).toEqual([
        'newest new',
        'middle new',
      ]);

      const read = await listAs(adminToken, '?status=READ');
      expect(ours(read.body.data.feedback).map((f: { message: string }) => f.message)).toEqual(['oldest read']);
    });

    it('honours page and limit', async () => {
      await seed();
      const res = await listAs(adminToken, '?limit=1&page=2');
      expect(res.status).toBe(200);
      expect(res.body.data.feedback).toHaveLength(1);
      expect(res.body.data.pagination).toMatchObject({ page: 2, limit: 1 });
    });

    it('rejects an unknown status filter', async () => {
      const res = await listAs(adminToken, '?status=ARCHIVED');
      expect(res.status).toBe(400);
    });

    it('marks feedback read (and back to new)', async () => {
      const ids = await seed();
      const id = ids['middle new'];
      const res = await request(app)
        .patch(`/api/v1/admin/feedback/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'READ' });
      expect(res.status).toBe(200);
      expect(res.body.data.feedback).toEqual({ id, status: 'READ' });
      const { rows } = await pool.query('SELECT status FROM customer_feedback WHERE id = $1', [id]);
      expect(rows[0].status).toBe('READ');

      const back = await request(app)
        .patch(`/api/v1/admin/feedback/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'NEW' });
      expect(back.body.data.feedback.status).toBe('NEW');
    });

    it('answers 404 for unknown feedback and 400 for a bad status or id', async () => {
      const auth = { Authorization: `Bearer ${adminToken}` };
      const missing = await request(app)
        .patch('/api/v1/admin/feedback/00000000-0000-0000-0000-000000000000')
        .set(auth)
        .send({ status: 'READ' });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('FEEDBACK_NOT_FOUND');

      const ids = await seed();
      const badStatus = await request(app)
        .patch(`/api/v1/admin/feedback/${ids['newest new']}`)
        .set(auth)
        .send({ status: 'DONE' });
      expect(badStatus.status).toBe(400);

      const badId = await request(app).patch('/api/v1/admin/feedback/not-a-uuid').set(auth).send({ status: 'READ' });
      expect(badId.status).toBe(400);
    });

    it('forbids a customer (403) and an anonymous caller (401)', async () => {
      const ids = await seed();
      const list = await listAs(customerToken);
      const patch = await request(app)
        .patch(`/api/v1/admin/feedback/${ids['newest new']}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ status: 'READ' });
      expect(list.status).toBe(403);
      expect(patch.status).toBe(403);

      const anonymous = await request(app).get('/api/v1/admin/feedback');
      expect(anonymous.status).toBe(401);

      const { rows } = await pool.query('SELECT status FROM customer_feedback WHERE id = $1', [ids['newest new']]);
      expect(rows[0].status).toBe('NEW');
    });
  });
});
