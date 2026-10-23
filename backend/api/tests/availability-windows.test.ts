import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { AVAILABILITY_KEY, windowOpenAt, windowText } from '../src/modules/configuration/availability-windows.js';
import { priceCart } from '../src/modules/orders/order.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Time-limited products (owner, 2026-10-23): GET|PUT /admin/settings/availability-windows for
 * Admin and Operations; every customer product carries available_window / window_closed and is
 * not available while its window is shut; priceCart refuses it (PRODUCT_OUTSIDE_HOURS). The
 * ordering clock is pinned to 2026-10-06T06:30Z (tests/setup/ordering-clock.ts) = 12:00 in
 * Colombo, so windows are written around noon. The stored row, the fixtures and the audit
 * entries are put back afterwards.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const customerToken = tokens.customer;
const fx = stockFixtures(app, 'AW-');

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;
let saved: SavedRow = null;
let testStart: Date;
let productId = '';
let categoryId = '';
let parentId = '';
let childId = '';

const putWindows = (windows: unknown, token = tokens.admin) =>
  request(app).put('/api/v1/admin/settings/availability-windows').set(auth(token)).send({ windows } as object);
const getWindows = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/availability-windows').set(auth(token));
const customerProduct = async () => (await request(app).get(`/api/v1/catalog/products/${productId}`)).body.data.product;
const clearRow = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [AVAILABILITY_KEY]);

// the loader keeps a snapshot for 5 s; every PUT drops it, so a test only has to PUT
beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved =
    (await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [AVAILABILITY_KEY])).rows[0] ??
    null;
  await fx.setup();
  const p = await fx.product({ tracked: false });
  productId = p.productId;
  categoryId = (await pool.query('SELECT category_id FROM products WHERE id = $1', [productId])).rows[0].category_id;
  const stamp = Date.now();
  parentId = (await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`AW Parent ${stamp}`, `aw-parent-${stamp}`])).rows[0].id;
  childId = (
    await pool.query(`INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id`, [`AW Child ${stamp}`, `aw-child-${stamp}`, parentId])
  ).rows[0].id;
  await clearRow();
});

afterEach(async () => {
  await clearRow();
  await putWindows([]); // drops the cached snapshot too
  await clearRow();
});

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'AVAILABILITY_WINDOWS_UPDATED' AND created_at >= $1`, [testStart]);
  await fx.cleanup();
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[childId, parentId].filter(Boolean)]);
  if (!saved) {
    await clearRow();
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [AVAILABILITY_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
});

describe('window arithmetic', () => {
  const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00+05:30`);
  it('is open from the first minute up to, not including, the last; wraps past midnight', () => {
    const w = { from: '06:00', until: '18:00' };
    expect(windowOpenAt(w, at('05:59'))).toBe(false);
    expect(windowOpenAt(w, at('06:00'))).toBe(true);
    expect(windowOpenAt(w, at('17:59'))).toBe(true);
    expect(windowOpenAt(w, at('18:00'))).toBe(false);
    const night = { from: '22:00', until: '02:00' };
    expect(windowOpenAt(night, at('23:30'))).toBe(true);
    expect(windowOpenAt(night, at('01:59'))).toBe(true);
    expect(windowOpenAt(night, at('12:00'))).toBe(false);
  });
  it('writes the hours as people say them', () => {
    expect(windowText({ from: '06:00', until: '18:00' })).toBe('6 am - 6 pm');
    expect(windowText({ from: '09:30', until: '00:00' })).toBe('9:30 am - 12 am');
  });
});

describe('Time-limited products', () => {
  it('with nothing stored: no limits, the product is available as before', async () => {
    const res = await getWindows();
    expect(res.status).toBe(200);
    expect(res.body.data.windows).toEqual([]);
    expect(await customerProduct()).toMatchObject({ available_window: null, window_closed: false, is_available: true });
  });

  it('a shut product window greys the product and priceCart refuses it; open again once the hours cover now', async () => {
    const shut = await putWindows([{ kind: 'PRODUCT', id: productId, from: '13:00', until: '18:00' }]);
    expect(shut.status, JSON.stringify(shut.body)).toBe(200);
    expect(shut.body.data.windows).toEqual([expect.objectContaining({ kind: 'PRODUCT', id: productId, from: '13:00', until: '18:00', open_now: false })]);
    expect(await customerProduct()).toMatchObject({ available_window: { from: '13:00', until: '18:00' }, window_closed: true, is_available: false });
    await expect(priceCart([{ product_id: productId, quantity: 1 }])).rejects.toMatchObject({ code: 'PRODUCT_OUTSIDE_HOURS', statusCode: 400 });

    await putWindows([{ kind: 'PRODUCT', id: productId, from: '09:00', until: '18:00' }]);
    expect(await customerProduct()).toMatchObject({ window_closed: false, is_available: true });
    await expect(priceCart([{ product_id: productId, quantity: 1 }])).resolves.toBeDefined();

    await putWindows([{ kind: 'PRODUCT', id: productId, from: '22:00', until: '13:00' }]); // past midnight, covers noon
    expect(await customerProduct()).toMatchObject({ window_closed: false, is_available: true });
  });

  it('a category window covers its products and its sub-categories; the product\'s own window wins', async () => {
    await putWindows([{ kind: 'CATEGORY', id: categoryId, from: '13:00', until: '18:00' }]);
    expect(await customerProduct()).toMatchObject({ window_closed: true, is_available: false });
    await putWindows([
      { kind: 'CATEGORY', id: categoryId, from: '13:00', until: '18:00' },
      { kind: 'PRODUCT', id: productId, from: '09:00', until: '18:00' },
    ]);
    expect(await customerProduct()).toMatchObject({ available_window: { from: '09:00', until: '18:00' }, window_closed: false });

    // a product in a sub-category follows its main category's window
    await pool.query('UPDATE products SET category_id = $1 WHERE id = $2', [childId, productId]);
    try {
      await putWindows([{ kind: 'CATEGORY', id: parentId, from: '13:00', until: '18:00' }]);
      expect(await customerProduct()).toMatchObject({ window_closed: true });
      await putWindows([
        { kind: 'CATEGORY', id: parentId, from: '13:00', until: '18:00' },
        { kind: 'CATEGORY', id: childId, from: '09:00', until: '18:00' },
      ]);
      expect(await customerProduct()).toMatchObject({ window_closed: false });
    } finally {
      await pool.query('UPDATE products SET category_id = $1 WHERE id = $2', [categoryId, productId]);
    }
  });

  it('is audited, and the list carries names', async () => {
    await putWindows([{ kind: 'CATEGORY', id: childId, from: '06:00', until: '18:00' }]);
    const list = (await getWindows()).body.data.windows;
    expect(list).toEqual([expect.objectContaining({ kind: 'CATEGORY', id: childId, parent_name: expect.stringContaining('AW Parent'), open_now: true })]);
    const audit = (
      await pool.query(
        `SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'AVAILABILITY_WINDOWS_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`,
        [testStart]
      )
    ).rows[0];
    expect(audit.actor_user_id).toBe(users.admin.id);
    expect(audit.new_values.windows).toHaveLength(1);
  });

  it('refuses equal times, bad times, duplicates and things that do not exist', async () => {
    const id = productId;
    expect((await putWindows([{ kind: 'PRODUCT', id, from: '06:00', until: '06:00' }])).status).toBe(400);
    expect((await putWindows([{ kind: 'PRODUCT', id, from: '6am', until: '18:00' }])).status).toBe(400);
    expect((await putWindows([{ kind: 'PRODUCT', id, from: '24:00', until: '18:00' }])).status).toBe(400);
    expect(
      (
        await putWindows([
          { kind: 'PRODUCT', id, from: '06:00', until: '18:00' },
          { kind: 'PRODUCT', id, from: '07:00', until: '19:00' },
        ])
      ).status
    ).toBe(400);
    const ghost = (await putWindows([{ kind: 'PRODUCT', id: '00000000-0000-4000-8000-000000000000', from: '06:00', until: '18:00' }])).body;
    expect(ghost.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await putWindows([{ kind: 'CATEGORY', id: productId, from: '06:00', until: '18:00' }])).body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('Operations may set it; customers may not', async () => {
    expect((await putWindows([], opsToken)).status).toBe(200);
    expect((await getWindows(opsToken)).status).toBe(200);
    expect((await getWindows(customerToken)).status).toBe(403);
    expect((await putWindows([], customerToken)).status).toBe(403);
  });
});
