import { ApiError } from '@/blynk/api/client';
import type { LineRefusal } from '@/blynk/cart/cartStore';

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

export const OUTSIDE_AREA = {
  title: "We don't deliver there yet",
  message: "We don't deliver to this address yet. Choose another address.",
};

const COPY: Record<string, PlaceErrorCopy> = {
  DELIVERY_OUTSIDE_RADIUS: { ...OUTSIDE_AREA, action: 'address' },
  ADDRESS_NOT_FOUND: { title: 'Address not found', message: "We couldn't find that address. Choose another one.", action: 'address' },
  STORE_CLOSED: { title: "We're closed right now", message: "We're closed right now. Please order again when we open.", action: 'closed' },
  STORE_UNAVAILABLE: { title: "We can't take orders right now", message: "We can't take orders right now. Try again in a little while.", action: 'retry' },
  PRODUCT_UNAVAILABLE: { title: 'Item unavailable', message: "An item in your cart isn't available right now. Remove it and try again.", action: 'reconcile' },
  PRODUCT_NOT_FOUND: { title: 'Item unavailable', message: "An item in your cart isn't available anymore. Remove it and try again.", action: 'reconcile' },
  SLOT_UNAVAILABLE: { title: 'Delivery time unavailable', message: "That delivery time isn't available any more. Pick another time.", action: 'slot' },
  SLOT_FULL: { title: 'Delivery time full', message: 'That delivery time is full. Pick another time.', action: 'slot' },
  FOR_SOMEONE_ELSE_DISABLED: { title: "Can't send to someone else", message: 'Ordering for someone else is not available right now.', action: 'details' },
  COUPON_NOT_FOUND: { title: 'Coupon not found', message: "That coupon code doesn't exist.", action: 'coupon' },
  COUPON_INACTIVE: { title: 'Coupon unavailable', message: 'That coupon is no longer available.', action: 'coupon' },
  COUPON_NOT_STARTED: { title: 'Coupon not active yet', message: "That coupon isn't active yet.", action: 'coupon' },
  COUPON_EXPIRED: { title: 'Coupon expired', message: 'That coupon has expired.', action: 'coupon' },
  COUPON_LIMIT_REACHED: { title: 'Coupon used up', message: "That coupon can't be used again.", action: 'coupon' },
  COUPON_FIRST_ORDER_ONLY: { title: 'First order only', message: 'That coupon is only for a first order.', action: 'coupon' },
  COUPON_MIN_SUBTOTAL: { title: 'Add more items', message: "Your cart is below that coupon's minimum. Add items or remove the code.", action: 'coupon' },
  COUPONS_DISABLED: { title: 'Coupons are off', message: 'Coupon codes are not available right now.', action: 'coupon' },
  // combo packs (Flutter app_errors.dart): ended, changed or sold out since it was added
  COMBO_NOT_FOUND: { title: 'Combo pack ended', message: "A combo pack in your cart isn't available anymore. Remove it and try again.", action: 'reconcile' },
  COMBO_UNAVAILABLE: { title: 'Combo pack unavailable', message: "A combo pack in your cart isn't available right now. Remove it and try again.", action: 'reconcile' },
  COMBO_OUT_OF_STOCK: { title: 'Combo pack sold out', message: 'A combo pack in your cart has sold out. Remove it or lower the quantity and try again.', action: 'reconcile' },
  COMBO_QUANTITY_TOO_HIGH: { title: 'Too many packs', message: 'You can order at most 20 of one combo pack.', action: null },
  // variants and stock (migration 045): the cart follows the refusal (stockRefusal)
  OUT_OF_STOCK: { title: 'Sold out', message: 'An item in your cart has sold out. It is marked in your cart.', action: 'stock' },
  INSUFFICIENT_STOCK: { title: 'Not enough left', message: 'We have fewer of an item than you asked for. Your cart now has what is left.', action: 'stock' },
  VARIANT_REQUIRED: { title: 'Choose a size', message: 'An item in your cart now comes in sizes. Remove it and add the size you want.', action: 'stock' },
  VARIANT_NOT_FOUND: { title: 'Size no longer sold', message: 'A size in your cart is no longer sold. Remove it and pick another size.', action: 'stock' },
  VARIANT_UNAVAILABLE: { title: 'Size unavailable', message: "A size in your cart isn't available right now. Remove it and try again.", action: 'stock' },
  // delivery lead time (migration 045): pick a slot on/after the first delivery day
  LEAD_TIME_REQUIRES_SLOT: { title: 'Pick a delivery time', message: 'An item in your cart needs a few days. Pick a delivery time.', action: 'slot' },
  SLOT_BEFORE_LEAD_TIME: { title: 'Pick a later time', message: 'An item in your cart cannot be delivered that soon. Pick a later delivery time.', action: 'slot' },
  // PayHere (docs/api/payhere.md): online payment switched off meanwhile, or the total is 0
  ONLINE_PAYMENT_UNAVAILABLE: { title: 'Online payment is off', message: 'Online payment is not available right now. Choose cash on delivery and place the order again.', action: 'payment' },
  NOTHING_TO_PAY_ONLINE: { title: 'Nothing to pay online', message: 'This order has nothing to pay online. Place it with cash on delivery.', action: 'payment' },
  POINTS_INSUFFICIENT: { title: 'Not enough points', message: "You don't have enough Blynk Points for that.", action: 'retry' },
  TOO_MANY_REQUESTS: { title: 'Too many tries', message: 'Too many tries. Wait a moment, then try again.', action: 'retry' },
  RATE_LIMITED: { title: 'Too many tries', message: 'Too many tries. Wait a moment, then try again.', action: 'retry' },
};

const SERVER_WORDED = new Set([
  'STORE_CLOSED', 'SLOT_UNAVAILABLE', 'SLOT_FULL', 'FOR_SOMEONE_ELSE_DISABLED',
  // these name the item ("Only 3 left of Chilli Powder 100 g. Please lower the quantity.")
  'OUT_OF_STOCK', 'INSUFFICIENT_STOCK', 'VARIANT_REQUIRED', 'VARIANT_NOT_FOUND', 'VARIANT_UNAVAILABLE',
  'LEAD_TIME_REQUIRES_SLOT', 'SLOT_BEFORE_LEAD_TIME',
]);

/** Clear copy for any failure of POST /orders (or the coupon preview). */
export function placeErrorCopy(e: unknown): PlaceErrorCopy {
  if (!(e instanceof ApiError)) return { title: 'Something went wrong', message: 'Something went wrong. Try again.', action: 'retry' };
  const known = e.code ? COPY[e.code] : undefined;
  if (known) {
    // the server's own sentence for these (the Flutter shop's serverWordedOrderRefusals):
    // STORE_CLOSED names when the store opens again, the slot ones say what to do
    if (e.code && SERVER_WORDED.has(e.code) && e.message && e.message !== 'Request failed.') return { ...known, message: e.message };
    return known;
  }
  if (e.status === 401) return { title: 'Log in needed', message: 'Please sign in again to place your order.', action: 'signin' };
  if (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT') {
    // the same idempotency key is sent again, so a retry never makes a second order
    return { title: 'No connection', message: "We couldn't reach Blynk. Check your connection and try again.", action: 'retry' };
  }
  if (e.status >= 500) return { title: 'Something went wrong', message: 'Something went wrong on our side. Try again in a moment.', action: 'retry' };
  if (e.status === 400) return { title: 'Check your order', message: 'Something in your order needs a look. Check your cart and try again.', action: 'reconcile' };
  return { title: "That can't be done right now", message: "That can't be done right now. Go back, check, and try again.", action: null };
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
  if (r.kind === 'only') return `Your cart now has ${r.available}.`;
  if (r.kind === 'needs-size') return 'Remove it and add the size you want.';
  return 'Remove it from your cart to order the rest.';
}

/** Cancel refusals (lifecycle CUSTOMER_CANCEL). */
export function cancelErrorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : undefined;
  switch (code) {
    case 'ORDER_ALREADY_OUT_FOR_DELIVERY': return "Your order is already on its way, so it can't be cancelled.";
    case 'ORDER_ALREADY_CANCELLED': return 'This order is already cancelled.';
    case 'ORDER_CANNOT_BE_CANCELLED':
    case 'INVALID_STATUS_TRANSITION': return "This order can't be cancelled now.";
    case 'ORDER_NOT_FOUND': return 'This order could not be found.';
    default: return "We couldn't confirm the cancellation. Checking your order…";
  }
}
