import type { Transaction } from 'kysely';
import type { Database } from '../../database/types.js';
import { lockStockRows, stockKeyOf, type StockKey } from '../inventory/stock-ledger.js';
import { sellableFor } from '../inventory/sellable.js';

/**
 * Gifts are real items (owner, 2026-10-25), so they need stock like any item - but a gift that ran
 * out between the cart quote and the order must never fail the customer's order: it is simply not
 * added. Inside the order transaction (after the cart's own lines passed assertCartStock) this locks
 * each gift's tracked inventory row, takes what the cart's lines already need off the sellable
 * figure, and returns the gifts that still fit, in order (earlier offers win the last units).
 * Untracked products are never limited.
 */
export async function giftsThatFit<G extends StockKey & { quantity: number }>(
  trx: Transaction<Database>,
  darkStoreId: string,
  cartLines: readonly (StockKey & { quantity: number })[],
  gifts: readonly G[]
): Promise<G[]> {
  if (gifts.length === 0) return [];
  const locked = await lockStockRows(trx, darkStoreId, gifts, { trackedOnly: true });
  const tracked = gifts.filter((g) => locked.get(stockKeyOf(g))?.tracking_mode === 'TRACKED');
  const sellable = tracked.length ? await sellableFor(trx, darkStoreId, tracked) : new Map();
  const used = new Map<string, number>();
  for (const l of cartLines) used.set(stockKeyOf(l), (used.get(stockKeyOf(l)) ?? 0) + l.quantity);
  const kept: G[] = [];
  for (const g of gifts) {
    const key = stockKeyOf(g);
    const row = sellable.get(key);
    if (row) {
      const room = row.sellable - (used.get(key) ?? 0);
      if (g.quantity > room) continue;
    }
    used.set(key, (used.get(key) ?? 0) + g.quantity);
    kept.push(g);
  }
  return kept;
}
