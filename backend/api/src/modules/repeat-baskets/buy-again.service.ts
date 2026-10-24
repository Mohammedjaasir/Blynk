import { sql } from 'kysely';
import { db } from '../../database/connection.js';

/**
 * "Buy again" (owner, 2026-10-24; contract docs/superpowers/plans/
 * 2026-10-24-buy-again-repeat.md section 1): what the customer buys most,
 * from their DELIVERED orders placed in the last 180 days.
 *
 * - Loose items only: products bought inside a combo pack are left out.
 * - Items the store removed (UNAVAILABLE) or replaced (SUBSTITUTED) do not count.
 * - One entry per product, or per size (migration 045); times_bought counts
 *   orders, last_quantity is what the latest of those orders had (two lines of
 *   the same product in one order are added up).
 * - Deleted products (and deleted sizes) are left out; switched-off or sold-out
 *   ones are still returned - the app decides what to show.
 * - Ranked by times_bought desc, then last_bought_at desc; at most 24.
 */
export const BUY_AGAIN_DAYS = 180;
export const BUY_AGAIN_LIMIT = 24;

export interface BuyAgainItem {
  product_id: string;
  variant_id: string | null;
  times_bought: number;
  last_bought_at: Date;
  last_quantity: number;
}

export async function customerBuyAgain(customerId: string): Promise<{ items: BuyAgainItem[] }> {
  const rows = await sql<{
    product_id: string;
    variant_id: string | null;
    times_bought: number;
    last_bought_at: Date;
    last_quantity: number;
  }>`
    WITH lines AS (
      SELECT o.id AS order_id, o.placed_at, oi.product_id, oi.variant_id, SUM(oi.quantity)::int AS quantity
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
       WHERE o.customer_id = ${customerId}
         AND o.order_status = 'DELIVERED'
         AND o.placed_at >= now() - make_interval(days => ${BUY_AGAIN_DAYS})
         AND oi.order_combo_id IS NULL
         AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')
         AND p.deleted_at IS NULL
         AND (oi.variant_id IS NULL OR (pv.id IS NOT NULL AND pv.deleted_at IS NULL))
       GROUP BY o.id, o.placed_at, oi.product_id, oi.variant_id
    )
    SELECT product_id,
           variant_id,
           COUNT(*)::int AS times_bought,
           MAX(placed_at) AS last_bought_at,
           (array_agg(quantity ORDER BY placed_at DESC, order_id DESC))[1]::int AS last_quantity
      FROM lines
     GROUP BY product_id, variant_id
     ORDER BY times_bought DESC, last_bought_at DESC, product_id ASC, variant_id ASC NULLS FIRST
     LIMIT ${BUY_AGAIN_LIMIT}`.execute(db);
  return {
    items: rows.rows.map((r) => ({
      product_id: r.product_id,
      variant_id: r.variant_id ?? null,
      times_bought: Number(r.times_bought),
      last_bought_at: r.last_bought_at,
      last_quantity: Number(r.last_quantity),
    })),
  };
}
