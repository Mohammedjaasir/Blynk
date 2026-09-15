import { db } from '../../database/connection.js';
import { DBConnection } from '../orders/order.repository.js';
import { DeliveryAssignmentStatus } from '../../database/types.js';

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
   * Lists active assigned deliveries for a rider.
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
      .where('deliveries.assignment_status', 'not in', ['FAILED', 'REJECTED'])
      .orderBy('deliveries.assigned_at', 'desc')
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

    return {
      ...row,
      total_amount: Number(Number(row.total_amount).toFixed(2)),
      cod_collected_amount: Number(Number(row.cod_collected_amount).toFixed(2)),
      delivery_latitude: Number(row.delivery_latitude),
      delivery_longitude: Number(row.delivery_longitude),
    };
  }

  /**
   * Transitions delivery status and syncs order status.
   */
  async updateDeliveryStatus(
    deliveryId: string,
    riderId: string,
    newStatus: DeliveryAssignmentStatus,
    userId: string,
    failureReason?: string,
    executor: DBConnection = db
  ) {
    return await executor.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('deliveries')
        .selectAll()
        .where('id', '=', deliveryId)
        .where('rider_id', '=', riderId)
        .forUpdate()
        .executeTakeFirst();

      if (!current) return null;

      const updateData: any = {
        assignment_status: newStatus,
        updated_at: new Date(),
      };

      if (newStatus === 'ACCEPTED') {
        updateData.accepted_at = new Date();
      } else if (newStatus === 'PICKED_UP') {
        updateData.picked_up_at = new Date();
      } else if (newStatus === 'DELIVERED') {
        updateData.delivered_at = new Date();
      } else if (newStatus === 'FAILED' || newStatus === 'REJECTED') {
        updateData.failed_at = new Date();
        updateData.failure_reason = failureReason || `Delivery ${newStatus}`;
      }

      const [updatedDelivery] = await trx
        .updateTable('deliveries')
        .set(updateData)
        .where('id', '=', deliveryId)
        .returningAll()
        .execute();

      // Sync Order Status:
      if (newStatus === 'PICKED_UP') {
        await trx
          .updateTable('orders')
          .set({
            order_status: 'OUT_FOR_DELIVERY',
            dispatched_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', current.order_id)
          .execute();

        await trx
          .insertInto('order_status_history')
          .values({
            order_id: current.order_id,
            old_status: 'PACKED',
            new_status: 'OUT_FOR_DELIVERY',
            changed_by_user_id: userId,
            reason_or_notes: 'Rider picked up order for delivery',
          })
          .execute();
      } else if (newStatus === 'FAILED') {
        await trx
          .updateTable('orders')
          .set({
            order_status: 'FAILED',
            updated_at: new Date(),
          })
          .where('id', '=', current.order_id)
          .execute();

        await trx
          .insertInto('order_status_history')
          .values({
            order_id: current.order_id,
            old_status: 'OUT_FOR_DELIVERY',
            new_status: 'FAILED',
            changed_by_user_id: userId,
            reason_or_notes: failureReason || 'Delivery failed',
          })
          .execute();
      }

      return updatedDelivery;
    });
  }

  /**
   * Doorstep COD Cash Collection: Transitions Delivery -> DELIVERED, Payment -> PAID, Order -> DELIVERED.
   */
  async collectCod(
    deliveryId: string,
    riderId: string,
    collectedAmount: number,
    userId: string,
    executor: DBConnection = db
  ) {
    return await executor.transaction().execute(async (trx) => {
      const delivery = await trx
        .selectFrom('deliveries')
        .selectAll()
        .where('id', '=', deliveryId)
        .where('rider_id', '=', riderId)
        .forUpdate()
        .executeTakeFirst();

      if (!delivery) return null;

      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', delivery.order_id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const now = new Date();

      // 1. Mark Delivery DELIVERED & record collected cash
      await trx
        .updateTable('deliveries')
        .set({
          assignment_status: 'DELIVERED',
          cod_collected_amount: collectedAmount,
          delivered_at: now,
          updated_at: now,
        })
        .where('id', '=', deliveryId)
        .execute();

      // 2. Mark Payment PAID
      await trx
        .updateTable('payments')
        .set({
          payment_status: 'PAID',
          paid_at: now,
          updated_at: now,
        })
        .where('order_id', '=', order.id)
        .execute();

      // 3. Mark Order DELIVERED
      await trx
        .updateTable('orders')
        .set({
          order_status: 'DELIVERED',
          payment_status: 'PAID',
          delivered_at: now,
          updated_at: now,
        })
        .where('id', '=', order.id)
        .execute();

      // 4. Log status history
      await trx
        .insertInto('order_status_history')
        .values({
          order_id: order.id,
          old_status: order.order_status,
          new_status: 'DELIVERED',
          changed_by_user_id: userId,
          reason_or_notes: `Delivered and collected ${collectedAmount.toFixed(2)} LKR in cash`,
        })
        .execute();

      return {
        delivery_id: deliveryId,
        order_id: order.id,
        order_status: 'DELIVERED',
        payment_status: 'PAID',
        cod_collected_amount: collectedAmount,
        delivered_at: now,
      };
    });
  }
}

export const riderRepository = new RiderRepository();
