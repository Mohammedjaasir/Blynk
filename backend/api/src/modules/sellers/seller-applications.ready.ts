import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';

/**
 * Whether migration 064 (seller_applications) has run. Migrations are run by hand in Coolify, so the
 * API is live before the table exists: until it does, every seller-application route answers 503
 * SELLER_APPLICATIONS_NOT_READY - never a 500. Checked at most once a minute until found, then
 * cached (running the migration turns the form on without a restart; the product-requests pattern).
 * A failed check counts as "not ready".
 */
let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function hasSellerApplicationsTable(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ ok: boolean }>`SELECT to_regclass('public.seller_applications') IS NOT NULL AS ok`.execute(db);
    cached = { ok: r.rows[0]?.ok === true, at: Date.now() };
  } catch (err) {
    logger.warn({ err }, 'Could not check for the seller_applications table; treating seller applications as not ready');
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend the table is missing (false) or present (true); null = check the database again. */
export function setSellerApplicationsTableForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

export const sellerApplicationsNotReady = () =>
  new AppError(
    'Seller applications are not open yet. Please call or WhatsApp us to apply.',
    503,
    'SELLER_APPLICATIONS_NOT_READY'
  );
