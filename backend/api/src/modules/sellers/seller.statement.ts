import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * A seller's statement (seller portal, docs/superpowers/plans/2026-10-24-seller-portal.md).
 * Computed on every read, never stored.
 *
 * Over the items of DELIVERED orders whose product belongs to the seller:
 *   gross      = SUM(quantity x order_items.estimated_unit_cost)  - the cost snapshot taken
 *                when the order was placed, which is the seller's price then (purchase_cost)
 *   commission = gross x sellers.commission_percent / 100
 *   earned     = gross - commission
 *   paid       = SUM(seller_payouts.amount)                        - the manual payouts ledger
 *   due        = earned - paid
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
}

export interface StatementPayout {
  id: string;
  amount: number;
  note: string | null;
  paid_on: string;
}

export interface Statement {
  commission_percent: number;
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

  const lineRows = (
    await sql<{ product_id: string; name: string; units: string; gross: string }>`
      SELECT p.id AS product_id, p.name,
             SUM(oi.quantity)::text AS units,
             SUM(oi.quantity * oi.estimated_unit_cost)::text AS gross
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
       WHERE p.seller_id = ${sellerId}
         AND o.order_status = 'DELIVERED'
         AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')
         ${from} ${to}
       GROUP BY p.id, p.name
       ORDER BY gross DESC, p.name ASC`.execute(db)
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
  }));
  const commissionPercent = Number(seller.commission_percent);
  const gross = round2(lines.reduce((sum, l) => sum + l.gross, 0));
  const commission = round2((gross * commissionPercent) / 100);
  const earned = round2(gross - commission);
  const payouts = payoutRows.map((r) => ({ id: r.id, amount: round2(Number(r.amount)), note: r.note, paid_on: r.paid_on }));
  const paid = round2(payouts.reduce((sum, p) => sum + p.amount, 0));

  return { commission_percent: commissionPercent, gross, commission, earned, paid, due: round2(earned - paid), lines, payouts };
}
