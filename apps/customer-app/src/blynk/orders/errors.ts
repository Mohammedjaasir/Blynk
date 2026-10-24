import { ApiError } from '@/blynk/api/client';
import type { LineRefusal } from '@/blynk/cart/cartStore';
import { ORDER_NOTE_WORDS, PLACE_ERROR_WORDS } from './words';

/*
 * Words for a refused order, keyed on the backend's error code (the Flutter app's
 * Services/app_errors.dart copy). The server's own text is shown only for STORE_CLOSED,
 * whose sentence says when the store opens again (Ops and Admin set the hours).
 */

export type PlaceErrorAction =
  /** Choose or add another address. */
  | 'address'
  /** Fresh prices and availability: refresh the catalogue so the cart reconciles. */
  | 'reconcile'
  /** The coupon stopped applying: drop it. */
  | 'coupon'
  | 'closed'
  /** The picked delivery slot went (full or no longer offered): reload the slots, pick again. */
  | 'slot'
  /** Staff switched "For someone else" off: reload checkout-info, which hides it. */
  | 'details'
  /**
   * Stock or size (migration 045): the cart is updated from the refusal (stockRefusal) - the line
   * marked sold out, lowered to what is left, or asking for a size - and the catalogue refreshed.
   */
  | 'stock'
  /** "Pay online" was refused (switched off, or nothing to pay): back to cash on delivery. */
  | 'payment'
  | 'signin'
  | 'retry'
  | null;

export interface PlaceErrorCopy { title: string; message: string; action: PlaceErrorAction }

/** "We don't deliver there yet": read `.title` / `.message` while rendering. */
export const OUTSIDE_AREA = {
  get title() { return PLACE_ERROR_WORDS.outsideArea.title; },
  get message() { return PLACE_ERROR_WORDS.outsideArea.message; },
};

/** What the screen does for each refusal code (the words are in PLACE_ERROR_WORDS). */
const ACTION: Record<string, PlaceErrorAction> = {
  DELIVERY_OUTSIDE_RADIUS: 'address',
  ADDRESS_NOT_FOUND: 'address',
  STORE_CLOSED: 'closed',
  STORE_UNAVAILABLE: 'retry',
  PRODUCT_UNAVAILABLE: 'reconcile',
  PRODUCT_NOT_FOUND: 'reconcile',
  SLOT_UNAVAILABLE: 'slot',
  SLOT_FULL: 'slot',
  FOR_SOMEONE_ELSE_DISABLED: 'details',
  COUPON_NOT_FOUND: 'coupon',
  COUPON_INACTIVE: 'coupon',
  COUPON_NOT_STARTED: 'coupon',
  COUPON_EXPIRED: 'coupon',
  COUPON_LIMIT_REACHED: 'coupon',
  COUPON_FIRST_ORDER_ONLY: 'coupon',
  COUPON_MIN_SUBTOTAL: 'coupon',
  COUPONS_DISABLED: 'coupon',
  // combo packs (Flutter app_errors.dart): ended, changed or sold out since it was added
  COMBO_NOT_FOUND: 'reconcile',
  COMBO_UNAVAILABLE: 'reconcile',
  COMBO_OUT_OF_STOCK: 'reconcile',
  COMBO_QUANTITY_TOO_HIGH: null,
  // variants and stock (migration 045): the cart follows the refusal (stockRefusal)
  OUT_OF_STOCK: 'stock',
  INSUFFICIENT_STOCK: 'stock',
  VARIANT_REQUIRED: 'stock',
  VARIANT_NOT_FOUND: 'stock',
  VARIANT_UNAVAILABLE: 'stock',
  // delivery lead time (migration 045): pick a slot on/after the first delivery day
  LEAD_TIME_REQUIRES_SLOT: 'slot',
  SLOT_BEFORE_LEAD_TIME: 'slot',
  // PayHere (docs/api/payhere.md): online payment switched off meanwhile, or the total is 0
  ONLINE_PAYMENT_UNAVAILABLE: 'payment',
  NOTHING_TO_PAY_ONLINE: 'payment',
  POINTS_INSUFFICIENT: 'retry',
  TOO_MANY_REQUESTS: 'retry',
  RATE_LIMITED: 'retry',
};

/** Which block key holds the words of a code (most are their own key). */
const WORDS_KEY: Record<string, string> = { DELIVERY_OUTSIDE_RADIUS: 'outsideArea', TOO_MANY_REQUESTS: 'TOO_MANY', RATE_LIMITED: 'TOO_MANY' };

/** The words of a known code, read now (so they follow the language). */
function knownCopy(code: string): PlaceErrorCopy | undefined {
  if (!Object.prototype.hasOwnProperty.call(ACTION, code)) return undefined;
  const w = (PLACE_ERROR_WORDS as unknown as Record<string, { title: string; message: string }>)[WORDS_KEY[code] ?? code];
  return { title: w.title, message: w.message, action: ACTION[code] };
}

const SERVER_WORDED = new Set([
  'STORE_CLOSED', 'SLOT_UNAVAILABLE', 'SLOT_FULL', 'FOR_SOMEONE_ELSE_DISABLED',
  // these name the item ("Only 3 left of Chilli Powder 100 g. Please lower the quantity.")
  'OUT_OF_STOCK', 'INSUFFICIENT_STOCK', 'VARIANT_REQUIRED', 'VARIANT_NOT_FOUND', 'VARIANT_UNAVAILABLE',
  'LEAD_TIME_REQUIRES_SLOT', 'SLOT_BEFORE_LEAD_TIME',
]);

/** Clear copy for any failure of POST /orders (or the coupon preview). */
export function placeErrorCopy(e: unknown): PlaceErrorCopy {
  const w = PLACE_ERROR_WORDS;
  if (!(e instanceof ApiError)) return { ...w.generic, action: 'retry' };
  const known = e.code ? knownCopy(e.code) : undefined;
  if (known) {
    // the server's own sentence for these (the Flutter shop's serverWordedOrderRefusals):
    // STORE_CLOSED names when the store opens again, the slot ones say what to do
    if (e.code && SERVER_WORDED.has(e.code) && e.message && e.message !== 'Request failed.') return { ...known, message: e.message };
    return known;
  }
  if (e.status === 401) return { ...w.signIn, action: 'signin' };
  if (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT') {
    // the same idempotency key is sent again, so a retry never makes a second order
    return { ...w.network, action: 'retry' };
  }
  if (e.status >= 500) return { ...w.server, action: 'retry' };
  if (e.status === 400) return { ...w.checkOrder, action: 'reconcile' };
  return { ...w.fallback, action: null };
}

/** The product the server refused (PRODUCT_UNAVAILABLE details), if any. */
export function refusedProduct(e: unknown): { product_id: string; name: string } | null {
  if (!(e instanceof ApiError) || e.code !== 'PRODUCT_UNAVAILABLE') return null;
  const d = e.details as { product_id?: unknown; name?: unknown } | null | undefined;
  return d && typeof d.product_id === 'string' ? { product_id: d.product_id, name: typeof d.name === 'string' ? d.name : '' } : null;
}

/** The cart line a stock / size refusal is about (migration 045 details), or null. */
export function stockRefusal(e: unknown): LineRefusal | null {
  if (!(e instanceof ApiError) || !e.code) return null;
  const d = (e.details ?? {}) as { product_id?: unknown; variant_id?: unknown; available?: unknown };
  if (typeof d.product_id !== 'string' || !d.product_id) return null;
  const variant = typeof d.variant_id === 'string' && d.variant_id ? d.variant_id : null;
  switch (e.code) {
    case 'OUT_OF_STOCK':
    case 'VARIANT_UNAVAILABLE':
    case 'VARIANT_NOT_FOUND':
      return { kind: 'sold-out', product_id: d.product_id, variant_id: variant };
    case 'INSUFFICIENT_STOCK': {
      const left = typeof d.available === 'number' && Number.isFinite(d.available) ? Math.max(0, Math.floor(d.available)) : 0;
      return left > 0
        ? { kind: 'only', product_id: d.product_id, variant_id: variant, available: left }
        : { kind: 'sold-out', product_id: d.product_id, variant_id: variant };
    }
    case 'VARIANT_REQUIRED':
      return { kind: 'needs-size', product_id: d.product_id };
    default:
      return null;
  }
}

/** The words under a stock refusal once the cart has been updated: what changed. */
export function stockRefusalNote(r: LineRefusal): string {
  if (r.kind === 'only') return ORDER_NOTE_WORDS.stock.only(r.available);
  if (r.kind === 'needs-size') return ORDER_NOTE_WORDS.stock.needsSize;
  return ORDER_NOTE_WORDS.stock.soldOut;
}

/** Cancel refusals (lifecycle CUSTOMER_CANCEL). */
export function cancelErrorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : undefined;
  switch (code) {
    case 'ORDER_ALREADY_OUT_FOR_DELIVERY': return ORDER_NOTE_WORDS.cancel.alreadyOut;
    case 'ORDER_ALREADY_CANCELLED': return ORDER_NOTE_WORDS.cancel.alreadyCancelled;
    case 'ORDER_CANNOT_BE_CANCELLED':
    case 'INVALID_STATUS_TRANSITION': return ORDER_NOTE_WORDS.cancel.cannot;
    case 'ORDER_NOT_FOUND': return ORDER_NOTE_WORDS.cancel.notFound;
    default: return ORDER_NOTE_WORDS.cancel.unknown;
  }
}
