import { sql, Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import { Database, OrderStatus, ItemFulfillmentStatus } from '../../database/types.js';
import { ACTIVE_DELIVERY_STATUSES, INITIAL_ORDER_STATUS } from './lifecycle/catalogue.js';
import { recordOrderPlaced } from './lifecycle/status-writer.js';

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
          order_status: INITIAL_ORDER_STATUS,
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

      // 4. Record initial status in order_status_history (lifecycle PLACE_ORDER)
      await recordOrderPlaced(trx, order.id, data.customer_id);

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
        .innerJoin('riders', 'riders.id', 'deliveries.rider_id')
        .innerJoin('users', 'users.id', 'riders.user_id')
        .selectAll('deliveries')
        .select('users.full_name as rider_name')
        .where('deliveries.order_id', '=', orderId)
        .where('deliveries.assignment_status', 'not in', ['FAILED', 'REJECTED'])
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

    // The list shows what is in each order ("2 items"): one query for the page.
    const items = orders.length
      ? await executor
          .selectFrom('order_items')
          .selectAll()
          .where('order_id', 'in', orders.map((o) => o.id))
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .execute()
      : [];

    return orders.map((o) => ({
      ...o,
      subtotal_amount: Number(Number(o.subtotal_amount).toFixed(2)),
      delivery_fee: Number(Number(o.delivery_fee).toFixed(2)),
      total_amount: Number(Number(o.total_amount).toFixed(2)),
      items: items
        .filter((it) => it.order_id === o.id)
        .map((it) => ({
          ...it,
          unit_selling_price: Number(Number(it.unit_selling_price).toFixed(2)),
          subtotal: Number(Number(it.subtotal).toFixed(2)),
        })),
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

  // --------------------------------------------------------------------------
  // STORE / ADMIN OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Orders for the staff screens (packing queue, Orders board), oldest first,
   * each with its item progress and its active rider - two grouped queries
   * for the whole page, not one per order.
   */
  async findAdminOrders(
    params: { statuses?: OrderStatus[]; since?: Date; limit: number; offset: number },
    executor: DBConnection = db
  ) {
    let query = executor.selectFrom('orders').selectAll();
    if (params.statuses?.length) query = query.where('order_status', 'in', params.statuses);
    if (params.since) query = query.where('updated_at', '>=', params.since);

    const orders = await query.orderBy('placed_at', 'asc').orderBy('id', 'asc').limit(params.limit).offset(params.offset).execute();
    if (orders.length === 0) return [];
    const ids = orders.map((o) => o.id);

    const summaries = await executor
      .selectFrom('order_items')
      .select([
        'order_id',
        sql<number>`count(*)::int`.as('total'),
        sql<number>`(count(*) filter (where item_status = 'PENDING'))::int`.as('pending'),
        sql<number>`(count(*) filter (where item_status = 'SOURCED'))::int`.as('sourced'),
        sql<number>`(count(*) filter (where item_status = 'PACKED'))::int`.as('packed'),
        sql<number>`(count(*) filter (where item_status = 'UNAVAILABLE'))::int`.as('unavailable'),
        sql<number>`(count(*) filter (where item_status = 'SUBSTITUTED'))::int`.as('substituted'),
      ])
      .where('order_id', 'in', ids)
      .groupBy('order_id')
      .execute();

    const active = await executor
      .selectFrom('deliveries')
      .innerJoin('riders', 'riders.id', 'deliveries.rider_id')
      .innerJoin('users', 'users.id', 'riders.user_id')
      .select([
        'deliveries.id',
        'deliveries.order_id',
        'deliveries.assignment_status',
        'deliveries.rider_id',
        'users.full_name as rider_name',
      ])
      .where('deliveries.order_id', 'in', ids)
      .where('deliveries.assignment_status', 'in', ACTIVE_DELIVERY_STATUSES)
      .execute();

    return orders.map((o) => {
      const summary = summaries.find((s) => s.order_id === o.id);
      const delivery = active.find((d) => d.order_id === o.id);
      return {
        ...o,
        subtotal_amount: Number(Number(o.subtotal_amount).toFixed(2)),
        delivery_fee: Number(Number(o.delivery_fee).toFixed(2)),
        total_amount: Number(Number(o.total_amount).toFixed(2)),
        items_summary: {
          total: summary?.total ?? 0,
          pending: summary?.pending ?? 0,
          sourced: summary?.sourced ?? 0,
          packed: summary?.packed ?? 0,
          unavailable: summary?.unavailable ?? 0,
          substituted: summary?.substituted ?? 0,
        },
        active_delivery: delivery
          ? {
              id: delivery.id,
              assignment_status: delivery.assignment_status,
              rider_id: delivery.rider_id,
              rider_name: delivery.rider_name,
            }
          : null,
      };
    });
  }

  async countAdminOrders(params: { statuses?: OrderStatus[]; since?: Date } = {}, executor: DBConnection = db) {
    let query = executor.selectFrom('orders').select(sql<string>`count(*)`.as('count'));
    if (params.statuses?.length) query = query.where('order_status', 'in', params.statuses);
    if (params.since) query = query.where('updated_at', '>=', params.since);
    const res = await query.executeTakeFirst();
    return res ? parseInt(res.count, 10) : 0;
  }

  /** The current status only - for choosing a lifecycle action before it locks. */
  async findOrderStatus(orderId: string, executor: DBConnection = db) {
    const row = await executor.selectFrom('orders').select('order_status').where('id', '=', orderId).executeTakeFirst();
    return row?.order_status ?? null;
  }
}

export const orderRepository = new OrderRepository();
