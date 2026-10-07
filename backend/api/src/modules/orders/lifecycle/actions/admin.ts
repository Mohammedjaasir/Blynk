import type { OrderStatus } from '../../../../database/types.js';
import { AppError } from '../../../../middleware/error.middleware.js';
import { ACTIVE_DELIVERY_STATUSES, CATALOGUE, type ActionName } from '../catalogue.js';
import { confirmWithCode, confirmWithOverride } from '../delivery-code.js';
import { enqueueCustomerSms } from '../notify.js';
import { settleCod, type CodSettlement } from '../settlement.js';
import { setOrderStatus } from '../status-writer.js';
import type { ActionImpl, DeliveryRow, LockedState, OrderRow, Trx } from '../types.js';
import { cancelOrder, closeDeliveryAsFailed, invalidTransition } from './shared.js';
import {
  distanceKm,
  findOpenDeliveriesForRiders,
  getBatchingRules,
  lockRider,
  roundKm,
  toPoint,
} from '../../../riders/batching.js';

function assertFrom(action: ActionName, order: OrderRow, requested: OrderStatus) {
  if (!CATALOGUE[action].from.includes(order.order_status)) throw invalidTransition(order, requested);
}

/**
 * #4 ASSIGN_RIDER - manual dispatch by the store manager (§H): a PACKED
 * order, an existing active rider, one active assignment per order, and the
 * rider's trip within the batching rules (checkTripRules). The
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
    // Rider row lock, taken after the order lock (no action locks a rider
    // before an order): two assignments to the same rider queue here, so the
    // second one counts the first one's delivery - the trip cap cannot be
    // raced past. Under READ COMMITTED each statement below reads afresh.
    const rider = await lockRider(trx, riderId);
    if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
    // Rider applications (migration 029): only an approved rider takes orders.
    if (rider.approval_status !== 'APPROVED') {
      throw new AppError('This rider has not been approved yet.', 409, 'RIDER_NOT_APPROVED');
    }
    if (!rider.is_active) throw new AppError('This rider is inactive.', 409, 'RIDER_INACTIVE');
    // A rider whose account is disabled (Staff accounts) cannot take an order.
    const account = await trx
      .selectFrom('users')
      .select(['is_active', 'staff_disabled_at'])
      .where('id', '=', rider.user_id)
      .executeTakeFirst();
    if (!account || !account.is_active || account.staff_disabled_at) {
      throw new AppError('This rider is inactive.', 409, 'RIDER_INACTIVE');
    }

    const active = await trx
      .selectFrom('deliveries')
      .select('id')
      .where('order_id', '=', order.id)
      .where('assignment_status', 'in', ACTIVE_DELIVERY_STATUSES)
      .executeTakeFirst();
    if (active) throw new AppError('This order already has an active rider.', 409, 'ORDER_ALREADY_ASSIGNED');

    await checkTripRules(trx, order, riderId, req.input?.confirm_far_batch === true);

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

/**
 * Rider trips (modules/riders/batching.ts): at most the configured number of
 * open deliveries per rider (409 RIDER_AT_CAPACITY), and a new drop-off
 * within the configured straight-line distance of every drop-off the rider
 * already holds - unless staff confirmed the longer trip (409
 * BATCH_DROPOFFS_TOO_FAR otherwise). Runs under the order and rider locks.
 */
async function checkTripRules(trx: Trx, order: OrderRow, riderId: string, confirmFar: boolean) {
  const rules = await getBatchingRules(trx);
  const open = await findOpenDeliveriesForRiders([riderId], trx);
  if (open.length >= rules.max_active_deliveries) {
    throw new AppError(
      `This rider already has ${open.length} open ${open.length === 1 ? 'delivery' : 'deliveries'}, the most one trip can carry.`,
      409,
      'RIDER_AT_CAPACITY',
      { open_deliveries: open.length, max_active_deliveries: rules.max_active_deliveries }
    );
  }
  if (open.length === 0 || confirmFar) return;
  const here = toPoint(order.delivery_latitude, order.delivery_longitude);
  for (const other of open) {
    // Without both pins the distance is unknown; staff must confirm it.
    const km = here && other.dropoff ? distanceKm(here, other.dropoff) : null;
    if (km === null || km > rules.max_dropoff_distance_km) {
      throw new AppError(
        km === null
          ? `How far this drop-off is from order #${other.order_number} is unknown. Confirm to add it to the trip anyway.`
          : `This drop-off is ${roundKm(km)} km from order #${other.order_number}, more than ${rules.max_dropoff_distance_km} km. Confirm to add it to the trip anyway.`,
        409,
        'BATCH_DROPOFFS_TOO_FAR',
        {
          distance_km: km === null ? null : roundKm(km),
          max_dropoff_distance_km: rules.max_dropoff_distance_km,
          other_order_number: other.order_number,
        }
      );
    }
  }
}

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
 *
 * Proof of delivery (migration 016): the customer's code, or - when the
 * customer cannot show it - a written override note. Which one was used is
 * recorded on order_delivery_codes and in the history note.
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
    const code = req.input?.delivery_code;
    const notes = req.input?.notes?.trim() ?? '';
    let note: string;
    if (code) {
      await confirmWithCode(trx, state.order.id, code, req.actor);
      note = notes ? `${notes} (customer code confirmed)` : 'Delivered (customer code confirmed)';
    } else {
      await confirmWithOverride(trx, state.order.id, req.actor, notes);
      note = `Delivered without the customer code (override): ${notes}`;
    }
    return await settleCod(trx, {
      delivery: deliveryOnTheRoad(state)!,
      order: state.order,
      amount: Number(state.order.total_amount),
      actor: req.actor,
      note,
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
