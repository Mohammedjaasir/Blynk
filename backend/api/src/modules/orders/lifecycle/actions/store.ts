import { sql } from 'kysely';
import { AppError } from '../../../../middleware/error.middleware.js';
import { lockInventoryRows, recordStockMovement } from '../../../inventory/stock-ledger.js';
import { CATALOGUE, ITEM_WORK_STATES, packingBlockers } from '../catalogue.js';
import { enqueueCustomerSms } from '../notify.js';
import { recomputeOrderDiscount } from '../../../coupons/coupon.service.js';
import { recomputeBirthdayDiscount } from '../../../birthday/birthday.offer.js';
import { setOrderStatus, updateOrderFields } from '../status-writer.js';
import type { ActionImpl, Actor, DeliveryRow, ItemRow, LockedState, OrderRow, Trx } from '../types.js';
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
    const subtotal = Number(remaining.reduce((sum, it) => sum + Number(it.subtotal), 0).toFixed(2));
    // A coupon's discount follows the new subtotal (migration 018; coupons/coupon.service.ts).
    // A birthday gift (migration 034) stays the same % of the new subtotal.
    const birthday = Number(order.birthday_discount_amount ?? 0) > 0 ? await recomputeBirthdayDiscount(trx, order.id, subtotal) : null;
    const discount =
      birthday !== null
        ? birthday
        : order.coupon_code
          ? await recomputeOrderDiscount(trx, order.id, subtotal, Number(order.delivery_fee))
          : Number(order.discount_amount ?? 0);
    const total = Number((subtotal + Number(order.delivery_fee) - discount).toFixed(2));
    const fields = {
      subtotal_amount: subtotal,
      discount_amount: discount,
      ...(birthday !== null ? { birthday_discount_amount: birthday } : {}),
      total_amount: total,
    };

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

/**
 * What sourcing used to do, done by the pack for every PENDING item (owner,
 * 2026-09-30: the lead fills the order from the shelf, there is no separate
 * sourcing step): the actual cost is the estimated cost, a sourcing record
 * keeps the audit trail, and a TRACKED product's units leave the shelf
 * (ORDER_FULFILLMENT) through the canonical stock writer. Any short product
 * refuses the whole pack. Lock order: items -> order -> inventory rows.
 */
async function sourcePendingItems(trx: Trx, order: OrderRow, items: ItemRow[], actor: Actor): Promise<void> {
  const pending = items.filter((i) => i.item_status === 'PENDING');
  if (pending.length === 0) return;

  const needed = new Map<string, { quantity: number; name: string }>();
  for (const it of pending) {
    const prev = needed.get(it.product_id);
    needed.set(it.product_id, { quantity: (prev?.quantity ?? 0) + it.quantity, name: it.product_name_snapshot });
  }
  const tracked = (await lockInventoryRows(trx, order.dark_store_id, [...needed.keys()])).filter(
    (row) => row.tracking_mode === 'TRACKED'
  );
  for (const row of tracked) {
    const need = needed.get(row.product_id)!;
    if (row.quantity_on_hand < need.quantity) {
      throw new AppError(
        `Not enough stock of ${need.name} to pack this order: ${row.quantity_on_hand} on hand, ${need.quantity} needed.`,
        409,
        'INSUFFICIENT_TRACKED_INVENTORY',
        { product_id: row.product_id, product_name: need.name, on_hand: row.quantity_on_hand, requested: need.quantity }
      );
    }
  }
  for (const row of tracked) {
    const need = needed.get(row.product_id)!;
    await recordStockMovement(trx, {
      inventory: row,
      delta: -need.quantity,
      type: 'ORDER_FULFILLMENT',
      orderId: order.id,
      actorId: actor.id,
      notes: `Order ${order.order_number} packed: ${need.quantity} x ${need.name}`,
    });
  }

  await trx
    .updateTable('order_items')
    .set({ actual_unit_cost: sql`estimated_unit_cost`, item_status: 'PACKED' })
    .where('order_id', '=', order.id)
    .where('item_status', '=', 'PENDING')
    .execute();
  await trx
    .insertInto('sourcing_records')
    .values(
      pending.map((it) => ({
        order_id: order.id,
        order_item_id: it.id,
        product_id: it.product_id,
        supplier_id: null,
        quantity_sourced: it.quantity,
        estimated_unit_cost: it.estimated_unit_cost,
        actual_unit_cost: it.estimated_unit_cost,
        sourcing_status: 'SOURCED' as const,
        notes: 'Taken from the shelf when the order was packed',
        sourced_by_user_id: actor.id,
      }))
    )
    .execute();
}

/**
 * #3 PACK - the bag is packed (§G). Items not yet sourced are sourced here at
 * their estimated cost (sourcePendingItems); items already sourced keep their
 * recorded cost.
 */
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
  async apply(trx, { order, items }, req) {
    await sourcePendingItems(trx, order, items ?? [], req.actor);
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
