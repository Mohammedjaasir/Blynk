import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { hasSellersTable } from '../catalog/catalog.repository.js';
import { cartRulesService } from '../configuration/cart-rules.js';

/*
 * One seller per order (owner's brother, 2026-10-27, "Option A"; the admin setting is
 * configuration/cart-rules.ts, ON by default).
 *
 * An order's SOURCES are the distinct sellers of its items - loose lines and the items of combo packs
 * alike - with Blynk's own products as one source (seller_id null, named "Blynk"). A product counts
 * as a seller's only while that seller is APPROVED (the same condition as the customer catalog's
 * `sold_by` / `seller_id`), so what the app sees and what the server enforces agree; before
 * migration 052 every product is Blynk's.
 *
 * With the rule on and more than one source the order is refused BEFORE any stock, price or fee work,
 * so nothing is reserved: 422 MIXED_SELLERS_NOT_ALLOWED with details.sources.
 */

export interface OrderSource {
  seller_id: string | null;
  /** The seller's shop name, or "Blynk". */
  name: string;
}

export const MIXED_SELLERS_MESSAGE = 'Your cart has items from different sellers. Please order from one seller at a time.';

/** The distinct sources of these products: Blynk first (when present), then sellers by shop name. */
export async function sourcesOfProducts(productIds: readonly string[]): Promise<OrderSource[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return [];
  if (!(await hasSellersTable())) return [{ seller_id: null, name: 'Blynk' }];
  const rows = await sql<{ id: string; seller_id: string | null; shop_name: string | null }>`
    SELECT p.id::text AS id, s.id::text AS seller_id, s.shop_name
    FROM products p
    LEFT JOIN sellers s ON s.id = p.seller_id AND s.status = 'APPROVED'
    WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`))})`.execute(db);
  const sellers = new Map<string, OrderSource>();
  // A product that does not exist is refused later (PRODUCT_NOT_FOUND); it is not a source.
  let blynk = false;
  for (const r of rows.rows) {
    if (r.seller_id) sellers.set(r.seller_id, { seller_id: r.seller_id, name: r.shop_name ?? 'Seller' });
    else blynk = true;
  }
  const out: OrderSource[] = [];
  if (blynk) out.push({ seller_id: null, name: 'Blynk' });
  out.push(...[...sellers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.seller_id!.localeCompare(b.seller_id!)));
  return out;
}

/** The products an order request holds: loose lines plus every combo's items. */
export async function requestProductIds(
  items: ReadonlyArray<{ product_id: string }>,
  combos: ReadonlyArray<{ combo_id: string }> = []
): Promise<string[]> {
  const ids = items.map((i) => i.product_id);
  if (combos.length) {
    const rows = await db
      .selectFrom('combo_items')
      .select('product_id')
      .where(
        'combo_id',
        'in',
        combos.map((c) => c.combo_id)
      )
      .execute();
    ids.push(...rows.map((r) => r.product_id));
  }
  return ids;
}

export function mixedSellersError(sources: OrderSource[]): AppError {
  return new AppError(MIXED_SELLERS_MESSAGE, 422, 'MIXED_SELLERS_NOT_ALLOWED', { sources });
}

/**
 * Throws MIXED_SELLERS_NOT_ALLOWED when the rule is on and the request holds more than one source.
 * The setting is read first, so with the rule off nothing else is queried (today's behaviour exactly).
 */
export async function assertSingleSource(
  items: ReadonlyArray<{ product_id: string }>,
  combos: ReadonlyArray<{ combo_id: string }> = []
): Promise<void> {
  const rules = await cartRulesService.read();
  if (!rules.one_seller_per_order.enabled) return;
  const sources = await sourcesOfProducts(await requestProductIds(items, combos));
  if (sources.length > 1) throw mixedSellersError(sources);
}
