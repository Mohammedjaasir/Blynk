import { ReactNode, useSyncExternalStore } from 'react';
import type { Combo, Product } from '@/blynk/api/types';
import {
  applyRefusal, clampQty, comboQuantityOf, itemCount, keyOf, lineAvailable, lineQuantityOf, loadCart, reconcile, reconcileCombos, reconcileVariants,
  regularTotal, saveCart, setComboQuantity, setQuantity, subtotal, type CartLine, type CartState, type CartVariant, type ComboLine,
  type LineRefusal,
} from '@/blynk/cart/cartStore';
import { trackCartChange } from '@/blynk/analytics/track';
import { showNotice } from '@/blynk/account/notice';
import { createSellerGuard, type AddOutcome } from '@/blynk/cart/sellerGuard';
import { oneSellerRuleOn, type AddEntry } from '@/blynk/cart/sellerRule';
import { openStartNewCart } from '@/blynk/cart/startNewCart';

type Address = { title: string; line: string };

type Snapshot = {
  /** Cart lines keyed by product (+ size), with enough product data to render (and persist). */
  lines: CartLine[];
  /** Units per product id, all its sizes together (a card's "in cart"). */
  qty: Record<string, number>;
  /** Units per line key (`lineKey(productId, variantId)`): one size of a product. */
  lineQty: Record<string, number>;
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

function derive(state: CartState): Pick<Snapshot, 'lines' | 'qty' | 'lineQty' | 'combos' | 'comboQty' | 'count' | 'total' | 'mrpTotal' | 'unavailable'> {
  const qty: Record<string, number> = {};
  const lineQty: Record<string, number> = {};
  for (const l of state.lines) {
    qty[l.product.id] = (qty[l.product.id] ?? 0) + l.quantity;
    lineQty[keyOf(l)] = l.quantity;
  }
  const combos = state.combos ?? [];
  const comboQty: Record<string, number> = {};
  for (const l of combos) comboQty[l.combo.id] = l.quantity;
  return {
    lines: state.lines,
    qty,
    lineQty,
    combos,
    comboQty,
    count: itemCount(state),
    total: subtotal(state),
    mrpTotal: regularTotal(state),
    unavailable: state.lines.filter((l) => !lineAvailable(l)).length + combos.filter((l) => !l.combo.is_available).length,
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
/** A customer's own change (not a sync or a refusal): GTM hears what was added or removed. */
function userSet(next: CartState, v?: CartVariant | null) {
  const before = state();
  setLines(next);
  trackCartChange(before, next, v);
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

/** Units of a product line (or size) / packs of a combo in the cart right now. */
const qtyOfEntry = (e: AddEntry) =>
  e.kind === 'combo' ? comboQuantityOf(state(), e.combo.id) : lineQuantityOf(state(), keyOf({ product: e.product, variant: e.variant }));

/**
 * One seller per order (2026-10-27): every add that can bring a NEW source into the cart goes through
 * this guard. With the rule on and a different source already in the cart, the add is held and the
 * customer is asked "Start a new cart?" (StartNewCartHost); otherwise it is applied as before.
 */
const guard = createSellerGuard({
  rule: oneSellerRuleOn,
  lines: () => snap.lines,
  combos: () => snap.combos,
  qtyOf: qtyOfEntry,
  apply: (e) => {
    if (e.kind === 'combo') userSet(setComboQuantity(state(), e.combo, comboQuantityOf(state(), e.combo.id) + e.quantity));
    else userSet(setQuantity(state(), e.product, lineQuantityOf(state(), keyOf({ product: e.product, variant: e.variant })) + e.quantity, e.variant), e.variant);
  },
  clear: () => userSet({ lines: [], combos: [] }),
  replace: (lines, combos) => userSet({ lines, combos }),
  prompt: openStartNewCart,
  notice: showNotice,
});

export const cartActions = {
  /** One more of a product, or of one size of it (`v`). */
  add: (p: Product, v?: CartVariant | null) => { guard.attempt([{ kind: 'product', product: p, variant: v, quantity: 1 }]); },
  /**
   * Many items at once (Add all, order again): the rule asks once for the whole list. `onDone` hears
   * what went in - now, or after "Clear cart and add"; never after "Keep current cart".
   */
  addMany: (entries: AddEntry[], onDone?: (o: AddOutcome) => void) => guard.attempt(entries, onDone),
  /** Checkout refused a cart that mixes sellers: keep only the first source's items; returns the units removed. */
  keepFirstSource: () => guard.keepFirstSource(),
  /** One less of a line: `key` is the product id, or `lineKey(productId, variantId)` for a size. */
  remove: (key: string) => {
    const line = snap.lines.find((l) => keyOf(l) === key);
    if (line) userSet(setQuantity(state(), line.product, line.quantity - 1, line.variant));
  },
  setQty: (p: Product, n: number, v?: CartVariant | null) => {
    const have = lineQuantityOf(state(), keyOf({ product: p, variant: v }));
    // more of a line (or a new one) can bring in a new source; fewer / removing never can
    if (clampQty(n) > have) guard.attempt([{ kind: 'product', product: p, variant: v, quantity: clampQty(n) - have }]);
    else userSet(setQuantity(state(), p, n, v), v);
  },
  /** A product page / size picker answer: fresh prices and stock for that product's size lines. */
  syncVariants: (p: Product) => {
    if (!snap.lines.some((l) => l.product.id === p.id)) return;
    const next = reconcileVariants(state(), p);
    if (next.lines !== snap.lines) setLines(next);
  },
  /** POST /orders refused a line (sold out, only N left, size needed): the cart follows. */
  applyRefusal: (r: LineRefusal) => {
    const next = applyRefusal(state(), r);
    if (next.lines !== snap.lines) setLines(next);
  },
  /** One more pack of a combo (at most 20 packs, 20 different combos); the snapshot becomes `c`. */
  addCombo: (c: Combo) => { guard.attempt([{ kind: 'combo', combo: c, quantity: 1 }]); },
  removeCombo: (c: Combo) => userSet(setComboQuantity(state(), c, comboQuantityOf(state(), c.id) - 1)),
  setComboQty: (c: Combo, n: number) => {
    const have = comboQuantityOf(state(), c.id);
    if (n > have) guard.attempt([{ kind: 'combo', combo: c, quantity: n - have }]);
    else userSet(setComboQuantity(state(), c, n));
  },
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
  /** `byCustomer`: the cart's own "Clear cart" (GTM hears remove_from_cart); sign-out and a placed order are not. */
  clear: (byCustomer = false) => (byCustomer ? userSet({ lines: [], combos: [] }) : setLines({ lines: [], combos: [] })),
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
