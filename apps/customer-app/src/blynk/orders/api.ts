import { apiGet, apiPost, ApiError } from '@/blynk/api/client';
import { pick } from '@/blynk/i18n/localized';
import { authed } from '@/blynk/auth/session';
import { parseSlots, type DeliverySlots } from '@/blynk/checkout/slots';
import { checkoutWalletOf, parseOrderWallet } from '@/blynk/wallet/models';
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
    ...(raw.bundle_savings !== undefined ? { bundle_savings: Math.max(0, n(raw.bundle_savings)) } : {}),
    total_amount: n(raw.total_amount),
    wallet_amount_used: Math.max(0, n(raw.wallet_amount_used)),
    ...(raw.wallet !== undefined ? { wallet: parseOrderWallet(raw.wallet) } : {}),
    can_cancel: raw.can_cancel === true,
    ...(Array.isArray(raw.combos) ? {
      combos: raw.combos.map((c) => ({
        ...c, unit_price: n(c.unit_price), subtotal: n(c.subtotal), items_regular_total: n(c.items_regular_total), quantity: n(c.quantity, 1),
      })),
    } : {}),
    items: (raw.items ?? []).map((it) => ({
      ...it,
      unit_selling_price: n(it.unit_selling_price),
      subtotal: n(it.subtotal),
      quantity: n(it.quantity, 1),
      ...(it.bundle_value !== undefined && it.bundle_value !== null ? { bundle_value: n(it.bundle_value) } : {}),
    })),
  };
}

export function parseCheckoutInfo(raw: CheckoutInfo): CheckoutInfo {
  const dist = raw.delivery_distance_km;
  const lead = raw.delivery_lead;
  const wallet = checkoutWalletOf(raw.wallet);
  return {
    ...raw,
    delivery_fee_lkr: n(raw.delivery_fee_lkr),
    standard_delivery_fee_lkr: n(raw.standard_delivery_fee_lkr),
    delivery_distance_km: dist === null || dist === undefined ? null : n(dist),
    ...(lead && typeof lead === 'object' ? {
      delivery_lead: {
        lead_days: Math.max(0, Math.floor(n(lead.lead_days))),
        earliest_delivery_date: typeof lead.earliest_delivery_date === 'string' ? lead.earliest_delivery_date : null,
        earliest_delivery_label: typeof lead.earliest_delivery_label === 'string' ? lead.earliest_delivery_label : null,
        asap_allowed: lead.asap_allowed !== false,
      },
    } : {}),
    wallet: wallet ? { enabled: wallet.enabled, balance: wallet.balance, max_use_percent: wallet.maxUsePercent } : undefined,
  };
}

/** `product_ids=a,b,c` (migration 045: the server works out the cart's longest lead time); '' for none. */
export function productIdsQuery(ids: readonly string[] | undefined): string {
  const list = [...new Set((ids ?? []).filter((id) => !!id && !id.startsWith('demo-')))].slice(0, 100);
  return list.length ? `product_ids=${list.map(encodeURIComponent).join(',')}` : '';
}

/**
 * GET /orders/checkout-info: the fee for this address (and, with the subtotal, the basket free
 * delivery; with the cart's product ids, its delivery lead time).
 */
export async function getCheckoutInfo(addressId: string, subtotal: number, signal?: AbortSignal, productIds?: readonly string[]): Promise<CheckoutInfo> {
  const ids = productIdsQuery(productIds);
  const q = `address_id=${encodeURIComponent(addressId)}&subtotal=${Math.max(0, Math.round(subtotal * 100) / 100)}${ids ? `&${ids}` : ''}`;
  return parseCheckoutInfo(await authed((t) => apiGet<CheckoutInfo>(`/orders/checkout-info?${q}`, t, signal)));
}

/** POST /orders/validate-coupon: what the code takes off this cart, without using it. */
export async function previewCoupon(
  code: string, items: PlaceOrderBody['items'], addressId: string, combos: PlaceOrderBody['combos'] = [],
): Promise<CouponPreview> {
  const body = { code, items, address_id: addressId, ...(combos?.length ? { combos } : {}) };
  const { coupon } = await authed((t) => apiPost<{ coupon: CouponPreview }>('/orders/validate-coupon', body, t));
  return coupon;
}

/**
 * GET /orders/slots: scheduled delivery on/off, whether ASAP is allowed now, and the windows with
 * room. With the cart's product ids the server applies its longest lead time (migration 045).
 */
export async function getDeliverySlots(signal?: AbortSignal, productIds?: readonly string[]): Promise<DeliverySlots> {
  const ids = productIdsQuery(productIds);
  const raw = await authed((t) => apiGet<unknown>(`/orders/slots${ids ? `?${ids}` : ''}`, t, signal));
  const parsed = parseSlots(raw);
  if (!parsed) throw new ApiError(pick("We couldn't load delivery times.", 'බෙදාහැරීමේ වේලාවන් ලබාගන්න බැරි වුණා.', 'டெலிவரி நேரங்களை ஏற்ற முடியவில்லை.'), 500, 'BAD_SLOTS');
  return parsed;
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
