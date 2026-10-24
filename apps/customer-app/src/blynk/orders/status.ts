import { formatLkr } from '@/blynk/lib/money';
import { WALLET_COPY } from '@/blynk/wallet/copy';
import { ORDER_WORDS } from './words';
import type { Order, OrderHistoryEntry, OrderStatus } from './types';

/*
 * The customer's words for an order's status (the Flutter app's order_status_labels.dart and
 * order_format.dart, approved wording), shared by My orders and the order status screen.
 */

export type OrderTone = 'active' | 'success' | 'neutral' | 'problem';

const KNOWN_STATUS = new Set<string>(['AWAITING_PAYMENT', 'PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE', 'ITEM_UNAVAILABLE']);

export const statusLabel = (s: string): string => (KNOWN_STATUS.has(s) ? ORDER_WORDS.labels[s as OrderStatus] : ORDER_WORDS.labels.unknown);

export function statusTone(s: string): OrderTone {
  switch (s) {
    case 'DELIVERED': return 'success';
    case 'CANCELLED': return 'neutral';
    case 'FAILED': case 'CUSTOMER_UNAVAILABLE': case 'ITEM_UNAVAILABLE': return 'problem';
    case 'PLACED': case 'PACKED': case 'OUT_FOR_DELIVERY': case 'AWAITING_PAYMENT': return 'active';
    default: return 'neutral';
  }
}

/** One sentence under the status, from the order status and the delivery's handover step. */
export function statusSentence(o: Pick<Order, 'order_status' | 'scheduled_for' | 'delivery'> & Partial<Pick<Order, 'payment_expires_at' | 'payment_status'>>): string {
  const a = o.delivery?.assignment_status ?? null;
  const w = ORDER_WORDS.sentences;
  switch (o.order_status) {
    case 'AWAITING_PAYMENT': {
      const by = clockTime(o.payment_expires_at);
      if (o.payment_status === 'FAILED') return by ? w.payFailedBy(by) : w.payFailed;
      return by ? w.payBy(by) : w.pay;
    }
    case 'PLACED': return o.scheduled_for ? w.placedScheduled : w.placed;
    case 'ITEM_UNAVAILABLE': return w.itemUnavailable;
    case 'PACKED': return a === 'ASSIGNED' || a === 'ACCEPTED' ? w.packedAssigned : w.packed;
    case 'OUT_FOR_DELIVERY': return a === 'ARRIVED_AT_CUSTOMER' ? w.outArrived : w.outWay;
    case 'DELIVERED': return w.delivered;
    case 'CANCELLED': return w.cancelled;
    case 'FAILED': return w.failed;
    case 'CUSTOMER_UNAVAILABLE': return w.customerUnavailable;
    default: return w.refresh;
  }
}

/** The four tracker steps in the customer's language (read while rendering). */
export const progressSteps = (): readonly string[] => ORDER_WORDS.steps;

/** Where the order is on the four-step tracker, and whether it stopped there (cancelled, failed). */
export function progressOf(s: string): { step: number; stopped: boolean } {
  switch (s) {
    case 'AWAITING_PAYMENT': case 'PLACED': case 'ITEM_UNAVAILABLE': return { step: 0, stopped: false };
    case 'PACKED': return { step: 1, stopped: false };
    case 'OUT_FOR_DELIVERY': return { step: 2, stopped: false };
    case 'DELIVERED': return { step: 3, stopped: false };
    case 'FAILED': case 'CUSTOMER_UNAVAILABLE': return { step: 2, stopped: true };
    default: return { step: 0, stopped: true };
  }
}

/** A "What happened" row: a PACKED after a failed attempt reads as a redelivery. */
export function timelineLabel(e: Pick<OrderHistoryEntry, 'old_status' | 'new_status'>): string {
  if (e.new_status === 'PACKED' && (e.old_status === 'FAILED' || e.old_status === 'CUSTOMER_UNAVAILABLE')) return ORDER_WORDS.packedAgain;
  return statusLabel(e.new_status);
}

/** The order is still moving: the status screen keeps polling. */
export const isOpenOrder = (s: string) => s === 'AWAITING_PAYMENT' || s === 'PLACED' || s === 'PACKED' || s === 'OUT_FOR_DELIVERY' || s === 'ITEM_UNAVAILABLE';

/** "9:41 PM" in Sri Lanka time, or '' (for "pay by"). */
export function clockTime(iso: string | null | undefined): string {
  const t = orderTime(iso);
  return t ? t.split(', ')[1] ?? '' : '';
}

export const isOnline = (o: Pick<Order, 'payment_method'>) => o.payment_method === 'ONLINE';

/** An online order still waiting for its PayHere payment ("Pay now" is offered). */
export const awaitingPayment = (o: Pick<Order, 'order_status' | 'payment_method'>) =>
  o.order_status === 'AWAITING_PAYMENT' && isOnline(o);

/** "Awaiting payment — pay by 9:41 PM" (or without the time when the server sent none). */
export const payByLine = (o: Pick<Order, 'payment_expires_at'>) => {
  const by = clockTime(o.payment_expires_at);
  return by ? ORDER_WORDS.awaitingPayBy(by) : ORDER_WORDS.awaitingPay;
};

/** The one payment line: cash on delivery, or the online payment's state. */
export function paymentLine(o: Pick<Order, 'order_status' | 'payment_status' | 'total_amount'> & Partial<Pick<Order, 'payment_method' | 'payment_expires_at' | 'wallet_amount_used'>>): string {
  const w = ORDER_WORDS.payment;
  if (o.payment_method === 'ONLINE') {
    if (o.payment_status === 'REFUNDED') return w.refunded;
    if (o.payment_status === 'PAID') return w.paidOnline;
    if (o.order_status === 'CANCELLED') return w.notPaidNothing;
    if (o.order_status === 'AWAITING_PAYMENT') {
      const by = clockTime(o.payment_expires_at);
      if (o.payment_status === 'FAILED') return by ? w.failedBy(by) : w.failed;
      return payByLine(o);
    }
    return w.payingOnline;
  }
  if (o.order_status === 'CANCELLED') return w.nothingToPay;
  // the Blynk Wallet paid it all: nothing for the rider to collect
  if ((o.wallet_amount_used ?? 0) > 0 && o.total_amount <= 0) return WALLET_COPY.paidByWallet;
  if (o.payment_status === 'PAID') return w.paidCash;
  if (o.order_status === 'FAILED' || o.order_status === 'CUSTOMER_UNAVAILABLE') return w.notPaid;
  return w.cod(formatLkr(o.total_amount));
}

/** "3 items" (units, as the list shows what is in the order). */
export function itemCountText(o: Pick<Order, 'items'>): string {
  const n = o.items.reduce((s, it) => s + (it.quantity || 0), 0);
  return ORDER_WORDS.itemCount(n);
}

/** "13 Oct, 9:41 PM" in Sri Lanka time (the store's timezone, UTC+5:30, no DST). */
export function orderTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 330 * 60_000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${d.getUTCDate()} ${ORDER_WORDS.months[d.getUTCMonth()]}, ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The discount rows the bill shows (only the ones that took something off). */
export function discountRows(o: Pick<Order, 'discount_amount' | 'birthday_discount_amount' | 'referral_discount_amount' | 'points_discount_amount' | 'coupon_code'>): { label: string; amount: number }[] {
  const rows: { label: string; amount: number }[] = [];
  if (o.birthday_discount_amount > 0) rows.push({ label: ORDER_WORDS.discounts.birthday, amount: o.birthday_discount_amount });
  if (o.referral_discount_amount > 0) rows.push({ label: ORDER_WORDS.discounts.referral, amount: o.referral_discount_amount });
  if (o.points_discount_amount > 0) rows.push({ label: ORDER_WORDS.discounts.points, amount: o.points_discount_amount });
  const named = o.birthday_discount_amount + o.referral_discount_amount + o.points_discount_amount;
  const rest = Math.round((o.discount_amount - named) * 100) / 100;
  if (rest > 0) rows.push({ label: o.coupon_code ? ORDER_WORDS.discounts.discountCode(o.coupon_code) : ORDER_WORDS.discounts.discount, amount: rest });
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

/** The rider is at the door: no map, but the customer can still call them. */
export const riderArrived = (o: Pick<Order, 'order_status' | 'delivery'>) =>
  o.order_status === 'OUT_FOR_DELIVERY' && o.delivery?.assignment_status === 'ARRIVED_AT_CUSTOMER';

/** The line under an item the store could not supply or replaced. */
export function itemCaption(itemStatus: string): { text: string; struck: boolean; problem: boolean } | null {
  if (itemStatus === 'UNAVAILABLE') return { text: ORDER_WORDS.caption.unavailable, struck: true, problem: true };
  if (itemStatus === 'SUBSTITUTED') return { text: ORDER_WORDS.caption.substituted, struck: false, problem: false };
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

/** Cancel is offered only while the server says so (CUSTOMER_CANCEL from AWAITING_PAYMENT, PLACED or PACKED). */
export const CANCELLABLE: readonly string[] = ['AWAITING_PAYMENT', 'PLACED', 'PACKED'];
export const mayCancel = (o: Pick<Order, 'order_status' | 'can_cancel'>) => o.can_cancel === true && CANCELLABLE.includes(o.order_status);
