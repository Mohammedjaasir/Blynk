import { sql, Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import { Database, OrderStatus, ItemFulfillmentStatus } from '../../database/types.js';

export type DBConnection = Transaction<Database> | typeof db;

export interface CreateOrderData {
  order_number: string;
  idempotency_key: string;
  customer_id: string;
  dark_store_id: string;
  subtotal_amount: number;
  delivery_fee: number;
  total_amount: number;
  scheduled_for: Date | null;
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  delivery_postal_code: string | null;
  delivery_latitude: number;
  delivery_longitude: number;
  delivery_instructions: string | null;
  customer_notes: string | null;
  items: Array<{
    product_id: string;
    product_name_snapshot: string;
    sku_snapshot: string;
    unit_snapshot: string;
    unit_selling_price: number;
    estimated_unit_cost: number;
    markup_percentage_applied: number;
    quantity: number;
    subtotal: number;
  }>;
}

export class OrderRepository {
  /**
   * Retrieves active dark store hub (Dharga Town).
   */
  async findActiveDarkStore(executor: DBConnection = db) {
    return await executor
      .selectFrom('dark_stores')
      .selectAll()
      .where('is_active', '=', true)
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * Retrieves default delivery fee configuration (default: 70.00 LKR).
   */
  async getDeliveryFee(executor: DBConnection = db): Promise<number> {
    const config = await executor
      .selectFrom('system_configurations')
      .selectAll()
      .where('key', '=', 'delivery_fee')
      .executeTakeFirst();

    if (config && typeof config.value === 'object' && config.value !== null) {
      const val = (config.value as any).fee_lkr;
      if (typeof val === 'number') return val;
    }
    return 70.0;
  }

  /**
   * Retrieves default markup configuration (default: 20.00%).
   */
  async getDefaultMarkup(executor: DBConnection = db): Promise<number> {
    const config = await executor
      .selectFrom('system_configurations')
      .selectAll()
      .where('key', '=', 'default_markup')
      .executeTakeFirst();

    if (config && typeof config.value === 'object' && config.value !== null) {
      const val = (config.value as any).markup_percent;
      if (typeof val === 'number') return val;
    }
    return 20.0;
  }

  /**
   * Finds customer delivery address by ID.
   */
  async findCustomerAddress(userId: string, addressId: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('customer_addresses')
      .selectAll()
      .where('id', '=', addressId)
      .where('user_id', '=', userId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
  }

  /**
   * Finds order by idempotency key.
   */
  async findOrderByIdempotencyKey(key: string, executor: DBConnection = db) {
    const order = await executor
      .selectFrom('orders')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst();

    if (!order) return null;
    return await this.findOrderById(order.id, undefined, executor);
  }

  /**
   * Queries products by IDs.
   */
  async findProductsByIds(productIds: string[], executor: DBConnection = db) {
    return await executor
      .selectFrom('products')
      .selectAll()
      .where('id', 'in', productIds)
      .execute();
  }

  /**
   * Atomic Order Creation Pipeline.
   */
  async createOrderAtomic(data: CreateOrderData) {
    return await db.transaction().execute(async (trx) => {
      // 1. Insert orders record
      const [order] = await trx
        .insertInto('orders')
        .values({
          order_number: data.order_number,
          idempotency_key: data.idempotency_key,
          customer_id: data.customer_id,
          dark_store_id: data.dark_store_id,
          order_status: 'PLACED',
          payment_method: 'COD',
          payment_status: 'PENDING',
          subtotal_amount: data.subtotal_amount,
          delivery_fee: data.delivery_fee,
          total_amount: data.total_amount,
          scheduled_for: data.scheduled_for,
          delivery_recipient_name: data.delivery_recipient_name,
          delivery_recipient_phone: data.delivery_recipient_phone,
          delivery_address_line1: data.delivery_address_line1,
          delivery_address_line2: data.delivery_address_line2,
          delivery_city: data.delivery_city,
          delivery_postal_code: data.delivery_postal_code,
          delivery_latitude: data.delivery_latitude,
          delivery_longitude: data.delivery_longitude,
          delivery_instructions: data.delivery_instructions,
          customer_notes: data.customer_notes,
          placed_at: new Date(),
        })
        .returningAll()
        .execute();

      // 2. Insert order items
      const itemInserts = data.items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        product_name_snapshot: item.product_name_snapshot,
        sku_snapshot: item.sku_snapshot,
        unit_snapshot: item.unit_snapshot,
        unit_selling_price: item.unit_selling_price,
        estimated_unit_cost: item.estimated_unit_cost,
        markup_percentage_applied: item.markup_percentage_applied,
        quantity: item.quantity,
        subtotal: item.subtotal,
        item_status: 'PENDING' as ItemFulfillmentStatus,
      }));

      const items = await trx
        .insertInto('order_items')
        .values(itemInserts)
        .returningAll()
        .execute();

      // 3. Insert payment record (Phase 1: COD PENDING)
      const [payment] = await trx
        .insertInto('payments')
        .values({
          order_id: order.id,
          payment_method: 'COD',
          payment_status: 'PENDING',
          amount: data.total_amount,
        })
        .returningAll()
        .execute();

      // 4. Record initial status in order_status_history
      await trx
        .insertInto('order_status_history')
        .values({
          order_id: order.id,
          old_status: null,
          new_status: 'PLACED',
          changed_by_user_id: data.customer_id,
          reason_or_notes: 'Order placed by customer',
        })
        .execute();

      // 5. Enqueue outbox notification
      await trx
        .insertInto('notifications')
        .values({
          user_id: data.customer_id,
          order_id: order.id,
          idempotency_key: `order_${order.id}_PLACED_SMS`,
          channel: 'SMS',
          notification_type: 'ORDER_PLACED',
          recipient: data.delivery_recipient_phone,
          payload: {
            order_number: order.order_number,
            total_amount: order.total_amount,
            scheduled_for: order.scheduled_for,
          },
          status: 'QUEUED',
        })
        .execute();

      return {
        ...order,
        subtotal_amount: Number(Number(order.subtotal_amount).toFixed(2)),
        delivery_fee: Number(Number(order.delivery_fee).toFixed(2)),
        total_amount: Number(Number(order.total_amount).toFixed(2)),
        delivery_latitude: Number(order.delivery_latitude),
        delivery_longitude: Number(order.delivery_longitude),
        items: items.map((it) => ({
          ...it,
          unit_selling_price: Number(Number(it.unit_selling_price).toFixed(2)),
          subtotal: Number(Number(it.subtotal).toFixed(2)),
        })),
        payment: {
          ...payment,
          amount: Number(Number(payment.amount).toFixed(2)),
        },
      };
    });
  }

  /**
   * Retrieves single order by ID with items, payment, and status history.
   */
  async findOrderById(orderId: string, customerId?: string, executor: DBConnection = db) {
    let query = executor
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', orderId);

    if (customerId) {
      query = query.where('customer_id', '=', customerId);
    }

    const order = await query.executeTakeFirst();
    if (!order) return null;

    const [items, payment, history, delivery] = await Promise.all([
      executor
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .execute(),
      executor
        .selectFrom('payments')
        .selectAll()
        .where('order_id', '=', orderId)
        .executeTakeFirst(),
      executor
        .selectFrom('order_status_history')
        .selectAll()
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .execute(),
      executor
        .selectFrom('deliveries')
        .selectAll()
        .where('order_id', '=', orderId)
        .where('assignment_status', 'not in', ['FAILED', 'REJECTED'])
        .executeTakeFirst(),
    ]);

    return {
      ...order,
      subtotal_amount: Number(Number(order.subtotal_amount).toFixed(2)),
      delivery_fee: Number(Number(order.delivery_fee).toFixed(2)),
      total_amount: Number(Number(order.total_amount).toFixed(2)),
      items: items.map((it) => ({
        ...it,
        unit_selling_price: Number(Number(it.unit_selling_price).toFixed(2)),
        subtotal: Number(Number(it.subtotal).toFixed(2)),
      })),
      payment: payment
        ? {
            ...payment,
            amount: Number(Number(payment.amount).toFixed(2)),
          }
        : null,
      history,
      delivery: delivery || null,
    };
  }

  /**
   * Retrieves customer order list.
   */
  async findCustomerOrders(
    customerId: string,
    page: number,
    limit: number,
    status?: OrderStatus,
    executor: DBConnection = db
  ) {
    const offset = (page - 1) * limit;

    let query = executor
      .selectFrom('orders')
      .selectAll()
      .where('customer_id', '=', customerId);

    if (status) {
      query = query.where('order_status', '=', status);
    }

    const orders = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return orders.map((o) => ({
      ...o,
      subtotal_amount: Number(Number(o.subtotal_amount).toFixed(2)),
      delivery_fee: Number(Number(o.delivery_fee).toFixed(2)),
      total_amount: Number(Number(o.total_amount).toFixed(2)),
    }));
  }

  async countCustomerOrders(customerId: string, status?: OrderStatus, executor: DBConnection = db) {
    let query = executor
      .selectFrom('orders')
      .select(sql<string>`count(*)`.as('count'))
      .where('customer_id', '=', customerId);

    if (status) {
      query = query.where('order_status', '=', status);
    }

    const result = await query.executeTakeFirst();
    return result ? parseInt(result.count, 10) : 0;
  }

  /**
   * Cancels order.
   */
  async cancelOrder(
    orderId: string,
    userId: string,
    reason?: string,
    executor: DBConnection = db
  ) {
    return await executor.transaction().execute(async (trx) => {
      const [order] = await trx
        .updateTable('orders')
        .set({
          order_status: 'CANCELLED',
          cancellation_reason: reason || 'Cancelled by customer',
          cancelled_by_user_id: userId,
          cancelled_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', orderId)
        .returningAll()
        .execute();

      await trx
        .insertInto('order_status_history')
        .values({
          order_id: orderId,
          old_status: order.order_status,
          new_status: 'CANCELLED',
          changed_by_user_id: userId,
          reason_or_notes: reason || 'Cancelled by customer',
        })
        .execute();

      return order;
    });
  }

  // --------------------------------------------------------------------------
  // STORE / ADMIN OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Retrieves orders for admin / packing queue.
   */
  async findAdminOrders(
    params: { status?: OrderStatus; limit: number; offset: number },
    executor: DBConnection = db
  ) {
    let query = executor
      .selectFrom('orders')
      .selectAll();

    if (params.status) {
      query = query.where('order_status', '=', params.status);
    }

    return await query
      .orderBy('placed_at', 'asc')
      .limit(params.limit)
      .offset(params.offset)
      .execute();
  }

  async countAdminOrders(status?: OrderStatus, executor: DBConnection = db) {
    let query = executor
      .selectFrom('orders')
      .select(sql<string>`count(*)`.as('count'));

    if (status) {
      query = query.where('order_status', '=', status);
    }

    const res = await query.executeTakeFirst();
    return res ? parseInt(res.count, 10) : 0;
  }

  /**
   * Updates order status (e.g. PLACED -> PACKED).
   */
  async updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    changedByUserId: string,
    notes?: string,
    executor: DBConnection = db
  ) {
    return await executor.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirst();

      if (!current) return null;

      const updateData: any = {
        order_status: newStatus,
        updated_at: new Date(),
      };

      if (newStatus === 'PACKED') {
        updateData.packed_at = new Date();
      } else if (newStatus === 'OUT_FOR_DELIVERY') {
        updateData.dispatched_at = new Date();
      } else if (newStatus === 'DELIVERED') {
        updateData.delivered_at = new Date();
      }

      const [updated] = await trx
        .updateTable('orders')
        .set(updateData)
        .where('id', '=', orderId)
        .returningAll()
        .execute();

      await trx
        .insertInto('order_status_history')
        .values({
          order_id: orderId,
          old_status: current.order_status,
          new_status: newStatus,
          changed_by_user_id: changedByUserId,
          reason_or_notes: notes || `Status updated to ${newStatus}`,
        })
        .execute();

      return updated;
    });
  }

  /**
   * Out-of-Stock Resolution: Marks an order item UNAVAILABLE and recalculates totals.
   */
  async resolveUnavailableItem(
    orderId: string,
    itemId: string,
    itemStatus: ItemFulfillmentStatus = 'UNAVAILABLE',
    executor: DBConnection = db
  ) {
    return await executor.transaction().execute(async (trx) => {
      // 1. Update item status
      await trx
        .updateTable('order_items')
        .set({ item_status: itemStatus })
        .where('id', '=', itemId)
        .where('order_id', '=', orderId)
        .execute();

      // 2. Recalculate remaining active items subtotal
      const activeItems = await trx
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', orderId)
        .where('item_status', '!=', 'UNAVAILABLE')
        .execute();

      const newSubtotal = activeItems.reduce(
        (sum, it) => sum + Number(it.subtotal),
        0
      );

      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const newTotal = Number((newSubtotal + Number(order.delivery_fee)).toFixed(2));

      // 3. Update orders subtotal and total
      const [updatedOrder] = await trx
        .updateTable('orders')
        .set({
          subtotal_amount: Number(newSubtotal.toFixed(2)),
          total_amount: newTotal,
          order_status: 'ITEM_UNAVAILABLE',
          updated_at: new Date(),
        })
        .where('id', '=', orderId)
        .returningAll()
        .execute();

      // 4. Update payment amount
      await trx
        .updateTable('payments')
        .set({
          amount: newTotal,
          updated_at: new Date(),
        })
        .where('order_id', '=', orderId)
        .execute();

      return updatedOrder;
    });
  }

  /**
   * Assigns order to rider (enforces partial unique index uq_deliveries_active_assignment).
   */
  async assignRider(orderId: string, riderId: string, executor: DBConnection = db) {
    return await executor.transaction().execute(async (trx) => {
      const [delivery] = await trx
        .insertInto('deliveries')
        .values({
          order_id: orderId,
          rider_id: riderId,
          assignment_status: 'ASSIGNED',
          cod_collected_amount: 0.0,
          assigned_at: new Date(),
        })
        .returningAll()
        .execute();

      return delivery;
    });
  }
}

export const orderRepository = new OrderRepository();
