import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * DELETE /me - a customer deletes their own account. Open orders block it;
 * otherwise the row is anonymised and deactivated, addresses, devices and
 * sessions go, and the orders stay for accounting.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c00028', phoneBase: '+947709280', name: 'Delete Me Customer' });
const MILK = 'b0000001-0000-0000-0000-000000000001';

describe('DELETE /me (customer account deletion)', () => {
  const ids: string[] = [];

  beforeAll(async () => {
    await people.purge(3);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await pool.query('DELETE FROM device_tokens WHERE user_id = ANY($1)', [ids]);
    await pool.query("DELETE FROM otp_verifications WHERE phone LIKE '+947709280%'");
    await people.cleanup();
  });

  it('staff cannot use it (403)', async () => {
    const admin = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' });
    const res = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(403);
  });

  it('refuses with 409 ACTIVE_ORDERS_EXIST while an order is open', async () => {
    const c = await people.customer(1);
    ids.push(c.id);
    const order = await expectCreated(await c.placeOrder([{ product_id: MILK, quantity: 1 }]));

    const res = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVE_ORDERS_EXIST');
    expect(res.body.error.message).toBe('Finish or cancel your open orders first.');
    const user = (await pool.query('SELECT is_active, phone FROM users WHERE id = $1', [c.id])).rows[0];
    expect(user).toEqual({ is_active: true, phone: c.phone });

    // Once the order is finished, deletion goes through.
    await pool.query("UPDATE orders SET order_status = 'CANCELLED' WHERE id = $1", [order.id]);
    const ok = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, data: { deleted: true } });
    // The order is kept for accounting.
    expect((await pool.query('SELECT customer_id FROM orders WHERE id = $1', [order.id])).rows[0].customer_id).toBe(c.id);
  });

  it('anonymises and deactivates; addresses, devices and sessions are removed; audit written', async () => {
    const c = await people.customer(2);
    ids.push(c.id);
    await pool.query("UPDATE users SET email = 'delete-me-28@example.com' WHERE id = $1", [c.id]);
    await pool.query("INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, 'del-test-token-28', 'android')", [c.id]);
    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, md5(random()::text), now() + interval '1 day')",
      [c.id]
    );

    const res = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    const user = (
      await pool.query('SELECT is_active, full_name, email, phone, sms_offers_opted_out_at FROM users WHERE id = $1', [c.id])
    ).rows[0];
    expect(user.is_active).toBe(false);
    expect(user.full_name).toBeNull();
    expect(user.email).toBeNull();
    expect(user.phone).not.toBe(c.phone);
    expect(user.phone).not.toMatch(/^\+94/);
    expect(user.phone.length).toBeLessThanOrEqual(20);
    expect(user.sms_offers_opted_out_at).not.toBeNull();
    expect((await pool.query('SELECT 1 FROM customer_addresses WHERE user_id = $1', [c.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM device_tokens WHERE user_id = $1', [c.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL', [c.id])).rowCount).toBe(0);
    const audit = (await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'CUSTOMER_ACCOUNT_DELETED'", [c.id])).rows;
    expect(audit).toHaveLength(1);

    // A second delete finds no active account.
    const again = await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`);
    expect(again.status).toBe(404);
  });

  it('the old number signs in as a brand-new customer, never the deleted account', async () => {
    authRateLimiter.reset();
    const c = await people.customer(3);
    ids.push(c.id);
    expect((await request(app).delete('/api/v1/me').set('Authorization', `Bearer ${c.token}`)).status).toBe(200);

    const otp = (await request(app).post('/api/v1/auth/otp/request').send({ phone: c.phone })).body.data.dev_otp;
    const refused = await request(app).post('/api/v1/auth/otp/verify').send({ phone: c.phone, otp, create_account: false });
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect((await pool.query('SELECT 1 FROM users WHERE phone = $1', [c.phone])).rowCount).toBe(0);
  });
});
