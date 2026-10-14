import type { Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';

/**
 * Stock as staff see it (migration 045): on hand, units in open (unpacked)
 * orders, what is left to sell and the low/out flags, from v_inventory_stock.
 * Staff reads only - customers get is_available, never a number.
 */
type Executor = typeof db | Transaction<Database>;

/** The seeded Dharga Town store (inventory.service DEFAULT_DARK_STORE_ID). */
const DEFAULT_STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';

export interface StaffStock {
  /** The inventory row; null when the stock was never set up (UNTRACKED). */
  inventory_id: string | null;
  tracked: boolean;
  on_hand: number;
  reserved: number;
  /** Units in orders not yet packed (they leave the shelf at packing). */
  in_open_orders: number;
  /** What customers can still order (on hand - reserved - in open orders); null when untracked. */
  sellable: number | null;
  low_stock_threshold: number;
  /** Tracked and on hand at or below the low-stock level (the Ops "Running low" rule). */
  is_low_stock: boolean;
  /** Tracked and nothing left to sell: customers see it as sold out. */
  is_out_of_stock: boolean;
}

export const UNTRACKED_STOCK: StaffStock = {
  inventory_id: null,
  tracked: false,
  on_hand: 0,
  reserved: 0,
  in_open_orders: 0,
  sellable: null,
  low_stock_threshold: 5,
  is_low_stock: false,
  is_out_of_stock: false,
};

export function toStaffStock(row: {
  inventory_id: string;
  tracking_mode: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_in_open_orders: number;
  quantity_sellable: number;
  low_stock_threshold: number;
} | undefined): StaffStock {
  if (!row) return { ...UNTRACKED_STOCK };
  const tracked = row.tracking_mode === 'TRACKED';
  const sellable = Math.max(0, Number(row.quantity_sellable));
  return {
    inventory_id: row.inventory_id,
    tracked,
    on_hand: Number(row.quantity_on_hand),
    reserved: Number(row.quantity_reserved),
    in_open_orders: Number(row.quantity_in_open_orders),
    sellable: tracked ? sellable : null,
    low_stock_threshold: Number(row.low_stock_threshold),
    is_low_stock: tracked && Number(row.quantity_on_hand) <= Number(row.low_stock_threshold),
    is_out_of_stock: tracked && sellable <= 0,
  };
}

/** Staff stock of product-level rows (variantId null) or variant rows, keyed by product or variant id. */
export async function staffStockFor(
  executor: Executor,
  ids: { productIds?: string[]; variantIds?: string[] },
  darkStoreId: string = DEFAULT_STORE
): Promise<Map<string, StaffStock>> {
  const out = new Map<string, StaffStock>();
  const productIds = ids.productIds ?? [];
  const variantIds = ids.variantIds ?? [];
  if (productIds.length === 0 && variantIds.length === 0) return out;
  let q = executor.selectFrom('v_inventory_stock').selectAll().where('dark_store_id', '=', darkStoreId);
  q = q.where((eb) =>
    eb.or([
      ...(productIds.length ? [eb.and([eb('product_id', 'in', productIds), eb('variant_id', 'is', null)])] : []),
      ...(variantIds.length ? [eb('variant_id', 'in', variantIds)] : []),
    ])
  );
  for (const r of await q.execute()) out.set(r.variant_id ?? r.product_id, toStaffStock(r));
  return out;
}

