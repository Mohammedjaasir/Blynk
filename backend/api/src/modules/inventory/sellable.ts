import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { lockStockRows, stockKeyOf, type StockKey } from './stock-ledger.js';

/**
 * Sellable stock (migration 045; owner, 2026-10-14: "if it's out of stock
 * they can't order"; customers can order until stock reaches 0).
 *
 * Stock leaves the shelf when an order is packed (or an item sourced), so the
 * units a customer may still order are
 *   sellable = on hand - reserved - units in open orders not yet packed
 * (v_inventory_stock.quantity_sellable). Only TRACKED rows count; an
 * UNTRACKED product or variant is never limited. Customers never see the
 * numbers - the catalog says is_available, the error says "only N left" only
 * when they ask for more than there is.
 */
type Executor = typeof db | Transaction<Database>;

export interface CartStockLine extends StockKey {
  quantity: number;
  /** For the message: "Chilli powder 100 g". */
  name: string;
}

export interface SellableRow {
  tracked: boolean;
  sellable: number;
}

/** The sellable figure of each tracked line (untracked lines are absent). */
export async function sellableFor(executor: Executor, darkStoreId: string, keys: readonly StockKey[]): Promise<Map<string, SellableRow>> {
  const out = new Map<string, SellableRow>();
  if (keys.length === 0) return out;
  const wanted = new Set(keys.map(stockKeyOf));
  const rows = await executor
    .selectFrom('v_inventory_stock')
    .select(['product_id', 'variant_id', 'tracking_mode', 'quantity_sellable'])
    .where('dark_store_id', '=', darkStoreId)
    .where('product_id', 'in', [...new Set(keys.map((k) => k.product_id))])
    .execute();
  const held = await heldByAwaitingPayment(executor, darkStoreId, keys);
  for (const r of rows) {
    const key = stockKeyOf({ product_id: r.product_id, variant_id: r.variant_id ?? null });
    if (!wanted.has(key) || r.tracking_mode !== 'TRACKED') continue;
    out.set(key, { tracked: true, sellable: Math.max(0, Number(r.quantity_sellable) - (held.get(key) ?? 0)) });
  }
  return out;
}

/**
 * Units held by online orders still waiting for their PayHere payment
 * (migration 047 AWAITING_PAYMENT, payment window not yet over). They are not
 * "open orders" in v_inventory_stock (staff never pack them), but once paid
 * they become PLACED without another stock check - so while the customer is
 * paying, those units are not sold to anyone else. An expired or cancelled
 * attempt releases them.
 */
async function heldByAwaitingPayment(executor: Executor, darkStoreId: string, keys: readonly StockKey[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const rows = await executor
    .selectFrom('order_items as oi')
    .innerJoin('orders as o', 'o.id', 'oi.order_id')
    .select(['oi.product_id', 'oi.variant_id', sql<string>`SUM(oi.quantity)`.as('quantity')])
    .where('o.dark_store_id', '=', darkStoreId)
    .where('o.order_status', '=', 'AWAITING_PAYMENT')
    .where((eb) => eb.or([eb('o.payment_expires_at', 'is', null), eb('o.payment_expires_at', '>', sql<Date>`now()`)]))
    .where('oi.item_status', '=', 'PENDING')
    .where('oi.product_id', 'in', [...new Set(keys.map((k) => k.product_id))])
    .groupBy(['oi.product_id', 'oi.variant_id'])
    .execute();
  for (const r of rows) out.set(stockKeyOf({ product_id: r.product_id, variant_id: r.variant_id ?? null }), Number(r.quantity));
  return out;
}

/** Adds up the quantity a cart wants per product/variant (loose and combo lines together). */
export function mergeCartLines(lines: readonly CartStockLine[]): CartStockLine[] {
  const merged = new Map<string, CartStockLine>();
  for (const l of lines) {
    const key = stockKeyOf(l);
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, quantity: prev.quantity + l.quantity } : { ...l });
  }
  return [...merged.values()];
}

/** The refusal for a line that wants more than is left. */
export function outOfStockError(line: CartStockLine, sellable: number): AppError {
  if (sellable <= 0) {
    return new AppError(`Sorry, ${line.name} is sold out.`, 409, 'OUT_OF_STOCK', {
      product_id: line.product_id,
      variant_id: line.variant_id,
      name: line.name,
      available: 0,
      requested: line.quantity,
    });
  }
  return new AppError(`Only ${sellable} left of ${line.name}. Please lower the quantity.`, 409, 'INSUFFICIENT_STOCK', {
    product_id: line.product_id,
    variant_id: line.variant_id,
    name: line.name,
    available: sellable,
    requested: line.quantity,
  });
}

/** Advisory check (cart pricing, previews): no locks. */
export async function checkCartStock(darkStoreId: string, lines: readonly CartStockLine[], executor: Executor = db): Promise<void> {
  const merged = mergeCartLines(lines);
  const stock = await sellableFor(executor, darkStoreId, merged);
  for (const line of merged) {
    const row = stock.get(stockKeyOf(line));
    if (row && line.quantity > row.sellable) throw outOfStockError(line, row.sellable);
  }
}

/**
 * Authoritative check inside the order transaction: locks the tracked rows
 * (ascending id), so two racing checkouts for the last units serialise and
 * the second one sees the first one's items as "in open orders".
 */
export async function assertCartStock(trx: Transaction<Database>, darkStoreId: string, lines: readonly CartStockLine[]): Promise<void> {
  const merged = mergeCartLines(lines);
  if (merged.length === 0) return;
  const locked = await lockStockRows(trx, darkStoreId, merged, { trackedOnly: true });
  const trackedKeys = merged.filter((l) => locked.get(stockKeyOf(l))?.tracking_mode === 'TRACKED');
  if (trackedKeys.length === 0) return;
  const stock = await sellableFor(trx, darkStoreId, trackedKeys);
  for (const line of trackedKeys) {
    const row = stock.get(stockKeyOf(line));
    if (row && line.quantity > row.sellable) throw outOfStockError(line, row.sellable);
  }
}
