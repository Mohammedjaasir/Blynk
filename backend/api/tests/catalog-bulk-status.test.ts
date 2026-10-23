import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Bulk on / off for products (owner, 2026-10-23): PATCH /admin/products/bulk-status switches the
 * ticked products hidden / shown (is_active) and greyed out / orderable (is_available) in one call,
 * audited once (PRODUCTS_BULK_STATUS).
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const fx = stockFixtures(app, 'BS-');
let testStart: Date;
let a = '';
let b = '';

const bulk = (body: unknown, token = tokens.admin) => request(app).patch('/api/v1/admin/products/bulk-status').set(auth(token)).send(body as object);
const flags = async (id: string) => (await pool.query('SELECT is_active, is_available FROM products WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  await fx.setup();
  a = (await fx.product({ tracked: false })).productId;
  b = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'PRODUCTS_BULK_STATUS' AND created_at >= $1`, [testStart]);
  await fx.cleanup();
});

describe('Bulk product status', () => {
  it('hides and shows the selection, and greys out and restores it, in one call each', async () => {
    const off = await bulk({ ids: [a, b], is_active: false });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.data).toEqual({ matched: 2, changed: 2, switched_on: 0 });
    expect(await flags(a)).toEqual({ is_active: false, is_available: true });
    expect(await flags(b)).toEqual({ is_active: false, is_available: true });
    // hidden from customers
    expect((await request(app).get(`/api/v1/catalog/products/${a}`)).status).toBe(404);

    const on = await bulk({ ids: [a, b], is_active: true });
    expect(on.body.data).toEqual({ matched: 2, changed: 2, switched_on: 2 });
    expect(await flags(a)).toEqual({ is_active: true, is_available: true });

    const grey = await bulk({ ids: [a], is_available: false });
    expect(grey.body.data).toEqual({ matched: 1, changed: 1, switched_on: 0 });
    expect(await flags(a)).toEqual({ is_active: true, is_available: false });
    expect(await flags(b)).toEqual({ is_active: true, is_available: true });
    const shown = (await request(app).get(`/api/v1/catalog/products/${a}`)).body.data.product;
    expect(shown.is_available).toBe(false);

    const back = await bulk({ ids: [a], is_available: true });
    expect(back.body.data).toEqual({ matched: 1, changed: 1, switched_on: 1 });
    expect(await flags(a)).toEqual({ is_active: true, is_available: true });
  });

  it('counts only what really changes, and sets both flags at once', async () => {
    const same = await bulk({ ids: [a, b], is_active: true, is_available: true });
    expect(same.body.data).toEqual({ matched: 2, changed: 0, switched_on: 0 });
    const both = await bulk({ ids: [a, b], is_active: false, is_available: false });
    expect(both.body.data).toEqual({ matched: 2, changed: 2, switched_on: 0 });
    expect(await flags(b)).toEqual({ is_active: false, is_available: false });
    const restore = await bulk({ ids: [a, b], is_active: true, is_available: true });
    expect(restore.body.data).toEqual({ matched: 2, changed: 2, switched_on: 2 });
  });

  it('is audited once per call with the products it changed', async () => {
    await bulk({ ids: [a, b], is_available: false });
    const audit = (
      await pool.query(`SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'PRODUCTS_BULK_STATUS' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`, [testStart])
    ).rows[0];
    expect(audit.actor_user_id).toBe(users.admin.id);
    expect(audit.new_values).toMatchObject({ is_available: false });
    expect([...audit.new_values.product_ids].sort()).toEqual([a, b].sort());
    await bulk({ ids: [a, b], is_available: true });
  });

  it('refuses an empty selection, nothing to change, unknown fields, bad ids and products that do not exist', async () => {
    expect((await bulk({ ids: [], is_active: false })).status).toBe(400);
    expect((await bulk({ ids: [a] })).status).toBe(400);
    expect((await bulk({ ids: [a], is_active: false, name: 'x' })).status).toBe(400);
    expect((await bulk({ ids: ['nope'], is_active: false })).status).toBe(400);
    expect((await bulk({ ids: Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`), is_active: false })).status).toBe(400);
    const ghost = await bulk({ ids: ['00000000-0000-4000-8000-000000000000'], is_active: false });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('Operations may; customers may not', async () => {
    expect((await bulk({ ids: [a], is_available: true }, opsToken)).status).toBe(200);
    expect((await bulk({ ids: [a], is_available: true }, tokens.customer)).status).toBe(403);
  });
});
