import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * Has migration 057 run? (seller stock notes, payout requests, category commission.) Migrations are
 * run by hand in Coolify, so the API is live before it: until then the stock-note / payout-request
 * routes answer 503 SELLER_REQUESTS_NOT_READY and commission uses the seller's own percent only
 * (never a 500). Checked once a minute until found, then cached - running the migration turns it all
 * on without a restart (the seller.location.ts pattern). 057 runs in one transaction, so the two
 * tables and the categories column always appear together.
 */
let tables: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function hasSellerRequestTables(): Promise<boolean> {
  if (override !== null) return override;
  if (tables && (tables.ok || Date.now() - tables.at < 60_000)) return tables.ok;
  const r = await sql<{ n: number }>`
    SELECT (SELECT count(*)::int FROM information_schema.tables
             WHERE table_schema = current_schema() AND table_name IN ('seller_stock_notes', 'seller_payout_requests'))
         + (SELECT count(*)::int FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'categories' AND column_name = 'seller_commission_percent') AS n`.execute(db);
  tables = { ok: (r.rows[0]?.n ?? 0) >= 3, at: Date.now() };
  return tables.ok;
}

/** Tests only: pretend migration 057 has not run (false) or has (true); null = check the database again. */
export function setSellerRequestTablesForTests(value: boolean | null): void {
  override = value;
  tables = null;
}

export const requestsNotReady = () =>
  new AppError('This will be available shortly (a database update is pending).', 503, 'SELLER_REQUESTS_NOT_READY');

export async function assertSellerRequestsReady(): Promise<void> {
  if (!(await hasSellerRequestTables())) throw requestsNotReady();
}
