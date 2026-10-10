import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { DEFAULT_DARK_STORE_ID } from './inventory.service.js';

/**
 * Low-stock auto purchase list (owner, 2026-10-10): a supplier order made
 * from what is running low.
 *
 * * Which products: the "Running low" rule (listLowStock) - active,
 *   non-deleted TRACKED products whose on-hand stock is at or below their
 *   low_stock_threshold.
 * * How many to buy: there is no reorder/target field, so the target level
 *   is twice the low-stock level. suggested = 2 × threshold − available,
 *   at least 1, where available = on hand − reserved (reserved units are
 *   already sold to open orders). The screen lets the operator change it.
 * * Supplier: the supplier this product was last sourced from
 *   (sourcing_records, newest first). Products never sourced from a named
 *   supplier are grouped under "No supplier yet".
 * * Cost: products.purchase_cost × suggested quantity (an estimate).
 *
 * There are no purchase-order tables: the list is copied, shared or
 * downloaded; stock is received through the existing restock (adjust) flow.
 */
export const PURCHASE_RULE =
  'Suggested = 2 × low-stock level − available (on hand minus reserved), at least 1. It brings the product back to twice its low-stock level.';

export function suggestedQuantity(threshold: number, available: number): number {
  return Math.max(1, threshold * 2 - available);
}

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));

export async function purchaseList(darkStoreId: string = DEFAULT_DARK_STORE_ID) {
  const rows = await db
    .selectFrom('inventory as inv')
    .innerJoin('products as p', 'p.id', 'inv.product_id')
    .innerJoin('categories as c', 'c.id', 'p.category_id')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('sourcing_records as sr')
          .innerJoin('suppliers as s', 's.id', 'sr.supplier_id')
          .select(['s.id as supplier_id', 's.name as supplier_name', 's.contact_phone as supplier_phone'])
          .whereRef('sr.product_id', '=', 'p.id')
          .orderBy('sr.created_at', 'desc')
          .limit(1)
          .as('last'),
      (join) => join.onTrue()
    )
    .select([
      'p.id as product_id',
      'p.name as product_name',
      'p.sku as product_sku',
      'p.unit as product_unit',
      'p.pack_size',
      'p.purchase_cost',
      'c.name as category_name',
      'inv.quantity_on_hand',
      'inv.quantity_reserved',
      'inv.low_stock_threshold',
      'last.supplier_id',
      'last.supplier_name',
      'last.supplier_phone',
    ])
    .where('inv.dark_store_id', '=', darkStoreId)
    .where('inv.tracking_mode', '=', 'TRACKED')
    .whereRef('inv.quantity_on_hand', '<=', 'inv.low_stock_threshold')
    .where('p.is_active', '=', true)
    .where('p.deleted_at', 'is', null)
    .orderBy(sql`inv.quantity_on_hand - inv.quantity_reserved`, 'asc')
    .orderBy('p.name', 'asc')
    .orderBy('p.id', 'asc')
    .execute();

  const items = rows.map((r) => {
    const available = r.quantity_on_hand - r.quantity_reserved;
    const suggested = suggestedQuantity(r.low_stock_threshold, available);
    const unitCost = money(r.purchase_cost);
    return {
      product_id: r.product_id,
      product_name: r.product_name,
      product_sku: r.product_sku,
      product_unit: r.product_unit,
      pack_size: r.pack_size,
      category_name: r.category_name,
      quantity_on_hand: r.quantity_on_hand,
      quantity_reserved: r.quantity_reserved,
      quantity_available: available,
      low_stock_threshold: r.low_stock_threshold,
      target_level: r.low_stock_threshold * 2,
      stock_state: (available <= 0 ? 'OUT' : 'LOW') as 'OUT' | 'LOW',
      suggested_quantity: suggested,
      unit_cost: unitCost,
      estimated_cost: money(unitCost * suggested),
      supplier_id: r.supplier_id ?? null,
      supplier_name: r.supplier_name ?? null,
      supplier_phone: r.supplier_phone ?? null,
    };
  });

  // Suppliers A-Z, "No supplier yet" last.
  const groups = new Map<string, { supplier_id: string | null; supplier_name: string | null; supplier_phone: string | null; items: typeof items }>();
  for (const item of items) {
    const key = item.supplier_id ?? '';
    if (!groups.has(key)) {
      groups.set(key, { supplier_id: item.supplier_id, supplier_name: item.supplier_name, supplier_phone: item.supplier_phone, items: [] });
    }
    groups.get(key)!.items.push(item);
  }
  const suppliers = [...groups.values()]
    .sort((a, b) => (a.supplier_id === null ? 1 : b.supplier_id === null ? -1 : (a.supplier_name ?? '').localeCompare(b.supplier_name ?? '')))
    .map((g) => ({
      ...g,
      estimated_cost: money(g.items.reduce((s, i) => s + i.estimated_cost, 0)),
    }));

  return {
    rule: PURCHASE_RULE,
    items,
    suppliers,
    totals: {
      products: items.length,
      out: items.filter((i) => i.stock_state === 'OUT').length,
      units: items.reduce((s, i) => s + i.suggested_quantity, 0),
      estimated_cost: money(items.reduce((s, i) => s + i.estimated_cost, 0)),
    },
  };
}
