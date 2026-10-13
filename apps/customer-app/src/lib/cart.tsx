import { ReactNode, useSyncExternalStore } from 'react';
import { FREE_DELIVERY_AT, PRODUCTS } from './data';

type Address = { title: string; line: string };

type Snapshot = {
  qty: Record<string, number>;
  storeId: string | null;
  count: number;
  total: number;
  mrpTotal: number;
  freeDelivery: boolean;
  phone: string | null;
  address: Address | null;
};

/*
 * A tiny external store instead of React context: components subscribe to just the
 * slice they need (`useCartSelect`), so tapping "+" on one card re-renders that card
 * and the cart bar — not every product on the screen.
 */
let snap: Snapshot = {
  qty: {}, storeId: null, count: 0, total: 0, mrpTotal: 0, freeDelivery: false, phone: null, address: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<Snapshot>) {
  const next = { ...snap, ...patch };
  if (patch.qty) {
    let count = 0;
    let total = 0;
    let mrpTotal = 0;
    for (const [id, q] of Object.entries(patch.qty)) {
      count += q;
      total += PRODUCTS[id].price * q;
      mrpTotal += PRODUCTS[id].mrp * q;
    }
    Object.assign(next, { count, total, mrpTotal, freeDelivery: total >= FREE_DELIVERY_AT });
  }
  snap = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => snap;

export const cartActions = {
  add: (id: string, storeId?: string) =>
    set({ qty: { ...snap.qty, [id]: (snap.qty[id] ?? 0) + 1 }, ...(storeId ? { storeId } : null) }),
  remove: (id: string) => {
    const n = (snap.qty[id] ?? 0) - 1;
    const qty = { ...snap.qty };
    if (n <= 0) delete qty[id];
    else qty[id] = n;
    set({ qty });
  },
  setPhone: (phone: string) => set({ phone }),
  setAddress: (address: Address) => set({ address }),
  clear: () => set({ qty: {} }),
};

/** Subscribe to one derived value; the component only re-renders when it changes. */
export function useCartSelect<T>(select: (s: Snapshot) => T): T {
  return useSyncExternalStore(subscribe, () => select(snap), () => select(snap));
}

/** Whole cart (for the cart screen and other places that genuinely need everything). */
export function useCart() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...s, ...cartActions };
}

export function CartProvider({ children }: { children: ReactNode }) {
  return children;
}
