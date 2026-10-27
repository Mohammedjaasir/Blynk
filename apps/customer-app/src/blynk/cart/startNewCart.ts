/*
 * The "Start a new cart?" question (one seller per order). One app-wide dialog (StartNewCartHost in
 * the root layout) reads this tiny store, like the size picker. The cart asks through `openStartNewCart`;
 * the dialog answers through the two callbacks.
 */

export interface NewCartPrompt {
  /** The cart's current source: a shop name, or "Blynk" for Blynk's own items. */
  sellerName: string;
  /** "Clear cart and add": empties the cart, then adds the item(s) that were asked for. */
  clearAndAdd: () => void;
  /** "Keep current cart": nothing changes. */
  keep: () => void;
}

let open: NewCartPrompt | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openStartNewCart(p: NewCartPrompt) { open = p; emit(); }
export function closeStartNewCart() { if (open) { open = null; emit(); } }
export const startNewCartPrompt = () => open;
export function subscribeStartNewCart(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
