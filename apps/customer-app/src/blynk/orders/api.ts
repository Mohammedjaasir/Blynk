import { apiGet, apiPost } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';
import type { CheckoutInfo, CouponPreview, Order, OrderList, PlaceOrderBody } from './types';

/*
 * Signed-in order calls (Bearer; authed() refreshes once on a 401). Never called in the
 * design mock: the screens check DEMO first.
 */

const n = (v: unknown, fallback = 0): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
};

/** Amounts come back as numbers today; parse anyway so a NUMERIC-as-string column never shows NaN. */
export function parseOrder(raw: Order): Order {
  return {
    ...raw,
    subtotal_amount: n(raw.subtotal_amount),
    delivery_fee: n(raw.delivery_fee),
    discount_amount: n(raw.discount_amount),
    birthday_discount_amount: n(raw.birthday_discount_amount),
    referral_discount_amount: n(raw.referral_discount_amount),
    points_discount_amount: n(raw.points_discount_amount),
    total_amount: n(raw.total_amount),
    can_cancel: raw.can_cancel === true,
    items: (raw.items ?? []).map((it) => ({
      ...it,
      unit_selling_price: n(it.unit_selling_price),
      subtotal: n(it.subtotal),
      quantity: n(it.quantity, 1),
    })),
  };
}

export function parseCheckoutInfo(raw: CheckoutInfo): CheckoutInfo {
  const dist = raw.delivery_distance_km;
  return {
    ...raw,
    delivery_fee_lkr: n(raw.delivery_fee_lkr),
    standard_delivery_fee_lkr: n(raw.standard_delivery_fee_lkr),
    delivery_distance_km: dist === null || dist === undefined ? null : n(dist),
  };
}

/** GET /orders/checkout-info: the fee for this address (and, with the subtotal, the basket free delivery). */
export async function getCheckoutInfo(addressId: string, subtotal: number, signal?: AbortSignal): Promise<CheckoutInfo> {
  const q = `address_id=${encodeURIComponent(addressId)}&subtotal=${Math.max(0, Math.round(subtotal * 100) / 100)}`;
  return parseCheckoutInfo(await authed((t) => apiGet<CheckoutInfo>(`/orders/checkout-info?${q}`, t, signal)));
}

/** POST /orders/validate-coupon: what the code takes off this cart, without using it. */
export async function previewCoupon(
  code: string, items: PlaceOrderBody['items'], addressId: string,
): Promise<CouponPreview> {
  const { coupon } = await authed((t) => apiPost<{ coupon: CouponPreview }>('/orders/validate-coupon', { code, items, address_id: addressId }, t));
  return coupon;
}

/** POST /orders: 201 a new order, 200 the same order again for a repeated idempotency key. */
export async function placeOrder(body: PlaceOrderBody): Promise<Order> {
  const { order } = await authed((t) => apiPost<{ order: Order; is_idempotent_replay: boolean }>('/orders', body, t));
  return parseOrder(order);
}

/** GET /orders: this customer's orders, newest first. */
export async function listOrders(page = 1, limit = 20, signal?: AbortSignal): Promise<OrderList> {
  const data = await authed((t) => apiGet<OrderList>(`/orders?page=${page}&limit=${limit}`, t, signal));
  return { ...data, orders: data.orders.map(parseOrder) };
}

/** GET /orders/:id: items, payment, history, delivery block, and (on the road) the delivery code and rider contact. */
export async function getOrder(id: string, signal?: AbortSignal): Promise<Order> {
  const { order } = await authed((t) => apiGet<{ order: Order }>(`/orders/${encodeURIComponent(id)}`, t, signal));
  return parseOrder(order);
}

/** POST /orders/:id/cancel: allowed while the order is PLACED or PACKED (the order's `can_cancel`). */
export async function cancelOrder(id: string, reason?: string): Promise<Order> {
  const body = reason && reason.trim().length >= 3 ? { reason: reason.trim() } : {};
  const { order } = await authed((t) => apiPost<{ order: Order }>(`/orders/${encodeURIComponent(id)}/cancel`, body, t));
  return parseOrder(order);
}
