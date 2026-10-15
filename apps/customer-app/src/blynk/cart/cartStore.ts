import type { Combo, Product, ProductVariant } from '../api/types';
import { effectivePrice, type MrpPriced } from '../lib/pricing';
import { storage } from '../lib/storage';

/** Its own key: the web app at / and this app at /app share an origin, and their carts stay apart. */
export const CART_KEY = 'blynk.app.cart.v1';
export const MAX_QTY = 100;
/**
 * The size/pack a line is for (migration 045): a snapshot of the variant as it was added, kept
 * fresh from the product page / size picker. The server prices it again at POST /orders.
 */
export type CartVariant = Pick<ProductVariant, 'id' | 'label' | 'selling_price' | 'offer_price' | 'offer_ends_at' | 'is_available' | 'mrp'>;
/**
 * One cart line: a product, or one size of it. Lines are keyed by product + variant
 * (`lineKey`), so 100 g and 250 g of the same chilli powder are two lines.
 */
export type CartLine = { product: Product; quantity: number; variant?: CartVariant | null };
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
function validVariant(v: CartVariant | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  return typeof v === 'object' && typeof v.id === 'string' && !!v.id && typeof v.label === 'string' && finite(v.selling_price)
    && (v.offer_price === null || v.offer_price === undefined || finite(v.offer_price)) && typeof v.is_available === 'boolean';
}
export function validLine(l: CartLine): boolean {
  const p = l?.product;
  return !!p && typeof p.id === 'string' && finite(p.selling_price)
    && (p.offer_price === null || p.offer_price === undefined || finite(p.offer_price))
    && typeof p.is_available === 'boolean' && finite(l.quantity) && validVariant(l.variant);
}

/** A line's key: the product id, or product id + variant id for a size of it. */
export const lineKey = (productId: string, variantId?: string | null) => (variantId ? `${productId}:${variantId}` : productId);
export const keyOf = (l: Pick<CartLine, 'product' | 'variant'>) => lineKey(l.product.id, l.variant?.id);

/** Only the fields a cart line keeps of a variant. */
export const toCartVariant = (v: CartVariant): CartVariant => ({
  id: v.id, label: v.label, selling_price: v.selling_price, offer_price: v.offer_price ?? null,
  offer_ends_at: v.offer_ends_at ?? null, is_available: v.is_available,
  // migration 048: the size's MRP, for the cart line's struck price
  ...(v.mrp != null ? { mrp: v.mrp } : {}),
});

/** The price fields that apply to a line: the variant's for a size, else the product's. */
export const linePriced = (l: Pick<CartLine, 'product' | 'variant'>): MrpPriced => (l.variant ? l.variant : l.product);
/** One unit of the line right now (offer-aware). */
export const lineUnitPrice = (l: Pick<CartLine, 'product' | 'variant'>, now = new Date()) => effectivePrice(linePriced(l), now);

/**
 * A product with variants must be ordered by size: a line saved before it had sizes (or whose
 * size was removed) needs the customer to pick one again.
 */
export const needsVariant = (l: Pick<CartLine, 'product' | 'variant'>) => !l.variant && l.product.has_variants === true;
/** The line can be ordered: the product is on, its size (if any) is in stock, and no size is missing. */
export const lineAvailable = (l: Pick<CartLine, 'product' | 'variant'>) =>
  l.product.is_available && (l.variant ? l.variant.is_available : !needsVariant(l));

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
      .map((l: CartLine) => ({ product: l.product, quantity: clampQty(l.quantity), ...(l.variant ? { variant: toCartVariant(l.variant) } : {}) }))
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
/** Set how many of a product (or of one size of it, `variant`) are in the cart; 0 removes the line. */
export function setQuantity(s: CartState, product: Product, qty: number, variant?: CartVariant | null): CartState {
  const q = clampQty(qty);
  const key = lineKey(product.id, variant?.id);
  const rest = s.lines.filter((l) => keyOf(l) !== key);
  if (q === 0) return { ...s, lines: rest };
  const i = s.lines.findIndex((l) => keyOf(l) === key);
  const line: CartLine = variant ? { product, quantity: q, variant: toCartVariant(variant) } : { product, quantity: q };
  if (i === -1) return { ...s, lines: [...s.lines, line] };
  const lines = [...s.lines]; lines[i] = line; return { ...s, lines };
}
/** Units of a product in the cart, all its sizes together (the card's "in cart"). */
export const quantityOf = (s: CartState, id: string) => s.lines.reduce((a, l) => a + (l.product.id === id ? l.quantity : 0), 0);
/** Units of one line (`lineKey`). */
export const lineQuantityOf = (s: CartState, key: string) => s.lines.find((l) => keyOf(l) === key)?.quantity ?? 0;
/** Product units plus combo packs (a pack counts as one item, as in the Flutter shop). */
export const itemCount = (s: CartState) =>
  s.lines.filter(lineAvailable).reduce((a, l) => a + l.quantity, 0) + comboPacks(s).reduce((a, l) => a + l.quantity, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Product lines at offer-aware prices (a size at its own price) plus combo price x packs. */
export const subtotal = (s: CartState, now = new Date()) =>
  round2(s.lines.filter(lineAvailable).reduce((a, l) => a + lineUnitPrice(l, now) * l.quantity, 0)
    + comboPacks(s).reduce((a, l) => a + l.combo.price * l.quantity, 0));
/** The same at regular prices: a combo counts at its items' own total (the struck price). */
export const regularTotal = (s: CartState) =>
  round2(s.lines.filter(lineAvailable).reduce((a, l) => a + linePriced(l).selling_price * l.quantity, 0)
    + comboPacks(s).reduce((a, l) => a + Math.max(l.combo.items_total, l.combo.price) * l.quantity, 0));
/**
 * Fresh prices and availability from the catalogue; a product that vanished is kept but flagged
 * unavailable. The list has no variants, so a size line keeps its size snapshot (see
 * reconcileVariants); a product that no longer has sizes makes its size lines unavailable.
 */
export function reconcile(s: CartState, fresh: Product[]): CartState {
  const byId = new Map(fresh.map((p) => [p.id, p]));
  return {
    ...s,
    lines: s.lines.map((l) => {
      const p = byId.get(l.product.id);
      if (!p) return { ...l, product: { ...l.product, is_available: false } };
      if (l.variant && p.has_variants === false) return { ...l, product: p, variant: { ...l.variant, is_available: false } };
      return { ...l, product: p };
    }),
  };
}

/**
 * A product page / size picker answer (GET /catalog/products/:id with `variants`): its size
 * lines take the fresh price and stock; a size no longer listed becomes unavailable.
 */
export function reconcileVariants(s: CartState, product: Product): CartState {
  if (!Array.isArray(product.variants)) return s;
  const byId = new Map(product.variants.map((v) => [v.id, v]));
  const { variants: _variants, ...listed } = product;
  void _variants;
  let changed = false;
  const lines = s.lines.map((l) => {
    if (l.product.id !== product.id) return l;
    changed = true;
    if (!l.variant) return { ...l, product: listed as Product };
    const v = byId.get(l.variant.id);
    return { ...l, product: listed as Product, variant: v ? toCartVariant(v) : { ...l.variant, is_available: false } };
  });
  return changed ? { ...s, lines } : s;
}

/* ------------------------------------------------------------------ refusals at checkout */

/** What POST /orders said about one line (errors.ts stockRefusal). */
export type LineRefusal =
  /** Nothing left (OUT_OF_STOCK) or the size is off / gone (VARIANT_UNAVAILABLE / VARIANT_NOT_FOUND). */
  | { kind: 'sold-out'; product_id: string; variant_id: string | null }
  /** Only `available` left (INSUFFICIENT_STOCK): the line is lowered to that. */
  | { kind: 'only'; product_id: string; variant_id: string | null; available: number }
  /** A product with sizes was sent without one (VARIANT_REQUIRED). */
  | { kind: 'needs-size'; product_id: string };

/** The cart after a refusal: the line is marked sold out, lowered, or asks for a size again. */
export function applyRefusal(s: CartState, r: LineRefusal): CartState {
  const hit = (l: CartLine) => l.product.id === r.product_id && (r.kind === 'needs-size' ? !l.variant : (l.variant?.id ?? null) === r.variant_id);
  if (!s.lines.some(hit)) return s;
  if (r.kind === 'only' && r.available > 0) {
    return { ...s, lines: s.lines.map((l) => (hit(l) ? { ...l, quantity: clampQty(Math.min(l.quantity, r.available)) } : l)) };
  }
  if (r.kind === 'needs-size') {
    return { ...s, lines: s.lines.map((l) => (hit(l) ? { ...l, product: { ...l.product, has_variants: true } } : l)) };
  }
  return {
    ...s,
    lines: s.lines.map((l) => {
      if (!hit(l)) return l;
      return l.variant ? { ...l, variant: { ...l.variant, is_available: false } } : { ...l, product: { ...l.product, is_available: false } };
    }),
  };
}
