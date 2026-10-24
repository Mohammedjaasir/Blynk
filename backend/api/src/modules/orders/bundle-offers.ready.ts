import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

/**
 * Bundle offers need migration 062 (order_items.bundle_offer_id and friends).
 * Migrations are run by hand in Coolify after the API is deployed, so until
 * they exist no offer is applied to an order, GET /store lists none and the
 * order DTOs say bundle_savings 0 - never a 500. The staff settings still
 * save (they are plain JSON in system_configurations) and say `ready: false`.
 *
 * Cached: once present it stays present; "missing" is re-checked at most once
 * a minute (same pattern as repeat-baskets/repeat.ready.ts).
 */
let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function bundleOffersReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ cols: number }>`
      SELECT count(*)::int AS cols FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'order_items'
         AND column_name IN ('bundle_offer_id', 'bundle_kind', 'bundle_title', 'bundle_value', 'bundle_rule')`.execute(db);
    cached = { ok: (r.rows[0]?.cols ?? 0) >= 5, at: Date.now() };
  } catch (err) {
    logger.warn({ err }, 'Could not check for the bundle offer columns; treating them as missing');
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 062 is missing (false) or present (true); null = check the database again. */
export function setBundleOffersReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}
