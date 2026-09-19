import { db } from '../../../database/connection.js';
import { AppError } from '../../../middleware/error.middleware.js';
import { ACTIVE_DELIVERY_STATUSES, CATALOGUE, type ActionName, type LockKind } from './catalogue.js';
import { ACTIONS } from './actions/index.js';
import type { ActionImpl, LockedState, OrderRow, TransitionRequest, Trx } from './types.js';

/**
 * Runs one lifecycle action (plan §O). The only way an order changes status.
 *
 *   1. request-level validation (notes required)
 *   2. locks, children first, then the order - the canonical lock order
 *   3. ownership and state checks against the locked rows (action's own codes)
 *   4. role check                      -> 403 TRANSITION_NOT_PERMITTED_FOR_ROLE
 *   5. remaining preconditions
 *   6. effects, including the status write and history, in the same transaction
 */
export async function runTransition<R = unknown>(name: ActionName, req: TransitionRequest): Promise<R> {
  const entry = CATALOGUE[name];
  const impl = ACTIONS[name] as ActionImpl<R>;

  if (entry.notesRequired && !req.input?.notes?.trim()) {
    throw new AppError('A note is required for this change.', 400, 'VALIDATION_ERROR', [
      { path: ['notes'], message: 'notes is required' },
    ]);
  }

  return await db.transaction().execute(async (trx) => {
    const state = await lockFor(trx, entry.lock, req);
    impl.checkState(state, req);
    if (!entry.roles.includes(req.actor.role)) {
      throw new AppError('Your role cannot make this change.', 403, 'TRANSITION_NOT_PERMITTED_FOR_ROLE', {
        action: name,
        role: req.actor.role,
      });
    }
    impl.checkPreconditions?.(state, req);
    return await impl.apply(trx, state, req);
  });
}

async function lockOrder(trx: Trx, orderId: string): Promise<OrderRow> {
  const order = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
  return order;
}

/**
 * Children before the order, never after: one item, all items (by id), the
 * rider's own delivery, or the order's active deliveries (by id). Payment rows
 * are only touched after the order.
 */
async function lockFor(trx: Trx, kind: LockKind, req: TransitionRequest): Promise<LockedState> {
  switch (kind) {
    case 'order':
      return { order: await lockOrder(trx, req.orderId!) };

    case 'item': {
      // Scoped to the order in the URL: another order's item is the same 404.
      const item = await trx
        .selectFrom('order_items')
        .selectAll()
        .where('id', '=', req.itemId!)
        .where('order_id', '=', req.orderId!)
        .forUpdate()
        .executeTakeFirst();
      if (!item) {
        throw new AppError('Order item not found on this order.', 404, 'ORDER_ITEM_NOT_FOUND', {
          order_id: req.orderId,
          item_id: req.itemId,
        });
      }
      return { item, order: await lockOrder(trx, req.orderId!) };
    }

    case 'allItems': {
      const items = await trx
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', req.orderId!)
        .orderBy('id')
        .forUpdate()
        .execute();
      return { items, order: await lockOrder(trx, req.orderId!) };
    }

    case 'riderDelivery': {
      // Scoped to the caller's rider profile: another rider's delivery is a 404.
      const delivery = await trx
        .selectFrom('deliveries')
        .selectAll()
        .where('id', '=', req.deliveryId!)
        .where('rider_id', '=', req.riderId!)
        .forUpdate()
        .executeTakeFirst();
      if (!delivery) throw new AppError('Delivery assignment not found.', 404, 'DELIVERY_NOT_FOUND');
      return { delivery, order: await lockOrder(trx, delivery.order_id) };
    }

    case 'activeDeliveries': {
      const activeDeliveries = await trx
        .selectFrom('deliveries')
        .selectAll()
        .where('order_id', '=', req.orderId!)
        .where('assignment_status', 'in', ACTIVE_DELIVERY_STATUSES)
        .orderBy('id')
        .forUpdate()
        .execute();
      const order = await lockOrder(trx, req.orderId!);
      // A delivery created between the two locks (a concurrent assignment)
      // would have to be locked after the order - the wrong order. Refuse
      // instead; the caller re-reads and retries.
      const now = await trx
        .selectFrom('deliveries')
        .select('id')
        .where('order_id', '=', req.orderId!)
        .where('assignment_status', 'in', ACTIVE_DELIVERY_STATUSES)
        .orderBy('id')
        .execute();
      if (now.map((d) => d.id).join() !== activeDeliveries.map((d) => d.id).join()) {
        throw new AppError('This order changed while it was being updated. Refresh and try again.', 409, 'ORDER_CHANGED');
      }
      return { order, activeDeliveries };
    }
  }
}
