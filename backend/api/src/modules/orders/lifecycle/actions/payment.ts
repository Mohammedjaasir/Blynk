import { AppError } from '../../../../middleware/error.middleware.js';
import { CATALOGUE, type ActionName } from '../catalogue.js';
import { setOrderStatus } from '../status-writer.js';
import type { ActionImpl, OrderRow } from '../types.js';
import { cancelOrder, invalidTransition } from './shared.js';

/**
 * PayHere online payments (migration 047; owner, 2026-10-14). Both actions
 * are run only by payments/payhere.service.ts - after a verified notification
 * or when the payment window has passed - with the order's own customer as
 * the actor. Neither is reachable from any route.
 */
function checkOnlineAwaiting(action: ActionName, order: OrderRow, actorId: string, to: 'PLACED' | 'CANCELLED') {
  if (order.customer_id !== actorId) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  if (!CATALOGUE[action].from.includes(order.order_status)) throw invalidTransition(order, to);
  if (order.payment_method !== 'ONLINE') {
    throw new AppError('This order is not paid online.', 422, 'NOT_ONLINE_ORDER');
  }
}

/** PAYMENT_CONFIRMED: AWAITING_PAYMENT -> PLACED, the order and its payment PAID. */
export const paymentConfirmed: ActionImpl<OrderRow> = {
  checkState({ order }, req) {
    checkOnlineAwaiting('PAYMENT_CONFIRMED', order, req.actor.id, 'PLACED');
  },
  async apply(trx, { order }, req) {
    const p = req.input!.payment!;
    const now = new Date();
    await trx
      .updateTable('payments')
      .set({
        payment_status: 'PAID',
        paid_at: now,
        updated_at: now,
        gateway: 'PAYHERE',
        gateway_payment_id: p.gateway_payment_id,
        gateway_status_code: p.status_code,
        gateway_method: p.method,
        gateway_status_message: p.status_message,
        transaction_reference: p.gateway_payment_id,
        gateway_response: JSON.stringify(p.response),
      })
      .where('order_id', '=', order.id)
      .execute();
    return await setOrderStatus(
      trx,
      order,
      'PLACED',
      req.actor,
      `Paid online (PayHere payment ${p.gateway_payment_id ?? 'unknown'})`,
      { payment_status: 'PAID', payment_expires_at: null, placed_at: now }
    );
  },
};

/** PAYMENT_EXPIRED: AWAITING_PAYMENT -> CANCELLED once the payment window has passed. */
export const paymentExpired: ActionImpl<OrderRow> = {
  checkState({ order }, req) {
    checkOnlineAwaiting('PAYMENT_EXPIRED', order, req.actor.id, 'CANCELLED');
  },
  checkPreconditions({ order }, req) {
    const now = req.input?.now ?? new Date();
    if (order.payment_expires_at && order.payment_expires_at.getTime() > now.getTime()) {
      throw new AppError('The payment window is still open.', 409, 'PAYMENT_WINDOW_OPEN');
    }
  },
  async apply(trx, { order }, req) {
    const now = new Date();
    await trx
      .updateTable('payments')
      .set({ payment_status: 'FAILED', failed_at: now, updated_at: now })
      .where('order_id', '=', order.id)
      .where('payment_status', '!=', 'PAID')
      .execute();
    return await cancelOrder(trx, order, req.actor, req.input?.reason || 'Online payment was not completed in time', {
      payment_status: order.payment_status === 'PAID' ? 'PAID' : 'FAILED',
    });
  },
};
