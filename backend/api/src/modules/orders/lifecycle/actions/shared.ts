import type { OrderStatus } from '../../../../database/types.js';
import { restoreOrderStock } from '../../../inventory/stock-ledger.js';
import { AppError } from '../../../../middleware/error.middleware.js';
import { CLOSED_ORDER_STATUSES } from '../catalogue.js';
import { enqueueCustomerSms } from '../notify.js';
import { setOrderStatus } from '../status-writer.js';
import type { Actor, DeliveryRow, OrderRow, Trx } from '../types.js';

/** Admin endpoint: the requested status is not reachable from the current one. */
export function invalidTransition(order: OrderRow, requested: OrderStatus): AppError {
  return new AppError(
    `An order in ${order.order_status} cannot move to ${requested}.`,
    422,
    'INVALID_STATUS_TRANSITION',
    { current_status: order.order_status, requested_status: requested }
  );
}

/** Rider actions (frozen): a closed order refuses every step. */
export function assertOrderActiveForRider(order: OrderRow): void {
  if (CLOSED_ORDER_STATUSES.includes(order.order_status)) {
    throw new AppError('This order is no longer active.', 409, 'ORDER_NOT_ACTIVE', { order_status: order.order_status });
  }
}

/**
 * PACKED -> OUT_FOR_DELIVERY with the delivery PICKED_UP, used by the rider's
 * pickup and by staff handing the bag over (D3). One OUT_FOR_DELIVERY message
 * per delivery, so a re-dispatch after a re-stage is announced again.
 */
export async function dispatch(trx: Trx, order: OrderRow, delivery: DeliveryRow, actor: Actor, note: string) {
  const now = new Date();
  await trx
    .updateTable('deliveries')
    .set({ assignment_status: 'PICKED_UP', picked_up_at: now, updated_at: now })
    .where('id', '=', delivery.id)
    .execute();
  const updated = await setOrderStatus(trx, order, 'OUT_FOR_DELIVERY', actor, note, { dispatched_at: now });
  await enqueueCustomerSms(trx, order, 'OUT_FOR_DELIVERY', `order_${order.id}_${delivery.id}_OUT_FOR_DELIVERY_SMS`, {
    order_number: order.order_number,
    total_amount: Number(order.total_amount),
  });
  return updated;
}

/** Ends an on-the-road delivery attempt; the order then no longer has an active rider. */
export async function closeDeliveryAsFailed(trx: Trx, delivery: DeliveryRow, reason: string) {
  const now = new Date();
  await trx
    .updateTable('deliveries')
    .set({ assignment_status: 'FAILED', failed_at: now, failure_reason: reason, updated_at: now })
    .where('id', '=', delivery.id)
    .execute();
}

/**
 * CANCELLED with the customer-visible reason, by the customer or an admin.
 * An ASSIGNED delivery is left as it is: the Rider app already shows a
 * cancelled order as "Cancelled - don't pick up".
 *
 * Tracked stock the order took at sourcing goes back on the shelf in the same
 * transaction (catalogue stock: RESTORE_ORDER_STOCK; inventory plan I2), after
 * the order lock: order -> inventory rows.
 */
export async function cancelOrder(trx: Trx, order: OrderRow, actor: Actor, reason: string) {
  const updated = await setOrderStatus(trx, order, 'CANCELLED', actor, reason, {
    cancellation_reason: reason,
    cancelled_by_user_id: actor.id,
    cancelled_at: new Date(),
  });
  await restoreOrderStock(trx, order, actor, actor.role === 'CUSTOMER' ? 'customer' : 'store');
  await enqueueCustomerSms(trx, order, 'ORDER_CANCELLED', `order_${order.id}_CANCELLED_SMS`, {
    order_number: order.order_number,
    reason,
  });
  return updated;
}
