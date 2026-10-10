import { sql, Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import { Database, OrderStatus, ItemFulfillmentStatus } from '../../database/types.js';
import { ACTIVE_DELIVERY_STATUSES, INITIAL_ORDER_STATUS, isUncostedSubstitution } from './lifecycle/catalogue.js';
import { recordOrderPlaced } from './lifecycle/status-writer.js';
import { DELIVERY_PUBLIC_SELECT } from './delivery.columns.js';
import { evaluateCoupon, recordRedemption } from '../coupons/coupon.service.js';
import { freeDeliveryStatus, type FreeDeliveryPolicy } from './free-delivery.js';
import {
  applyBirthday,
  birthdayBeatsCoupon,
  birthdayOfferStatus,
  recordBirthdayRedemption,
} from '../birthday/birthday.offer.js';
import type { BirthdayOfferSetting } from '../configuration/settings.service.js';
import type { DeliveryFeeQuote } from './delivery-fee.js';
// Refer a friend and Blynk Points (owner, 2026-10-10; migration 037).
import { orderRewardColumns, pointsForOrder, recordOrderRewards, referralForOrder } from '../loyalty/order-rewards.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * Refuses (409 SLOT_FULL) when the slot starting at `start` already holds
 * `max` non-cancelled orders. Serialised per slot by pg_advisory_xact_lock,
 * released when the order transaction ends (owner, 2026-10-10).
 */
export async function assertSlotHasRoom(trx: Transaction<Database>, start: Date, max: number, label: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${'delivery_slot:' + start.toISOString()}))`.execute(trx);
  const row = await trx
    .selectFrom('orders')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('scheduled_for', '=', start)
    .where('scheduled_until', 'is not', null)
    .where('order_status', '!=', 'CANCELLED')
    .executeTakeFirstOrThrow();
  if (Number(row.n) >= max) {
    throw new AppError(`The delivery slot ${label} is full. Please pick another slot.`, 409, 'SLOT_FULL', {
      slot_start: start.toISOString(),
    });
  }
}

export type DBConnection = Transaction<Database> | typeof db;

export interface CreateOrderData {
  order_number: string;
  idempotency_key: string;
  customer_id: string;
  dark_store_id: string;
  subtotal_amount: number;
  /** The standard fee; 0 is charged instead when a free delivery applies. */
  delivery_fee: number;
  /**
   * How the standard fee was worked out (orders/delivery-fee.ts; owner,
   * 2026-10-10): snapshotted as delivery_fee_mode / delivery_distance_km /
   * delivery_distance_estimated (migration 040). Absent = not recorded.
   */
  delivery_fee_quote?: Pick<DeliveryFeeQuote, 'fee_mode' | 'distance_km' | 'distance_estimated'> | null;
  /**
   * New-customer free deliveries (owner, 2026-10-08), checked under the
   * customer's row lock inside the order transaction. Absent = no offer.
   */
  free_delivery?: FreeDeliveryPolicy | null;
  /** Before any coupon; the discount and final total are settled in the transaction. */
  total_amount: number;
  /** Migration 018: re-checked under the coupon row lock inside the order transaction. */
  coupon_code?: string | null;
  /**
   * Migration 034 (owner, 2026-10-09): the birthday offer and the checkout
   * clock; the gift is decided under the customer's row lock. Absent = none.
   */
  birthday_offer?: { setting: BirthdayOfferSetting; now: Date } | null;
  /** Migration 037 (owner, 2026-10-10): the customer turned "Use points" on. */
  use_points?: boolean;
  scheduled_for: Date | null;
  /**
   * Scheduled delivery slot (owner, 2026-10-10): its end (migration 036) and
   * capacity. With a slot, scheduled_for is its start; the count of orders
   * already in it is re-checked under a per-slot lock, so racing checkouts
   * cannot overbook it.
   */
  delivery_slot?: { until: Date; max_orders: number; label: string } | null;
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  delivery_alternate_phone: string | null;
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
    /** Migration 033: index into `combos` when this item was ordered as part of a combo pack. */
    combo_index?: number;
  }>;
  /** Migration 033 (owner, 2026-10-09): combo packs, each charged its combo price. */
  combos?: Array<{
    combo_id: string;
    combo_name_snapshot: string;
    unit_price: number;
    quantity: number;
    subtotal: number;
    items_regular_total: number;
  }>;
}

/** Migration 033: an order's combo lines as the API returns them. */
function toComboLine(row: {
  id: string;
  order_id: string;
  combo_id: string | null;
  combo_name_snapshot: string;
  unit_price: unknown;
  quantity: number;
  subtotal: unknown;
  items_regular_total: unknown;
}) {
  return {
    id: row.id,
    order_id: row.order_id,
    combo_id: row.combo_id,
    name: row.combo_name_snapshot,
    unit_price: Number(Number(row.unit_price).toFixed(2)),
    quantity: row.quantity,
    subtotal: Number(Number(row.subtotal).toFixed(2)),
    items_regular_total: Number(Number(row.items_regular_total).toFixed(2)),
  };
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
   * Migration 033: the running category offer of each product (own category
   * or its parent, from v_product_catalog), for priceCart.
   */
  async findCategoryOffers(productIds: string[], executor: DBConnection = db) {
    const map = new Map<string, { category_offer_percent: string | null; category_offer_ends_at: Date | null }>();
    if (productIds.length === 0) return map;
    const rows = await executor
      .selectFrom('v_product_catalog')
      .select(['id', 'category_offer_percent', 'category_offer_ends_at'])
      .where('id', 'in', productIds)
      .execute();
    for (const r of rows) map.set(r.id, { category_offer_percent: r.category_offer_percent, category_offer_ends_at: r.category_offer_ends_at });
    return map;
  }

  /**
   * Atomic Order Creation Pipeline.
   */
  async createOrderAtomic(data: CreateOrderData) {
    return await db.transaction().execute(async (trx) => {
      // 0. Delivery slot (owner, 2026-10-10): one transaction-scoped advisory
      //    lock per slot start, then count the non-cancelled orders in it.
      if (data.delivery_slot && data.scheduled_for) {
        await assertSlotHasRoom(trx, data.scheduled_for, data.delivery_slot.max_orders, data.delivery_slot.label);
      }

      // 0a. New-customer free delivery: counted under the customer's row lock,
      //     so two racing checkouts cannot both take the last one.
      const free = data.free_delivery
        ? await freeDeliveryStatus(trx, data.customer_id, data.free_delivery, true)
        : null;
      const deliveryFee = free?.applies ? 0 : data.delivery_fee;

      // 0b. Coupon (migration 018): locked and re-validated here, so limits
      //     hold when checkouts race; the preview the app showed is advisory.
      const applied = data.coupon_code
        ? await evaluateCoupon(trx, {
            code: data.coupon_code,
            customerId: data.customer_id,
            subtotal: data.subtotal_amount,
            deliveryFee,
            lock: true,
          })
        : null;
      // 0c. Birthday gift (migration 034): decided under the customer's row
      //     lock. It never stacks with a coupon - the larger one is used (a
      //     tie keeps the coupon), and the one not used is not spent.
      const birthdayStatus = data.birthday_offer?.setting.enabled
        ? await birthdayOfferStatus(trx, data.customer_id, data.birthday_offer.setting, data.birthday_offer.now, true)
        : null;
      const birthdayCandidate = birthdayStatus ? applyBirthday(birthdayStatus, data.subtotal_amount) : null;
      const birthdayOverCoupon = birthdayBeatsCoupon(birthdayCandidate, applied?.discount_amount ?? null) ? birthdayCandidate : null;
      const couponOverBirthday = birthdayOverCoupon ? null : applied;
      // 0d. Referral reward (migration 037; owner, 2026-10-10): no stacking -
      //     used only when strictly larger than the coupon/gift chosen above.
      const referral = await referralForOrder(trx, {
        customerId: data.customer_id,
        subtotal: data.subtotal_amount,
        deliveryFee,
        otherDiscount: birthdayOverCoupon?.discount_amount ?? couponOverBirthday?.discount_amount ?? null,
      });
      const birthday = referral ? null : birthdayOverCoupon;
      const coupon = referral ? null : couponOverBirthday;
      const offerDiscount = referral?.discount_amount ?? birthday?.discount_amount ?? coupon?.discount_amount ?? 0;
      // 0e. Blynk Points (migration 037): a payment after every discount, so
      //     they combine with any of the above; part of discount_amount.
      const rewardsNow = new Date();
      const points = await pointsForOrder(trx, {
        customerId: data.customer_id,
        due: data.subtotal_amount + deliveryFee - offerDiscount,
        use: data.use_points,
        now: rewardsNow,
      });

      const discountAmount = Number((offerDiscount + (points?.discount_amount ?? 0)).toFixed(2));
      const totalAmount = Number((data.subtotal_amount + deliveryFee - discountAmount).toFixed(2));

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
          delivery_fee: deliveryFee,
          // Migration 032 (owner, 2026-10-09): the standard fee, even when this
          // order goes out free - a commission rider earns their share of it.
          standard_delivery_fee: data.delivery_fee,
          // Migration 040 (owner, 2026-10-10): how that fee was worked out.
          delivery_fee_mode: data.delivery_fee_quote?.fee_mode ?? null,
          delivery_distance_km: data.delivery_fee_quote?.distance_km ?? null,
          delivery_distance_estimated: data.delivery_fee_quote?.distance_estimated ?? null,
          discount_amount: discountAmount,
          birthday_discount_amount: birthday?.discount_amount ?? 0,
          ...orderRewardColumns(referral, points),
          coupon_code: coupon?.code ?? null,
          total_amount: totalAmount,
          scheduled_for: data.scheduled_for,
          scheduled_until: data.delivery_slot?.until ?? null,
          delivery_recipient_name: data.delivery_recipient_name,
          delivery_recipient_phone: data.delivery_recipient_phone,
          delivery_alternate_phone: data.delivery_alternate_phone,
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

      // 2a. Combo lines (migration 033), so their items can point at them.
      const comboRows = data.combos?.length
        ? await trx
            .insertInto('order_combos')
            .values(data.combos.map((c) => ({ ...c, order_id: order.id })))
            .returningAll()
            .execute()
        : [];

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
        order_combo_id: item.combo_index !== undefined ? comboRows[item.combo_index].id : null,
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
          amount: totalAmount,
        })
        .returningAll()
        .execute();

      if (coupon) await recordRedemption(trx, coupon, order.id, data.customer_id);
      if (birthday) await recordBirthdayRedemption(trx, birthday, order.id, data.customer_id);
      await recordOrderRewards(trx, { orderId: order.id, customerId: data.customer_id, referral, points, now: rewardsNow });

      // 4. Record initial status in order_status_history (lifecycle PLACE_ORDER)
      await recordOrderPlaced(trx, order.id, data.customer_id);

      // 5. No "order placed" SMS (owner, 2026-10-07: SMS cost) - the app
      // shows the confirmation. See CUSTOMER_ORDER_SMS (lifecycle/notify.ts).

      return {
        ...order,
        subtotal_amount: Number(Number(order.subtotal_amount).toFixed(2)),
        delivery_fee: Number(Number(order.delivery_fee).toFixed(2)),
        discount_amount: Number(Number(order.discount_amount).toFixed(2)),
        birthday_discount_amount: Number(Number(order.birthday_discount_amount ?? 0).toFixed(2)),
        referral_discount_amount: Number(Number(order.referral_discount_amount ?? 0).toFixed(2)),
        points_discount_amount: Number(Number(order.points_discount_amount ?? 0).toFixed(2)),
        total_amount: Number(Number(order.total_amount).toFixed(2)),
        delivery_latitude: Number(order.delivery_latitude),
        delivery_longitude: Number(order.delivery_longitude),
        items: items.map((it) => ({
          ...it,
          unit_selling_price: Number(Number(it.unit_selling_price).toFixed(2)),
          subtotal: Number(Number(it.subtotal).toFixed(2)),
        })),
        combos: comboRows.map(toComboLine),
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

    const [items, payment, history, delivery, combos] = await Promise.all([
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
        // Allow-list, not selectAll: the rider's live position is the customer stream's alone (delivery.columns.ts).
        .select(DELIVERY_PUBLIC_SELECT)
        .select('users.full_name as rider_name')
        .where('deliveries.order_id', '=', orderId)
        .where('deliveries.assignment_status', 'not in', ['FAILED', 'REJECTED'])
        .executeTakeFirst(),
      // Migration 033: combo packs; their items carry order_combo_id.
      executor
        .selectFrom('order_combos')
        .selectAll()
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute(),
    ]);

    return {
      ...order,
      subtotal_amount: Number(Number(order.subtotal_amount).toFixed(2)),
      delivery_fee: Number(Number(order.delivery_fee).toFixed(2)),
      discount_amount: Number(Number(order.discount_amount).toFixed(2)),
      birthday_discount_amount: Number(Number(order.birthday_discount_amount ?? 0).toFixed(2)),
      referral_discount_amount: Number(Number(order.referral_discount_amount ?? 0).toFixed(2)),
      points_discount_amount: Number(Number(order.points_discount_amount ?? 0).toFixed(2)),
      total_amount: Number(Number(order.total_amount).toFixed(2)),
      items: items.map((it) => ({
        ...it,
        unit_selling_price: Number(Number(it.unit_selling_price).toFixed(2)),
        subtotal: Number(Number(it.subtotal).toFixed(2)),
      })),
      combos: combos.map(toComboLine),
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
    const combos = orders.length
      ? await executor
          .selectFrom('order_combos')
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
      discount_amount: Number(Number(o.discount_amount).toFixed(2)),
      birthday_discount_amount: Number(Number(o.birthday_discount_amount ?? 0).toFixed(2)),
      referral_discount_amount: Number(Number(o.referral_discount_amount ?? 0).toFixed(2)),
      points_discount_amount: Number(Number(o.points_discount_amount ?? 0).toFixed(2)),
      total_amount: Number(Number(o.total_amount).toFixed(2)),
      items: items
        .filter((it) => it.order_id === o.id)
        .map((it) => ({
          ...it,
          unit_selling_price: Number(Number(it.unit_selling_price).toFixed(2)),
          subtotal: Number(Number(it.subtotal).toFixed(2)),
        })),
      combos: combos.filter((c) => c.order_id === o.id).map(toComboLine),
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

    // Substitutions PACK would refuse for want of a cost - counted with the
    // lifecycle's own rule (isUncostedSubstitution), so the board blocks Pack
    // exactly when the API would.
    const substitutedItems = await executor
      .selectFrom('order_items')
      .select(['order_id', 'item_status', 'actual_unit_cost'])
      .where('order_id', 'in', ids)
      .where('item_status', '=', 'SUBSTITUTED')
      .execute();
    const uncosted = new Map<string, number>();
    for (const item of substitutedItems) {
      if (isUncostedSubstitution(item)) uncosted.set(item.order_id, (uncosted.get(item.order_id) ?? 0) + 1);
    }

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
        discount_amount: Number(Number(o.discount_amount).toFixed(2)),
        birthday_discount_amount: Number(Number(o.birthday_discount_amount ?? 0).toFixed(2)),
        referral_discount_amount: Number(Number(o.referral_discount_amount ?? 0).toFixed(2)),
        points_discount_amount: Number(Number(o.points_discount_amount ?? 0).toFixed(2)),
        total_amount: Number(Number(o.total_amount).toFixed(2)),
        items_summary: {
          total: summary?.total ?? 0,
          pending: summary?.pending ?? 0,
          sourced: summary?.sourced ?? 0,
          packed: summary?.packed ?? 0,
          unavailable: summary?.unavailable ?? 0,
          substituted: summary?.substituted ?? 0,
          uncosted_substitutions: uncosted.get(o.id) ?? 0,
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

  // --------------------------------------------------------------------------
  // LIVE LOCATION TRACKING (read side, Task B4)
  // --------------------------------------------------------------------------

  /**
   * The one row the live-tracking stream needs (plan §7, §9): ownership plus
   * the current delivery's position, only while the trackable window (plan
   * §2.3 - PICKED_UP with the order OUT_FOR_DELIVERY) is open. A re-staged
   * order's old FAILED delivery can never match this query, by construction
   * (plan §2.2 gotcha #2) - at most one delivery row can be PICKED_UP at a
   * time per uq_deliveries_active_assignment.
   */
  async findTrackableLocationForCustomer(orderId: string, customerId: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('orders')
      .innerJoin('deliveries', 'deliveries.order_id', 'orders.id')
      .select([
        'deliveries.current_latitude',
        'deliveries.current_longitude',
        'deliveries.location_accuracy_m',
        'deliveries.location_captured_at',
        'deliveries.location_received_at',
      ])
      .where('orders.id', '=', orderId)
      .where('orders.customer_id', '=', customerId)
      .where('deliveries.assignment_status', '=', 'PICKED_UP')
      .where('orders.order_status', '=', 'OUT_FOR_DELIVERY')
      .executeTakeFirst();
  }

  /**
   * The road-route endpoint's input (owner, 2026-10-10): the same trackable
   * window and ownership as the stream above, plus the order's delivery
   * point. Null outside the window or for someone else's order.
   */
  async findRouteContextForCustomer(orderId: string, customerId: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('orders')
      .innerJoin('deliveries', 'deliveries.order_id', 'orders.id')
      .select([
        'orders.delivery_latitude',
        'orders.delivery_longitude',
        'deliveries.current_latitude',
        'deliveries.current_longitude',
        'deliveries.location_captured_at',
      ])
      .where('orders.id', '=', orderId)
      .where('orders.customer_id', '=', customerId)
      .where('deliveries.assignment_status', '=', 'PICKED_UP')
      .where('orders.order_status', '=', 'OUT_FOR_DELIVERY')
      .executeTakeFirst();
  }

  /**
   * The rider's first name and phone for the customer's "Call rider" button
   * (owner, 2026-10-10). Only the customer's OWN order, only while it is
   * OUT_FOR_DELIVERY and its delivery is on the road (PICKED_UP) or at the
   * door (ARRIVED_AT_CUSTOMER). Never another order's rider, never before
   * pickup, never after delivery / failure / cancellation. These are users
   * columns read by this one query, not deliveries columns, so the
   * delivery.columns.ts allow-list is unchanged.
   */
  async findRiderContactForCustomer(orderId: string, customerId: string, executor: DBConnection = db) {
    return await executor
      .selectFrom('orders')
      .innerJoin('deliveries', 'deliveries.order_id', 'orders.id')
      .innerJoin('riders', 'riders.id', 'deliveries.rider_id')
      .innerJoin('users', 'users.id', 'riders.user_id')
      .select(['users.full_name', 'users.phone'])
      .where('orders.id', '=', orderId)
      .where('orders.customer_id', '=', customerId)
      .where('orders.order_status', '=', 'OUT_FOR_DELIVERY')
      .where('deliveries.assignment_status', 'in', ['PICKED_UP', 'ARRIVED_AT_CUSTOMER'])
      .executeTakeFirst();
  }
}

export const orderRepository = new OrderRepository();
