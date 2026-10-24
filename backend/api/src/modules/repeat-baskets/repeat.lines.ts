import { db } from '../../database/connection.js';
import type { RepeatBasketLine } from '../../database/types.js';
import { loadAvailability, windowFor, windowOpenAt, windowText } from '../configuration/availability-windows.js';
import { sellableFor } from '../inventory/sellable.js';
import { stockKeyOf } from '../inventory/stock-ledger.js';
import { orderRepository } from '../orders/order.repository.js';
import { priceCart } from '../orders/order.service.js';
import { logger } from '../../utils/logger.js';

/**
 * Which lines of a repeat basket can be ordered right now (migration 054):
 * the same rules order placement applies - the product exists and is on sale,
 * its availability window is open, a product with sizes is ordered by size
 * and that size is on sale, no delivery lead time (a repeat basket is an
 * "as soon as possible" order) and enough sellable stock. A line that fails
 * is left out of the order and named in the run reason.
 */
export interface LineCheck {
  line: RepeatBasketLine;
  ok: boolean;
  /** 'Milk 1 L' (with the size), or null when the product no longer exists. */
  name: string | null;
  /** Why it cannot be ordered now ('sold out', 'no longer sold', ...); null when ok. */
  reason: string | null;
}

export async function checkLines(lines: readonly RepeatBasketLine[], at: Date): Promise<LineCheck[]> {
  if (lines.length === 0) return [];
  const productIds = [...new Set(lines.map((l) => l.product_id))];
  const variantIds = lines.map((l) => l.variant_id).filter((v): v is string => !!v);
  const [products, catalog, variants, availability, store] = await Promise.all([
    db
      .selectFrom('products')
      .select(['id', 'name', 'category_id', 'is_active', 'is_available', 'deleted_at', 'delivery_lead_days'])
      .where('id', 'in', productIds)
      .execute(),
    orderRepository.findCategoryOffers(productIds),
    orderRepository.findVariantsByIds(variantIds),
    loadAvailability(),
    orderRepository.findActiveDarkStore(),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const out: LineCheck[] = lines.map((line) => {
    const p = productMap.get(line.product_id);
    if (!p || p.deleted_at) return { line, ok: false, name: null, reason: 'no longer sold' };
    const v = line.variant_id ? variantMap.get(line.variant_id) : undefined;
    const name = v ? `${p.name} ${v.label}` : p.name;
    const fail = (reason: string): LineCheck => ({ line, ok: false, name, reason });
    if (!p.is_active || !p.is_available) return fail('not available now');
    const w = windowFor(availability, { id: p.id, category_id: p.category_id });
    if (w && !windowOpenAt(w, at)) return fail(`only ${windowText(w)}`);
    if (Number(p.delivery_lead_days ?? 0) > 0) return fail(`needs ${p.delivery_lead_days} day${Number(p.delivery_lead_days) === 1 ? '' : 's'} notice`);
    if (line.variant_id) {
      if (!v || v.product_id !== p.id) return fail('that size is no longer sold');
      if (!v.is_active || !v.is_available) return fail('not available now');
    } else if (catalog.get(p.id)?.has_variants) {
      return fail('choose a size');
    }
    return { line, ok: true, name, reason: null };
  });

  // Stock: tracked products / sizes customers can still order (advisory; the
  // order transaction re-checks under its locks).
  const okLines = out.filter((c) => c.ok);
  if (store && okLines.length) {
    const stock = await sellableFor(
      db,
      store.id,
      okLines.map((c) => ({ product_id: c.line.product_id, variant_id: c.line.variant_id ?? null }))
    );
    for (const c of okLines) {
      const row = stock.get(stockKeyOf({ product_id: c.line.product_id, variant_id: c.line.variant_id ?? null }));
      if (row && c.line.quantity > row.sellable) {
        c.ok = false;
        c.reason = row.sellable <= 0 ? 'sold out' : `only ${row.sellable} left`;
      }
    }
  }
  return out;
}

/** "Milk 1 L (sold out), Bread (not available now)" - at most `max` characters. */
export function describeLeftOut(checks: readonly LineCheck[], max = 240): string {
  const text = checks
    .filter((c) => !c.ok)
    .map((c) => `${c.name ?? 'A product'} (${c.reason ?? 'not available'})`)
    .join(', ');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** The order lines (createOrder shape) of the lines that can be ordered. */
export const orderLinesOf = (lines: readonly RepeatBasketLine[]) =>
  lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, ...(l.variant_id ? { variant_id: l.variant_id } : {}) }));

/**
 * The basket at today's prices (offers included, delivery fee not): the
 * items that can be ordered now, priced exactly as an order would be.
 */
export async function estimateBasket(lines: readonly RepeatBasketLine[], at: Date) {
  const checks = await checkLines(lines, at);
  const ok = checks.filter((c) => c.ok).map((c) => c.line);
  let itemsTotal = 0;
  if (ok.length) {
    try {
      itemsTotal = (await priceCart(orderLinesOf(ok))).subtotal;
    } catch (err) {
      // A change between the check and the pricing: the estimate is advisory.
      logger.warn({ err }, 'Repeat basket estimate could not be priced');
    }
  }
  return {
    items_total: Number(itemsTotal.toFixed(2)),
    available_lines: ok.length,
    unavailable_lines: checks.length - ok.length,
    unavailable: checks
      .filter((c) => !c.ok)
      .map((c) => ({ product_id: c.line.product_id, variant_id: c.line.variant_id ?? null, name: c.name, reason: c.reason })),
  };
}
