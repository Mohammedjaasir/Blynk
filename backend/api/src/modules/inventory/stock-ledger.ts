import { sql, type Selectable, type Transaction } from 'kysely';
import type {
  Database,
  InventoryAdjustmentsTable,
  InventoryAdjustmentType,
  InventoryTable,
} from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * The canonical stock writer (inventory plan §5). The only code that changes
 * inventory.quantity_on_hand or appends to inventory_adjustments; a static
 * test (tests/stock-ledger-guard.test.ts) keeps it that way. Every movement is
 * one ledger row whose before/after values are read from the row the caller
 * has locked, so the ledger always explains the count.
 *
 * When stock moves (business rules §6):
 *   - sourcing an item of a TRACKED product takes it (ORDER_FULFILLMENT);
 *   - cancelling the order returns what the order took (ORDER_CANCELLATION_RESTORE);
 *   - an admin restocks, writes off or corrects a count (manual types).
 * Nothing else - packing, dispatch, delivery, failure, re-stage - moves stock.
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

/** Locks one product's inventory row in a store; undefined when it has none (UNTRACKED by default). */
export async function lockInventoryRow(trx: Trx, darkStoreId: string, productId: string): Promise<InventoryRow | undefined> {
  return await trx
    .selectFrom('inventory')
    .selectAll()
    .where('dark_store_id', '=', darkStoreId)
    .where('product_id', '=', productId)
    .forUpdate()
    .executeTakeFirst();
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
