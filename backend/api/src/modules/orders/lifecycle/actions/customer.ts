import { AppError } from '../../../../middleware/error.middleware.js';
import { CATALOGUE } from '../catalogue.js';
import type { ActionImpl, OrderRow } from '../types.js';
import { cancelOrder } from './shared.js';

/**
 * #1 CUSTOMER_CANCEL - self-service, only before the order leaves the store
 * (business rules §5; D2 keeps PACKED cancellable). Error codes are the
 * customer app's existing contract.
 */
export const customerCancel: ActionImpl<OrderRow> = {
  checkState({ order }, req) {
    // Someone else's order is indistinguishable from a missing one.
    if (order.customer_id !== req.actor.id) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    const status = order.order_status;
    if (status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED') {
      throw new AppError(
        'Order is already out for delivery or delivered and cannot be cancelled online.',
        400,
        'ORDER_ALREADY_OUT_FOR_DELIVERY'
      );
    }
    if (status === 'CANCELLED') throw new AppError('Order is already cancelled.', 400, 'ORDER_ALREADY_CANCELLED');
    if (!CATALOGUE.CUSTOMER_CANCEL.from.includes(status)) {
      throw new AppError(`Order cannot be cancelled in '${status}' status.`, 400, 'ORDER_CANNOT_BE_CANCELLED');
    }
  },
  async apply(trx, { order }, req) {
    return await cancelOrder(trx, order, req.actor, req.input?.reason || 'Cancelled by customer');
  },
};
