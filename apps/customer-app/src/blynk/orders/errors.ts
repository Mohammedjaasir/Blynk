import { ApiError } from '@/blynk/api/client';

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
  // PayHere (docs/api/payhere.md): online payment switched off meanwhile, or the total is 0
  ONLINE_PAYMENT_UNAVAILABLE: { title: 'Online payment is off', message: 'Online payment is not available right now. Choose cash on delivery and place the order again.', action: 'payment' },
  NOTHING_TO_PAY_ONLINE: { title: 'Nothing to pay online', message: 'This order has nothing to pay online. Place it with cash on delivery.', action: 'payment' },
  POINTS_INSUFFICIENT: { title: 'Not enough points', message: "You don't have enough Blynk Points for that.", action: 'retry' },
  TOO_MANY_REQUESTS: { title: 'Too many tries', message: 'Too many tries. Wait a moment, then try again.', action: 'retry' },
  RATE_LIMITED: { title: 'Too many tries', message: 'Too many tries. Wait a moment, then try again.', action: 'retry' },
};

const SERVER_WORDED = new Set(['STORE_CLOSED', 'SLOT_UNAVAILABLE', 'SLOT_FULL', 'FOR_SOMEONE_ELSE_DISABLED']);

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
