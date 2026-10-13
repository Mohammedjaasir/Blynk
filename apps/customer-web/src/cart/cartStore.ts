import type { Product } from '../api/types';
import { effectivePrice } from '../lib/pricing';

export const CART_KEY = 'blynk.web.cart.v1';
export const MAX_QTY = 100;
export type CartLine = { product: Product; quantity: number };
export type CartState = { lines: CartLine[] };

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_QTY, Math.floor(n))) : 0);

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
function validLine(l: CartLine): boolean {
  const p = l?.product;
  return !!p && typeof p.id === 'string' && finite(p.selling_price)
    && (p.offer_price === null || p.offer_price === undefined || finite(p.offer_price))
    && typeof p.is_available === 'boolean' && finite(l.quantity);
}

export function loadCart(): CartState {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) ?? 'null');
    if (!raw || raw.v !== 1 || !Array.isArray(raw.lines)) return { lines: [] };
    const lines = raw.lines
      .filter((l: CartLine) => validLine(l))
      .map((l: CartLine) => ({ product: l.product, quantity: clamp(l.quantity) }))
      .filter((l: CartLine) => l.quantity > 0);
    return { lines };
  } catch { return { lines: [] }; }
}
export function saveCart(s: CartState) {
  try { localStorage.setItem(CART_KEY, JSON.stringify({ v: 1, lines: s.lines })); } catch { /* storage full or blocked */ }
}
export function setQuantity(s: CartState, product: Product, qty: number): CartState {
  const q = clamp(qty);
  const rest = s.lines.filter((l) => l.product.id !== product.id);
  if (q === 0) return { lines: rest };
  const i = s.lines.findIndex((l) => l.product.id === product.id);
  const line = { product, quantity: q };
  if (i === -1) return { lines: [...s.lines, line] };
  const lines = [...s.lines]; lines[i] = line; return { lines };
}
export const quantityOf = (s: CartState, id: string) => s.lines.find((l) => l.product.id === id)?.quantity ?? 0;
export const itemCount = (s: CartState) => s.lines.reduce((a, l) => a + l.quantity, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const subtotal = (s: CartState, now = new Date()) =>
  round2(s.lines.filter((l) => l.product.is_available).reduce((a, l) => a + effectivePrice(l.product, now) * l.quantity, 0));
export const regularTotal = (s: CartState) =>
  round2(s.lines.filter((l) => l.product.is_available).reduce((a, l) => a + l.product.selling_price * l.quantity, 0));
export function reconcile(s: CartState, fresh: Product[]): CartState {
  const byId = new Map(fresh.map((p) => [p.id, p]));
  return { lines: s.lines.map((l) => ({ ...l, product: byId.get(l.product.id) ?? { ...l.product, is_available: false } })) };
}
