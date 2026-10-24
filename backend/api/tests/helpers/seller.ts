import request from 'supertest';
import type { Express } from 'express';
import { expect } from 'vitest';
import { pool } from '../../src/database/connection.js';
import { authRateLimiter } from '../../src/modules/auth/auth.rate-limiter.js';

/**
 * Seller-portal fixtures for one test file. `phoneBase` is `+94` + 7 digits
 * (a two-digit index completes the number); every user whose phone starts with
 * it is removed by cleanup() together with their sellers, submissions, payouts,
 * products, sessions and codes (purge() clears an aborted earlier run).
 */
export function sellerFixtures(app: Express, phoneBase: string) {
  const phone = (n: number) => `${phoneBase}${String(n).padStart(2, '0')}`;

  /** The real flow: POST /auth/otp/request then /auth/otp/verify (app: 'seller' unless overridden). */
  async function signIn(n: number, extra: Record<string, unknown> = { app: 'seller' }) {
    authRateLimiter.reset();
    const asked = await request(app).post('/api/v1/auth/otp/request').send({ phone: phone(n) });
    expect(asked.status).toBe(200);
    return request(app).post('/api/v1/auth/otp/verify').send({ phone: phone(n), otp: asked.body.data.dev_otp, ...extra });
  }

  /**
   * A seller as staff add one (sellers are invite-only since 2026-10-24: a SELLER user with the
   * phone and its sellers row, no own commission rate), in `status`, then signed in through the
   * real SMS-code flow. The shop is named after the phone unless `shop_name` is given.
   */
  async function makeSeller(n: number, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' = 'APPROVED', shop_name?: string) {
    const userId = (await pool.query(`INSERT INTO users (phone, role) VALUES ($1, 'SELLER') RETURNING id`, [phone(n)])).rows[0].id as string;
    const sellerId = (
      await pool.query('INSERT INTO sellers (user_id, shop_name, status) VALUES ($1, $2, $3) RETURNING id', [userId, shop_name ?? phone(n), status])
    ).rows[0].id as string;
    const res = await signIn(n);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(userId);
    return { userId, sellerId, token: res.body.data.access_token as string, refresh: res.body.data.refresh_token as string, phone: phone(n) };
  }

  /** A non-seller account with a phone number (CUSTOMER, RIDER, OPERATIONS...). */
  async function plainUser(n: number, role: string) {
    const row = (await pool.query('INSERT INTO users (phone, role) VALUES ($1, $2) RETURNING id', [phone(n), role])).rows[0];
    return row.id as string;
  }

  async function purge() {
    const sellers = (
      await pool.query('SELECT s.id FROM sellers s JOIN users u ON u.id = s.user_id WHERE u.phone LIKE $1', [`${phoneBase}%`])
    ).rows.map((r) => r.id as string);
    if (sellers.length) {
      const products = (await pool.query('SELECT id FROM products WHERE seller_id = ANY($1)', [sellers])).rows.map((r) => r.id as string);
      if (products.length) {
        await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [products]);
        await pool.query('DELETE FROM products WHERE id = ANY($1)', [products]);
      }
      await pool.query('DELETE FROM sellers WHERE id = ANY($1)', [sellers]);
    }
    await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE phone LIKE $1)', [`${phoneBase}%`]);
    await pool.query('DELETE FROM users WHERE phone LIKE $1', [`${phoneBase}%`]);
    await pool.query('DELETE FROM otp_verifications WHERE phone LIKE $1', [`${phoneBase}%`]);
  }

  /** A product that belongs to the seller (what an approved submission becomes), made directly. */
  async function sellerProduct(sellerId: string, categoryId: string, tag: string, o: { cost?: number; fixed?: number; active?: boolean } = {}) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const row = (
      await pool.query(
        `INSERT INTO products (category_id, name, slug, sku, unit, purchase_cost, pricing_mode, fixed_selling_price, is_active, is_available, seller_id)
         VALUES ($1, $2, $3, $4, '1 kg', $5, 'FIXED', $6, $7, true, $8) RETURNING id`,
        [categoryId, `Seller test ${tag} ${stamp}`, `seller-test-${tag}-${stamp}`, `SELL-${tag}-${stamp}`, o.cost ?? 100, o.fixed ?? 150, o.active ?? true, sellerId]
      )
    ).rows[0];
    return row.id as string;
  }

  const activeCategory = async () =>
    (await pool.query('SELECT id FROM categories WHERE is_active = true AND deleted_at IS NULL ORDER BY display_order LIMIT 1')).rows[0].id as string;

  return { phone, signIn, makeSeller, plainUser, purge, cleanup: purge, sellerProduct, activeCategory };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
