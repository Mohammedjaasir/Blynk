import type { Product } from '@/blynk/api/types';

/*
 * "Your usuals" (owner, 2026-10-10; Flutter Models/usuals_model.dart and Services/reorder.dart):
 * the products of the signed-in customer's most recent order that was not cancelled, from
 * GET /me/usuals, with today's price and availability. "Add all" puts every product on sale now
 * in the cart at its last quantity. Pure functions; the call itself is in ./api.ts.
 */

export interface UsualItem {
  product: Product;
  /** The quantity on the last order (at least 1). */
  quantity: number;
}

export interface Usuals {
  orderId: string | null;
  orderNumber: string | null;
  /** Products still in the shop (some may be out of stock right now). */
  items: UsualItem[];
  /** Names of products from that order that were deleted or switched off. */
  unavailable: string[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

/** `data` of GET /me/usuals. Null for anything that is not a usuals answer; no order yet is an empty (not null) answer. */
export function parseUsuals(raw: unknown): Usuals | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const order = r.order && typeof r.order === 'object' ? (r.order as Record<string, unknown>) : null;
  const items: UsualItem[] = [];
  for (const entry of Array.isArray(r.items) ? r.items : []) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const p = e.product as (Product & Record<string, unknown>) | null | undefined;
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string') continue;
    const selling = num(p.selling_price);
    if (selling == null) continue;
    const q = Math.trunc(num(e.quantity) ?? 1);
    items.push({
      product: { ...p, selling_price: selling, offer_price: p.offer_price == null ? null : num(p.offer_price), is_available: p.is_available !== false },
      quantity: q < 1 ? 1 : q,
    });
  }
  return {
    orderId: text(order?.id),
    orderNumber: text(order?.order_number),
    items,
    unavailable: (Array.isArray(r.unavailable) ? r.unavailable : []).map(text).filter((n): n is string => !!n),
  };
}

/** Whether Home shows the row: signed in, with at least one product from a past order. */
export const showUsuals = (signedIn: boolean, usuals: Usuals | null): usuals is Usuals => signedIn && !!usuals && usuals.items.length > 0;

/** Products "Add all" would put in the cart. */
export const availableUsuals = (u: Usuals) => u.items.filter((i) => i.product.is_available);

export interface AddUsualsResult { addedUnits: number; unavailable: string[] }

/**
 * Adds every available usual at its last quantity. `addProduct` adds up to n units (the cart
 * caps quantities) and returns how many went in. Sold-out and removed products are named.
 */
export function addUsualsInto(u: Usuals, addProduct: (p: Product, n: number) => number): AddUsualsResult {
  let addedUnits = 0;
  const unavailable: string[] = [];
  for (const i of u.items) {
    if (!i.product.is_available) { unavailable.push(i.product.name); continue; }
    addedUnits += addProduct(i.product, i.quantity);
  }
  return { addedUnits, unavailable: [...unavailable, ...u.unavailable] };
}

/** The note after Add all (Flutter usualsAddedMessage). */
export function usualsAddedMessage(r: AddUsualsResult): { text: string; ok: boolean } {
  const missing = r.unavailable;
  if (r.addedUnits === 0) {
    return { text: missing.length ? `Nothing was added. Not available now: ${missing.join(', ')}.` : 'These are already in your cart.', ok: false };
  }
  const added = r.addedUnits === 1 ? 'Added 1 item.' : `Added ${r.addedUnits} items.`;
  return { text: missing.length ? `${added} Not available now: ${missing.join(', ')}.` : added, ok: true };
}
