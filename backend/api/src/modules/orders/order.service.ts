import { orderRepository, CreateOrderData } from './order.repository.js';
import { CreateOrderInput, OrderQueryInput } from './order.schema.js';
import { calculateSellingPrice } from '../pricing/index.js';
import { isWithinDeliveryRadius } from '../../utils/geo.js';
import { calculateScheduledDeliveryTime } from '../../utils/time.js';
import { AppError } from '../../middleware/error.middleware.js';
import { OrderStatus, ItemFulfillmentStatus } from '../../database/types.js';
import { logger } from '../../utils/logger.js';

function generateOrderNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `BL-${dateStr}-${randomSuffix}`;
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
      return { order: existingOrder, is_idempotent_replay: true };
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

    const createdOrder = await orderRepository.createOrderAtomic(orderData);
    logger.info({ orderId: createdOrder.id, orderNumber: createdOrder.order_number }, 'Order placed successfully');

    return { order: createdOrder, is_idempotent_replay: false };
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
      orders,
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
    return order;
  }

  /**
   * Customer self-service cancellation window.
   */
  async cancelOrderCustomer(orderId: string, customerId: string, reason?: string) {
    const order = await orderRepository.findOrderById(orderId, customerId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.order_status === 'OUT_FOR_DELIVERY' || order.order_status === 'DELIVERED') {
      throw new AppError(
        'Order is already out for delivery or delivered and cannot be cancelled online.',
        400,
        'ORDER_ALREADY_OUT_FOR_DELIVERY'
      );
    }

    if (order.order_status === 'CANCELLED') {
      throw new AppError('Order is already cancelled.', 400, 'ORDER_ALREADY_CANCELLED');
    }

    if (!['PLACED', 'PACKED'].includes(order.order_status)) {
      throw new AppError(
        `Order cannot be cancelled in '${order.order_status}' status.`,
        400,
        'ORDER_CANNOT_BE_CANCELLED'
      );
    }

    await orderRepository.cancelOrder(orderId, customerId, reason);
    return await orderRepository.findOrderById(orderId, customerId);
  }

  // --------------------------------------------------------------------------
  // STORE / ADMIN OPERATIONS
  // --------------------------------------------------------------------------

  async getPackingQueue() {
    return await orderRepository.findAdminOrders({ status: 'PLACED', limit: 100, offset: 0 });
  }

  async getAdminOrders(params: { status?: OrderStatus; page?: number; limit?: number }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      orderRepository.findAdminOrders({ status: params.status, limit, offset }),
      orderRepository.countAdminOrders(params.status),
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

  async updateOrderStatusAdmin(orderId: string, newStatus: OrderStatus, userId: string, notes?: string) {
    const updated = await orderRepository.updateOrderStatus(orderId, newStatus, userId, notes);
    if (!updated) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }
    return await orderRepository.findOrderById(orderId);
  }

  async resolveUnavailableItem(orderId: string, itemId: string, itemStatus: ItemFulfillmentStatus) {
    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    await orderRepository.resolveUnavailableItem(orderId, itemId, itemStatus);
    return await orderRepository.findOrderById(orderId);
  }

  async assignRiderAdmin(orderId: string, riderId: string) {
    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    const delivery = await orderRepository.assignRider(orderId, riderId);
    return delivery;
  }
}

export const orderService = new OrderService();
