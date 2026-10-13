import { ReactNode, useSyncExternalStore } from 'react';
import type { Product } from '@/blynk/api/types';
import {
  itemCount, loadCart, quantityOf, reconcile, regularTotal, saveCart, setQuantity, subtotal, type CartLine, type CartState,
} from '@/blynk/cart/cartStore';

type Address = { title: string; line: string };

type Snapshot = {
  /** Cart lines keyed by Blynk product id, with enough product data to render (and persist). */
  lines: CartLine[];
  qty: Record<string, number>;
  /** Items you can actually buy (unavailable lines are excluded, like the subtotal). */
  count: number;
  /** Subtotal at effective (offer-aware) prices. */
  total: number;
  /** The same items at regular selling prices. */
  mrpTotal: number;
  /** Lines whose product went unavailable or vanished from the catalogue. */
  unavailable: number;
  /** Local only in this phase: nothing here is sent or verified. */
  phone: string | null;
  address: Address | null;
};

function derive(state: CartState): Pick<Snapshot, 'lines' | 'qty' | 'count' | 'total' | 'mrpTotal' | 'unavailable'> {
  const qty: Record<string, number> = {};
  for (const l of state.lines) qty[l.product.id] = l.quantity;
  return {
    lines: state.lines,
    qty,
    count: itemCount(state),
    total: subtotal(state),
    mrpTotal: regularTotal(state),
    unavailable: state.lines.filter((l) => !l.product.is_available).length,
  };
}

/*
 * A tiny external store instead of React context: components subscribe to just the
 * slice they need (`useCartSelect`), so tapping "+" on one card re-renders that card
 * and the cart bar — not every product on the screen.
 */
let snap: Snapshot = { ...derive(loadCart()), phone: null, address: null };
const listeners = new Set<() => void>();

function setLines(state: CartState) {
  saveCart(state);
  snap = { ...snap, ...derive(state) };
  listeners.forEach((l) => l());
}
function set(patch: Partial<Pick<Snapshot, 'phone' | 'address'>>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => snap;
const state = (): CartState => ({ lines: snap.lines });

export const cartActions = {
  add: (p: Product) => setLines(setQuantity(state(), p, quantityOf(state(), p.id) + 1)),
  remove: (id: string) => {
    const line = snap.lines.find((l) => l.product.id === id);
    if (line) setLines(setQuantity(state(), line.product, line.quantity - 1));
  },
  setQty: (p: Product, n: number) => setLines(setQuantity(state(), p, n)),
  /** Keep prices and availability in step with a fresh catalogue. */
  reconcileWith: (products: Product[]) => {
    if (snap.lines.length) setLines(reconcile(state(), products));
  },
  setPhone: (phone: string) => set({ phone }),
  setAddress: (address: Address) => set({ address }),
  clear: () => setLines({ lines: [] }),
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
