import { orderRepository, CreateOrderData } from './order.repository.js';
import { CreateOrderInput, OrderQueryInput } from './order.schema.js';
import { calculateSellingPrice } from '../pricing/index.js';
import { assertWithinServiceZone } from './delivery-zone.js';
import { orderingClock } from '../../utils/time.js';
import { buildSlots, storeClosedMessage, storeStatusAt, STORE_TIMEZONE } from '../../utils/store-hours.js';
import { storeSchedule } from '../configuration/store-schedule.js';
import { AppError } from '../../middleware/error.middleware.js';
import { OrderStatus } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { runTransition } from './lifecycle/engine.js';
import { findDeliveryCodeForCustomer } from './lifecycle/delivery-code.js';
import type { Actor, DeliveryRow } from './lifecycle/types.js';
import { adminStatusAction, CATALOGUE } from './lifecycle/catalogue.js';
import { toPublicDelivery } from './delivery.columns.js';
import { db } from '../../database/connection.js';
import { evaluateCoupon } from '../coupons/coupon.service.js';
import type { ValidateCouponInput } from '../coupons/coupon.schema.js';
import { birthdayOfferSettings, checkoutSettings } from '../configuration/settings.service.js';
import { applyBirthday, birthdayBeatsCoupon, birthdayOfferStatus, publicBirthdayStatus } from '../birthday/birthday.offer.js';
import { freeDeliveryStatus } from './free-delivery.js';
import { effectivePrice } from '../catalog/catalog.offers.js';
import { looseQuantities, priceComboLines } from '../catalog/catalog.combos.js';
// Refer a friend and Blynk Points (owner, 2026-10-10; migration 037).
import { checkoutRewardsInfo, previewReferral } from '../loyalty/order-rewards.js';

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
 * What the customer sees of their rider while the order is on the road
 * (owner, 2026-10-10): the FIRST name only (never the surname) and the phone
 * to call. Null when there is no contact row (outside the window).
 */
export function toRiderContact(row: { full_name: string | null; phone: string } | null | undefined) {
  if (!row) return null;
  const firstName = (row.full_name ?? '').trim().split(/\s+/)[0] || null;
  return { first_name: firstName, phone: row.phone };
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

/**
 * Authoritative prices for a cart (order creation and the coupon preview):
 * every product must exist and be on sale; line totals use the pricing rules.
 * A product on an active offer (migration 031; owner, 2026-10-09) is charged
 * its offer price, and unit_selling_price snapshots what was charged. With a
 * category offer running too (migration 033) it is charged the LOWER of the
 * two (catalog.offers effectivePrice).
 *
 * Combo packs (migration 033) are charged the combo price: each becomes a
 * combo line plus its items, whose unit prices share that price
 * (catalog.combos priceComboLines). Items come back loose first, then each
 * combo's items tagged with `combo_index` into `combos`.
 */
export async function priceCart(items: CreateOrderInput['items'], comboLines: NonNullable<CreateOrderInput['combos']> = []) {
  const productIds = items.map((it) => it.product_id);
  const products = productIds.length ? await orderRepository.findProductsByIds(productIds) : [];

  if (products.length !== productIds.length) {
    throw new AppError('One or more requested products were not found.', 400, 'PRODUCT_NOT_FOUND');
  }

  const productMap = new Map(products.map((p) => [p.id, p]));
  const defaultMarkup = productIds.length ? await orderRepository.getDefaultMarkup() : 0;
  const categoryOffers = await orderRepository.findCategoryOffers(productIds);

  let subtotalAmount = 0;
  const orderItemsData = items.map((item) => {
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

    const unitPrice = effectivePrice({ ...prod, ...categoryOffers.get(prod.id) }, priceResult.sellingPrice);
    const lineSubtotal = Number((unitPrice * item.quantity).toFixed(2));
    subtotalAmount += lineSubtotal;

    return {
      product_id: prod.id,
      product_name_snapshot: prod.name,
      sku_snapshot: prod.sku,
      unit_snapshot: prod.unit,
      unit_selling_price: unitPrice,
      estimated_unit_cost: Number(Number(prod.purchase_cost).toFixed(2)),
      markup_percentage_applied: priceResult.effectiveMarkupPercent,
      quantity: item.quantity,
      subtotal: lineSubtotal,
    } as CreateOrderData['items'][number];
  });

  const combos = await priceComboLines(comboLines, looseQuantities(items));
  combos.forEach((combo, comboIndex) => {
    subtotalAmount += combo.subtotal;
    for (const it of combo.items) orderItemsData.push({ ...it, combo_index: comboIndex });
  });

  return {
    items: orderItemsData,
    combos: combos.map(({ items: _items, ...line }) => line),
    subtotal: Number(subtotalAmount.toFixed(2)),
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

    // 1b. Store timing (owner, 2026-10-10: set by Ops and Admin - opening
    // hours, "close the store now", holidays, delivery slots). After the
    // replay check, so a retried order that was accepted in time still
    // answers with that order instead of a refusal.
    const now = orderingClock.now();
    const schedule = await storeSchedule.read();
    const status = storeStatusAt(schedule, now);
    let slot: { start: Date; until: Date; label: string } | null = null;
    if (input.delivery_slot_start) {
      // A chosen slot must be one GET /orders/slots offers right now (slots
      // on, an open day, past the lead time, not while closed by staff).
      // Capacity is re-checked under the slot lock in the transaction.
      const wanted = Date.parse(input.delivery_slot_start);
      const offered = schedule.slots.enabled ? buildSlots(schedule, now).find((s) => Date.parse(s.start) === wanted) : undefined;
      if (!offered) {
        throw new AppError(
          schedule.slots.enabled
            ? 'That delivery slot is no longer available. Please pick another slot.'
            : 'Delivery slots are not available right now.',
          422,
          'SLOT_UNAVAILABLE',
          { slots_enabled: schedule.slots.enabled }
        );
      }
      slot = { start: new Date(offered.start), until: new Date(offered.end), label: offered.label };
    } else if (!status.is_open_now) {
      // As soon as possible needs the store open; with slots on, a slot can
      // still be booked while closed (e.g. tonight for tomorrow morning).
      throw new AppError(storeClosedMessage(status, now, schedule.slots.enabled), 422, 'STORE_CLOSED', {
        opens_at: status.today_hours?.open ?? null,
        closes_at: status.today_hours?.close ?? null,
        timezone: STORE_TIMEZONE,
        closed_kind: status.closed_kind,
        closed_reason: status.closed_reason,
        reopens_at: status.reopens_at,
        next_open_at: status.next_open_at,
        slots_enabled: schedule.slots.enabled,
      });
    }

    // 2. Address verification (ownership + active)
    const address = await orderRepository.findCustomerAddress(customerId, input.address_id);
    if (!address) {
      throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
    }

    // 3. Geofence verification (4.00 km Haversine from Dharga Town hub)
    const store = await assertWithinServiceZone(Number(address.latitude), Number(address.longitude));

    // 4. Scheduled delivery: the slot's start, or null for as soon as possible.
    const scheduledFor = slot?.start ?? null;

    // 5. Products & Authoritative Pricing
    const { items: orderItemsData, combos: orderCombos, subtotal: subtotalAmount } = await priceCart(input.items, input.combos ?? []);
    const deliveryFee = await orderRepository.getDeliveryFee();
    // Checkout switches (owner, 2026-10-08). With coupons off a code is
    // ignored, not refused, so an older app that still sends one can order.
    const settings = await checkoutSettings.read();
    // Birthday gift (owner, 2026-10-09): decided inside the order transaction.
    const birthdaySetting = await birthdayOfferSettings.read();
    if (input.coupon_code && !settings.coupons_enabled) {
      logger.info({ customerId }, 'Coupon code ignored: coupons are switched off');
    }
    const totalAmount = Number((subtotalAmount + deliveryFee).toFixed(2));
    const orderNumber = generateOrderNumber();

    const orderData: CreateOrderData = {
      order_number: orderNumber,
      idempotency_key: idempotencyKey,
      customer_id: customerId,
      dark_store_id: store.id,
      subtotal_amount: subtotalAmount,
      delivery_fee: deliveryFee,
      free_delivery: settings.new_customer_free_deliveries,
      total_amount: totalAmount,
      coupon_code: settings.coupons_enabled ? input.coupon_code ?? null : null,
      birthday_offer: birthdaySetting.enabled ? { setting: birthdaySetting, now } : null,
      use_points: input.use_points === true,
      scheduled_for: scheduledFor,
      delivery_slot: slot ? { until: slot.until, max_orders: schedule.slots.max_orders_per_slot, label: slot.label } : null,
      delivery_recipient_name: address.recipient_name,
      delivery_recipient_phone: address.recipient_phone,
      delivery_alternate_phone: address.alternate_phone ?? null,
      delivery_address_line1: address.address_line1,
      delivery_address_line2: address.address_line2,
      delivery_city: address.city,
      delivery_postal_code: address.postal_code,
      delivery_latitude: Number(address.latitude),
      delivery_longitude: Number(address.longitude),
      delivery_instructions: address.delivery_instructions,
      customer_notes: input.customer_notes ?? null,
      items: orderItemsData,
      combos: orderCombos,
    };

    const createdOrder = await createWithUniqueNumber(orderData);
    logger.info({ orderId: createdOrder.id, orderNumber: createdOrder.order_number }, 'Order placed successfully');

    return { order: sanitizeCustomerOrder(createdOrder), is_idempotent_replay: false };
  }

  /**
   * POST /orders/validate-coupon: what the code would take off this cart,
   * without using it. Order creation re-checks under the coupon lock.
   */
  async previewCoupon(customerId: string, input: ValidateCouponInput) {
    const settings = await checkoutSettings.read();
    if (!settings.coupons_enabled) {
      throw new AppError('Coupon codes are not available right now.', 422, 'COUPONS_DISABLED');
    }
    const subtotal =
      input.items?.length || input.combos?.length
        ? (await priceCart(input.items ?? [], input.combos ?? [])).subtotal
        : Number(input.subtotal!.toFixed(2));
    const free = await freeDeliveryStatus(db, customerId, settings.new_customer_free_deliveries);
    const deliveryFee = free.applies ? 0 : await orderRepository.getDeliveryFee();
    const applied = await evaluateCoupon(db, { code: input.code, customerId, subtotal, deliveryFee });
    // Birthday gift (owner, 2026-10-09): never stacked with a coupon - the
    // larger is used (a tie keeps the coupon). discount_amount stays the
    // coupon's own; total is what the order will actually charge.
    const birthdaySetting = await birthdayOfferSettings.read();
    const birthday = birthdaySetting.enabled
      ? applyBirthday(await birthdayOfferStatus(db, customerId, birthdaySetting, orderingClock.now()), subtotal)
      : null;
    const birthdayWins = birthdayBeatsCoupon(birthday, applied.discount_amount);
    const couponOrGift = birthdayWins ? birthday!.discount_amount : applied.discount_amount;
    // Referral reward (owner, 2026-10-10): no stacking either - only when
    // strictly larger than the coupon/gift. Points are not in this preview.
    const referral = await previewReferral(db, { customerId, subtotal, deliveryFee });
    const referralWins = !!referral && referral.discount_amount > couponOrGift;
    const charged = referralWins ? referral!.discount_amount : couponOrGift;
    return {
      code: applied.code,
      discount_type: applied.discount_type,
      description: applied.description,
      subtotal,
      delivery_fee: deliveryFee,
      discount_amount: applied.discount_amount,
      birthday_discount_amount: birthday?.discount_amount ?? 0,
      referral_discount_amount: referral?.discount_amount ?? 0,
      applied_discount: referralWins ? ('REFERRAL' as const) : birthdayWins ? ('BIRTHDAY' as const) : ('COUPON' as const),
      total: Number((subtotal + deliveryFee - charged).toFixed(2)),
    };
  }

  /**
   * GET /orders/checkout-info: what this customer's next order costs to
   * deliver, whether to show a coupon field, and their birthday gift. Advisory - order placement
   * decides again under the customer's row lock.
   */
  async getCheckoutInfo(customerId: string) {
    const [settings, standardFee, birthdaySetting] = await Promise.all([
      checkoutSettings.read(),
      orderRepository.getDeliveryFee(),
      birthdayOfferSettings.read(),
    ]);
    const free = await freeDeliveryStatus(db, customerId, settings.new_customer_free_deliveries);
    const birthday = await birthdayOfferStatus(db, customerId, birthdaySetting, orderingClock.now());
    return {
      delivery_fee_lkr: free.applies ? 0 : standardFee,
      standard_delivery_fee_lkr: standardFee,
      coupons_enabled: settings.coupons_enabled,
      free_delivery: free,
      // Owner, 2026-10-09: eligible -> the next order gets `percent` off its items.
      birthday_offer: publicBirthdayStatus(birthday),
      // Owner, 2026-10-10: referral_reward (applied automatically when it is
      // the larger discount) and points (balance + the program's numbers).
      ...(await checkoutRewardsInfo(db, customerId, free.applies ? 0 : standardFee)),
    };
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
    // Proof of delivery (migration 016): the code the customer shows the
    // rider, only while the order is on the road. Never in staff or rider
    // responses - it lives in its own table, which only this reads.
    const deliveryCode = order.order_status === 'OUT_FOR_DELIVERY' ? await findDeliveryCodeForCustomer(order.id) : null;
    // The rider's first name + phone for "Call rider" (owner, 2026-10-10):
    // this endpoint only, and only while the order is on the road. The
    // `delivery` block itself still never says which rider.
    const contact =
      order.order_status === 'OUT_FOR_DELIVERY' ? await orderRepository.findRiderContactForCustomer(order.id, customerId) : null;
    return { ...sanitizeCustomerOrder(order), delivery_code: deliveryCode, rider_contact: toRiderContact(contact) };
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
  async updateOrderStatusAdmin(
    orderId: string,
    requested: OrderStatus,
    actor: Actor,
    notes?: string,
    deliveryCode?: string
  ) {
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
    await runTransition(action, {
      actor,
      orderId,
      input: { notes, ...(action === 'ADMIN_MARK_DELIVERED' && deliveryCode ? { delivery_code: deliveryCode } : {}) },
    });
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
  async assignRiderAdmin(orderId: string, riderId: string, actor: Actor, confirmFarBatch = false) {
    const delivery = await runTransition<DeliveryRow>('ASSIGN_RIDER', {
      actor,
      orderId,
      input: { rider_id: riderId, confirm_far_batch: confirmFarBatch },
    });
    // The lifecycle hands back the whole inserted row; staff get the public columns only.
    return toPublicDelivery(delivery);
  }
}

export const orderService = new OrderService();
