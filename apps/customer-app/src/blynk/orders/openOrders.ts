import { useSyncExternalStore } from 'react';

/*
 * The Orders tab's badge (Flutter CustomerShell): shown while the customer has an order that is
 * not finished. Delivered, cancelled and failed orders are finished; anything else - a problem
 * that needs the customer included - is still open. Fed by every orders list the app loads.
 */

const FINISHED = new Set(['DELIVERED', 'CANCELLED', 'FAILED']);

export const isOpenOrder = (status: string | null | undefined): boolean => !!status && !FINISHED.has(status);

export const hasOpenOrder = (orders: { order_status: string }[]): boolean => orders.some((o) => isOpenOrder(o.order_status));

let open = false;
const listeners = new Set<() => void>();

/** Record the latest first page of the customer's orders (or [] when signed out). */
export function setKnownOrders(orders: { order_status: string }[]) {
  const next = hasOpenOrder(orders);
  if (next === open) return;
  open = next;
  listeners.forEach((l) => l());
}

export const getHasOpenOrder = () => open;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useHasOpenOrder(): boolean {
  return useSyncExternalStore(subscribe, getHasOpenOrder, getHasOpenOrder);
}
