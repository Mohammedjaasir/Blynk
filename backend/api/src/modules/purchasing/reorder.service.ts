import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { colomboToday, addDays } from '../sellers/seller-requests.service.js';
import { fastMoverCutoff, groupBySupplier, suggest, type ReorderReason } from './reorder.rules.js';

/**
 * Reorder suggestions (owner, 2026-10-25): what to buy, from whom, and how much.
 *
 * Sales velocity: units of DELIVERED orders over the last `days` days (today included, Colombo
 * delivery date), items that arrived (not UNAVAILABLE / SUBSTITUTED), seller-held products left
 * out (their stock is the seller's - they send stock notes instead). Combo lines count like any
 * other item. Stock: TRACKED inventory rows of live, active products (and live variants).
 * On order: SENT / PARTIAL purchase orders' lines not yet received (DRAFT lines are shown as
 * `in_draft` but not subtracted - a draft is not ordered). Supplier: the one this product was
 * last bought from - the newest of a sourcing record and a (not cancelled) purchase order.
 * The maths is in reorder.rules.ts.
 */
export interface ReorderQuery {
  days: number;
  cover_days: number;
  lead_days: number;
}

export interface ReorderItem {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  display_name: string;
  sku: string;
  unit: string;
  pack_size: string | null;
  category_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
  units_sold: number;
  avg_daily_units: number;
  days_of_stock_left: number | null;
  on_order: number;
  in_draft: number;
  buy_multiple: number | null;
  suggested_quantity: number;
  last_cost: number;
  estimated_cost: number;
  reasons: ReorderReason[];
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
}

interface Row {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  sku: string;
  variant_sku: string | null;
  unit: string;
  pack_size: string | null;
  category_name: string;
  purchase_cost: string;
  variant_cost: string | null;
  on_hand: number;
  reserved: number;
  threshold: number;
  units: string | null;
  on_order: string | null;
  in_draft: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
}

const money = (v: unknown) => Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;

export const REORDER_RULE =
  'Suggested = what sells in the cover days and the supplier lead days + the low-stock level, minus what is available and what is already on order. Packs like "Case of 12" round up.';

export async function reorderSuggestions(q: ReorderQuery, darkStoreId: string = DEFAULT_DARK_STORE_ID) {
  const to = colomboToday();
  const from = addDays(to, -(q.days - 1));

  const rows = (
    await sql<Row>`
      WITH sold AS (
        SELECT oi.product_id, oi.variant_id, SUM(oi.quantity)::text AS units
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products sp ON sp.id = oi.product_id
         WHERE o.order_status = 'DELIVERED'
           AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')
           AND sp.seller_id IS NULL
           AND (COALESCE(o.delivered_at, o.updated_at) AT TIME ZONE 'Asia/Colombo')::date BETWEEN ${from}::date AND ${to}::date
         GROUP BY oi.product_id, oi.variant_id
      ), pending AS (
        SELECT poi.product_id, poi.variant_id,
               SUM(GREATEST(poi.ordered_qty - poi.received_qty, 0)) FILTER (WHERE po.status IN ('SENT', 'PARTIAL'))::text AS on_order,
               SUM(poi.ordered_qty) FILTER (WHERE po.status = 'DRAFT')::text AS in_draft
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.purchase_order_id
         WHERE po.status IN ('DRAFT', 'SENT', 'PARTIAL')
         GROUP BY poi.product_id, poi.variant_id
      )
      SELECT p.id AS product_id, inv.variant_id, p.name AS product_name, v.label AS variant_label,
             p.sku, v.sku AS variant_sku, p.unit, p.pack_size, c.name AS category_name,
             p.purchase_cost::text AS purchase_cost, v.purchase_cost::text AS variant_cost,
             inv.quantity_on_hand AS on_hand, inv.quantity_reserved AS reserved, inv.low_stock_threshold AS threshold,
             sold.units, pending.on_order, pending.in_draft,
             sup.id AS supplier_id, sup.name AS supplier_name, sup.contact_phone AS supplier_phone
        FROM inventory inv
        JOIN products p ON p.id = inv.product_id
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN product_variants v ON v.id = inv.variant_id
        LEFT JOIN sold ON sold.product_id = inv.product_id AND sold.variant_id IS NOT DISTINCT FROM inv.variant_id
        LEFT JOIN pending ON pending.product_id = inv.product_id AND pending.variant_id IS NOT DISTINCT FROM inv.variant_id
        LEFT JOIN LATERAL (
          SELECT s.id, s.name, s.contact_phone
            FROM (
              SELECT sr.supplier_id, sr.created_at AS at FROM sourcing_records sr
               WHERE sr.product_id = p.id AND sr.supplier_id IS NOT NULL
              UNION ALL
              SELECT po2.supplier_id, po2.created_at FROM purchase_order_items poi2
                JOIN purchase_orders po2 ON po2.id = poi2.purchase_order_id
               WHERE poi2.product_id = p.id AND po2.supplier_id IS NOT NULL AND po2.status <> 'CANCELLED'
            ) x
            JOIN suppliers s ON s.id = x.supplier_id
           ORDER BY x.at DESC
           LIMIT 1
        ) sup ON TRUE
       WHERE inv.dark_store_id = ${darkStoreId}
         AND inv.tracking_mode = 'TRACKED'
         AND p.is_active = TRUE AND p.deleted_at IS NULL
         AND p.seller_id IS NULL
         AND (inv.variant_id IS NULL OR (v.deleted_at IS NULL AND v.is_active = TRUE))`.execute(db)
  ).rows;

  const avgs = rows.map((r) => (r.units ? Number(r.units) / q.days : 0));
  const fastCutoff = fastMoverCutoff(avgs);

  const items: ReorderItem[] = [];
  for (const r of rows) {
    const s = suggest({
      units: Number(r.units ?? 0),
      days: q.days,
      onHand: r.on_hand,
      reserved: r.reserved,
      lowStockThreshold: r.threshold,
      onOrder: Number(r.on_order ?? 0),
      packSize: r.pack_size,
      coverDays: q.cover_days,
      leadDays: q.lead_days,
      fastCutoff,
    });
    if (s.suggested_quantity <= 0) continue;
    const cost = money(r.variant_id ? r.variant_cost : r.purchase_cost);
    items.push({
      product_id: r.product_id,
      variant_id: r.variant_id ?? null,
      product_name: r.product_name,
      variant_label: r.variant_label ?? null,
      display_name: r.variant_label ? `${r.product_name} - ${r.variant_label}` : r.product_name,
      sku: r.variant_sku || r.sku,
      unit: r.unit,
      pack_size: r.pack_size,
      category_name: r.category_name,
      quantity_on_hand: r.on_hand,
      quantity_reserved: r.reserved,
      quantity_available: s.available,
      low_stock_threshold: r.threshold,
      units_sold: Number(r.units ?? 0),
      avg_daily_units: s.avg_daily_units,
      days_of_stock_left: s.days_of_stock_left,
      on_order: Number(r.on_order ?? 0),
      in_draft: Number(r.in_draft ?? 0),
      buy_multiple: s.buy_multiple,
      suggested_quantity: s.suggested_quantity,
      last_cost: cost,
      estimated_cost: money(cost * s.suggested_quantity),
      reasons: s.reasons,
      supplier_id: r.supplier_id ?? null,
      supplier_name: r.supplier_name ?? null,
      supplier_phone: r.supplier_phone ?? null,
    });
  }

  const suppliers = groupBySupplier(items);
  return {
    params: { days: q.days, cover_days: q.cover_days, lead_days: q.lead_days, period: { from, to } },
    rule: REORDER_RULE,
    suppliers,
    totals: {
      products: items.length,
      out: items.filter((i) => i.reasons.includes('OUT')).length,
      units: items.reduce((n, i) => n + i.suggested_quantity, 0),
      estimated_cost: money(items.reduce((n, i) => n + i.estimated_cost, 0)),
    },
  };
}
