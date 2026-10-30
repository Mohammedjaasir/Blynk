import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { sellerFixtures } from './helpers/seller.js';
import { tokens, auth } from './helpers/stock.js';

/**
 * The seller portal end to end (owner, 2026-10-24): a seller signs in with an SMS code, Admin
 * approves the shop, the seller proposes a product, Admin approves it with a customer price, the
 * customer API serves it with "sold by", the seller edits it, Admin approves / rejects the change
 * and suspends the shop. Seller-side and staff-side routes were built separately and tested with
 * simulated counterparts; this runs them against each other.
 */
const app = createApp();
const fx = sellerFixtures(app, '+947791909');
const stamp = Date.now();
let testStart: Date;
let categoryId = '';
let sellerId = '';
let sellerToken = '';
let productId = '';

const admin = (method: 'get' | 'post' | 'patch', path: string, body?: object) =>
  request(app)[method](`/api/v1/admin${path}`).set(auth(tokens.admin)).send(body as object);
const seller = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
  request(app)[method](`/api/v1/seller${path}`).set(auth(sellerToken)).send(body as object);

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  await fx.purge();
  categoryId = (await pool.query('SELECT id FROM categories WHERE is_active = true AND parent_id IS NULL ORDER BY display_order LIMIT 1')).rows[0].id;
});

afterAll(async () => {
  await fx.purge();
  await pool.query(`DELETE FROM audit_logs WHERE action LIKE 'SELLER_%' AND created_at >= $1`, [testStart]);
  await pool.query(`DELETE FROM notifications WHERE created_at >= $1 AND notification_type LIKE 'SELLER_%'`, [testStart]);
});

describe('Seller portal, seller and staff sides together', () => {
  it('sign in, approval, a new product, approval with a customer price, sold_by', async () => {
    const made = await fx.makeSeller(1, 'PENDING', `E2E Shop ${stamp}`);
    sellerId = made.sellerId;
    sellerToken = made.token;

    // not approved yet: cannot propose products
    const early = await seller('post', '/products', { name: 'Early', category_id: categoryId, unit: '1 pc', seller_price: 50 });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('SELLER_NOT_APPROVED');

    const approved = await admin('patch', `/sellers/${sellerId}`, { status: 'APPROVED' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.data.seller.status).toBe('APPROVED');

    const proposed = await seller('post', '/products', {
      name: `E2E Juice ${stamp}`,
      category_id: categoryId,
      unit: '250 ml',
      description: 'Fresh pressed',
      // a photo is mandatory for a new product (2026-10-30)
      image_url: '/uploads/products/seller-e2e-test.png',
      seller_price: 80,
    });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
    const submissionId = proposed.body.data.submission.id as string;

    // the seller sees it waiting, as a row of its own
    const mine = (await seller('get', '/products')).body.data.products as Array<{ id: string; live: boolean; pending: { id: string } | null }>;
    expect(mine.find((p) => p.pending?.id === submissionId)).toMatchObject({ live: false });

    // Admin's queue shows it with the seller
    const queue = (await admin('get', `/seller-submissions?seller_id=${sellerId}`)).body.data.submissions as Array<{ id: string; seller: { shop_name: string } }>;
    expect(queue.map((s) => s.id)).toContain(submissionId);
    expect(queue[0]!.seller.shop_name).toBe(`E2E Shop ${stamp}`);

    // a price is required on a NEW approval
    expect((await admin('post', `/seller-submissions/${submissionId}/approve`, {})).status).toBe(400);

    const ok = await admin('post', `/seller-submissions/${submissionId}/approve`, { selling_price: 120 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    productId = ok.body.data.product.id as string;
    const row = (await pool.query('SELECT purchase_cost, fixed_selling_price, pricing_mode, seller_id, is_active FROM products WHERE id = $1', [productId])).rows[0];
    expect(Number(row.purchase_cost)).toBe(80);
    expect(Number(row.fixed_selling_price)).toBe(120);
    expect(row).toMatchObject({ pricing_mode: 'FIXED', seller_id: sellerId, is_active: true });

    // customers see it, with the shop and the price Admin set
    const shown = (await request(app).get(`/api/v1/catalog/products/${productId}`)).body.data.product;
    expect(shown).toMatchObject({ name: `E2E Juice ${stamp}`, selling_price: 120, sold_by: `E2E Shop ${stamp}` });

    // the seller sees it live with the customer price
    const live = ((await seller('get', '/products')).body.data.products as Array<{ id: string; live: boolean; selling_price: number | null; seller_price: number }>).find((p) => p.id === productId);
    expect(live).toMatchObject({ live: true, selling_price: 120, seller_price: 80 });
  });

  it('an edit waits, a newer edit replaces it, approval applies it, rejection shows the reason', async () => {
    const first = await seller('patch', `/products/${productId}`, { seller_price: 95 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await seller('patch', `/products/${productId}`, { seller_price: 90, name: `E2E Juice ${stamp} Big` });
    expect(second.status).toBe(200);
    const states = (await pool.query(`SELECT id, status FROM seller_submissions WHERE product_id = $1 AND kind = 'EDIT' ORDER BY created_at`, [productId])).rows;
    expect(states.map((s) => s.status)).toEqual(['WITHDRAWN', 'PENDING']);

    // the live product is untouched until approval
    expect(Number((await pool.query('SELECT purchase_cost FROM products WHERE id = $1', [productId])).rows[0].purchase_cost)).toBe(80);
    expect((await request(app).get(`/api/v1/catalog/products/${productId}`)).body.data.product.name).toBe(`E2E Juice ${stamp}`);

    // the seller price changed, so Admin must set the customer price again
    const edit = second.body.data.submission.id as string;
    expect((await admin('post', `/seller-submissions/${edit}/approve`, {})).status).toBe(400);
    const ok = await admin('post', `/seller-submissions/${edit}/approve`, { selling_price: 130 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = (await pool.query('SELECT name, purchase_cost, fixed_selling_price FROM products WHERE id = $1', [productId])).rows[0];
    expect(row.name).toBe(`E2E Juice ${stamp} Big`);
    expect(Number(row.purchase_cost)).toBe(90);
    expect(Number(row.fixed_selling_price)).toBe(130);

    // a rejected change keeps the live product and tells the seller why
    const third = await seller('patch', `/products/${productId}`, { seller_price: 70 });
    const rej = await admin('post', `/seller-submissions/${third.body.data.submission.id}/reject`, { reason: 'Price looks too low' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    const mine = ((await seller('get', '/products')).body.data.products as Array<{ id: string; seller_price: number; pending: unknown; last_rejected: { reject_reason: string } | null }>).find((p) => p.id === productId);
    expect(mine).toMatchObject({ seller_price: 90, pending: null });
    expect(mine!.last_rejected?.reject_reason).toBe('Price looks too low');
  });

  it('suspending the shop switches its products off for customers', async () => {
    const res = await admin('patch', `/sellers/${sellerId}`, { status: 'SUSPENDED' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await pool.query('SELECT is_active FROM products WHERE id = $1', [productId])).rows[0].is_active).toBe(false);
    expect((await request(app).get(`/api/v1/catalog/products/${productId}`)).status).toBe(404);
    // and the seller can still sign in, but not change the profile
    expect((await seller('get', '/me')).body.data.seller.status).toBe('SUSPENDED');
    expect((await seller('post', '/products', { name: 'Late', category_id: categoryId, unit: '1 pc', seller_price: 10 })).status).toBe(403);
  });
});
