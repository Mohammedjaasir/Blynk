import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { APP_UPDATES_KEY } from '../src/modules/configuration/app-updates.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * In-app updates for Blynk Ops and Blynk Rider (owner, 2026-10-12): the public
 * GET /app-updates/policy?app=ops|rider (the apps ask on the login screen too)
 * and GET|PATCH /admin/settings/app-updates (Admin + Operations, audited
 * APP_UPDATES_UPDATED). Puts the stored row and its audit entries back.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;
let saved: SavedRow = null;
let testStart: Date;

const policy = (appName: string) => request(app).get(`/api/v1/app-updates/policy?app=${appName}`);
const getSetting = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/app-updates').set(auth(token));
const patchSetting = (body: unknown, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/app-updates').set(auth(token)).send(body as object);

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved =
    (
      await pool.query(
        'SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1',
        [APP_UPDATES_KEY]
      )
    ).rows[0] ?? null;
  await pool.query('DELETE FROM system_configurations WHERE key = $1', [APP_UPDATES_KEY]);
});

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'APP_UPDATES_UPDATED' AND created_at >= $1`, [testStart]);
  if (!saved) {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [APP_UPDATES_KEY]);
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [APP_UPDATES_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
});

describe('Public update policy', () => {
  it('needs no sign-in and returns only the defaults when nothing is stored', async () => {
    for (const name of ['ops', 'rider']) {
      const res = await policy(name);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toEqual({
        success: true,
        data: { app: name, min_version_code: 0, mode: 'optional', notes: '' },
      });
    }
  });

  it('refuses an unknown or missing app', async () => {
    for (const path of ['/api/v1/app-updates/policy', '/api/v1/app-updates/policy?app=customer', '/api/v1/app-updates/policy?app=']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('a malformed stored row falls back to safe values', async () => {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description)
       VALUES ($1, '{"ops":{"min_version_code":-4,"mode":"forced","notes":7},"rider":"x"}'::jsonb, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [APP_UPDATES_KEY]
    );
    expect((await policy('ops')).body.data).toEqual({ app: 'ops', min_version_code: 0, mode: 'optional', notes: '' });
    expect((await policy('rider')).body.data).toEqual({ app: 'rider', min_version_code: 0, mode: 'optional', notes: '' });
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [APP_UPDATES_KEY]);
  });
});

describe('Admin app updates setting', () => {
  it('Admin and Operations read the defaults', async () => {
    for (const token of [tokens.admin, opsToken]) {
      const res = await getSetting(token);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        ops: { min_version_code: 0, mode: 'optional', notes: '' },
        rider: { min_version_code: 0, mode: 'optional', notes: '' },
        updated_at: null,
      });
    }
  });

  it('saves per app (left-out fields keep their value), is audited, and the public policy follows', async () => {
    const first = await patchSetting({ rider: { min_version_code: 5, mode: 'required', notes: '  Faster maps  ' } }, opsToken);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.rider).toEqual({ min_version_code: 5, mode: 'required', notes: 'Faster maps' });
    expect(first.body.data.ops).toEqual({ min_version_code: 0, mode: 'optional', notes: '' });
    expect(first.body.data.updated_at).toBeTruthy();
    expect((await policy('rider')).body.data).toEqual({ app: 'rider', min_version_code: 5, mode: 'required', notes: 'Faster maps' });

    const second = await patchSetting({ ops: { min_version_code: 3 }, rider: { mode: 'optional' } });
    expect(second.status).toBe(200);
    expect(second.body.data.ops).toEqual({ min_version_code: 3, mode: 'optional', notes: '' });
    expect(second.body.data.rider).toEqual({ min_version_code: 5, mode: 'optional', notes: 'Faster maps' });
    expect((await policy('ops')).body.data.min_version_code).toBe(3);

    const audit = (
      await pool.query(
        `SELECT actor_user_id, old_values, new_values FROM audit_logs
          WHERE action = 'APP_UPDATES_UPDATED' AND created_at >= $1 ORDER BY created_at`,
        [testStart]
      )
    ).rows;
    expect(audit).toHaveLength(2);
    expect(audit[0].old_values).toEqual({ key: APP_UPDATES_KEY });
    expect(audit[0].new_values.rider).toEqual({ min_version_code: 5, mode: 'required', notes: 'Faster maps' });
    expect(audit[1].old_values.rider.mode).toBe('required');
    expect(audit[1].new_values.ops.min_version_code).toBe(3);
    expect(audit.every((a) => a.actor_user_id === users.admin.id)).toBe(true);
  });

  it('refuses malformed bodies (strict) and changes nothing', async () => {
    const before = (await getSetting()).body.data;
    const bad = [
      {},
      { ops: { min_version_code: -1 } },
      { ops: { min_version_code: 1.5 } },
      { ops: { min_version_code: '7' } },
      { ops: { min_version_code: 2_100_000_001 } },
      { rider: { mode: 'forced' } },
      { rider: { notes: 'x'.repeat(501) } },
      { rider: { notes: 5 } },
      { customer: { mode: 'required' } },
      { ops: { mode: 'required', url: 'https://evil.example/x.apk' } },
    ];
    for (const body of bad) {
      const res = await patchSetting(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await getSetting()).body.data).toEqual(before);
  });

  it('is Admin and Operations only', async () => {
    for (const token of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await getSetting(token)).status).toBe(403);
      expect((await patchSetting({ ops: { mode: 'required' } }, token)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/settings/app-updates')).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/settings/app-updates').send({ ops: { mode: 'required' } })).status).toBe(401);
  });
});

describe('automatic update mode (owner, 2026-10-22: update by itself when the app is opened)', () => {
  it('can be saved per app, is returned by the public policy, and an unknown mode still reads as optional', async () => {
    const res = await patchSetting({ ops: { mode: 'automatic' }, rider: { mode: 'automatic', notes: 'New deliveries alerts' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.ops.mode).toBe('automatic');
    expect((await policy('rider')).body.data).toMatchObject({ app: 'rider', mode: 'automatic', notes: 'New deliveries alerts' });
    // a mode the server does not know is refused...
    expect((await patchSetting({ ops: { mode: 'sometimes' } })).status).toBe(400);
    // ...and one that somehow got stored reads as optional
    await pool.query(`UPDATE system_configurations SET value = jsonb_set(value, '{ops,mode}', '"sometimes"') WHERE key = $1`, [APP_UPDATES_KEY]);
    expect((await policy('ops')).body.data.mode).toBe('optional');
  });
});
