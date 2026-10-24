import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { HOME_SECTIONS_KEY, sectionStatus } from '../src/modules/configuration/home-sections.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Home sections (owner's brother, 2026-10-24): GET|PUT /admin/settings/home-sections for Admin and
 * Operations; GET /store carries only the LIVE sections as `home_sections`. The ordering clock is
 * pinned to 2026-10-06T06:30Z (tests/setup/ordering-clock.ts) = 12:00 in Colombo, so schedules are
 * written around that day. The stored row, the fixtures and the audit entries are put back.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const fx = stockFixtures(app, 'HS-');

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;
let saved: SavedRow = null;
let testStart: Date;
let p1 = '';
let p2 = '';
let p3 = '';
let catId = '';
let catSlug = '';
let offCatId = '';
const stamp = Date.now();

const put = (sections: unknown, token = tokens.admin) =>
  request(app).put('/api/v1/admin/settings/home-sections').set(auth(token)).send({ sections } as object);
const get = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/home-sections').set(auth(token));
const publicSections = async () => (await request(app).get('/api/v1/store')).body.data.home_sections;
const clearRow = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [HOME_SECTIONS_KEY]);

const byCategory = (extra: Record<string, unknown> = {}) => ({
  title: 'Fresh juices',
  subtitle: 'Cold and ready until 6 pm',
  source: { kind: 'CATEGORY', category_id: catId },
  is_active: true,
  starts_at: null,
  ends_at: null,
  show_countdown: false,
  max_items: 8,
  ...extra,
});
const byProducts = (ids: string[], extra: Record<string, unknown> = {}) =>
  byCategory({ title: 'Weekend offers', subtitle: null, source: { kind: 'PRODUCTS', product_ids: ids }, ...extra });

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved =
    (await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [HOME_SECTIONS_KEY])).rows[0] ??
    null;
  await fx.setup();
  p1 = (await fx.product({ tracked: false })).productId;
  p2 = (await fx.product({ tracked: false })).productId;
  p3 = (await fx.product({ tracked: false })).productId;
  catSlug = `hs-cat-${stamp}`;
  catId = (await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`HS Juices ${stamp}`, catSlug])).rows[0].id;
  offCatId = (await pool.query(`INSERT INTO categories (name, slug, is_active) VALUES ($1, $2, false) RETURNING id`, [`HS Off ${stamp}`, `hs-off-${stamp}`])).rows[0].id;
  await clearRow();
});

afterEach(async () => {
  await clearRow();
});

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'HOME_SECTIONS_UPDATED' AND created_at >= $1`, [testStart]);
  await fx.cleanup();
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[catId, offCatId].filter(Boolean)]);
  if (!saved) {
    await clearRow();
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [HOME_SECTIONS_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
});

describe('section status', () => {
  const at = new Date('2026-10-06T12:00:00+05:30');
  it('is OFF when switched off, else by the schedule', () => {
    const base = { is_active: true, starts_at: null, ends_at: null };
    expect(sectionStatus(base, at)).toBe('LIVE');
    expect(sectionStatus({ ...base, is_active: false }, at)).toBe('OFF');
    expect(sectionStatus({ ...base, starts_at: '2026-10-06T12:00:01+05:30' }, at)).toBe('SCHEDULED');
    expect(sectionStatus({ ...base, starts_at: '2026-10-06T12:00:00+05:30' }, at)).toBe('LIVE');
    expect(sectionStatus({ ...base, ends_at: '2026-10-06T12:00:00+05:30' }, at)).toBe('ENDED');
    expect(sectionStatus({ ...base, ends_at: '2026-10-06T12:00:01+05:30' }, at)).toBe('LIVE');
  });
});

describe('Home sections', () => {
  it('with nothing stored: no sections, and /store says []', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.sections).toEqual([]);
    expect(await publicSections()).toEqual([]);
  });

  it('saves in order, assigns ids, names the source, and /store gets the live ones', async () => {
    const res = await put([byCategory(), byProducts([p2, p1], { show_countdown: true, ends_at: '2026-10-06T18:00:00+05:30' })]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [a, b] = res.body.data.sections;
    expect(a).toMatchObject({ title: 'Fresh juices', subtitle: 'Cold and ready until 6 pm', status: 'LIVE', source_name: `HS Juices ${stamp}`, max_items: 8 });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatchObject({ title: 'Weekend offers', subtitle: null, status: 'LIVE', source_name: '2 products', show_countdown: true, ends_at: '2026-10-06T18:00:00+05:30' });
    expect(b.products.map((p: { id: string }) => p.id)).toEqual([p2, p1]);

    // a second save keeps the ids that are sent back, and the order
    const again = await put([{ ...b }, { ...a }].map(({ status: _s, source_name: _n, products: _p, ...s }) => s));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.data.sections.map((s: { id: string }) => s.id)).toEqual([b.id, a.id]);

    expect(await publicSections()).toEqual([
      { id: b.id, title: 'Weekend offers', subtitle: null, ends_at: '2026-10-06T18:00:00+05:30', show_countdown: true, max_items: 8, category: null, product_ids: [p2, p1] },
      { id: a.id, title: 'Fresh juices', subtitle: 'Cold and ready until 6 pm', ends_at: null, show_countdown: false, max_items: 8, category: { id: catId, slug: catSlug }, product_ids: null },
    ]);
  });

  it('shows only what is LIVE: not switched off, not scheduled for later, not ended', async () => {
    const res = await put([
      byCategory({ title: 'Switched off', is_active: false }),
      byCategory({ title: 'Starts later', starts_at: '2026-10-06T13:00:00+05:30' }),
      byCategory({ title: 'Already over', ends_at: '2026-10-06T11:00:00+05:30' }),
      byCategory({ title: 'On now', starts_at: '2026-10-06T09:00:00+05:30', ends_at: '2026-10-06T18:00:00+05:30' }),
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.sections.map((s: { status: string }) => s.status)).toEqual(['OFF', 'SCHEDULED', 'ENDED', 'LIVE']);
    expect((await publicSections()).map((s: { title: string }) => s.title)).toEqual(['On now']);
  });

  it('keeps times in the store zone whatever offset was sent, and leaves out a category that is switched off', async () => {
    const res = await put([byCategory({ ends_at: '2026-10-06T12:30:00.000Z' }), byCategory({ title: 'Hidden aisle', source: { kind: 'CATEGORY', category_id: offCatId } })]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.sections[0].ends_at).toBe('2026-10-06T18:00:00+05:30');
    expect((await publicSections()).map((s: { title: string }) => s.title)).toEqual(['Fresh juices']);
  });

  it('is audited', async () => {
    await put([byCategory()]);
    const audit = (
      await pool.query(
        `SELECT actor_user_id, new_values FROM audit_logs WHERE action = 'HOME_SECTIONS_UPDATED' AND created_at >= $1 ORDER BY created_at DESC LIMIT 1`,
        [testStart]
      )
    ).rows[0];
    expect(audit.actor_user_id).toBe(users.admin.id);
    expect(audit.new_values.sections).toHaveLength(1);
  });

  it('refuses what cannot work', async () => {
    const bad = async (sections: unknown) => (await put(sections)).status;
    expect(await bad([byCategory({ title: 'A' })])).toBe(400);
    expect(await bad([byCategory({ title: 'x'.repeat(29) })])).toBe(400);
    expect(await bad([byCategory({ title: 'Two\nlines' })])).toBe(400);
    expect(await bad([byCategory({ subtitle: 'y'.repeat(41) })])).toBe(400);
    expect(await bad([byCategory({ max_items: 3 })])).toBe(400);
    expect(await bad([byCategory({ max_items: 13 })])).toBe(400);
    expect(await bad([byCategory({ starts_at: 'tomorrow' })])).toBe(400);
    expect(await bad([byCategory({ show_countdown: true })])).toBe(400); // a countdown needs an end
    expect(await bad([byCategory({ starts_at: '2026-10-06T18:00:00+05:30', ends_at: '2026-10-06T18:00:00+05:30' })])).toBe(400);
    expect(await bad([byCategory({ starts_at: '2026-10-07T18:00:00+05:30', ends_at: '2026-10-06T18:00:00+05:30' })])).toBe(400);
    expect(await bad([byProducts([])])).toBe(400);
    expect(await bad([byProducts([p1, p1])])).toBe(400);
    expect(await bad([byProducts(Array.from({ length: 13 }, () => p1))])).toBe(400);
    expect(await bad(Array.from({ length: 9 }, () => byCategory()))).toBe(400);
    const id = '11111111-1111-4111-8111-111111111111';
    expect(await bad([byCategory({ id }), byCategory({ id })])).toBe(400);
    expect(await bad([{ ...byCategory(), surprise: 1 }])).toBe(400);
    expect((await get()).body.data.sections).toEqual([]); // nothing was stored by the refusals
  });

  it('refuses a category or product that does not exist', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const c = await put([byCategory({ source: { kind: 'CATEGORY', category_id: ghost } })]);
    expect(c.status).toBe(400);
    expect(c.body.error.code).toBe('CATEGORY_NOT_FOUND');
    const p = await put([byProducts([p1, ghost])]);
    expect(p.status).toBe(400);
    expect(p.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await put([byProducts([p1, p2, p3])])).status).toBe(200);
  });

  it('Operations may set it; customers and anonymous callers may not', async () => {
    expect((await put([], opsToken)).status).toBe(200);
    expect((await get(opsToken)).status).toBe(200);
    expect((await get(tokens.customer)).status).toBe(403);
    expect((await put([], tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/home-sections')).status).toBe(401);
  });
});
