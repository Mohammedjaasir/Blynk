import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { appliedPercentSql, commissionContext, groupFreeSql } from './seller.commission.js';

/**
 * A seller's statement (seller portal, docs/superpowers/plans/2026-10-24-seller-portal.md).
 * Computed on every read, never stored.
 *
 * Over the items of DELIVERED orders whose product belongs to the seller, per product (line):
 *   gross      = SUM(quantity x order_items.estimated_unit_cost)  - the cost snapshot taken
 *                when the order was placed, which is the seller's price then (purchase_cost)
 *   commission = ROUND(line gross x the line's percent / 100, 2)   - the percent is the seller's own
 *                rate, else the category's, else the main category's, else the global default
 *                (seller.commission.ts; before migration 057 just the seller's own rate)
 * and in total:
 *   commission = the sum of the lines' commission
 *   earned     = gross - commission
 *   paid       = SUM(seller_payouts.amount)                        - the manual payouts ledger
 *   due        = earned - paid
 * Free month (migration 065): sales of orders delivered before the seller's commission_free_until
 * carry no commission (percent 0). A product sold both inside and after that window shows two lines,
 * one at 0 % and one at the normal rate, so every line's percent is the one actually applied.
 * Items packed as UNAVAILABLE or SUBSTITUTED were not delivered as the seller's product and do
 * not count. The delivery date is orders.delivered_at (set when the cash is collected), read in
 * Asia/Colombo; an optional from / to (YYYY-MM-DD, inclusive) limits both the sales and the
 * payouts (by paid_on), so the period figures stay consistent with each other.
 */
export interface StatementLine {
  product_id: string;
  name: string;
  units: number;
  gross: number;
  /** The percent Blynk keeps on this line, and what that comes to. */
  commission_percent: number;
  commission: number;
}

export interface StatementPayout {
  id: string;
  amount: number;
  note: string | null;
  paid_on: string;
}

export interface Statement {
  /** The seller's own rate; null = each line uses its category's rate or the default. */
  commission_percent: number | null;
  gross: number;
  commission: number;
  earned: number;
  paid: number;
  due: number;
  lines: StatementLine[];
  payouts: StatementPayout[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export async function sellerStatement(
  sellerId: string,
  opts: { from?: string; to?: string } = {}
): Promise<Statement> {
  const seller = await db.selectFrom('sellers').select(['id', 'commission_percent']).where('id', '=', sellerId).executeTakeFirst();
  if (!seller) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');

  const delivered = sql`COALESCE(o.delivered_at, o.updated_at) AT TIME ZONE 'Asia/Colombo'`;
  const from = opts.from ? sql` AND (${delivered})::date >= ${opts.from}::date` : sql``;
  const to = opts.to ? sql` AND (${delivered})::date <= ${opts.to}::date` : sql``;

  const ctx = await commissionContext();
  const pct = appliedPercentSql(ctx);
  const lineRows = (
    await sql<{ product_id: string; name: string; units: string; gross: string; pct: string; commission: string }>`
      SELECT p.id AS product_id, p.name,
             SUM(oi.quantity)::text AS units,
             SUM(oi.quantity * oi.estimated_unit_cost)::text AS gross,
             (${pct})::text AS pct,
             ROUND(SUM(oi.quantity * oi.estimated_unit_cost) * (${pct}) / 100, 2)::text AS commission
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        JOIN sellers ss ON ss.id = p.seller_id
       WHERE p.seller_id = ${sellerId}
         AND o.order_status = 'DELIVERED'
         AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')
         ${from} ${to}
       GROUP BY p.id, p.name, ss.id${groupFreeSql(ctx)}
       ORDER BY SUM(oi.quantity * oi.estimated_unit_cost) DESC, p.name ASC`.execute(db)
  ).rows;

  const payoutFrom = opts.from ? sql` AND paid_on >= ${opts.from}::date` : sql``;
  const payoutTo = opts.to ? sql` AND paid_on <= ${opts.to}::date` : sql``;
  const payoutRows = (
    await sql<{ id: string; amount: string; note: string | null; paid_on: string }>`
      SELECT id, amount::text AS amount, note, to_char(paid_on, 'YYYY-MM-DD') AS paid_on
        FROM seller_payouts
       WHERE seller_id = ${sellerId} ${payoutFrom} ${payoutTo}
       ORDER BY paid_on DESC, created_at DESC`.execute(db)
  ).rows;

  const lines = lineRows.map((r) => ({
    product_id: r.product_id,
    name: r.name,
    units: Number(r.units),
    gross: round2(Number(r.gross)),
    commission_percent: Number(r.pct),
    commission: round2(Number(r.commission)),
  }));
  const commissionPercent = seller.commission_percent === null ? null : Number(seller.commission_percent);
  const gross = round2(lines.reduce((sum, l) => sum + l.gross, 0));
  const commission = round2(lines.reduce((sum, l) => sum + l.commission, 0));
  const earned = round2(gross - commission);
  const payouts = payoutRows.map((r) => ({ id: r.id, amount: round2(Number(r.amount)), note: r.note, paid_on: r.paid_on }));
  const paid = round2(payouts.reduce((sum, p) => sum + p.amount, 0));

  return { commission_percent: commissionPercent, gross, commission, earned, paid, due: round2(earned - paid), lines, payouts };
}
