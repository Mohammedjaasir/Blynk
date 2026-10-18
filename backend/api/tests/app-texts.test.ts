import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { APP_TEXTS_KEY, appTextsFrom, DEFAULT_APP_TEXTS } from '../src/modules/configuration/app-texts.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * App texts (owner, 2026-10-18: "make sure each and everything was editable
 * from the admin"). GET|PATCH /admin/settings/app-texts for Admin and
 * Operations (audited APP_TEXTS_UPDATED); GET /store `app_texts` carries only
 * what is set. The stored row and the audit entries are put back afterwards.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const inventoryToken = generateAccessToken({ ...users.admin, role: 'INVENTORY' as never });
const CAT = '11111111-2222-4333-8444-555555555555';

type SavedRow = { value: unknown; description: string | null } | null;
let saved: SavedRow = null;
let testStart: Date;

const getTexts = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/app-texts').set(auth(token));
const patchTexts = (body: unknown, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/app-texts').set(auth(token)).send(body as object);
const publicTexts = async () => (await request(app).get('/api/v1/store')).body.data.app_texts;
const clearRow = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [APP_TEXTS_KEY]);

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT value, description FROM system_configurations WHERE key = $1', [APP_TEXTS_KEY])).rows[0] ?? null;
});

beforeEach(clearRow);

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'APP_TEXTS_UPDATED' AND created_at >= $1`, [testStart]);
  await clearRow();
  if (saved) {
    await pool.query('INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, $3)', [
      APP_TEXTS_KEY,
      JSON.stringify(saved.value),
      saved.description,
    ]);
  }
});

describe('app texts', () => {
  it('no row: staff see the blank defaults; customers get an empty object (the app keeps its own words)', async () => {
    const res = await getTexts();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ...DEFAULT_APP_TEXTS, updated_at: null });
    expect(await publicTexts()).toEqual({});
  });

  it('Ops sets some words, a list, the Under amount and an aisle colour; customers get exactly those', async () => {
    const res = await patchTexts(
      {
        cart_header_pill: '  Weekend specials  ',
        home_aisle_lines: ['Fresh daily', 'Local picks'],
        home_under_amount: 500,
        aisle_colors: { [CAT]: '#FFEEDD' },
      },
      opsToken
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.cart_header_pill).toBe('Weekend specials');
    expect(await publicTexts()).toEqual({
      cart_header_pill: 'Weekend specials',
      home_aisle_lines: ['Fresh daily', 'Local picks'],
      home_under_amount: 500,
      aisle_colors: { [CAT]: '#FFEEDD' },
    });

    // a later PATCH keeps the rest; '' puts a word back to the app's own
    await patchTexts({ placed_title: 'Got it!', cart_header_pill: '' });
    expect(await publicTexts()).toEqual({
      placed_title: 'Got it!',
      home_aisle_lines: ['Fresh daily', 'Local picks'],
      home_under_amount: 500,
      aisle_colors: { [CAT]: '#FFEEDD' },
    });
    const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'APP_TEXTS_UPDATED' AND created_at >= $1`, [testStart]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('surface colours: set, served upper-case, and cleared with ""', async () => {
    expect((await patchTexts({ hero_bg_top: '#112233', cart_bar_bg: '#ffe141' })).status).toBe(200);
    expect(await publicTexts()).toEqual({ hero_bg_top: '#112233', cart_bar_bg: '#FFE141' });
    await patchTexts({ hero_bg_top: '' });
    expect(await publicTexts()).toEqual({ cart_bar_bg: '#FFE141' });
  });

  it('refuses bad input and other roles', async () => {
    expect((await patchTexts({ cart_bar_line: 'x'.repeat(37) })).status).toBe(400);
    expect((await patchTexts({ placed_title: 'two\nlines' })).status).toBe(400);
    expect((await patchTexts({ home_under_amount: 10 })).status).toBe(400);
    expect((await patchTexts({ aisle_colors: { [CAT]: 'red' } })).status).toBe(400);
    expect((await patchTexts({ cart_bar_bg: 'yellow' })).status).toBe(400);
    expect((await patchTexts({ unknown_field: 'x' })).status).toBe(400);
    expect((await patchTexts({})).status).toBe(400);
    expect((await patchTexts({ cart_bar_line: 'ok' }, inventoryToken)).status).toBe(403);
    expect((await getTexts(inventoryToken)).status).toBe(403);
  });

  it('a malformed stored field falls back to its default; the rest are kept', () => {
    const s = appTextsFrom({ cart_bar_line: 'Hello', placed_title: 42, aisle_colors: 'x' });
    expect(s.cart_bar_line).toBe('Hello');
    expect(s.placed_title).toBe('');
    expect(s.aisle_colors).toEqual({});
  });
});
