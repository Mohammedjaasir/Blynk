import type { OrderStatus } from '../../../../database/types.js';
import { AppError } from '../../../../middleware/error.middleware.js';
import { ACTIVE_DELIVERY_STATUSES, CATALOGUE, type ActionName } from '../catalogue.js';
import { enqueueCustomerSms } from '../notify.js';
import { settleCod, type CodSettlement } from '../settlement.js';
import { setOrderStatus } from '../status-writer.js';
import type { ActionImpl, DeliveryRow, LockedState, OrderRow } from '../types.js';
import { cancelOrder, closeDeliveryAsFailed, invalidTransition } from './shared.js';

function assertFrom(action: ActionName, order: OrderRow, requested: OrderStatus) {
  if (!CATALOGUE[action].from.includes(order.order_status)) throw invalidTransition(order, requested);
}

/**
 * #4 ASSIGN_RIDER - manual dispatch by the store manager (§H): a PACKED
 * order, an existing active rider, one active assignment per order. The
 * order status does not change; the rider's pickup (or a hand-over) does that.
 */
export const assignRider: ActionImpl<DeliveryRow> = {
  checkState({ order }) {
    if (order.order_status !== 'PACKED') {
      throw new AppError('Only packed orders can be assigned to a rider.', 422, 'ORDER_NOT_READY_FOR_ASSIGNMENT', {
        order_status: order.order_status,
      });
    }
  },
  async apply(trx, { order }, req) {
    const riderId = req.input!.rider_id!;
    const rider = await trx.selectFrom('riders').selectAll().where('id', '=', riderId).executeTakeFirst();
    if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
    if (!rider.is_active) throw new AppError('This rider is inactive.', 409, 'RIDER_INACTIVE');

    const active = await trx
      .selectFrom('deliveries')
      .select('id')
      .where('order_id', '=', order.id)
      .where('assignment_status', 'in', ACTIVE_DELIVERY_STATUSES)
      .executeTakeFirst();
    if (active) throw new AppError('This order already has an active rider.', 409, 'ORDER_ALREADY_ASSIGNED');

    let delivery: DeliveryRow;
    try {
      delivery = await trx
        .insertInto('deliveries')
        .values({
          order_id: order.id,
          rider_id: riderId,
          assignment_status: 'ASSIGNED',
          cod_collected_amount: 0.0,
          assigned_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      // uq_deliveries_active_assignment: the last line of defence.
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('This order already has an active rider.', 409, 'ORDER_ALREADY_ASSIGNED');
      }
      throw err;
    }

    // One message per assignment, so a replacement rider after a re-stage is announced too.
    await enqueueCustomerSms(trx, order, 'RIDER_ASSIGNED', `order_${order.id}_${delivery.id}_RIDER_ASSIGNED_SMS`, {
      order_number: order.order_number,
      rider_name: 'Blynk Rider',
      vehicle_registration_number: rider.vehicle_registration_number,
    });
    return delivery;
  },
};

/** #13 ADMIN_CANCEL - operations cancellation before dispatch (D10); the note is the customer-visible reason. */
export const adminCancel: ActionImpl<OrderRow> = {
  checkState({ order }) {
    assertFrom('ADMIN_CANCEL', order, 'CANCELLED');
  },
  async apply(trx, { order }, req) {
    return await cancelOrder(trx, order, req.actor, req.input!.notes!.trim());
  },
};

/** The one delivery on the road for this order (picked up, or at the door). */
function deliveryOnTheRoad({ activeDeliveries }: LockedState): DeliveryRow | undefined {
  return (activeDeliveries ?? []).find(
    (d) => d.assignment_status === 'PICKED_UP' || d.assignment_status === 'ARRIVED_AT_CUSTOMER'
  );
}

function requireDeliveryOnTheRoad(state: LockedState): DeliveryRow {
  const delivery = deliveryOnTheRoad(state);
  if (!delivery) {
    throw new AppError('This order has no rider on the road.', 422, 'NO_ACTIVE_DELIVERY');
  }
  return delivery;
}

/**
 * #10 ADMIN_MARK_DELIVERED - an admin records the handover and the cash
 * (§G: OUT_FOR_DELIVERY -> DELIVERED by RIDER, ADMIN; D4) through the same
 * settlement as the rider, for exactly the order total read under the lock.
 */
export const adminMarkDelivered: ActionImpl<CodSettlement> = {
  checkState({ order }) {
    assertFrom('ADMIN_MARK_DELIVERED', order, 'DELIVERED');
  },
  checkPreconditions(state) {
    requireDeliveryOnTheRoad(state);
    if (state.order.payment_status === 'PAID') {
      throw new AppError('Cash for this order has already been collected.', 409, 'COD_ALREADY_COLLECTED');
    }
    if (state.order.payment_method !== 'COD') {
      throw new AppError('This order is not cash on delivery.', 422, 'NOT_COD_ORDER');
    }
  },
  async apply(trx, state, req) {
    return await settleCod(trx, {
      delivery: deliveryOnTheRoad(state)!,
      order: state.order,
      amount: Number(state.order.total_amount),
      actor: req.actor,
      note: req.input!.notes!.trim(),
    });
  },
};

function markOnTheRoadAs(action: 'ADMIN_MARK_FAILED' | 'ADMIN_MARK_CUSTOMER_UNAVAILABLE', to: OrderStatus) {
  const impl: ActionImpl<OrderRow> = {
    checkState({ order }) {
      assertFrom(action, order, to);
    },
    checkPreconditions(state) {
      requireDeliveryOnTheRoad(state);
    },
    async apply(trx, state, req) {
      const notes = req.input!.notes!.trim();
      // Closing the attempt frees the order for a replacement rider (#14, #4).
      await closeDeliveryAsFailed(trx, deliveryOnTheRoad(state)!, notes);
      return await setOrderStatus(trx, state.order, to, req.actor, notes);
    },
  };
  return impl;
}

/** #11 ADMIN_MARK_FAILED (D5). */
export const adminMarkFailed = markOnTheRoadAs('ADMIN_MARK_FAILED', 'FAILED');
/** #12 ADMIN_MARK_CUSTOMER_UNAVAILABLE (D5). */
export const adminMarkCustomerUnavailable = markOnTheRoadAs('ADMIN_MARK_CUSTOMER_UNAVAILABLE', 'CUSTOMER_UNAVAILABLE');

/**
 * #14 RESTAGE (D6 = B) - the bag is back at the store after a failed attempt;
 * the order returns to PACKED so a replacement rider can be assigned
 * (PRD §3.6, business rules §7, §H "a replacement rider can be assigned
 * immediately"). Only once the failed attempt is closed.
 */
export const restage: ActionImpl<OrderRow> = {
  checkState({ order }) {
    assertFrom('RESTAGE', order, 'PACKED');
  },
  checkPreconditions({ activeDeliveries }) {
    if ((activeDeliveries ?? []).length > 0) {
      throw new AppError('This order still has an active rider.', 422, 'ACTIVE_DELIVERY_EXISTS');
    }
  },
  async apply(trx, { order }, req) {
    return await setOrderStatus(trx, order, 'PACKED', req.actor, req.input!.notes!.trim());
  },
};
