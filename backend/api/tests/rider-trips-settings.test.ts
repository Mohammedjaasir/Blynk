import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { getBatchingRules, RIDER_BATCHING_KEY } from '../src/modules/riders/batching.js';
import { tokens, auth, users } from './helpers/stock.js';
import { withRiderTripRules } from './helpers/rider-trips.js';

/**
 * Rider trips settings (owner, 2026-10-10: "ops can control the 2 orders for
 * one delivery if it's in the same route"): GET/PATCH
 * /admin/settings/rider-trips edits the rules ASSIGN_RIDER applies
 * (riders/batching.ts). Admin and Operations; audited. The stored row is put
 * back afterwards (withRiderTripRules) with the audit entries this file wrote.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
let testStart: Date;

const get = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/rider-trips').set(auth(token));
const patch = (body: unknown, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/rider-trips').set(auth(token)).send(body as object);

withRiderTripRules();

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
});

afterAll(async () => {
  await pool.query(`DELETE FROM audit_logs WHERE action = 'RIDER_TRIPS_UPDATED' AND created_at >= $1`, [testStart]);
});

describe('Rider trips settings', () => {
  it('shows the defaults (2 orders, 1.5 km) when nothing is stored', async () => {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [RIDER_BATCHING_KEY]);
    const res = await get(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5, updated_at: null });
  });

  it('Operations and Admin change it, audited; only the fields sent change; ASSIGN_RIDER reads it', async () => {
    const one = await patch({ max_active_deliveries: 3 }, opsToken);
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.data).toMatchObject({ max_active_deliveries: 3, max_dropoff_distance_km: 1.5 });
    expect(one.body.data.updated_at).toBeTruthy();

    const two = await patch({ max_dropoff_distance_km: 2.5 });
    expect(two.status).toBe(200);
    expect(two.body.data).toMatchObject({ max_active_deliveries: 3, max_dropoff_distance_km: 2.5 });
    expect(await getBatchingRules()).toEqual({ max_active_deliveries: 3, max_dropoff_distance_km: 2.5 });

    // 1 = no trips: one order per rider.
    const off = await patch({ max_active_deliveries: 1, max_dropoff_distance_km: 0.5 }, opsToken);
    expect(off.status).toBe(200);
    expect(await getBatchingRules()).toEqual({ max_active_deliveries: 1, max_dropoff_distance_km: 0.5 });
    expect((await get()).body.data).toMatchObject({ max_active_deliveries: 1, max_dropoff_distance_km: 0.5 });

    const audit = (
      await pool.query(
        `SELECT actor_user_id, old_values, new_values FROM audit_logs
          WHERE action = 'RIDER_TRIPS_UPDATED' AND created_at >= $1 ORDER BY created_at`,
        [testStart]
      )
    ).rows;
    expect(audit).toHaveLength(3);
    // The first change had no stored row: the old values are just the key.
    expect(audit[0].old_values).toEqual({ key: RIDER_BATCHING_KEY });
    expect(audit[0].new_values).toEqual({ key: RIDER_BATCHING_KEY, max_active_deliveries: 3, max_dropoff_distance_km: 1.5 });
    expect(audit[1].old_values).toEqual({ key: RIDER_BATCHING_KEY, max_active_deliveries: 3, max_dropoff_distance_km: 1.5 });
    expect(audit[2].new_values).toEqual({ key: RIDER_BATCHING_KEY, max_active_deliveries: 1, max_dropoff_distance_km: 0.5 });
    expect(audit.every((a) => a.actor_user_id === users.admin.id)).toBe(true);
  });

  it('accepts the edges: 5 orders, 10 km, 0.5 km', async () => {
    expect((await patch({ max_active_deliveries: 5, max_dropoff_distance_km: 10 })).status).toBe(200);
    expect((await patch({ max_dropoff_distance_km: 0.5 })).status).toBe(200);
    expect(await getBatchingRules()).toEqual({ max_active_deliveries: 5, max_dropoff_distance_km: 0.5 });
  });

  it('refuses out-of-range and malformed values, and changes nothing', async () => {
    await patch({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });
    const bad: unknown[] = [
      {},
      { max_active_deliveries: 0 },
      { max_active_deliveries: 6 },
      { max_active_deliveries: 2.5 },
      { max_active_deliveries: '2' },
      { max_dropoff_distance_km: 0.4 },
      { max_dropoff_distance_km: 10.5 },
      { max_dropoff_distance_km: 1.25 },
      { max_dropoff_distance_km: 'far' },
      { max_active_deliveries: 2, extra: true },
    ];
    for (const body of bad) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await getBatchingRules()).toEqual({ max_active_deliveries: 2, max_dropoff_distance_km: 1.5 });
  });

  it('is Admin and Operations only', async () => {
    for (const token of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await get(token)).status).toBe(403);
      expect((await patch({ max_active_deliveries: 2 }, token)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/settings/rider-trips')).status).toBe(401);
  });
});
