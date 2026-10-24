import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * Ratings + rider tips (migration 055) are deployed before the migration is
 * run by hand in Coolify. Until order_ratings and the orders tip columns exist
 * every ratings / tip endpoint answers 503 RATINGS_NOT_READY, GET /store says
 * ratings_enabled: false, checkout-info offers no tip and a checkout tip is
 * ignored (never a 500). A "yes" is cached for good; a "no" is checked again
 * after a minute.
 */
const TIP_COLUMNS = ['rider_tip', 'rider_tip_wallet', 'rider_tip_wallet_at'] as const;

let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function ratingsReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ n: number; t: boolean }>`
      SELECT (SELECT count(*)::int FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'orders'
                 AND column_name IN (${sql.join(TIP_COLUMNS.map((c) => sql`${c}`))})) AS n,
             to_regclass('order_ratings') IS NOT NULL AS t`.execute(db);
    const row = r.rows[0];
    cached = { ok: (row?.n ?? 0) >= TIP_COLUMNS.length && row?.t === true, at: Date.now() };
  } catch {
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 055 is missing (false) or present (true); null = check the database again. */
export function setRatingsReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

export const ratingsNotReady = () =>
  new AppError('Ratings and tips will be available shortly.', 503, 'RATINGS_NOT_READY');

/** Throws 503 RATINGS_NOT_READY until migration 055 exists. */
export async function assertRatingsReady(): Promise<void> {
  if (!(await ratingsReady())) throw ratingsNotReady();
}
