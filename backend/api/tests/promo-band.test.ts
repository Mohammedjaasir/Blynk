import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import {
  DEFAULT_PROMO_BAND,
  PROMO_BAND_KEY,
  autoTextColor,
  promoBandFrom,
  readableTextColors,
} from '../src/modules/configuration/promo-band.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Home promo band (owner, 2026-10-14: "make sure promotional banner edit
 * option like this animation in the ops and admin"). GET|PATCH
 * /admin/settings/promo-band for Admin and Operations (audited
 * PROMO_BAND_UPDATED); GET /store carries the band as the app draws it, or
 * null while off / outside its schedule. The checkout clock is pinned to
 * 2026-10-06T06:30Z (tests/setup/ordering-clock.ts), so schedules are
 * written around that instant. The stored row, the fixtures and the audit
 * entries are put back afterwards.
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
let offCategorySlug = '';
let offCategoryId = '';

const getBand = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/promo-band').set(auth(token));
const patchBand = (body: unknown, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/promo-band').set(auth(token)).send(body as object);
const publicBand = async () => (await request(app).get('/api/v1/store')).body.data.promo_band;
const clearRow = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [PROMO_BAND_KEY]);

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved =
    (
      await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [
        PROMO_BAND_KEY,
      ])
    ).rows[0] ?? null;
  const on = (
    await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id, slug`, [`PB Cat ${stamp}`, `pb-cat-${stamp}`])
  ).rows[0];
  categoryId = on.id;
  categorySlug = on.slug;
  const off = (
    await pool.query(`INSERT INTO categories (name, slug, is_active) VALUES ($1, $2, false) RETURNING id, slug`, [
      `PB Off ${stamp}`,
      `pb-off-${stamp}`,
    ])
  ).rows[0];
  offCategoryId = off.id;
  offCategorySlug = off.slug;
});

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'PROMO_BAND_UPDATED' AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[categoryId, offCategoryId].filter(Boolean)]);
  if (!saved) {
    await clearRow();
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [PROMO_BAND_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
});

describe('Promo band setting', () => {
  beforeEach(clearRow);

  it('with nothing stored: the defaults (today\'s band), live, and GET /store serves it', async () => {
    const res = await getBand(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ...DEFAULT_PROMO_BAND, cta_target: null, status: 'LIVE', updated_at: null });
    expect(await publicBand()).toEqual({
      lines: [],
      ticks: [],
      background: 'YELLOW',
      colors: { start: '#FFE141', end: '#F2C600', text: '#1A1D2E' },
      item: { kind: 'NONE', illustration: null, image_url: null },
      mascot: 'WAVE',
      cta_target: null,
      ends_at: null,
    });
  });

  it('a malformed stored row also means the defaults', async () => {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, '{"background":"PINK","lines":"x"}'::jsonb, 'test')`,
      [PROMO_BAND_KEY]
    );
    expect((await getBand()).body.data.background).toBe('YELLOW');
    expect(promoBandFrom('nonsense')).toEqual(DEFAULT_PROMO_BAND);
  });

  it('Operations saves headlines, points, colours, item, mascot and link; audited; GET /store follows', async () => {
    const res = await patchBand(
      {
        lines: ['  Fresh bread every morning ', 'Free delivery today'],
        ticks: ['No Platform Fee'],
        background: 'INK',
        text_color: 'YELLOW',
        item_kind: 'ILLUSTRATED',
        item_illustration: 'bread',
        mascot: 'RIDE',
        cta_destination_type: 'CATEGORY',
        cta_destination_value: categoryId, // an id is stored as the slug
      },
      opsToken
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      lines: ['Fresh bread every morning', 'Free delivery today'],
      cta_destination_value: categorySlug,
      cta_target: expect.objectContaining({ level: 'CATEGORY', slug: categorySlug }),
      status: 'LIVE',
    });
    expect(res.body.data.updated_at).not.toBeNull();

    expect(await publicBand()).toEqual({
      lines: ['Fresh bread every morning', 'Free delivery today'],
      ticks: ['No Platform Fee'],
      background: 'INK',
      colors: { start: '#1A1D2E', end: '#2A2E45', text: '#FFE141' },
      item: { kind: 'ILLUSTRATED', illustration: 'bread', image_url: null },
      mascot: 'RIDE',
      cta_target: expect.objectContaining({ level: 'CATEGORY', slug: categorySlug, is_active: true }),
      ends_at: null,
    });

    const audit = (
      await pool.query(
        `SELECT actor_user_id, old_values, new_values FROM audit_logs WHERE action = 'PROMO_BAND_UPDATED' AND created_at >= $1
         ORDER BY created_at DESC LIMIT 1`,
        [testStart]
      )
    ).rows[0];
    expect(audit.actor_user_id).toBe(users.admin.id);
    expect(audit.old_values).toEqual({ key: PROMO_BAND_KEY });
    expect(audit.new_values).toMatchObject({ key: PROMO_BAND_KEY, background: 'INK', mascot: 'RIDE' });
  });

  it('a PATCH changes only what it sends', async () => {
    expect((await patchBand({ lines: ['1'] })).status).toBe(400); // too short
    expect((await patchBand({ lines: ['Weekend deals'], mascot: 'OFF' })).status).toBe(200);
    const res = await patchBand({ background: 'CREAM' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ lines: ['Weekend deals'], mascot: 'OFF', background: 'CREAM' });
  });

  it('refuses unreadable colours, palette escapes, missing item details and bad schedules', async () => {
    const white = await patchBand({ background: 'YELLOW', text_color: 'WHITE' });
    expect(white.status).toBe(400);
    expect(white.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(white.body.error.details)).toContain('hard to read');

    expect((await patchBand({ background: '#FF00FF' })).status).toBe(400);
    expect((await patchBand({ item_kind: 'ILLUSTRATED' })).status).toBe(400);
    expect((await patchBand({ item_kind: 'ILLUSTRATED', item_illustration: 'pizza' })).status).toBe(400);
    expect((await patchBand({ item_kind: 'IMAGE' })).status).toBe(400);
    expect((await patchBand({ item_kind: 'IMAGE', item_image_url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await patchBand({ lines: ['a'.repeat(45)] })).status).toBe(400);
    expect((await patchBand({ lines: ['one!', 'two!', 'three', 'four!', 'five!', 'six!!'] })).status).toBe(400);
    expect((await patchBand({ ticks: ['aa', 'bb', 'cc', 'dd'] })).status).toBe(400);
    expect(
      (await patchBand({ starts_at: '2026-10-08T00:00:00+05:30', ends_at: '2026-10-07T00:00:00+05:30' })).status
    ).toBe(400);
    expect((await patchBand({ starts_at: 'tomorrow' })).status).toBe(400);
    expect((await patchBand({ cta_destination_type: 'PRODUCT' })).status).toBe(400);
    expect((await patchBand({ unknown_field: true })).status).toBe(400);
    expect((await patchBand({})).status).toBe(400);

    const missing = await patchBand({ cta_destination_type: 'CATEGORY', cta_destination_value: 'no-such-category-pb' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVALID_PROMOTION_TARGET');

    // nothing was stored by any refused request
    expect((await getBand()).body.data.updated_at).toBeNull();
  });

  it('the image item is served only while the item kind is IMAGE', async () => {
    const url = 'https://cdn.example.com/promotions/bread.png';
    expect((await patchBand({ item_kind: 'IMAGE', item_image_url: url })).status).toBe(200);
    expect((await publicBand()).item).toEqual({ kind: 'IMAGE', illustration: null, image_url: url });
    expect((await patchBand({ item_kind: 'NONE' })).status).toBe(200);
    expect((await publicBand()).item).toEqual({ kind: 'NONE', illustration: null, image_url: null });
    // the upload is kept for switching back
    expect((await getBand()).body.data.item_image_url).toBe(url);
  });

  it('off, scheduled and ended bands are not served to customers', async () => {
    expect((await patchBand({ enabled: false })).body.data.status).toBe('OFF');
    expect(await publicBand()).toBeNull();

    const later = await patchBand({ enabled: true, starts_at: '2026-10-07T00:00:00Z', ends_at: null });
    expect(later.body.data.status).toBe('SCHEDULED');
    expect(await publicBand()).toBeNull();

    const ended = await patchBand({ starts_at: null, ends_at: '2026-10-06T06:00:00Z' });
    expect(ended.body.data.status).toBe('ENDED');
    expect(await publicBand()).toBeNull();

    const live = await patchBand({ starts_at: '2026-10-01T00:00:00+05:30', ends_at: '2026-10-31T00:00:00+05:30' });
    expect(live.body.data.status).toBe('LIVE');
    expect((await publicBand()).ends_at).toBe('2026-10-31T00:00:00+05:30');
  });

  it('a switched-off target is kept for staff but not linked for customers', async () => {
    const res = await patchBand({ cta_destination_type: 'CATEGORY', cta_destination_value: offCategorySlug });
    expect(res.status).toBe(200);
    expect(res.body.data.cta_target).toMatchObject({ slug: offCategorySlug, is_active: false });
    expect((await publicBand()).cta_target).toBeNull();
    // the whole catalog is always a valid link
    expect((await patchBand({ cta_destination_type: 'CATALOG', cta_destination_value: null })).status).toBe(200);
    expect((await publicBand()).cta_target).toMatchObject({ level: 'CATALOG' });
  });

  it('only Admin and Operations may read or change it', async () => {
    expect((await request(app).get('/api/v1/admin/settings/promo-band')).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/settings/promo-band').send({ enabled: false })).status).toBe(401);
    for (const token of [tokens.customer, tokens.rider, tokens.staff, inventoryToken]) {
      expect((await getBand(token)).status).toBe(403);
      expect((await patchBand({ enabled: false }, token)).status).toBe(403);
    }
    expect((await getBand()).body.data.enabled).toBe(true);
  });
});

describe('Promo band palette rules', () => {
  it('only AA-readable text colours are offered per background; automatic picks the most readable', () => {
    expect(readableTextColors('YELLOW')).toEqual(['INK']);
    expect(readableTextColors('INK')).toEqual(['WHITE', 'YELLOW']);
    expect(readableTextColors('GREEN')).toEqual(['WHITE']);
    expect(readableTextColors('WHITE')).toEqual(['INK', 'BROWN', 'GREEN']);
    expect(autoTextColor('YELLOW')).toBe('INK');
    expect(autoTextColor('INK')).toBe('WHITE');
  });
});
