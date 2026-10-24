import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { bearer, sellerFixtures } from './helpers/seller.js';

/**
 * Seller portal sign-in: the SMS code flow with app: 'seller' creates a SELLER
 * user and a PENDING sellers row; a number used for any other account is
 * PHONE_IN_USE; the customer / rider / staff sign-ins refuse a SELLER number
 * (SELLER_SIGN_IN_REQUIRED); a seller token opens no other app's routes.
 */
const app = createApp();
const fx = sellerFixtures(app, '+947700120');

beforeAll(fx.purge);
afterAll(fx.cleanup);

const sellerRow = async (userId: string) =>
  (await pool.query('SELECT shop_name, status, commission_percent::float AS commission FROM sellers WHERE user_id = $1', [userId])).rows[0];

describe('Seller sign-in', () => {
  it('a new number becomes a SELLER user with a PENDING shop named after the phone', async () => {
    const res = await fx.signIn(1);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ phone: fx.phone(1), role: 'SELLER' });
    expect(res.body.data.access_token).toBeTruthy();
    expect(await sellerRow(res.body.data.user.id)).toEqual({ shop_name: fx.phone(1), status: 'PENDING', commission: 0 });
    const user = (await pool.query('SELECT role, phone_verified_at, phone_hash FROM users WHERE id = $1', [res.body.data.user.id])).rows[0];
    expect(user.role).toBe('SELLER');
    expect(user.phone_verified_at).not.toBeNull();
    expect(user.phone_hash).not.toBeNull();
  });

  it('takes the shop name from the optional shop_name field', async () => {
    const res = await fx.signIn(2, { app: 'seller', shop_name: '  Green Basket  ' });
    expect(res.status).toBe(200);
    expect((await sellerRow(res.body.data.user.id)).shop_name).toBe('Green Basket');
  });

  it('refuses a one-letter shop name', async () => {
    const res = await fx.signIn(3, { app: 'seller', shop_name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('signs an existing seller in again in every status, never making a second shop', async () => {
    const seller = await fx.makeSeller(4, 'PENDING', 'Again Shop');
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED', 'APPROVED']) {
      await pool.query('UPDATE sellers SET status = $2 WHERE id = $1', [seller.sellerId, status]);
      const res = await fx.signIn(4, { app: 'seller', shop_name: 'Ignored Name' });
      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(seller.userId);
    }
    const rows = (await pool.query('SELECT shop_name FROM sellers WHERE user_id = $1', [seller.userId])).rows;
    expect(rows).toEqual([{ shop_name: 'Again Shop' }]);
  });

  it('the session works: /auth/me says SELLER and the refresh token rotates', async () => {
    const seller = await fx.makeSeller(5);
    const me = await request(app).get('/api/v1/auth/me').set(bearer(seller.token));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ id: seller.userId, role: 'SELLER', phone: seller.phone });
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: seller.refresh });
    expect(refreshed.status).toBe(200);
    const me2 = await request(app).get('/api/v1/auth/me').set(bearer(refreshed.body.data.access_token));
    expect(me2.body.data.role).toBe('SELLER');
  });

  it('an unknown number is not created when the app asks create_account: false', async () => {
    const res = await fx.signIn(6, { app: 'seller', create_account: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect((await pool.query('SELECT 1 FROM users WHERE phone = $1', [fx.phone(6)])).rowCount).toBe(0);
  });

  it.each([
    [7, 'CUSTOMER'],
    [8, 'RIDER'],
    [9, 'OPERATIONS'],
  ])('a number already used by a %s account (%s) is PHONE_IN_USE and stays what it was', async (n, role) => {
    const userId = await fx.plainUser(n, role);
    const res = await fx.signIn(n);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PHONE_IN_USE');
    expect(res.body.error.message).toBe('This number is already used for a Blynk account.');
    expect((await pool.query('SELECT role FROM users WHERE id = $1', [userId])).rows[0].role).toBe(role);
    expect((await pool.query('SELECT 1 FROM sellers WHERE user_id = $1', [userId])).rowCount).toBe(0);
  });

  it('a SELLER number is refused by the customer, rider and staff sign-ins', async () => {
    await fx.makeSeller(10);
    for (const extra of [{}, { app: 'rider' }, { create_account: false }, { app: 'rider', create_account: false }]) {
      const res = await fx.signIn(10, extra);
      expect(res.status, JSON.stringify(extra)).toBe(403);
      expect(res.body.error.code).toBe('SELLER_SIGN_IN_REQUIRED');
    }
    // Each refusal leaves the seller able to sign in where they belong.
    expect((await fx.signIn(10, { app: 'seller' })).status).toBe(200);
  });

  it('a seller token opens no customer, rider or staff route', async () => {
    const seller = await fx.makeSeller(11);
    for (const path of ['/api/v1/orders/checkout-info', '/api/v1/admin/products', '/api/v1/riders/me/day', '/api/v1/admin/inventory']) {
      const res = await request(app).get(path).set(bearer(seller.token));
      expect(res.status, path).toBe(403);
    }
    // ...and the seller routes refuse everyone else.
    const customerId = await fx.plainUser(12, 'CUSTOMER');
    expect(customerId).toBeTruthy();
    const { generateAccessToken } = await import('../src/modules/auth/token.service.js');
    const customer = generateAccessToken({ id: customerId, phone: fx.phone(12), role: 'CUSTOMER' });
    expect((await request(app).get('/api/v1/seller/me').set(bearer(customer))).status).toBe(403);
    expect((await request(app).get('/api/v1/seller/me')).status).toBe(401);
  });
});
