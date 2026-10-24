import { sql } from 'kysely';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';

/**
 * Purchase orders need migration 058 (purchase_orders, purchase_order_items). Migrations are run
 * by hand in Coolify after the API is deployed, so until the tables exist every
 * /admin/purchase-orders and /admin/reorder-suggestions route answers 503 PURCHASING_NOT_READY -
 * never a 500. Cached: once present it stays present; "missing" is re-checked at most once a
 * minute (same pattern as repeat-baskets/repeat.ready.ts).
 */
let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function purchasingReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ tables: number }>`
      SELECT count(*)::int AS tables FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name IN ('purchase_orders', 'purchase_order_items')`.execute(db);
    cached = { ok: (r.rows[0]?.tables ?? 0) >= 2, at: Date.now() };
  } catch (err) {
    logger.warn({ err }, 'Could not check for the purchase order tables; treating them as missing');
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 058 is missing (false) or present (true); null = check the database again. */
export function setPurchasingReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

export const purchasingNotReady = () =>
  new AppError('Purchase orders will be available shortly (a database update is pending).', 503, 'PURCHASING_NOT_READY');

/** Route guard: 503 PURCHASING_NOT_READY until migration 058 exists. */
export async function requirePurchasingReady(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    next((await purchasingReady()) ? undefined : purchasingNotReady());
  } catch {
    next(purchasingNotReady());
  }
}
