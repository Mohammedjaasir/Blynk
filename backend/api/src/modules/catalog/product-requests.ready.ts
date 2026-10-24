import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';

/**
 * Whether migration 056 (product_requests) has run. Migrations are run by hand in Coolify, so the
 * API is live before the table exists: until it does, every product-request route answers 503
 * PRODUCT_REQUESTS_NOT_READY and GET /store says `product_requests_enabled: false` - never a 500.
 * Checked at most once a minute until found, then cached (running the migration turns the feature on
 * without a restart; the seller-location pattern). A failed check counts as "not ready".
 */
let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function hasProductRequestsTable(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ ok: boolean }>`SELECT to_regclass('public.product_requests') IS NOT NULL AS ok`.execute(db);
    cached = { ok: r.rows[0]?.ok === true, at: Date.now() };
  } catch (err) {
    logger.warn({ err }, 'Could not check for the product_requests table; treating product requests as not ready');
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend the table is missing (false) or present (true); null = check the database again. */
export function setProductRequestsTableForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

export const productRequestsNotReady = () =>
  new AppError('Product requests will be available shortly.', 503, 'PRODUCT_REQUESTS_NOT_READY');
