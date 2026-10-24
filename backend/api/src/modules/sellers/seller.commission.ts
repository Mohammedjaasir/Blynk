import { sql, type RawBuilder, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { hasSellerRequestTables, requestsNotReady } from './seller-requests.guard.js';

/**
 * What Blynk keeps from a seller's sales (owner, 2026-10-24: "for sellers universally we must be
 * able to set a percentage on sales category-wise, and for each seller also a separate
 * percentage"; most sellers 2%, some 4%). Per sold line (one product), the percent is
 *
 *   1. the seller's own rate             sellers.commission_percent (NULL = none)
 *   2. else the product's category rate  categories.seller_commission_percent
 *   3. else its main category's rate     (a sub-category falls back to its parent)
 *   4. else the global default           system_configurations 'seller_commission' { default_percent }, 0 when unset
 *
 * and the line's commission is ROUND(line gross x percent / 100, 2) - in SQL, so the statement, the
 * sellers list and the payout checks all agree to the cent. The current category counts (a product
 * moved to another category is charged at the new rate).
 *
 * Before migration 057 (seller-requests.guard.ts) categories have no rate and every seller has a
 * percent of their own: the rule is just (1), as before.
 */

type Executor = typeof db | Transaction<Database>;

export const SELLER_COMMISSION_KEY = 'seller_commission';

const pctFrom = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
};

/** The global default seller commission (0 when unset or unusable). */
export async function defaultSellerCommission(executor: Executor = db): Promise<number> {
  const row = await executor.selectFrom('system_configurations').select('value').where('key', '=', SELLER_COMMISSION_KEY).executeTakeFirst();
  const value = row?.value as { default_percent?: unknown } | null | undefined;
  return pctFrom(value?.default_percent) ?? 0;
}

export interface CommissionContext {
  /** Migration 057 has run (category rates and "no own rate" exist). */
  ready: boolean;
  defaultPercent: number;
}

export async function commissionContext(executor: Executor = db): Promise<CommissionContext> {
  const ready = await hasSellerRequestTables();
  return { ready, defaultPercent: ready ? await defaultSellerCommission(executor) : 0 };
}

/**
 * The percent for a sold line, as SQL over the aliases `p` (products) and `ss` (the product's
 * seller). Adds no joins.
 */
export function linePercentSql(ctx: CommissionContext): RawBuilder<unknown> {
  if (!ctx.ready) return sql`COALESCE(ss.commission_percent, 0)`;
  return sql`COALESCE(
    ss.commission_percent,
    (SELECT cc.seller_commission_percent FROM categories cc WHERE cc.id = p.category_id),
    (SELECT pc.seller_commission_percent FROM categories cc JOIN categories pc ON pc.id = cc.parent_id
      WHERE cc.id = p.category_id AND pc.deleted_at IS NULL),
    ${ctx.defaultPercent}::numeric)`;
}

/**
 * What a seller has earned in all (delivered sales less commission, line by line), as a scalar
 * subquery returning text; `sellerRef` is the seller id expression (a column or a value).
 */
export function earnedSql(sellerRef: RawBuilder<unknown>, ctx: CommissionContext): RawBuilder<unknown> {
  return sql`(SELECT COALESCE(SUM(t.gross - t.commission), 0)::text FROM (
      SELECT SUM(oi.quantity * oi.estimated_unit_cost) AS gross,
             ROUND(SUM(oi.quantity * oi.estimated_unit_cost) * (${linePercentSql(ctx)}) / 100, 2) AS commission
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        JOIN sellers ss ON ss.id = p.seller_id
       WHERE p.seller_id = ${sellerRef} AND o.order_status = 'DELIVERED'
         AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')
       GROUP BY p.id, ss.id) t)`;
}

/** The seller's side of the rule (GET /seller/me commission_rule). */
export async function commissionRule(override: number | null) {
  const ctx = await commissionContext();
  return { override_percent: override, default_percent: ctx.defaultPercent };
}

// ----------------------------------------------------------------------------
// Settings (GET | PUT /admin/settings/seller-commission)
// ----------------------------------------------------------------------------

export interface CategoryRate {
  category_id: string;
  name: string;
  parent_id: string | null;
  percent: number | null;
}

export async function getCommissionSettings() {
  const ready = await hasSellerRequestTables();
  const [defaultPercent, rows] = await Promise.all([
    ready ? defaultSellerCommission() : Promise.resolve(0),
    ready
      ? sql<{ id: string; name: string; parent_id: string | null; pct: string | null }>`
          SELECT id, name, parent_id, seller_commission_percent::text AS pct FROM categories
           WHERE deleted_at IS NULL ORDER BY display_order ASC, name ASC`.execute(db)
      : sql<{ id: string; name: string; parent_id: string | null; pct: string | null }>`
          SELECT id, name, parent_id, NULL::text AS pct FROM categories
           WHERE deleted_at IS NULL ORDER BY display_order ASC, name ASC`.execute(db),
  ]);
  const categories: CategoryRate[] = rows.rows.map((r) => ({
    category_id: r.id,
    name: r.name,
    parent_id: r.parent_id,
    percent: r.pct === null ? null : Number(r.pct),
  }));
  return { default_percent: defaultPercent, categories, ready };
}

/**
 * Saves the global default and the listed categories' rates (null clears a category's rate;
 * categories left out keep theirs). One transaction, audited SELLER_COMMISSION_UPDATED with only
 * what changed. 503 SELLER_REQUESTS_NOT_READY before migration 057.
 */
export async function setCommissionSettings(
  input: { default_percent: number; categories?: { category_id: string; percent: number | null }[] },
  actor: AuditActor
) {
  if (!(await hasSellerRequestTables())) throw requestsNotReady();
  const wanted = input.categories ?? [];
  const ids = [...new Set(wanted.map((c) => c.category_id))];
  if (ids.length !== wanted.length) throw new AppError('Each category can be listed once.', 400, 'VALIDATION_ERROR', { field: 'categories' });

  await db.transaction().execute(async (trx) => {
    const before = await trx.selectFrom('system_configurations').select('value').where('key', '=', SELLER_COMMISSION_KEY).forUpdate().executeTakeFirst();
    const previousDefault = pctFrom((before?.value as { default_percent?: unknown } | undefined)?.default_percent) ?? 0;
    const value = JSON.stringify({ default_percent: input.default_percent });
    await trx
      .insertInto('system_configurations')
      .values({ key: SELLER_COMMISSION_KEY, value, description: 'Default seller commission percent (seller portal)' })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
      .execute();

    const changes: { category_id: string; name: string; from: number | null; to: number | null }[] = [];
    if (ids.length) {
      const current = (
        await sql<{ id: string; name: string; pct: string | null }>`
          SELECT id, name, seller_commission_percent::text AS pct FROM categories
           WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL FOR UPDATE`.execute(trx)
      ).rows;
      const byId = new Map(current.map((c) => [c.id, c]));
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) {
        throw new AppError('Some categories do not exist.', 400, 'CATEGORY_NOT_FOUND', { field: 'categories', category_ids: missing });
      }
      for (const w of wanted) {
        const c = byId.get(w.category_id)!;
        const from = c.pct === null ? null : Number(c.pct);
        if (from === w.percent) continue;
        await sql`UPDATE categories SET seller_commission_percent = ${w.percent}, updated_at = now() WHERE id = ${w.category_id}`.execute(trx);
        changes.push({ category_id: w.category_id, name: c.name, from, to: w.percent });
      }
    }

    if (previousDefault !== input.default_percent || changes.length || !before) {
      await writeAudit(trx, actor, {
        action: 'SELLER_COMMISSION_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: SELLER_COMMISSION_KEY, default_percent: before ? previousDefault : null },
        newValues: { key: SELLER_COMMISSION_KEY, default_percent: input.default_percent, categories: changes },
      });
    }
    logger.info({ default: input.default_percent, categories: changes.length, actorId: actor.actorId }, 'Seller commission settings saved');
  });
  return getCommissionSettings();
}
