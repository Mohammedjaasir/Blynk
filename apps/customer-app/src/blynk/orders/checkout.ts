import { lineAvailable, type CartLine, type ComboLine } from '@/blynk/cart/cartStore';
import { formatLkr } from '@/blynk/lib/money';
import { storage } from '@/blynk/lib/storage';
import { rewardsSummary, type DiscountKind } from '@/blynk/checkout/rewards';
import type { CheckoutInfo, CouponPreview, PlaceOrderBody } from './types';

/*
 * Checkout logic with no React in it: what is sent, what the bill shows, and the
 * idempotency key that makes a double tap (or a retry after a timeout) one order.
 */

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The lines the order carries: available Blynk products only (design-mock "demo-" lines never go
 * out). A size line names its variant (migration 045); the server prices it again.
 */
export function orderItems(lines: CartLine[]): PlaceOrderBody['items'] {
  return lines
    .filter((l) => lineAvailable(l) && l.quantity > 0 && !l.product.id.startsWith('demo-'))
    .map((l) => (l.variant ? { product_id: l.product.id, variant_id: l.variant.id, quantity: l.quantity } : { product_id: l.product.id, quantity: l.quantity }));
}

/** The combo packs the order carries (POST /orders `combos`): available ones only, like items. */
export function orderCombos(combos: ComboLine[] | undefined): NonNullable<PlaceOrderBody['combos']> {
  return (combos ?? [])
    .filter((l) => l.combo.is_available && l.quantity > 0)
    .map((l) => ({ combo_id: l.combo.id, quantity: l.quantity }));
}

/** Everything that makes this checkout a different order. Same signature = same idempotency key. */
export function checkoutSignature(args: {
  items: PlaceOrderBody['items']; addressId: string; coupon?: string | null; note?: string | null;
  combos?: PlaceOrderBody['combos'];
  /** The rest of the body that makes it a different order: slot, points, receiver, needs help. */
  extra?: Pick<PlaceOrderBody, 'delivery_slot_start' | 'use_points' | 'for_someone_else' | 'recipient' | 'needs_help' | 'payment_method'>;
}): string {
  const itemKey = (i: PlaceOrderBody['items'][number]) => (i.variant_id ? `${i.product_id}:${i.variant_id}` : i.product_id);
  const items = [...args.items].sort((a, b) => itemKey(a).localeCompare(itemKey(b))).map((i) => `${itemKey(i)}x${i.quantity}`).join(',');
  const x = args.extra;
  const more = x && (x.delivery_slot_start || x.use_points || x.for_someone_else || x.needs_help)
    ? [x.delivery_slot_start ?? '', x.use_points ? 'P' : '', x.for_someone_else ? `R:${x.recipient?.name ?? ''}:${x.recipient?.phone ?? ''}` : '', x.needs_help ? 'H' : ''].join(';')
    : null;
  const combos = [...(args.combos ?? [])].sort((a, b) => a.combo_id.localeCompare(b.combo_id)).map((c) => `C${c.combo_id}x${c.quantity}`).join(',');
  // paying online is a different order from cash on delivery (a COD replay must not answer an online checkout)
  const pay = x?.payment_method === 'ONLINE' ? ['PAY:ONLINE'] : [];
  return [combos ? `${items}+${combos}` : items, args.addressId, args.coupon ?? '', (args.note ?? '').trim(), ...(more ? [more] : []), ...pay].join('|');
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
  /** The one discount (coupon, birthday gift or referral reward; estimated without a coupon). */
  discount: number;
  discountKind: DiscountKind;
  /** "Use points": the estimated points and their value (0 when off or not usable). */
  points: { points: number; value: number };
  /** Blynk Points this order earns once delivered (estimate). */
  earn: number;
  /** null while the fee is unknown. */
  toPay: number | null;
  distanceKm: number | null;
  distanceEstimated: boolean;
}

/** The bill from the cart's item total and the server's quote (and an applied coupon preview). */
export function checkoutBill(itemTotal: number, quote: CheckoutInfo | null, coupon?: CouponPreview | null, usePoints = false): CheckoutBill {
  const basket = quote?.basket_free_delivery;
  const basketApplies = basket?.enabled === true && basket.applies === true;
  const newCustomer = !basketApplies && quote?.free_delivery?.applies === true;
  const fee = quote ? quote.delivery_fee_lkr : null;
  // one discount only: the coupon preview carries the server's choice; without one the
  // larger of the birthday gift and the referral reward is assumed; points come on top
  const r = rewardsSummary({ subtotal: itemTotal, deliveryFee: fee ?? 0, quote, coupon, usePoints });
  return {
    itemTotal: round2(itemTotal),
    deliveryFee: fee,
    standardFee: quote ? quote.standard_delivery_fee_lkr : null,
    freeReason: basketApplies ? 'BASKET' : newCustomer ? 'NEW_CUSTOMER' : null,
    freeRemaining: newCustomer ? quote!.free_delivery.remaining : 0,
    // worked out from this basket (the quote may lag a quantity change by a moment)
    basketRemaining: basket?.enabled && !basketApplies && basket.min_subtotal_lkr > itemTotal ? round2(basket.min_subtotal_lkr - itemTotal) : null,
    basketMin: basket?.enabled ? basket.min_subtotal_lkr : null,
    discount: r.discount.amount,
    discountKind: r.discount.kind,
    points: r.points,
    earn: r.earn,
    toPay: fee === null ? null : r.toPay,
    distanceKm: quote?.delivery_fee_mode === 'DISTANCE_TIERS' ? quote.delivery_distance_km : null,
    distanceEstimated: quote?.delivery_distance_estimated === true,
  };
}

/* The order just placed, so /placed shows it at once (it is fetched again after a reload). */
let lastPlaced: import('./types').Order | null = null;
export const rememberPlaced = (o: import('./types').Order) => { lastPlaced = o; };
export const placedFromMemory = (id: string) => (lastPlaced && lastPlaced.id === id ? lastPlaced : null);

/** How far the basket is towards free delivery by the basket amount, 0..1. */
export function basketProgress(itemTotal: number, min: number | null): number {
  if (!min || min <= 0) return 0;
  return Math.max(0, Math.min(1, itemTotal / min));
}

/** The line under a FREE delivery fee (the Flutter shop's wording). */
export function freeDeliveryNote(bill: CheckoutBill, count: number): string | null {
  if (bill.freeReason === 'BASKET' && bill.basketMin) return `Free delivery on orders of ${formatLkr(bill.basketMin)} or more.`;
  if (bill.freeReason === 'NEW_CUSTOMER') return `Free delivery — ${bill.freeRemaining} of ${count} free ${count === 1 ? 'delivery' : 'deliveries'} left.`;
  return null;
}

/** "Add LKR 450 more for free delivery". */
export const basketPrompt = (remaining: number) => `Add ${formatLkr(remaining)} more for free delivery`;
