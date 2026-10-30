import type { SellerOrder, SellerOrderStatus } from '../api/types';
import { ApiError } from '../api/client';
import { errorMessage } from './apiErrors';

export const ORDER_STATUS_CHIP: Record<SellerOrderStatus, { label: string; tone: 'ok' | 'wait' | 'bad' | 'off' }> = {
  NEW: { label: 'New', tone: 'wait' },
  READY: { label: 'Ready', tone: 'ok' },
  ON_THE_WAY: { label: 'On the way', tone: 'ok' },
  DELIVERED: { label: 'Delivered', tone: 'off' },
  CANCELLED: { label: 'Cancelled', tone: 'bad' },
};

/** Orders that still need the seller's attention or are on their way. */
export const OPEN_STATUSES: SellerOrderStatus[] = ['NEW', 'READY', 'ON_THE_WAY'];

export const MIXED_MESSAGE = 'Blynk will collect this order.';
export const NOT_NEW_MESSAGE = 'This order is not new any more. Its latest state is shown below.';
export const READY_DONE_TEXT = 'Ready, the rider has been told';

export function isOpen(order: SellerOrder): boolean {
  return OPEN_STATUSES.includes(order.status);
}

/** How many orders wait for the seller (the tab's badge). */
export function newOrderCount(orders: SellerOrder[]): number {
  return orders.filter((o) => o.status === 'NEW').length;
}

/** "#1283" from 1283, "1283" or "#1283". */
export function orderLabel(order: Pick<SellerOrder, 'order_number'>): string {
  return `#${String(order.order_number).replace(/^#/, '')}`;
}

/** "2 x Apple Pie" for one line. */
export function itemLine(item: { name: string; quantity: number }): string {
  return `${item.quantity} x ${item.name}`;
}

/** "Today, 2:15 pm" or "28 Oct, 2:15 pm" in Colombo time. */
export function orderTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const zone = { timeZone: 'Asia/Colombo' } as const;
  const day = (d: Date) => d.toLocaleDateString('en-CA', zone);
  const clock = date
    .toLocaleTimeString('en-GB', { ...zone, hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?([ap])m$/i, (_m, c: string) => ` ${c.toLowerCase()}m`);
  if (day(date) === day(now)) return `Today, ${clock}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day(date) === day(yesterday)) return `Yesterday, ${clock}`;
  return `${date.toLocaleDateString('en-GB', { ...zone, day: 'numeric', month: 'short' })}, ${clock}`;
}

/** The API's refusal to "Order is ready" in the seller's words. */
export function readyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'SELLER_ORDER_MIXED') return MIXED_MESSAGE;
    if (err.code === 'ORDER_NOT_NEW') return NOT_NEW_MESSAGE;
  }
  return errorMessage(err, 'Could not tell the rider. Please try again.');
}
