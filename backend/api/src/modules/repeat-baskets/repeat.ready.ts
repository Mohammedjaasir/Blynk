import { sql } from 'kysely';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';

/**
 * Repeat baskets need migration 054 (repeat_baskets, repeat_basket_runs,
 * orders.repeat_basket_id). Migrations are run by hand in Coolify after the
 * API is deployed, so until they exist every repeat-basket endpoint answers
 * 503 REPEAT_NOT_READY, GET /store says repeat_baskets_enabled false and the
 * worker does nothing - never a 500.
 *
 * Cached: once present it stays present; "missing" is re-checked at most once
 * a minute (same pattern as sellers/seller.location.ts).
 */
let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function repeatBasketsReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ tables: number; cols: number }>`
      SELECT
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name IN ('repeat_baskets', 'repeat_basket_runs')) AS tables,
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'repeat_basket_id') AS cols`.execute(db);
    const row = r.rows[0];
    cached = { ok: (row?.tables ?? 0) >= 2 && (row?.cols ?? 0) >= 1, at: Date.now() };
  } catch (err) {
    logger.warn({ err }, 'Could not check for the repeat basket tables; treating them as missing');
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 054 is missing (false) or present (true); null = check the database again. */
export function setRepeatBasketsReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

export const repeatNotReady = () =>
  new AppError('Repeat baskets will be available shortly.', 503, 'REPEAT_NOT_READY');

/** Route guard: 503 REPEAT_NOT_READY until migration 054 exists. */
export async function requireRepeatReady(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    next((await repeatBasketsReady()) ? undefined : repeatNotReady());
  } catch {
    next(repeatNotReady());
  }
}
