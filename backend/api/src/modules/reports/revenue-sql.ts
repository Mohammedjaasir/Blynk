import { sql, type RawBuilder } from 'kysely';

/**
 * What an order brought in for Blynk: what the customer paid in cash and from the wallet, WITHOUT the
 * rider's cash tip (migration 055: `orders.rider_tip` is inside total_amount but belongs to the rider).
 * Works before 055 has been run too: the tip is read from the row as JSON, so a missing column is 0,
 * never an error. `alias` is the table alias of the orders row in the query (default: orders itself).
 */
export const revenueOf = (alias = 'orders'): RawBuilder<string> => {
  const p = alias === 'orders' ? '' : `${alias}.`;
  return sql.raw(`(${p}total_amount + ${p}wallet_amount_used - coalesce((to_jsonb(${alias})->>'rider_tip')::numeric, 0))`);
};
