import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { DEFAULT_HERO_BANNER, HERO_BANNER_KEY, heroBannerFrom } from '../src/modules/configuration/hero-banner.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Home hero banner (the purple banner at the top of the customer app's Home).
 * GET|PATCH /admin/settings/hero-banner for Admin and Operations (audited
 * HERO_BANNER_UPDATED); GET /store carries the custom banner while it is live,
 * or null (AUTO / outside its schedule) = the app's automatic banner. The
 * checkout clock is pinned to 2026-10-06T06:30Z (tests/setup/ordering-clock.ts),
 * so schedules are written around that instant. The stored row, the fixtures
 * and the audit entries are put back afterwards.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const inventoryToken = generateAccessToken({ ...users.admin, role: 'INVENTORY' as never });
const stamp = Date.now();

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;
let saved: SavedRow = null;
let testStart: Date;
let categoryId = '';
let categorySlug = '';
let offCategoryId = '';
let offCategorySlug = '';

const getHero = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/hero-banner').set(auth(token));
const patchHero = (body: unknown, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/hero-banner').set(auth(token)).send(body as object);
const publicHero = async () => (await request(app).get('/api/v1/store')).body.data.hero_banner;
const clearRow = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [HERO_BANNER_KEY]);

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved =
    (
      await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [
        HERO_BANNER_KEY,
      ])
    ).rows[0] ?? null;
  const on = (
    await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id, slug`, [`HB Cat ${stamp}`, `hb-cat-${stamp}`])
  ).rows[0];
  categoryId = on.id;
  categorySlug = on.slug;
  const off = (
    await pool.query(`INSERT INTO categories (name, slug, is_active) VALUES ($1, $2, false) RETURNING id, slug`, [
      `HB Off ${stamp}`,
      `hb-off-${stamp}`,
    ])
  ).rows[0];
  offCategoryId = off.id;
  offCategorySlug = off.slug;
});

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'HERO_BANNER_UPDATED' AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[categoryId, offCategoryId].filter(Boolean)]);
  if (!saved) {
    await clearRow();
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [HERO_BANNER_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
});

describe('Hero banner setting', () => {
  beforeEach(clearRow);

  it('with nothing stored: AUTO (today\'s banner) and GET /store serves null', async () => {
    const res = await getHero(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ...DEFAULT_HERO_BANNER, cta_target: null, status: 'AUTO', updated_at: null });
    expect(DEFAULT_HERO_BANNER.mode).toBe('AUTO');
    expect(await publicHero()).toBeNull();
  });

  it('a malformed stored row also means the defaults', async () => {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, '{"mode":"CUSTOM","items":[]}'::jsonb, 'test')`,
      [HERO_BANNER_KEY]
    );
    expect((await getHero()).body.data.mode).toBe('AUTO');
    expect(await publicHero()).toBeNull();
    expect(heroBannerFrom('nonsense')).toEqual(DEFAULT_HERO_BANNER);
  });

  it('Operations saves a custom banner; audited; GET /store follows', async () => {
    const res = await patchHero(
      {
        mode: 'CUSTOM',
        title_1: ' weekend ',
        title_2: 'Deals',
        lines: ['Up to 20% off rice', 'Groceries starting at {min_price}', 'First {free_count} deliveries free'],
        cta_label: 'Shop rice',
        cta_destination_type: 'CATEGORY',
        cta_destination_value: categoryId, // an id is stored as the slug
        items: ['milk', 'bread'],
      },
      opsToken
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      mode: 'CUSTOM',
      title_1: 'WEEKEND',
      title_2: 'DEALS',
      cta_label: 'SHOP RICE',
      cta_destination_value: categorySlug,
      cta_target: expect.objectContaining({ level: 'CATEGORY', slug: categorySlug }),
      status: 'LIVE',
    });
    expect(res.body.data.updated_at).not.toBeNull();

    expect(await publicHero()).toEqual({
      mode: 'CUSTOM',
      title: ['WEEKEND', 'DEALS'],
      lines: ['Up to 20% off rice', 'Groceries starting at {min_price}', 'First {free_count} deliveries free'],
      cta_label: 'SHOP RICE',
      cta_target: expect.objectContaining({ level: 'CATEGORY', slug: categorySlug, is_active: true }),
      items: ['milk', 'bread'],
      ends_at: null,
    });

    const audit = (
      await pool.query(
        `SELECT actor_user_id, old_values, new_values FROM audit_logs WHERE action = 'HERO_BANNER_UPDATED' AND created_at >= $1
         ORDER BY created_at DESC LIMIT 1`,
        [testStart]
      )
    ).rows[0];
    expect(audit.actor_user_id).toBe(users.admin.id);
    expect(audit.old_values).toEqual({ key: HERO_BANNER_KEY });
    expect(audit.new_values).toMatchObject({ key: HERO_BANNER_KEY, mode: 'CUSTOM', title_1: 'WEEKEND' });
  });

  it('a PATCH changes only what it sends; back to AUTO keeps the custom words for later', async () => {
    expect((await patchHero({ mode: 'CUSTOM', title_1: 'Big' })).status).toBe(200);
    const res = await patchHero({ lines: ['Fresh fish today'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mode: 'CUSTOM', title_1: 'BIG', title_2: 'GROCERIES', lines: ['Fresh fish today'] });
    const auto = await patchHero({ mode: 'AUTO' });
    expect(auto.body.data).toMatchObject({ mode: 'AUTO', status: 'AUTO', title_1: 'BIG' });
    expect(await publicHero()).toBeNull();
  });

  it('refuses words that do not fit, unknown tokens, bad items and schedules', async () => {
    const long = await patchHero({ title_1: 'A'.repeat(13) });
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('VALIDATION_ERROR');
    expect((await patchHero({ title_2: '' })).status).toBe(400);
    expect((await patchHero({ title_1: 'TWO\nLINES' })).status).toBe(400);
    expect((await patchHero({ lines: [] })).status).toBe(400);
    expect((await patchHero({ lines: ['a'.repeat(41)] })).status).toBe(400);
    expect((await patchHero({ lines: ['one!', 'two!', 'three', 'four!', 'five!'] })).status).toBe(400);
    const token = await patchHero({ lines: ['From {price}'] });
    expect(token.status).toBe(400);
    expect(JSON.stringify(token.body.error.details)).toContain('Unknown token {price}');
    expect((await patchHero({ cta_label: 'X'.repeat(17) })).status).toBe(400);
    expect((await patchHero({ cta_label: '  ' })).status).toBe(400);
    expect((await patchHero({ items: [] })).status).toBe(400);
    expect((await patchHero({ items: ['pizza'] })).status).toBe(400);
    expect((await patchHero({ items: ['milk', 'milk'] })).status).toBe(400);
    expect((await patchHero({ mode: 'MAYBE' })).status).toBe(400);
    expect((await patchHero({ background: '#FF00FF' })).status).toBe(400); // no colour fields
    expect(
      (await patchHero({ starts_at: '2026-10-08T00:00:00+05:30', ends_at: '2026-10-07T00:00:00+05:30' })).status
    ).toBe(400);
    expect((await patchHero({ starts_at: 'tomorrow' })).status).toBe(400);
    expect((await patchHero({ cta_destination_type: 'PRODUCT' })).status).toBe(400);
    expect((await patchHero({})).status).toBe(400);
    const missing = await patchHero({ cta_destination_type: 'CATEGORY', cta_destination_value: 'no-such-category-hb' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVALID_PROMOTION_TARGET');

    // nothing was stored by any refused request
    expect((await getHero()).body.data.updated_at).toBeNull();
  });

  it('outside its schedule the app falls back to AUTO', async () => {
    const later = await patchHero({ mode: 'CUSTOM', starts_at: '2026-10-07T00:00:00Z' });
    expect(later.body.data.status).toBe('SCHEDULED');
    expect(await publicHero()).toBeNull();

    const ended = await patchHero({ starts_at: null, ends_at: '2026-10-06T06:00:00Z' });
    expect(ended.body.data.status).toBe('ENDED');
    expect(await publicHero()).toBeNull();

    const live = await patchHero({ starts_at: '2026-10-01T00:00:00+05:30', ends_at: '2026-10-31T00:00:00+05:30' });
    expect(live.body.data.status).toBe('LIVE');
    expect((await publicHero()).ends_at).toBe('2026-10-31T00:00:00+05:30');
  });

  it('a switched-off target is kept for staff; customers get the app\'s own button', async () => {
    const res = await patchHero({ mode: 'CUSTOM', cta_destination_type: 'CATEGORY', cta_destination_value: offCategorySlug });
    expect(res.status).toBe(200);
    expect(res.body.data.cta_target).toMatchObject({ slug: offCategorySlug, is_active: false });
    expect((await publicHero()).cta_target).toBeNull();
    expect((await patchHero({ cta_destination_type: 'CATALOG', cta_destination_value: null })).status).toBe(200);
    expect((await publicHero()).cta_target).toMatchObject({ level: 'CATALOG' });
  });

  it('only Admin and Operations may read or change it', async () => {
    expect((await request(app).get('/api/v1/admin/settings/hero-banner')).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/settings/hero-banner').send({ mode: 'CUSTOM' })).status).toBe(401);
    for (const token of [tokens.customer, tokens.rider, tokens.staff, inventoryToken]) {
      expect((await getHero(token)).status).toBe(403);
      expect((await patchHero({ mode: 'CUSTOM' }, token)).status).toBe(403);
    }
    expect((await getHero()).body.data.mode).toBe('AUTO');
  });
});
