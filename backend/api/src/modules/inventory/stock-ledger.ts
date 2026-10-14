import { sql, type Selectable, type Transaction } from 'kysely';
import type {
  Database,
  InventoryAdjustmentsTable,
  InventoryAdjustmentType,
  InventoryTable,
} from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { releaseStockAlertsSafely } from '../notifications/push/push.events.js';

/**
 * The canonical stock writer (inventory plan §5). The only code that changes
 * inventory.quantity_on_hand or appends to inventory_adjustments; a static
 * test (tests/stock-ledger-guard.test.ts) keeps it that way. Every movement is
 * one ledger row whose before/after values are read from the row the caller
 * has locked, so the ledger always explains the count.
 *
 * When stock moves (business rules §6):
 *   - packing takes it for every item not yet sourced, or sourcing an item
 *     takes it, for a TRACKED product (ORDER_FULFILLMENT);
 *   - cancelling the order returns what the order took (ORDER_CANCELLATION_RESTORE);
 *   - an admin restocks, writes off or corrects a count (manual types).
 * Nothing else - dispatch, delivery, failure, re-stage - moves stock.
 */
type Trx = Transaction<Database>;
export type InventoryRow = Selectable<InventoryTable>;
export type AdjustmentRow = Selectable<InventoryAdjustmentsTable>;

export interface StockMovement {
  /** Locked by the caller (FOR UPDATE) in this transaction. */
  inventory: InventoryRow;
  /** Non-zero; negative takes stock, positive returns or adds it. */
  delta: number;
  type: InventoryAdjustmentType;
  orderId: string | null;
  actorId: string | null;
  notes: string | null;
}

/**
 * Locks one product's inventory row in a store; undefined when it has none
 * (UNTRACKED by default). Migration 045: `variantId` picks a variant's own
 * row; omitted/null is the product-level row (variant_id IS NULL).
 */
export async function lockInventoryRow(
  trx: Trx,
  darkStoreId: string,
  productId: string,
  variantId: string | null = null
): Promise<InventoryRow | undefined> {
  let q = trx.selectFrom('inventory').selectAll().where('dark_store_id', '=', darkStoreId).where('product_id', '=', productId);
  q = variantId === null ? q.where('variant_id', 'is', null) : q.where('variant_id', '=', variantId);
  return await q.forUpdate().executeTakeFirst();
}

/**
 * Locks several products' product-level inventory rows in a store, in
 * ascending id (the canonical order for inventory rows). Products without a
 * row are absent. Variant rows are not included (lockStockRows does both).
 */
export async function lockInventoryRows(trx: Trx, darkStoreId: string, productIds: readonly string[]): Promise<InventoryRow[]> {
  if (productIds.length === 0) return [];
  return await trx
    .selectFrom('inventory')
    .selectAll()
    .where('dark_store_id', '=', darkStoreId)
    .where('product_id', 'in', [...productIds])
    .where('variant_id', 'is', null)
    .orderBy('id')
    .forUpdate()
    .execute();
}

/** A stock line: a product, or one of its variants (migration 045). */
export interface StockKey {
  product_id: string;
  variant_id: string | null;
}

export const stockKeyOf = (k: StockKey) => `${k.product_id}:${k.variant_id ?? ''}`;

/**
 * Locks the inventory rows of several product/variant lines in a store, in
 * ascending id (canonical order). Lines without a row are absent from the
 * result map (they are UNTRACKED).
 */
export async function lockStockRows(
  trx: Trx,
  darkStoreId: string,
  keys: readonly StockKey[],
  opts: { trackedOnly?: boolean } = {}
): Promise<Map<string, InventoryRow>> {
  const out = new Map<string, InventoryRow>();
  if (keys.length === 0) return out;
  const wanted = new Set(keys.map(stockKeyOf));
  let q = trx
    .selectFrom('inventory')
    .selectAll()
    .where('dark_store_id', '=', darkStoreId)
    .where('product_id', 'in', [...new Set(keys.map((k) => k.product_id))]);
  // Checkout locks only counted rows: carts of untracked products never wait on each other.
  if (opts.trackedOnly) q = q.where('tracking_mode', '=', 'TRACKED');
  const rows = await q.orderBy('id').forUpdate().execute();
  for (const row of rows) {
    const key = stockKeyOf({ product_id: row.product_id, variant_id: row.variant_id ?? null });
    if (wanted.has(key)) out.set(key, row);
  }
  return out;
}

export async function recordStockMovement(trx: Trx, m: StockMovement): Promise<{ inventory: InventoryRow; adjustment: AdjustmentRow }> {
  const previous = m.inventory.quantity_on_hand;
  const next = previous + m.delta;

  if (next < 0) {
    throw new AppError(`Adjustment would cause negative on-hand inventory (${next}).`, 400, 'NEGATIVE_INVENTORY_PROHIBITED', {
      previous_quantity: previous,
      delta: m.delta,
      resulting_quantity: next,
    });
  }
  if (next < m.inventory.quantity_reserved) {
    throw new AppError(
      `Adjustment would cause available inventory to drop below zero (On-hand: ${next}, Reserved: ${m.inventory.quantity_reserved}).`,
      400,
      'INSUFFICIENT_AVAILABLE_INVENTORY',
      { resulting_on_hand: next, reserved: m.inventory.quantity_reserved }
    );
  }

  const inventory = await trx
    .updateTable('inventory')
    .set({ quantity_on_hand: next, updated_at: sql<Date>`clock_timestamp()` })
    .where('id', '=', m.inventory.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  const adjustment = await trx
    .insertInto('inventory_adjustments')
    .values({
      inventory_id: m.inventory.id,
      adjustment_type: m.type,
      quantity_delta: m.delta,
      previous_quantity: previous,
      new_quantity: next,
      reference_order_id: m.orderId,
      notes: m.notes,
      created_by_user_id: m.actorId,
      // The moment of the movement, taken under the row lock - not the
      // transaction's start (the column default) - so ledger order is the
      // order in which stock actually moved (plan F3).
      created_at: sql<Date>`clock_timestamp()`,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Back in stock (phase 6): a tracked product whose free stock goes from
  // none to some releases its "notify me" alerts - if the product is also
  // switched on for customers (releaseStockAlerts checks). Best effort, in a
  // savepoint: it never fails the movement.
  const reserved = m.inventory.quantity_reserved;
  if (m.inventory.tracking_mode === 'TRACKED' && previous - reserved <= 0 && next - reserved > 0) {
    await releaseStockAlertsSafely(trx, m.inventory.product_id);
  }

  return { inventory, adjustment };
}

/**
 * Returns to the shelf the stock an order still holds, when it is cancelled
 * (plan I2). The amount per product is the order's own ledger net - what its
 * ORDER_FULFILLMENT rows took minus what its ORDER_CANCELLATION_RESTORE rows
 * already returned - so it is exact (partial sourcing, several lines of one
 * product), order-specific, independent of the product's current tracking
 * mode (I5), and idempotent: a second call finds nothing held and writes
 * nothing.
 *
 * Runs inside the cancel transaction after the order row is locked; locks the
 * inventory rows in ascending id (canonical order: order -> inventory rows).
 * Holding the order lock is what makes the ledger read safe: sourcing locks
 * the order before it writes, so its rows are either committed and visible
 * here, or it will find the order cancelled and refuse.
 */
export async function restoreOrderStock(
  trx: Trx,
  order: { id: string; order_number: string },
  actor: { id: string },
  by: 'customer' | 'store'
): Promise<{ inventory_id: string; quantity: number }[]> {
  const held = await trx
    .selectFrom('inventory_adjustments')
    .select(['inventory_id', sql<number>`(-sum(quantity_delta))::int`.as('quantity')])
    .where('reference_order_id', '=', order.id)
    .where('adjustment_type', 'in', ['ORDER_FULFILLMENT', 'ORDER_CANCELLATION_RESTORE'])
    .groupBy('inventory_id')
    .having(sql`sum(quantity_delta)`, '<', 0)
    .orderBy('inventory_id')
    .execute();

  const restored: { inventory_id: string; quantity: number }[] = [];
  for (const { inventory_id, quantity } of held) {
    const row = await trx.selectFrom('inventory').selectAll().where('id', '=', inventory_id).forUpdate().executeTakeFirstOrThrow();
    await recordStockMovement(trx, {
      inventory: row,
      delta: quantity,
      type: 'ORDER_CANCELLATION_RESTORE',
      orderId: order.id,
      actorId: actor.id,
      notes: `Order ${order.order_number} cancelled by the ${by}: ${quantity} returned to stock`,
    });
    restored.push({ inventory_id, quantity });
  }
  return restored;
}
