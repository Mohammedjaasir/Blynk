import { AppError } from '../../../../middleware/error.middleware.js';
import { CATALOGUE, ITEM_WORK_STATES, packingBlockers } from '../catalogue.js';
import { enqueueCustomerSms } from '../notify.js';
import { setOrderStatus, updateOrderFields } from '../status-writer.js';
import type { ActionImpl, DeliveryRow, LockedState, OrderRow } from '../types.js';
import { dispatch, invalidTransition } from './shared.js';

/**
 * #2 RESOLVE_ITEM - an item the store cannot source is removed from the bill
 * (UNAVAILABLE) or replaced (SUBSTITUTED); architecture §K. Only while the
 * order is still being packed (D9): resolving later would drag a packed or
 * on-the-road order back to ITEM_UNAVAILABLE and change the cash to collect.
 * Error codes are the Inventory app's existing contract.
 */
export const resolveItem: ActionImpl<OrderRow> = {
  checkState({ order, item }) {
    if (!ITEM_WORK_STATES.includes(order.order_status)) {
      throw new AppError(
        `Cannot resolve items for order with status '${order.order_status}'.`,
        400,
        'ORDER_NOT_IN_SOURCING_STATE',
        { order_id: order.id, order_status: order.order_status }
      );
    }
    if (item!.item_status === 'SOURCED' || item!.item_status === 'PACKED') {
      throw new AppError('This item has already been sourced.', 409, 'ITEM_ALREADY_SOURCED', {
        item_id: item!.id,
        current_status: item!.item_status,
      });
    }
    if (item!.item_status === 'UNAVAILABLE' || item!.item_status === 'SUBSTITUTED') {
      throw new AppError('This item has already been resolved.', 409, 'ITEM_ALREADY_RESOLVED', {
        item_id: item!.id,
        current_status: item!.item_status,
      });
    }
  },
  async apply(trx, { order, item }, req) {
    const itemStatus = req.input?.item_status ?? 'UNAVAILABLE';
    await trx.updateTable('order_items').set({ item_status: itemStatus }).where('id', '=', item!.id).execute();

    // Totals over what is still on the order (§K Scenario A).
    const remaining = await trx
      .selectFrom('order_items')
      .select('subtotal')
      .where('order_id', '=', order.id)
      .where('item_status', '!=', 'UNAVAILABLE')
      .execute();
    const subtotal = remaining.reduce((sum, it) => sum + Number(it.subtotal), 0);
    const total = Number((subtotal + Number(order.delivery_fee)).toFixed(2));
    const fields = { subtotal_amount: Number(subtotal.toFixed(2)), total_amount: total };

    const note = `${itemStatus === 'SUBSTITUTED' ? 'Item substituted' : 'Item unavailable'}: ${item!.product_name_snapshot}`;
    const updated =
      order.order_status === 'ITEM_UNAVAILABLE'
        ? await updateOrderFields(trx, order, fields)
        : await setOrderStatus(trx, order, 'ITEM_UNAVAILABLE', req.actor, note, fields);

    await trx
      .updateTable('payments')
      .set({ amount: total, updated_at: new Date() })
      .where('order_id', '=', order.id)
      .execute();

    await enqueueCustomerSms(trx, order, 'ITEM_UNAVAILABLE', `order_${order.id}_${item!.id}_UNAVAILABLE_SMS`, {
      order_number: order.order_number,
      item_name: item!.product_name_snapshot || 'An item',
      new_total_amount: total,
    });
    return updated;
  },
};

/** #3 PACK - items sourced and bagged, actual procurement cost recorded (§G). */
export const pack: ActionImpl<OrderRow> = {
  checkState({ order }) {
    if (!CATALOGUE.PACK.from.includes(order.order_status)) throw invalidTransition(order, 'PACKED');
  },
  checkPreconditions({ items }) {
    const blockers = packingBlockers(items ?? []);
    if (blockers) {
      throw new AppError('This order cannot be packed yet.', 422, 'ORDER_NOT_PACKABLE', blockers);
    }
  },
  async apply(trx, { order }, req) {
    // D8: the bag is packed, so are the items in it.
    await trx
      .updateTable('order_items')
      .set({ item_status: 'PACKED' })
      .where('order_id', '=', order.id)
      .where('item_status', '=', 'SOURCED')
      .execute();
    return await setOrderStatus(trx, order, 'PACKED', req.actor, req.input?.notes?.trim() || 'Packed', {
      packed_at: new Date(),
    });
  },
};

/** The single active delivery waiting at the counter, if any. */
function waitingDelivery({ activeDeliveries }: LockedState): DeliveryRow | undefined {
  const active = activeDeliveries ?? [];
  if (active.length !== 1) return undefined;
  return active[0].assignment_status === 'ASSIGNED' || active[0].assignment_status === 'ACCEPTED'
    ? active[0]
    : undefined;
}

/**
 * #5 HAND_TO_RIDER - staff hand the bag to the assigned rider (§G: PACKED ->
 * OUT_FOR_DELIVERY by PACKING_STAFF, ADMIN; D3). The delivery is marked
 * PICKED_UP in the same transaction, so the Rider app's next step is
 * "I've arrived".
 */
export const handToRider: ActionImpl<OrderRow> = {
  checkState({ order }) {
    if (!CATALOGUE.HAND_TO_RIDER.from.includes(order.order_status)) throw invalidTransition(order, 'OUT_FOR_DELIVERY');
  },
  checkPreconditions(state) {
    if (!waitingDelivery(state)) {
      throw new AppError('Assign a rider before handing the order over.', 422, 'NO_ACTIVE_DELIVERY');
    }
  },
  async apply(trx, state, req) {
    return await dispatch(trx, state.order, waitingDelivery(state)!, req.actor, req.input?.notes?.trim() || 'Handed to rider');
  },
};
