import { ApiError } from '@/blynk/api/client';
import type { Combo, Product, ProductVariant } from '@/blynk/api/types';
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
  /** Adds up to n units (within the cart's limit) of the product or of one size of it; returns how many went in. */
  addProduct: (p: Product, n: number, variant?: ProductVariant | null) => number;
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

  // per product and size (migration 045): a size line goes back in as that size
  const qty = new Map<string, number>();
  const names = new Map<string, string>();
  const sizeOf = new Map<string, string | null>();
  const productOf = new Map<string, string>();
  for (const it of order.items) {
    // a free unit or a gift (bundle offers) is not bought again: the offer gives it back by itself
    if (it.is_bundle_free) continue;
    if (it.order_combo_id && comboLinesAdded.has(it.order_combo_id)) continue;
    if (!it.product_id) { unavailable.push(it.product_name_snapshot); continue; }
    const vid = it.variant_id ?? null;
    const key = vid ? `${it.product_id}:${vid}` : it.product_id;
    qty.set(key, (qty.get(key) ?? 0) + it.quantity);
    names.set(key, it.variant_label_snapshot ? `${it.product_name_snapshot} ${it.variant_label_snapshot}` : it.product_name_snapshot);
    sizeOf.set(key, vid);
    productOf.set(key, it.product_id);
  }

  const ids = [...new Set(productOf.values())];
  const results = await Promise.all(ids.map((id) => deps.fetchProduct(id).then((p) => ({ p }), (e: unknown) => ({ e }))));
  let networkFailures = 0;
  const fetched = new Map(ids.map((id, i) => [id, results[i]]));
  results.forEach((r) => {
    if ('e' in r && (!(r.e instanceof ApiError) || r.e.status === 0 || r.e.code === 'NETWORK_ERROR' || r.e.code === 'TIMEOUT')) networkFailures++;
  });
  for (const [key, n] of qty) {
    const r = fetched.get(productOf.get(key)!)!;
    if ('e' in r || !r.p.is_available) { unavailable.push(names.get(key)!); continue; }
    const vid = sizeOf.get(key) ?? null;
    if (vid) {
      // that size today: gone or sold out is named, never swapped for another size
      const v = (r.p.variants ?? []).find((x) => x.id === vid);
      if (!v || !v.is_available) { unavailable.push(names.get(key)!); continue; }
      addedUnits += deps.addProduct(r.p, n, v);
    } else if (r.p.has_variants) {
      // it is sold in sizes now: the customer picks one
      unavailable.push(names.get(key)!);
    } else {
      addedUnits += deps.addProduct(r.p, n);
    }
  }

  return { addedUnits, unavailable, offline: ids.length > 0 && networkFailures === ids.length };
}

/** The toast after "Order again" (Flutter OrderAgainButton). */
export function reorderMessage(r: ReorderResult): { text: string; ok: boolean } {
  if (r.offline) return { text: "You're offline. Nothing was added. Try again when you have signal.", ok: false };
  if (r.addedUnits === 0) return { text: "These items aren't available right now.", ok: false };
  const units = r.addedUnits === 1 ? '1 item' : `${r.addedUnits} items`;
  return { text: r.unavailable.length ? `Added ${units}. Not available now: ${r.unavailable.join(', ')}.` : `Added ${units} to your cart.`, ok: true };
}
