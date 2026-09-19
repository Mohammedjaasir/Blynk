import { AppError } from '../../../../middleware/error.middleware.js';
import type { DeliveryAssignmentStatus } from '../../../../database/types.js';
import { settleCod, type CodSettlement } from '../settlement.js';
import { setOrderStatus } from '../status-writer.js';
import type { ActionImpl, DeliveryRow, OrderRow } from '../types.js';
import { assertOrderActiveForRider, closeDeliveryAsFailed, dispatch } from './shared.js';

/*
 * Rider actions #6-#9. Messages, codes and their precedence are the Rider
 * app's existing contract (Rider foundation, approved) and must not change.
 */

function invalidDeliveryStep(delivery: DeliveryRow, requested: DeliveryAssignmentStatus, extra: object = {}) {
  return new AppError('This delivery cannot move to that status.', 409, 'INVALID_DELIVERY_TRANSITION', {
    current_status: delivery.assignment_status,
    requested_status: requested,
    ...extra,
  });
}

/** #6 RIDER_PICKUP - PACKED -> OUT_FOR_DELIVERY, delivery -> PICKED_UP. */
export const riderPickup: ActionImpl<OrderRow> = {
  checkState({ order, delivery }) {
    assertOrderActiveForRider(order);
    if (delivery!.assignment_status !== 'ASSIGNED' && delivery!.assignment_status !== 'ACCEPTED') {
      throw invalidDeliveryStep(delivery!, 'PICKED_UP');
    }
    if (order.order_status !== 'PACKED') {
      throw new AppError('This order is not packed yet.', 409, 'ORDER_NOT_READY_FOR_PICKUP', {
        order_status: order.order_status,
      });
    }
  },
  async apply(trx, { order, delivery }, req) {
    return await dispatch(trx, order, delivery!, req.actor, 'Rider picked up order for delivery');
  },
};

function assertOnTheRoad(order: OrderRow, delivery: DeliveryRow, requested: DeliveryAssignmentStatus) {
  if (order.order_status !== 'OUT_FOR_DELIVERY') {
    throw new AppError('This order is not out for delivery.', 409, 'INVALID_DELIVERY_TRANSITION', {
      current_status: delivery.assignment_status,
      requested_status: requested,
      order_status: order.order_status,
    });
  }
}

/** #7 RIDER_ARRIVE - the order stays OUT_FOR_DELIVERY. */
export const riderArrive: ActionImpl<void> = {
  checkState({ order, delivery }) {
    assertOrderActiveForRider(order);
    if (delivery!.assignment_status !== 'PICKED_UP') throw invalidDeliveryStep(delivery!, 'ARRIVED_AT_CUSTOMER');
    assertOnTheRoad(order, delivery!, 'ARRIVED_AT_CUSTOMER');
  },
  async apply(trx, { delivery }) {
    await trx
      .updateTable('deliveries')
      .set({ assignment_status: 'ARRIVED_AT_CUSTOMER', updated_at: new Date() })
      .where('id', '=', delivery!.id)
      .execute();
  },
};

/**
 * #8 RIDER_FAIL - OUT_FOR_DELIVERY -> FAILED. The rider's words stay on the
 * delivery row for staff; the order history records "Delivery failed".
 */
export const riderFail: ActionImpl<OrderRow> = {
  checkState({ order, delivery }) {
    assertOrderActiveForRider(order);
    if (delivery!.assignment_status !== 'PICKED_UP' && delivery!.assignment_status !== 'ARRIVED_AT_CUSTOMER') {
      throw invalidDeliveryStep(delivery!, 'FAILED');
    }
    assertOnTheRoad(order, delivery!, 'FAILED');
  },
  async apply(trx, { order, delivery }, req) {
    await closeDeliveryAsFailed(trx, delivery!, req.input!.failure_reason!);
    return await setOrderStatus(trx, order, 'FAILED', req.actor, 'Delivery failed');
  },
};

/**
 * #9 RIDER_COLLECT_COD - only at the door, only for an unpaid COD order, and
 * only for exactly the order total read under the lock (architecture §I).
 */
export const riderCollectCod: ActionImpl<CodSettlement> = {
  checkState({ order, delivery }) {
    if (order.payment_status === 'PAID' || delivery!.assignment_status === 'DELIVERED') {
      throw new AppError('Cash for this order has already been collected.', 409, 'COD_ALREADY_COLLECTED');
    }
    assertOrderActiveForRider(order);
    if (delivery!.assignment_status !== 'ARRIVED_AT_CUSTOMER' || order.order_status !== 'OUT_FOR_DELIVERY') {
      throw new AppError('Mark the delivery as arrived before collecting cash.', 409, 'INVALID_DELIVERY_TRANSITION', {
        current_status: delivery!.assignment_status,
        requested_status: 'DELIVERED',
        order_status: order.order_status,
      });
    }
  },
  checkPreconditions({ order }, req) {
    if (order.payment_method !== 'COD') {
      throw new AppError('This order is not cash on delivery.', 409, 'NOT_COD_ORDER');
    }
    const amount = req.input!.amount!;
    const total = Number(order.total_amount);
    if (Math.abs(amount - total) > 0.01) {
      throw new AppError(
        `Collected cash amount (${amount.toFixed(2)} LKR) does not match total order amount (${total.toFixed(2)} LKR).`,
        400,
        'INVALID_COD_AMOUNT',
        { expected_amount: total, provided_amount: amount }
      );
    }
  },
  async apply(trx, { order, delivery }, req) {
    const amount = req.input!.amount!;
    return await settleCod(trx, {
      delivery: delivery!,
      order,
      amount,
      actor: req.actor,
      note: `Delivered and collected ${amount.toFixed(2)} LKR in cash`,
    });
  },
};
