import { ApiError } from '@/blynk/api/client';
import type { Combo, Product } from '@/blynk/api/types';
import type { Order, OrderStatus } from './types';

/*
 * "Order again" (Flutter Services/reorder.dart, 2026-09-30): a past order's products back in the
 * cart at the same quantities, each re-read first (GET /catalog/products/:id) so the cart gets
 * today's price and availability, never the old order's. A combo pack still on sale goes back in
 * as a pack at today's price; one that ended or sold out falls back to its products. Gone or
 * sold-out products are skipped and named. Quantities add to what is already in the cart.
 */

export interface ReorderResult {
  /** Units (and packs) put in the cart. */
  addedUnits: number;
  /** Names of products that are gone or out of stock right now. */
  unavailable: string[];
  /** Nothing could be checked because the connection failed. */
  offline: boolean;
}

export interface ReorderDeps {
  fetchProduct: (id: string) => Promise<Product>;
  fetchCombos: () => Promise<Combo[]>;
  comboQty: (id: string) => number;
  addCombo: (c: Combo) => void;
  /** Adds up to n units (within the cart's limit); returns how many went in. */
  addProduct: (p: Product, n: number) => number;
}

const OVER: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE'];

/** Orders that are over offer "Order again". */
export const canReorder = (o: Pick<Order, 'items' | 'order_status'>) => o.items.length > 0 && OVER.includes(o.order_status);

export async function reorderInto(order: Pick<Order, 'items' | 'combos'>, deps: ReorderDeps): Promise<ReorderResult> {
  let addedUnits = 0;
  const unavailable: string[] = [];
  const comboLinesAdded = new Set<string>();

  const lines = (order.combos ?? []).filter((c) => c.combo_id && c.quantity > 0);
  if (lines.length) {
    const fresh = await deps.fetchCombos().catch(() => [] as Combo[]);
    for (const line of lines) {
      const combo = fresh.find((c) => c.id === line.combo_id);
      if (!combo || !combo.is_available) continue;
      const before = deps.comboQty(combo.id);
      for (let i = 0; i < line.quantity; i++) deps.addCombo(combo);
      const added = deps.comboQty(combo.id) - before;
      if (added > 0) { addedUnits += added; comboLinesAdded.add(line.id); }
    }
  }

  const qty = new Map<string, number>();
  const names = new Map<string, string>();
  for (const it of order.items) {
    if (it.order_combo_id && comboLinesAdded.has(it.order_combo_id)) continue;
    if (!it.product_id) { unavailable.push(it.product_name_snapshot); continue; }
    qty.set(it.product_id, (qty.get(it.product_id) ?? 0) + it.quantity);
    names.set(it.product_id, it.product_name_snapshot);
  }

  const ids = [...qty.keys()];
  const results = await Promise.all(ids.map((id) => deps.fetchProduct(id).then((p) => ({ p }), (e: unknown) => ({ e }))));
  let networkFailures = 0;
  results.forEach((r, i) => {
    const id = ids[i];
    if ('e' in r) {
      if (!(r.e instanceof ApiError) || r.e.status === 0 || r.e.code === 'NETWORK_ERROR' || r.e.code === 'TIMEOUT') networkFailures++;
      unavailable.push(names.get(id)!);
      return;
    }
    if (!r.p.is_available) { unavailable.push(names.get(id)!); return; }
    addedUnits += deps.addProduct(r.p, qty.get(id)!);
  });

  return { addedUnits, unavailable, offline: ids.length > 0 && networkFailures === ids.length };
}

/** The toast after "Order again" (Flutter OrderAgainButton). */
export function reorderMessage(r: ReorderResult): { text: string; ok: boolean } {
  if (r.offline) return { text: "You're offline. Nothing was added. Try again when you have signal.", ok: false };
  if (r.addedUnits === 0) return { text: "These items aren't available right now.", ok: false };
  const units = r.addedUnits === 1 ? '1 item' : `${r.addedUnits} items`;
  return { text: r.unavailable.length ? `Added ${units}. Not available now: ${r.unavailable.join(', ')}.` : `Added ${units} to your cart.`, ok: true };
}
