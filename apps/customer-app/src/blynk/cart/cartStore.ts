import type { Combo, Product } from '../api/types';
import { effectivePrice } from '../lib/pricing';
import { storage } from '../lib/storage';

/** Its own key: the web app at / and this app at /app share an origin, and their carts stay apart. */
export const CART_KEY = 'blynk.app.cart.v1';
export const MAX_QTY = 100;
export type CartLine = { product: Product; quantity: number };
/**
 * A combo pack line (Flutter CartComboLine, owner 2026-10-09): a snapshot of the combo as it was
 * added, kept apart from product lines (a combo id is never a product id). The server re-prices
 * it at POST /orders as `combos: [{ combo_id, quantity }]`.
 */
export type ComboLine = { combo: Combo; quantity: number };
/** `combos` is optional so a cart saved before combo packs (and older callers) still work. */
export type CartState = { lines: CartLine[]; combos?: ComboLine[] };

/** Backend order.schema: at most 20 packs of one combo and 20 different combos per order. */
export const MAX_COMBO_QTY = 20;
export const MAX_COMBO_LINES = 20;

export const clampQty = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_QTY, Math.floor(n))) : 0);

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
export function validLine(l: CartLine): boolean {
  const p = l?.product;
  return !!p && typeof p.id === 'string' && finite(p.selling_price)
    && (p.offer_price === null || p.offer_price === undefined || finite(p.offer_price))
    && typeof p.is_available === 'boolean' && finite(l.quantity);
}

export function validComboLine(l: ComboLine): boolean {
  const c = l?.combo;
  return !!c && typeof c.id === 'string' && !!c.id && typeof c.name === 'string' && finite(c.price) && c.price > 0
    && finite(c.items_total) && typeof c.is_available === 'boolean' && Array.isArray(c.items) && finite(l.quantity);
}
const clampCombo = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_COMBO_QTY, Math.floor(n))) : 0);

export function loadCart(): CartState {
  try {
    const raw = JSON.parse(storage.get(CART_KEY) ?? 'null');
    if (!raw || raw.v !== 1 || !Array.isArray(raw.lines)) return { lines: [] };
    const lines = raw.lines
      .filter((l: CartLine) => validLine(l))
      .map((l: CartLine) => ({ product: l.product, quantity: clampQty(l.quantity) }))
      .filter((l: CartLine) => l.quantity > 0);
    const seen = new Set<string>();
    const combos: ComboLine[] = (Array.isArray(raw.combos) ? raw.combos : [])
      .filter((l: ComboLine) => validComboLine(l))
      .map((l: ComboLine) => ({ combo: l.combo, quantity: clampCombo(l.quantity) }))
      .filter((l: ComboLine) => l.quantity > 0 && !seen.has(l.combo.id) && !!seen.add(l.combo.id))
      .slice(0, MAX_COMBO_LINES);
    return combos.length ? { lines, combos } : { lines };
  } catch { return { lines: [] }; }
}
export function saveCart(s: CartState) {
  const combos = s.combos ?? [];
  try { storage.set(CART_KEY, JSON.stringify({ v: 1, lines: s.lines, ...(combos.length ? { combos } : {}) })); } catch { /* storage full or blocked */ }
}
/** Set how many packs of a combo are in the cart (0 removes it); the snapshot becomes `combo`. */
export function setComboQuantity(s: CartState, combo: Combo, qty: number): CartState {
  const q = clampCombo(qty);
  const list = s.combos ?? [];
  const rest = list.filter((l) => l.combo.id !== combo.id);
  if (q === 0) return { ...s, combos: rest };
  const i = list.findIndex((l) => l.combo.id === combo.id);
  if (i === -1) {
    if (list.length >= MAX_COMBO_LINES) return s;
    return { ...s, combos: [...list, { combo, quantity: q }] };
  }
  const combos = [...list]; combos[i] = { combo, quantity: q }; return { ...s, combos };
}
export const comboQuantityOf = (s: CartState, id: string) => (s.combos ?? []).find((l) => l.combo.id === id)?.quantity ?? 0;
const comboPacks = (s: CartState) => (s.combos ?? []).filter((l) => l.combo.is_available);
/** Fresh combos (GET /combos) replace the saved snapshots; one no longer served is kept (the server says so at checkout). */
export function reconcileCombos(s: CartState, fresh: Combo[]): CartState {
  if (!s.combos?.length) return s;
  const byId = new Map(fresh.map((c) => [c.id, c]));
  return { ...s, combos: s.combos.map((l) => ({ ...l, combo: byId.get(l.combo.id) ?? l.combo })) };
}
export function setQuantity(s: CartState, product: Product, qty: number): CartState {
  const q = clampQty(qty);
  const rest = s.lines.filter((l) => l.product.id !== product.id);
  if (q === 0) return { lines: rest };
  const i = s.lines.findIndex((l) => l.product.id === product.id);
  const line = { product, quantity: q };
  if (i === -1) return { lines: [...s.lines, line] };
  const lines = [...s.lines]; lines[i] = line; return { lines };
}
export const quantityOf = (s: CartState, id: string) => s.lines.find((l) => l.product.id === id)?.quantity ?? 0;
/** Product units plus combo packs (a pack counts as one item, as in the Flutter shop). */
export const itemCount = (s: CartState) =>
  s.lines.filter((l) => l.product.is_available).reduce((a, l) => a + l.quantity, 0) + comboPacks(s).reduce((a, l) => a + l.quantity, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Product lines at offer-aware prices plus combo price x packs. */
export const subtotal = (s: CartState, now = new Date()) =>
  round2(s.lines.filter((l) => l.product.is_available).reduce((a, l) => a + effectivePrice(l.product, now) * l.quantity, 0)
    + comboPacks(s).reduce((a, l) => a + l.combo.price * l.quantity, 0));
/** The same at regular prices: a combo counts at its items' own total (the struck price). */
export const regularTotal = (s: CartState) =>
  round2(s.lines.filter((l) => l.product.is_available).reduce((a, l) => a + l.product.selling_price * l.quantity, 0)
    + comboPacks(s).reduce((a, l) => a + Math.max(l.combo.items_total, l.combo.price) * l.quantity, 0));
/** Fresh prices and availability from the catalogue; a product that vanished is kept but flagged unavailable. */
export function reconcile(s: CartState, fresh: Product[]): CartState {
  const byId = new Map(fresh.map((p) => [p.id, p]));
  return { ...s, lines: s.lines.map((l) => ({ ...l, product: byId.get(l.product.id) ?? { ...l.product, is_available: false } })) };
}
