import { formatLkr } from '@/blynk/lib/money';
import type { Order, OrderHistoryEntry, OrderStatus } from './types';

/*
 * The customer's words for an order's status (the Flutter app's order_status_labels.dart and
 * order_format.dart, approved wording), shared by My orders and the order status screen.
 */

export type OrderTone = 'active' | 'success' | 'neutral' | 'problem';

const LABEL: Record<OrderStatus, string> = {
  PLACED: 'Order placed',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Delivery failed',
  CUSTOMER_UNAVAILABLE: "We couldn't reach you",
  ITEM_UNAVAILABLE: 'Item unavailable',
};

export const statusLabel = (s: string): string => LABEL[s as OrderStatus] ?? 'Status unavailable';

export function statusTone(s: string): OrderTone {
  switch (s) {
    case 'DELIVERED': return 'success';
    case 'CANCELLED': return 'neutral';
    case 'FAILED': case 'CUSTOMER_UNAVAILABLE': case 'ITEM_UNAVAILABLE': return 'problem';
    case 'PLACED': case 'PACKED': case 'OUT_FOR_DELIVERY': return 'active';
    default: return 'neutral';
  }
}

/** One sentence under the status, from the order status and the delivery's handover step. */
export function statusSentence(o: Pick<Order, 'order_status' | 'scheduled_for' | 'delivery'>): string {
  const a = o.delivery?.assignment_status ?? null;
  switch (o.order_status) {
    case 'PLACED': return o.scheduled_for ? "We'll start preparing it when deliveries open." : "We've received your order.";
    case 'ITEM_UNAVAILABLE': return "Something couldn't be sourced. Your total has been updated.";
    case 'PACKED': return a === 'ASSIGNED' || a === 'ACCEPTED' ? 'A rider has been assigned.' : 'Your order is packed.';
    case 'OUT_FOR_DELIVERY': return a === 'ARRIVED_AT_CUSTOMER' ? 'Your rider has arrived.' : 'Your order is on its way.';
    case 'DELIVERED': return 'Delivered. Thank you!';
    case 'CANCELLED': return 'This order was cancelled.';
    case 'FAILED': return "We couldn't complete this delivery.";
    case 'CUSTOMER_UNAVAILABLE': return "The rider couldn't reach you at the address.";
    default: return 'Pull down to refresh.';
  }
}

export const PROGRESS_STEPS = ['Order received', 'Packed', 'On the way', 'Delivered'] as const;

/** Where the order is on the four-step tracker, and whether it stopped there (cancelled, failed). */
export function progressOf(s: string): { step: number; stopped: boolean } {
  switch (s) {
    case 'PLACED': case 'ITEM_UNAVAILABLE': return { step: 0, stopped: false };
    case 'PACKED': return { step: 1, stopped: false };
    case 'OUT_FOR_DELIVERY': return { step: 2, stopped: false };
    case 'DELIVERED': return { step: 3, stopped: false };
    case 'FAILED': case 'CUSTOMER_UNAVAILABLE': return { step: 2, stopped: true };
    default: return { step: 0, stopped: true };
  }
}

/** A "What happened" row: a PACKED after a failed attempt reads as a redelivery. */
export function timelineLabel(e: Pick<OrderHistoryEntry, 'old_status' | 'new_status'>): string {
  if (e.new_status === 'PACKED' && (e.old_status === 'FAILED' || e.old_status === 'CUSTOMER_UNAVAILABLE')) return 'Packed again for redelivery';
  return statusLabel(e.new_status);
}

/** The order is still moving: the status screen keeps polling. */
export const isOpenOrder = (s: string) => s === 'PLACED' || s === 'PACKED' || s === 'OUT_FOR_DELIVERY' || s === 'ITEM_UNAVAILABLE';

/** The one payment line (cash on delivery is the only method). */
export function paymentLine(o: Pick<Order, 'order_status' | 'payment_status' | 'total_amount'>): string {
  if (o.order_status === 'CANCELLED') return 'Nothing to pay';
  if (o.payment_status === 'PAID') return 'Paid in cash';
  if (o.order_status === 'FAILED' || o.order_status === 'CUSTOMER_UNAVAILABLE') return 'Not paid';
  return `Cash on delivery — pay ${formatLkr(o.total_amount)} to the rider`;
}

/** "3 items" (units, as the list shows what is in the order). */
export function itemCountText(o: Pick<Order, 'items'>): string {
  const n = o.items.reduce((s, it) => s + (it.quantity || 0), 0);
  return `${n} item${n === 1 ? '' : 's'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Oct, 9:41 PM" in Sri Lanka time (the store's timezone, UTC+5:30, no DST). */
export function orderTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 330 * 60_000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The discount rows the bill shows (only the ones that took something off). */
export function discountRows(o: Pick<Order, 'discount_amount' | 'birthday_discount_amount' | 'referral_discount_amount' | 'points_discount_amount' | 'coupon_code'>): { label: string; amount: number }[] {
  const rows: { label: string; amount: number }[] = [];
  if (o.birthday_discount_amount > 0) rows.push({ label: 'Birthday gift', amount: o.birthday_discount_amount });
  if (o.referral_discount_amount > 0) rows.push({ label: 'Referral reward', amount: o.referral_discount_amount });
  if (o.points_discount_amount > 0) rows.push({ label: 'Blynk Points', amount: o.points_discount_amount });
  const named = o.birthday_discount_amount + o.referral_discount_amount + o.points_discount_amount;
  const rest = Math.round((o.discount_amount - named) * 100) / 100;
  if (rest > 0) rows.push({ label: o.coupon_code ? `Discount (${o.coupon_code})` : 'Discount', amount: rest });
  return rows;
}

/** "Big Onions · 1 kg", but never the unit twice ("Shampoo 180ml" already says 180 ml). */
export function itemTitle(name: string, unit: string | null | undefined): string {
  const squash = (x: string) => x.toLowerCase().replace(/\s+/g, '');
  if (!unit || !unit.trim() || squash(name).includes(squash(unit))) return name;
  return `${name} · ${unit.trim()}`;
}

/* ---- the order screen's rules (the Flutter shop's order_summary_screen.dart) ---- */

/** The proof-of-delivery code shows only while OUT_FOR_DELIVERY and the server sent it. */
export const showsDeliveryCode = (o: Pick<Order, 'order_status' | 'delivery_code'>) =>
  o.order_status === 'OUT_FOR_DELIVERY' && typeof o.delivery_code === 'string' && o.delivery_code.length > 0;

/** Before pickup there is no code yet: say where it will appear. */
export const showsDeliveryCodeComing = (o: Pick<Order, 'order_status'>) =>
  o.order_status === 'PLACED' || o.order_status === 'PACKED' || o.order_status === 'ITEM_UNAVAILABLE';

export const CODE_COMING = 'Your 4-digit delivery code appears here when the rider picks up your order. We also send it by SMS.';

/** The rider is at the door: no map, but the customer can still call them. */
export const riderArrived = (o: Pick<Order, 'order_status' | 'delivery'>) =>
  o.order_status === 'OUT_FOR_DELIVERY' && o.delivery?.assignment_status === 'ARRIVED_AT_CUSTOMER';

/** The line under an item the store could not supply or replaced. */
export function itemCaption(itemStatus: string): { text: string; struck: boolean; problem: boolean } | null {
  if (itemStatus === 'UNAVAILABLE') return { text: 'Unavailable — not charged', struck: true, problem: true };
  if (itemStatus === 'SUBSTITUTED') return { text: 'Replaced by the store', struck: false, problem: false };
  return null;
}

/** "14 Oct, 8:00 AM – 10:00 AM" for a booked slot; null for as soon as possible. */
export function slotWindowText(from: string | null | undefined, until: string | null | undefined): string | null {
  const start = orderTime(from);
  if (!start) return null;
  const end = orderTime(until);
  if (!end) return start;
  // same day: only the end time after the dash
  const [d1, t1] = start.split(', ');
  const [d2, t2] = end.split(', ');
  return d1 === d2 ? `${d1}, ${t1} – ${t2}` : `${start} – ${end}`;
}

/** Cancel is offered only while the server says so (CUSTOMER_CANCEL from PLACED or PACKED). */
export const CANCELLABLE: readonly string[] = ['PLACED', 'PACKED'];
export const mayCancel = (o: Pick<Order, 'order_status' | 'can_cancel'>) => o.can_cancel === true && CANCELLABLE.includes(o.order_status);
