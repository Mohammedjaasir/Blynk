import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { DBConnection } from '../orders/order.repository.js';
import { ACTIVE_DELIVERY_STATUSES, CLOSED_ORDER_STATUSES } from '../orders/lifecycle/catalogue.js';

/** Assignments the rider still holds. */
const ACTIVE_ASSIGNMENT_STATUSES = ACTIVE_DELIVERY_STATUSES;

/** Midnight today in the store's timezone (business rules §4: Asia/Colombo). */
const startOfTodayColombo = sql<Date>`(date_trunc('day', now() AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo')`;

export class RiderRepository {
  /**
   * Finds rider profile linked to a user.
   */
  async findRiderByUserId(userId: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('riders')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  /**
   * Active riders the store manager can assign (architecture: GET
   * /admin/riders), with how many deliveries each already holds - counted
   * from real rows. No availability flag: nothing maintains one (plan C10).
   */
  async listActiveRidersForAssignment(executor: DBConnection = db) {
    return await executor
      .selectFrom('riders')
      .innerJoin('users', 'users.id', 'riders.user_id')
      .select((eb) => [
        'riders.id',
        'users.full_name',
        'users.phone',
        'riders.vehicle_type',
        'riders.vehicle_registration_number',
        eb
          .selectFrom('deliveries')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('deliveries.rider_id', '=', 'riders.id')
          .where('deliveries.assignment_status', 'in', ACTIVE_ASSIGNMENT_STATUSES)
          .as('open_deliveries'),
      ])
      .where('riders.is_active', '=', true)
      .where('users.is_active', '=', true)
      .orderBy('users.full_name')
      .execute();
  }

  /**
   * Lists a rider's deliveries for today: everything still in hand, plus
   * what was delivered (or closed under them) since midnight Asia/Colombo.
   * Oldest assignment first - the order the rider works in.
   */
  async findActiveDeliveries(riderId: string, executor: DBConnection = db) {
    const rows = await executor
      .selectFrom('deliveries')
      .innerJoin('orders', 'deliveries.order_id', 'orders.id')
      .select([
        'deliveries.id as delivery_id',
        'deliveries.order_id',
        'deliveries.assignment_status',
        'deliveries.assigned_at',
        'deliveries.accepted_at',
        'deliveries.picked_up_at',
        'orders.order_number',
        'orders.order_status',
        'orders.total_amount',
        'orders.payment_method',
        'orders.payment_status',
        'orders.delivery_recipient_name',
        'orders.delivery_recipient_phone',
        'orders.delivery_address_line1',
        'orders.delivery_address_line2',
        'orders.delivery_city',
        'orders.delivery_latitude',
        'orders.delivery_longitude',
        'orders.delivery_instructions',
      ])
      .where('deliveries.rider_id', '=', riderId)
      .where((eb) =>
        eb.or([
          // Work in hand; a closed order (e.g. cancelled after assignment)
          // stays visible for the rest of the day so the rider knows not to
          // pick it up, then drops off.
          eb.and([
            eb('deliveries.assignment_status', 'in', ACTIVE_ASSIGNMENT_STATUSES),
            eb.or([
              eb('orders.order_status', 'not in', CLOSED_ORDER_STATUSES),
              eb('orders.updated_at', '>=', startOfTodayColombo),
            ]),
          ]),
          // Delivered today.
          eb.and([
            eb('deliveries.assignment_status', '=', 'DELIVERED'),
            eb('deliveries.delivered_at', '>=', startOfTodayColombo),
          ]),
        ])
      )
      .orderBy('deliveries.assigned_at', 'asc')
      .orderBy('deliveries.id', 'asc')
      .execute();

    return rows.map((row) => ({
      ...row,
      total_amount: Number(Number(row.total_amount).toFixed(2)),
      delivery_latitude: Number(row.delivery_latitude),
      delivery_longitude: Number(row.delivery_longitude),
    }));
  }

  /**
   * Detailed delivery view.
   */
  async findDeliveryById(deliveryId: string, riderId?: string, executor: DBConnection = db) {
    let query = executor
      .selectFrom('deliveries')
      .innerJoin('orders', 'deliveries.order_id', 'orders.id')
      .select([
        'deliveries.id as delivery_id',
        'deliveries.order_id',
        'deliveries.rider_id',
        'deliveries.assignment_status',
        'deliveries.cod_collected_amount',
        'deliveries.assigned_at',
        'deliveries.accepted_at',
        'deliveries.picked_up_at',
        'deliveries.delivered_at',
        'deliveries.failed_at',
        'deliveries.failure_reason',
        'orders.order_number',
        'orders.order_status',
        'orders.total_amount',
        'orders.payment_method',
        'orders.payment_status',
        'orders.delivery_recipient_name',
        'orders.delivery_recipient_phone',
        'orders.delivery_address_line1',
        'orders.delivery_address_line2',
        'orders.delivery_city',
        'orders.delivery_latitude',
        'orders.delivery_longitude',
        'orders.delivery_instructions',
      ])
      .where('deliveries.id', '=', deliveryId);

    if (riderId) {
      query = query.where('deliveries.rider_id', '=', riderId);
    }

    const row = await query.executeTakeFirst();
    if (!row) return null;

    // What is in the bag: names and quantities only - no prices or costs.
    // Items resolved as unavailable were removed from the order.
    const items = await executor
      .selectFrom('order_items')
      .select(['id', 'product_name_snapshot', 'quantity', 'item_status'])
      .where('order_id', '=', row.order_id)
      .where('item_status', '!=', 'UNAVAILABLE')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();

    return {
      ...row,
      items,
      total_amount: Number(Number(row.total_amount).toFixed(2)),
      cod_collected_amount: Number(Number(row.cod_collected_amount).toFixed(2)),
      delivery_latitude: Number(row.delivery_latitude),
      delivery_longitude: Number(row.delivery_longitude),
    };
  }

}

export const riderRepository = new RiderRepository();
