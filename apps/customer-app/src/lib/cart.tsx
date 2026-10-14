import { ReactNode, useSyncExternalStore } from 'react';
import type { Combo, Product } from '@/blynk/api/types';
import {
  comboQuantityOf, itemCount, loadCart, quantityOf, reconcile, reconcileCombos, regularTotal, saveCart, setComboQuantity, setQuantity,
  subtotal, type CartLine, type CartState, type ComboLine,
} from '@/blynk/cart/cartStore';

type Address = { title: string; line: string };

type Snapshot = {
  /** Cart lines keyed by Blynk product id, with enough product data to render (and persist). */
  lines: CartLine[];
  qty: Record<string, number>;
  /** Combo pack lines (owner, 2026-10-09), in the order they were first added. */
  combos: ComboLine[];
  /** Packs per combo id. */
  comboQty: Record<string, number>;
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

function derive(state: CartState): Pick<Snapshot, 'lines' | 'qty' | 'combos' | 'comboQty' | 'count' | 'total' | 'mrpTotal' | 'unavailable'> {
  const qty: Record<string, number> = {};
  for (const l of state.lines) qty[l.product.id] = l.quantity;
  const combos = state.combos ?? [];
  const comboQty: Record<string, number> = {};
  for (const l of combos) comboQty[l.combo.id] = l.quantity;
  return {
    lines: state.lines,
    qty,
    combos,
    comboQty,
    count: itemCount(state),
    total: subtotal(state),
    mrpTotal: regularTotal(state),
    unavailable: state.lines.filter((l) => !l.product.is_available).length + combos.filter((l) => !l.combo.is_available).length,
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
/** The cart right now, outside React (e.g. to count what an action added). */
export const getCartSnapshot = () => snap;
const state = (): CartState => ({ lines: snap.lines, combos: snap.combos });

export const cartActions = {
  add: (p: Product) => setLines(setQuantity(state(), p, quantityOf(state(), p.id) + 1)),
  remove: (id: string) => {
    const line = snap.lines.find((l) => l.product.id === id);
    if (line) setLines(setQuantity(state(), line.product, line.quantity - 1));
  },
  setQty: (p: Product, n: number) => setLines(setQuantity(state(), p, n)),
  /** One more pack of a combo (at most 20 packs, 20 different combos); the snapshot becomes `c`. */
  addCombo: (c: Combo) => setLines(setComboQuantity(state(), c, comboQuantityOf(state(), c.id) + 1)),
  removeCombo: (c: Combo) => setLines(setComboQuantity(state(), c, comboQuantityOf(state(), c.id) - 1)),
  setComboQty: (c: Combo, n: number) => setLines(setComboQuantity(state(), c, n)),
  /** Fresh combos (GET /combos) update saved combo lines' prices, items and availability. */
  syncCombos: (fresh: Combo[]) => { if (snap.combos.length) setLines(reconcileCombos(state(), fresh)); },
  /** Keep prices and availability in step with a fresh catalogue. */
  reconcileWith: (products: Product[]) => {
    if (!snap.lines.length) return;
    // design-mock lines (ids "demo-...") are not in Blynk's catalogue: leave them as they are
    const fresh = reconcile(state(), products);
    setLines({ ...fresh, lines: fresh.lines.map((l, i) => (snap.lines[i].product.id.startsWith('demo-') ? snap.lines[i] : l)) });
  },
  setPhone: (phone: string) => set({ phone }),
  setAddress: (address: Address) => set({ address }),
  clear: () => setLines({ lines: [], combos: [] }),
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
