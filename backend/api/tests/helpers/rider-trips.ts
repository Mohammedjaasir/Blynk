import { afterAll, beforeAll } from 'vitest';
import { pool } from '../../src/database/connection.js';
import { RIDER_BATCHING_KEY } from '../../src/modules/riders/batching.js';

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;

async function readRow(): Promise<SavedRow> {
  const { rows } = await pool.query(
    'SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1',
    [RIDER_BATCHING_KEY]
  );
  return rows[0] ?? null;
}

/** Puts the rider_batching row back exactly as it was (the hygiene check compares whole rows). */
async function restoreRow(saved: SavedRow) {
  if (!saved) {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [RIDER_BATCHING_KEY]);
    return;
  }
  await pool.query(
    `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
       created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
    [RIDER_BATCHING_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
  );
}

/** Sets the trip rules for the rest of the file; restored by the hook this registers. */
export async function setRiderTripRules(rules: { max_active_deliveries: number; max_dropoff_distance_km: number }) {
  await pool.query(
    `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2::jsonb, 'test')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [RIDER_BATCHING_KEY, JSON.stringify(rules)]
  );
}

/**
 * Registers beforeAll/afterAll hooks that save the stored trip rules and put
 * them back after the file. With `rules`, those apply for the whole file.
 */
export function withRiderTripRules(rules?: { max_active_deliveries: number; max_dropoff_distance_km: number }) {
  let saved: SavedRow = null;
  beforeAll(async () => {
    saved = await readRow();
    if (rules) await setRiderTripRules(rules);
  });
  afterAll(async () => {
    await restoreRow(saved);
  });
}

/**
 * For files that test something other than rider trips but hand one seeded
 * rider many orders at once (rider trips, 2026-09-30): lifts the per-rider
 * cap and the drop-off distance for the file, and restores them afterwards.
 * tests/rider-trips.test.ts covers the real limits.
 */
export function liftRiderTripCap() {
  withRiderTripRules({ max_active_deliveries: 10_000, max_dropoff_distance_km: 100_000 });
}
