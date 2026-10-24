import { sql } from 'kysely';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';

/**
 * Expiry dates need migration 059 (stock_batches, products.expiry_tracking).
 * Migrations are run by hand in Coolify after the API is deployed, so until
 * they exist every expiry endpoint answers 503 EXPIRY_NOT_READY, the daily
 * push does nothing and the restock call ignores nothing (an `expires_on` on
 * it is refused with the same 503) - never a 500.
 *
 * Cached: once present it stays present; "missing" is re-checked at most once
 * a minute (same pattern as repeat-baskets/repeat.ready.ts).
 */
let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function expiryReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ t: boolean; c: number }>`
      SELECT to_regclass('stock_batches') IS NOT NULL AS t,
             (SELECT count(*)::int FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'products' AND column_name = 'expiry_tracking') AS c`.execute(db);
    const row = r.rows[0];
    cached = { ok: row?.t === true && (row?.c ?? 0) >= 1, at: Date.now() };
  } catch (err) {
    logger.warn({ err }, 'Could not check for the expiry tables; treating them as missing');
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 059 is missing (false) or present (true); null = check the database again. */
export function setExpiryReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

export const expiryNotReady = () => new AppError('Expiry dates will be available shortly.', 503, 'EXPIRY_NOT_READY');

/** Throws 503 EXPIRY_NOT_READY until migration 059 exists. */
export async function assertExpiryReady(): Promise<void> {
  if (!(await expiryReady())) throw expiryNotReady();
}

/** Route guard: 503 EXPIRY_NOT_READY until migration 059 exists. */
export async function requireExpiryReady(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    next((await expiryReady()) ? undefined : expiryNotReady());
  } catch {
    next(expiryNotReady());
  }
}
