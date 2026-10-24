/**
 * Reorder suggestion maths (pure, no database): see reorder.service.ts for where the figures come from.
 *
 *   avg daily units = units delivered in the last `days` days / days
 *   days of stock left = available / avg daily units          (null when nothing sold)
 *   target stock = ceil(avg daily x (cover days + lead days)) + low-stock level
 *   suggested = target - available - already on order         (never below 0)
 *
 * "available" is on hand minus reserved (reserved units are already sold to open orders). The
 * low-stock level the owner set on the product is the safety stock: after the delivery has been
 * sold through the cover days, the shelf is still at its low-stock level, not empty. Lead days is
 * the days the supplier takes, so what sells while waiting is bought too. A product that is not
 * selling at all but is at or under its low-stock level is topped back up to that level.
 *
 * Products whose pack_size says how they are bought ("Case of 12", "Box x 24") are rounded UP to
 * a whole number of those packs. pack_size is otherwise only the size label of one unit
 * ("500 g", "1 L"), which says nothing about how a supplier packs it, so no rounding applies.
 */
export type ReorderReason = 'OUT' | 'LOW' | 'WONT_LAST' | 'FAST';

export const REORDER_DAYS = [14, 28] as const;
export const MAX_COVER_DAYS = 60;
export const MAX_LEAD_DAYS = 30;
/** Units per day at or above which a product can count as a fast mover. */
export const FAST_MOVER_MIN_DAILY = 1;

const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const avgDailyUnits = (units: number, days: number): number => (days > 0 ? round2(Math.max(0, units) / days) : 0);

export const daysOfStockLeft = (available: number, avgDaily: number): number | null =>
  avgDaily > 0 ? round1(Math.max(0, available) / avgDaily) : null;

/** The buy-in pack multiple a pack_size text names ("Case of 12", "box x 24", "carton × 6"); null = none. */
export function packMultiple(packSize: string | null | undefined): number | null {
  if (!packSize) return null;
  const m = /\b(?:case|box|carton|tray|crate|outer|master)\s*(?:of|x|×)\s*(\d{1,4})\b/i.exec(packSize);
  const n = m ? Number(m[1]) : 0;
  return n >= 2 ? n : null;
}

export const roundUpToMultiple = (qty: number, multiple: number | null): number =>
  multiple && multiple > 1 ? Math.ceil(qty / multiple) * multiple : qty;

/**
 * The daily-units level from which a product counts as a fast mover: the top fifth of the products
 * that sold anything (the 80th percentile), but never below FAST_MOVER_MIN_DAILY.
 */
export function fastMoverCutoff(avgDailies: readonly number[]): number {
  const sold = avgDailies.filter((a) => a > 0).sort((a, b) => a - b);
  if (sold.length === 0) return FAST_MOVER_MIN_DAILY;
  const idx = Math.min(sold.length - 1, Math.floor(sold.length * 0.8));
  return Math.max(FAST_MOVER_MIN_DAILY, sold[idx]!);
}

export interface SuggestInput {
  /** Units delivered in the window. */
  units: number;
  days: number;
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  /** Ordered but not yet received on SENT / PARTIAL orders. */
  onOrder: number;
  packSize?: string | null;
  coverDays: number;
  leadDays: number;
  fastCutoff?: number;
}

export interface Suggestion {
  avg_daily_units: number;
  days_of_stock_left: number | null;
  available: number;
  target_stock: number;
  buy_multiple: number | null;
  suggested_quantity: number;
  reasons: ReorderReason[];
}

export function suggest(i: SuggestInput): Suggestion {
  const available = i.onHand - i.reserved;
  const avg = avgDailyUnits(i.units, i.days);
  const left = daysOfStockLeft(available, avg);
  const target = Math.ceil(avg * (i.coverDays + i.leadDays) - 1e-9) + Math.max(0, i.lowStockThreshold);
  const raw = Math.max(0, target - available - Math.max(0, i.onOrder));
  const multiple = packMultiple(i.packSize);
  const suggested = raw > 0 ? roundUpToMultiple(raw, multiple) : 0;

  const reasons: ReorderReason[] = [];
  if (available <= 0) reasons.push('OUT');
  else if (available <= i.lowStockThreshold) reasons.push('LOW');
  if (left !== null && available > 0 && left < i.coverDays) reasons.push('WONT_LAST');
  if (avg > 0 && avg >= (i.fastCutoff ?? FAST_MOVER_MIN_DAILY)) reasons.push('FAST');

  return {
    avg_daily_units: avg,
    days_of_stock_left: left,
    available,
    target_stock: target,
    buy_multiple: multiple,
    suggested_quantity: suggested,
    reasons,
  };
}

export interface SupplierGroupable {
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  days_of_stock_left: number | null;
  display_name: string;
  estimated_cost: number;
}

/** Groups lines by supplier: A-Z, "no supplier yet" last; inside a group the soonest to run out first. */
export function groupBySupplier<T extends SupplierGroupable>(items: readonly T[]) {
  const groups = new Map<string, { supplier_id: string | null; supplier_name: string | null; supplier_phone: string | null; items: T[] }>();
  for (const item of items) {
    const key = item.supplier_id ?? '';
    if (!groups.has(key)) {
      groups.set(key, { supplier_id: item.supplier_id, supplier_name: item.supplier_name, supplier_phone: item.supplier_phone, items: [] });
    }
    groups.get(key)!.items.push(item);
  }
  const soonest = (a: T, b: T) => {
    const x = a.days_of_stock_left ?? Number.POSITIVE_INFINITY;
    const y = b.days_of_stock_left ?? Number.POSITIVE_INFINITY;
    return x - y || a.display_name.localeCompare(b.display_name);
  };
  return [...groups.values()]
    .sort((a, b) => (a.supplier_id === null ? 1 : b.supplier_id === null ? -1 : (a.supplier_name ?? '').localeCompare(b.supplier_name ?? '')))
    .map((g) => ({
      ...g,
      items: [...g.items].sort(soonest),
      estimated_cost: round2(g.items.reduce((s, i) => s + i.estimated_cost, 0)),
    }));
}
