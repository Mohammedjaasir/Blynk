import type { CartLine } from '@/blynk/cart/cartStore';
import { storage } from '@/blynk/lib/storage';
import type { CheckoutInfo, CouponPreview, PlaceOrderBody } from './types';

/*
 * Checkout logic with no React in it: what is sent, what the bill shows, and the
 * idempotency key that makes a double tap (or a retry after a timeout) one order.
 */

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The lines the order carries: available Blynk products only (design-mock "demo-" lines never go out). */
export function orderItems(lines: CartLine[]): PlaceOrderBody['items'] {
  return lines
    .filter((l) => l.product.is_available && l.quantity > 0 && !l.product.id.startsWith('demo-'))
    .map((l) => ({ product_id: l.product.id, quantity: l.quantity }));
}

/** Everything that makes this checkout a different order. Same signature = same idempotency key. */
export function checkoutSignature(args: {
  items: PlaceOrderBody['items']; addressId: string; coupon?: string | null; note?: string | null;
}): string {
  const items = [...args.items].sort((a, b) => a.product_id.localeCompare(b.product_id)).map((i) => `${i.product_id}x${i.quantity}`).join(',');
  return [items, args.addressId, args.coupon ?? '', (args.note ?? '').trim()].join('|');
}

/** 128 random bits as hex (the server allows up to 128 characters). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'app_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const CHECKOUT_KEY = 'blynk.app.checkout-key.v1';

/**
 * One key per checkout: kept (and persisted, so a reload mid-request still replays the same
 * order) until the cart, address, coupon or note changes, or the order is placed.
 */
export function checkoutKeyFor(signature: string, make: () => string = newIdempotencyKey): string {
  try {
    const saved = JSON.parse(storage.get(CHECKOUT_KEY) || 'null') as { sig?: string; key?: string } | null;
    if (saved && saved.sig === signature && typeof saved.key === 'string' && saved.key) return saved.key;
  } catch { /* corrupt: make a new one */ }
  const key = make();
  storage.set(CHECKOUT_KEY, JSON.stringify({ sig: signature, key }));
  return key;
}

/** After an order is placed: the next checkout gets a key of its own. */
export const forgetCheckoutKey = () => storage.set(CHECKOUT_KEY, '');

export type FreeReason = 'BASKET' | 'NEW_CUSTOMER' | null;

export interface CheckoutBill {
  itemTotal: number;
  /** null until the quote is known. */
  deliveryFee: number | null;
  /** The fee before any free delivery (struck through when free). */
  standardFee: number | null;
  freeReason: FreeReason;
  /** New-customer free deliveries left, including this one. */
  freeRemaining: number;
  /** "Add LKR X more for free delivery" (basket amount switched on and not reached). */
  basketRemaining: number | null;
  basketMin: number | null;
  /** Coupon / birthday / referral discount from the coupon preview (0 without one). */
  discount: number;
  /** null while the fee is unknown. */
  toPay: number | null;
  distanceKm: number | null;
  distanceEstimated: boolean;
}

/** The bill from the cart's item total and the server's quote (and an applied coupon preview). */
export function checkoutBill(itemTotal: number, quote: CheckoutInfo | null, coupon?: CouponPreview | null): CheckoutBill {
  const basket = quote?.basket_free_delivery;
  const basketApplies = basket?.enabled === true && basket.applies === true;
  const newCustomer = !basketApplies && quote?.free_delivery?.applies === true;
  const fee = quote ? quote.delivery_fee_lkr : null;
  // the preview's total already picks the larger of coupon, birthday gift and referral reward
  const shownDiscount = coupon ? Math.max(0, round2(coupon.subtotal + coupon.delivery_fee - coupon.total)) : 0;
  return {
    itemTotal: round2(itemTotal),
    deliveryFee: fee,
    standardFee: quote ? quote.standard_delivery_fee_lkr : null,
    freeReason: basketApplies ? 'BASKET' : newCustomer ? 'NEW_CUSTOMER' : null,
    freeRemaining: newCustomer ? quote!.free_delivery.remaining : 0,
    basketRemaining: basket?.enabled && basket.applies === false && basket.remaining_lkr != null && basket.remaining_lkr > 0 ? basket.remaining_lkr : null,
    basketMin: basket?.enabled ? basket.min_subtotal_lkr : null,
    discount: shownDiscount,
    toPay: fee === null ? null : Math.max(0, round2(itemTotal + fee - shownDiscount)),
    distanceKm: quote?.delivery_fee_mode === 'DISTANCE_TIERS' ? quote.delivery_distance_km : null,
    distanceEstimated: quote?.delivery_distance_estimated === true,
  };
}

/* The order just placed, so /placed shows it at once (it is fetched again after a reload). */
let lastPlaced: import('./types').Order | null = null;
export const rememberPlaced = (o: import('./types').Order) => { lastPlaced = o; };
export const placedFromMemory = (id: string) => (lastPlaced && lastPlaced.id === id ? lastPlaced : null);
