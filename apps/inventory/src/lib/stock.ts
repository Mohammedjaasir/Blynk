import type { StockRow } from '../api/types';

/**
 * How a product's stock reads to an operator. Every state carries a word, so
 * nothing depends on colour alone.
 *
 * UNTRACKED products are sourced on order (Phase 1 model): their quantities
 * are never read by the backend, so the app shows "Sourced on order" instead
 * of a 0 that would look like "empty".
 */
export type StockKind = 'IN_STOCK' | 'LOW' | 'OUT' | 'UNTRACKED';

export interface StockState {
  kind: StockKind;
  label: string;
  /** Units available, or null when the product isn't counted. */
  units: number | null;
}

type Counted = Pick<
  StockRow,
  'tracking_mode' | 'quantity_available' | 'quantity_on_hand' | 'low_stock_threshold'
>;

export function stockState(row: Counted): StockState {
  if (row.tracking_mode !== 'TRACKED') return { kind: 'UNTRACKED', label: 'Sourced on order', units: null };
  if (row.quantity_available <= 0) return { kind: 'OUT', label: 'Out of stock', units: 0 };
  if (row.quantity_on_hand <= row.low_stock_threshold) {
    return { kind: 'LOW', label: 'Low stock', units: row.quantity_available };
  }
  return { kind: 'IN_STOCK', label: 'In stock', units: row.quantity_available };
}

/**
 * D1: stock does not drive customer availability. A tracked product with no
 * stock that Admin still has active and available can be ordered, and its
 * sourcing will then fail - the case the Overview puts first.
 */
export function isOrderableButOut(row: Pick<StockRow, 'is_active' | 'is_available'> & Counted): boolean {
  return row.is_active && row.is_available && stockState(row).kind === 'OUT';
}

export function unitsLabel(units: number): string {
  return `${units} ${units === 1 ? 'unit' : 'units'}`;
}
