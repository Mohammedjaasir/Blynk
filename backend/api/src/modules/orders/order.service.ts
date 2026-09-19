import { orderRepository, CreateOrderData } from './order.repository.js';
import { CreateOrderInput, OrderQueryInput } from './order.schema.js';
import { calculateSellingPrice } from '../pricing/index.js';
import { isWithinDeliveryRadius } from '../../utils/geo.js';
import { calculateScheduledDeliveryTime } from '../../utils/time.js';
import { AppError } from '../../middleware/error.middleware.js';
import { OrderStatus } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { runTransition } from './lifecycle/engine.js';
import type { Actor } from './lifecycle/types.js';
import { adminStatusAction, CATALOGUE } from './lifecycle/catalogue.js';

function generateOrderNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `BL-${dateStr}-${randomSuffix}`;
}

/** Four random digits a day collide; how many fresh numbers to try before giving up. */
const ORDER_NUMBER_ATTEMPTS = 5;

/**
 * Inserts the order, drawing a fresh order number if the generated one is
 * already taken today (UNIQUE orders_order_number_key). Any other failure,
 * including a duplicate idempotency key, is rethrown untouched.
 */
async function createWithUniqueNumber(data: CreateOrderData) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await orderRepository.createOrderAtomic(data);
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code !== '23505' || e.constraint !== 'orders_order_number_key' || attempt >= ORDER_NUMBER_ATTEMPTS) throw err;
      data = { ...data, order_number: generateOrderNumber() };
    }
  }
}

export function sanitizeCustomerOrderItem(it: any) {
  if (!it) return it;
  const { estimated_unit_cost, actual_unit_cost, markup_percentage_applied, ...safeItem } = it;
  return safeItem;
}

/**
 * The customer's view of the delivery: where it is in the handover, never
 * which rider, the cash ledger, or the rider's notes.
 */
export function sanitizeCustomerDelivery(delivery: any) {
  if (!delivery) return delivery;
  const { assignment_status, assigned_at, picked_up_at, delivered_at } = delivery;
  return { assignment_status, assigned_at, picked_up_at, delivered_at };
}

/**
 * The customer's view of the order history: which status and when (D11).
 * Notes are written by staff and riders for each other; who made the change
 * is internal too.
 */
export function sanitizeCustomerHistory(entry: any) {
  const { id, order_id, old_status, new_status, created_at } = entry;
  return { id, order_id, old_status, new_status, created_at };
}

/**
 * Whether the customer may cancel right now: the CUSTOMER_CANCEL rule itself,
 * so the app never keeps its own list. Advisory - the cancel action re-checks
 * under the order lock.
 */
export function customerCanCancel(status: OrderStatus): boolean {
  return CATALOGUE.CUSTOMER_CANCEL.from.includes(status);
}

export function sanitizeCustomerOrder(order: any) {
  if (!order) return order;
  // internal_notes is staff-only; the customer's own notes are customer_notes.
  const { internal_notes, ...safeOrder } = order;
  return {
    ...safeOrder,
    can_cancel: customerCanCancel(order.order_status),
    items: Array.isArray(order.items) ? order.items.map(sanitizeCustomerOrderItem) : order.items,
    ...('delivery' in order ? { delivery: sanitizeCustomerDelivery(order.delivery) } : {}),
    ...(Array.isArray(order.history) ? { history: order.history.map(sanitizeCustomerHistory) } : {}),
  };
}

export class OrderService {
  /**
   * Atomic Checkout & Order Creation.
   */
  async createOrder(
    customerId: string,
    input: CreateOrderInput,
    idempotencyKeyHeader?: string
  ) {
    const idempotencyKey =
      input.idempotency_key || idempotencyKeyHeader || `idemp_${Date.now()}_${Math.random()}`;

    // 1. Check idempotency: if duplicate key, replay cached response
    const existingOrder = await orderRepository.findOrderByIdempotencyKey(idempotencyKey);
    if (existingOrder) {
      logger.info(
        { orderId: existingOrder.id, idempotencyKey },
        'Idempotent checkout request replayed'
      );
      return { order: sanitizeCustomerOrder(existingOrder), is_idempotent_replay: true };
    }

    // 2. Address verification (ownership + active)
    const address = await orderRepository.findCustomerAddress(customerId, input.address_id);
    if (!address) {
      throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
    }

    // 3. Geofence verification (4.00 km Haversine from Dharga Town hub)
    const store = await orderRepository.findActiveDarkStore();
    if (!store) {
      throw new AppError('No active dark store hub found.', 500, 'STORE_UNAVAILABLE');
    }

    const { isWithin, distanceKm } = isWithinDeliveryRadius(
      Number(store.latitude),
      Number(store.longitude),
      Number(address.latitude),
      Number(address.longitude),
      Number(store.radius_km)
    );

    if (!isWithin) {
      throw new AppError(
        `Delivery address is outside the ${Number(store.radius_km).toFixed(2)} km service zone (${distanceKm} km away).`,
        422,
        'DELIVERY_OUTSIDE_RADIUS',
        { distance_km: distanceKm, max_radius_km: Number(store.radius_km) }
      );
    }

    // 4. Operating Window & 24/7 Scheduling
    const scheduledFor = calculateScheduledDeliveryTime(new Date());

    // 5. Products & Authoritative Pricing
    const productIds = input.items.map((it) => it.product_id);
    const products = await orderRepository.findProductsByIds(productIds);

    if (products.length !== productIds.length) {
      throw new AppError('One or more requested products were not found.', 400, 'PRODUCT_NOT_FOUND');
    }

    const productMap = new Map(products.map((p) => [p.id, p]));
    const defaultMarkup = await orderRepository.getDefaultMarkup();

    let subtotalAmount = 0;
    const orderItemsData = input.items.map((item) => {
      const prod = productMap.get(item.product_id);
      if (!prod) {
        throw new AppError(`Product ${item.product_id} not found.`, 400, 'PRODUCT_NOT_FOUND');
      }

      if (!prod.is_active || !prod.is_available) {
        throw new AppError(
          `Product '${prod.name}' is currently unavailable.`,
          400,
          'PRODUCT_UNAVAILABLE',
          { product_id: prod.id, name: prod.name }
        );
      }

      const priceResult = calculateSellingPrice({
        purchaseCost: Number(prod.purchase_cost),
        customMarkupPercent: prod.custom_markup_percent !== null ? Number(prod.custom_markup_percent) : null,
        defaultMarkupPercent: defaultMarkup,
      });

      const lineSubtotal = Number((priceResult.sellingPrice * item.quantity).toFixed(2));
      subtotalAmount += lineSubtotal;

      return {
        product_id: prod.id,
        product_name_snapshot: prod.name,
        sku_snapshot: prod.sku,
        unit_snapshot: prod.unit,
        unit_selling_price: priceResult.sellingPrice,
        estimated_unit_cost: Number(Number(prod.purchase_cost).toFixed(2)),
        markup_percentage_applied: priceResult.effectiveMarkupPercent,
        quantity: item.quantity,
        subtotal: lineSubtotal,
      };
    });

    subtotalAmount = Number(subtotalAmount.toFixed(2));
    const deliveryFee = await orderRepository.getDeliveryFee();
    const totalAmount = Number((subtotalAmount + deliveryFee).toFixed(2));
    const orderNumber = generateOrderNumber();

    const orderData: CreateOrderData = {
      order_number: orderNumber,
      idempotency_key: idempotencyKey,
      customer_id: customerId,
      dark_store_id: store.id,
      subtotal_amount: subtotalAmount,
      delivery_fee: deliveryFee,
      total_amount: totalAmount,
      scheduled_for: scheduledFor,
      delivery_recipient_name: address.recipient_name,
      delivery_recipient_phone: address.recipient_phone,
      delivery_address_line1: address.address_line1,
      delivery_address_line2: address.address_line2,
      delivery_city: address.city,
      delivery_postal_code: address.postal_code,
      delivery_latitude: Number(address.latitude),
      delivery_longitude: Number(address.longitude),
      delivery_instructions: address.delivery_instructions,
      customer_notes: input.customer_notes ?? null,
      items: orderItemsData,
    };

    const createdOrder = await createWithUniqueNumber(orderData);
    logger.info({ orderId: createdOrder.id, orderNumber: createdOrder.order_number }, 'Order placed successfully');

    return { order: sanitizeCustomerOrder(createdOrder), is_idempotent_replay: false };
  }

  /**
   * Customer order history.
   */
  async getCustomerOrders(customerId: string, query: OrderQueryInput) {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const [orders, total] = await Promise.all([
      orderRepository.findCustomerOrders(customerId, page, limit, query.status),
      orderRepository.countCustomerOrders(customerId, query.status),
    ]);

    return {
      orders: orders.map(sanitizeCustomerOrder),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Customer order detail.
   */
  async getCustomerOrderById(orderId: string, customerId: string) {
    const order = await orderRepository.findOrderById(orderId, customerId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    return sanitizeCustomerOrder(order);
  }

  /**
   * Customer self-service cancellation (lifecycle #1 CUSTOMER_CANCEL): the
   * rules and codes live in the lifecycle and are checked under the lock.
   */
  async cancelOrderCustomer(orderId: string, actor: Actor, reason?: string) {
    await runTransition('CUSTOMER_CANCEL', { actor, orderId, input: { reason } });
    const updated = await orderRepository.findOrderById(orderId, actor.id);
    return sanitizeCustomerOrder(updated);
  }

  // --------------------------------------------------------------------------
  // STORE / ADMIN OPERATIONS
  // --------------------------------------------------------------------------

  async getPackingQueue() {
    return await orderRepository.findAdminOrders({ statuses: ['PLACED'], limit: 100, offset: 0 });
  }

  async getAdminOrders(params: { status?: OrderStatus[]; since?: Date; page?: number; limit?: number }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      orderRepository.findAdminOrders({ statuses: params.status, since: params.since, limit, offset }),
      orderRepository.countAdminOrders({ statuses: params.status, since: params.since }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getAdminOrderById(orderId: string) {
    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    return order;
  }

  /**
   * PATCH /admin/orders/:id/status. The requested status names a lifecycle
   * action (catalogue adminStatusAction); the action re-checks everything
   * under its locks, so a status that changed since this read is a
   * deterministic 422/409, never a bypass.
   */
  async updateOrderStatusAdmin(orderId: string, requested: OrderStatus, actor: Actor, notes?: string) {
    const current = await orderRepository.findOrderStatus(orderId);
    if (!current) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    const action = adminStatusAction(requested, current);
    if (!action) {
      throw new AppError(`An order in ${current} cannot move to ${requested}.`, 422, 'INVALID_STATUS_TRANSITION', {
        current_status: current,
        requested_status: requested,
      });
    }
    await runTransition(action, { actor, orderId, input: { notes } });
    return await orderRepository.findOrderById(orderId);
  }

  /** Lifecycle #2 RESOLVE_ITEM. */
  async resolveUnavailableItem(orderId: string, itemId: string, itemStatus: 'UNAVAILABLE' | 'SUBSTITUTED', actor: Actor) {
    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    await runTransition('RESOLVE_ITEM', { actor, orderId, itemId, input: { item_status: itemStatus } });
    return await orderRepository.findOrderById(orderId);
  }

  /** Lifecycle #4 ASSIGN_RIDER. */
  async assignRiderAdmin(orderId: string, riderId: string, actor: Actor) {
    return await runTransition('ASSIGN_RIDER', { actor, orderId, input: { rider_id: riderId } });
  }
}

export const orderService = new OrderService();
