import type { Updateable } from 'kysely';
import type { OrderStatus, OrdersTable } from '../../../database/types.js';
import { AppError } from '../../../middleware/error.middleware.js';
import type { Actor, OrderRow, Trx } from './types.js';
import { INITIAL_ORDER_STATUS } from './catalogue.js';

/** Order columns an action may change alongside the status - never the status itself. */
export type OrderFields = Omit<Updateable<OrdersTable>, 'order_status' | 'id'>;

/**
 * The one place orders.order_status changes (the lifecycle guard test keeps it
 * that way). A compare-and-set against the status the action locked and
 * checked, plus the history row: every status change is recorded
 * (architecture §8 "Status History").
 *
 * `note` is staff-facing; customers see history as status and time only.
 */
export async function setOrderStatus(
  trx: Trx,
  order: OrderRow,
  to: OrderStatus,
  actor: Actor,
  note: string,
  fields: OrderFields = {}
): Promise<OrderRow> {
  const now = new Date();
  const updated = await trx
    .updateTable('orders')
    .set({ ...fields, order_status: to, updated_at: now })
    .where('id', '=', order.id)
    .where('order_status', '=', order.order_status)
    .returningAll()
    .executeTakeFirst();
  if (!updated) {
    // Unreachable while the action holds the order lock; kept so a future
    // caller without the lock fails loudly instead of overwriting.
    throw new AppError('This order changed while it was being updated. Refresh and try again.', 409, 'ORDER_CHANGED');
  }

  await trx
    .insertInto('order_status_history')
    .values({
      order_id: order.id,
      old_status: order.order_status,
      new_status: to,
      changed_by_user_id: actor.id,
      reason_or_notes: note,
    })
    .execute();

  return updated;
}

/** Non-status changes to a locked order (e.g. totals after an item is resolved). */
export async function updateOrderFields(trx: Trx, order: OrderRow, fields: OrderFields): Promise<OrderRow> {
  return await trx
    .updateTable('orders')
    .set({ ...fields, updated_at: new Date() })
    .where('id', '=', order.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** PLACE_ORDER: the first history row of a new order. */
export async function recordOrderPlaced(trx: Trx, orderId: string, customerId: string): Promise<void> {
  await trx
    .insertInto('order_status_history')
    .values({
      order_id: orderId,
      old_status: null,
      new_status: INITIAL_ORDER_STATUS,
      changed_by_user_id: customerId,
      reason_or_notes: 'Order placed by customer',
    })
    .execute();
}
