import { ApiError } from '../api/client';
import type { AdjustmentType, StockRow } from '../api/types';

/**
 * Display rules for Inventory (task F6, plan §13). Ported from
 * `apps/inventory/src/lib/stock.ts` (a fresh implementation, not an import -
 * common.md rule 2). Every stock number shown or sent still comes straight
 * from the backend's own response - this file only decides how to word a
 * number that already arrived, it never predicts or recalculates one
 * (common.md's "never duplicate stock-integrity calculations client-side"
 * rule, this task's brief).
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

type Counted = Pick<StockRow, 'tracking_mode' | 'quantity_available' | 'quantity_on_hand' | 'low_stock_threshold'>;

export function stockState(row: Counted): StockState {
  if (row.tracking_mode !== 'TRACKED') return { kind: 'UNTRACKED', label: 'Sourced on order', units: null };
  if (row.quantity_available <= 0) return { kind: 'OUT', label: 'Out of stock', units: 0 };
  if (row.quantity_on_hand <= row.low_stock_threshold) {
    return { kind: 'LOW', label: 'Low stock', units: row.quantity_available };
  }
  return { kind: 'IN_STOCK', label: 'In stock', units: row.quantity_available };
}

/** Stock does not drive customer availability: a tracked product with no
 * stock that Catalog still has active and available can still be ordered,
 * and packing it will then fail - the case worth flagging first. */
export function isOrderableButOut(row: Pick<StockRow, 'is_active' | 'is_available'> & Counted): boolean {
  return row.is_active && row.is_available && stockState(row).kind === 'OUT';
}

export function unitsLabel(units: number): string {
  return `${units} ${units === 1 ? 'unit' : 'units'}`;
}

/** Signed quantity for ledger deltas: "+24", "−3" (a true minus sign). */
export const formatDelta = (delta: number) => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`);

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});
/** Date + store-local clock time (Asia/Colombo) - distinct from
 * `lib/orders.ts`'s `formatClock` (time only, for the Orders board's short
 * "Updated HH:MM" line); the ledger needs the date too, since entries span
 * many days. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

export const ADJUSTMENT_LABEL: Record<AdjustmentType, string> = {
  PURCHASE_RESTOCK: 'Restock',
  DAMAGE_WRITE_OFF: 'Damage write-off',
  INVENTORY_AUDIT_ADJUSTMENT: 'Audit correction',
  ORDER_FULFILLMENT: 'Order fulfilment',
  ORDER_RESERVATION: 'Order reservation',
  ORDER_CANCELLATION_RESTORE: 'Cancellation restore',
};

/**
 * The API's refusals in the operator's words (mirrors `lib/orders.ts`'s
 * `orderErrorMessage`/`lib/catalog.ts`'s `catalogErrorMessage` shape - one
 * per-domain code→copy table, never swallowing a rejection - established by
 * F3/F5). Ported from Inventory's own `lib/errors.ts:MESSAGES` map.
 */
const MESSAGES: Record<string, string> = {
  SUPPLIER_INACTIVE: 'That supplier has been deactivated. Choose an active supplier.',
  SUPPLIER_CODE_TAKEN: 'Another supplier already uses this code.',
  PRODUCT_NOT_TRACKED: 'Only tracked products can be adjusted. Switch the product to TRACKED first.',
  NEGATIVE_INVENTORY_PROHIBITED: 'That would take stock below zero.',
  INSUFFICIENT_AVAILABLE_INVENTORY: 'That would leave less stock than is already reserved.',
};

export function inventoryErrorMessage(err: unknown, fallback = 'Something went wrong. Nothing was changed.'): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
  if (err.code === 'NETWORK') return 'Could not reach the Blynk API. Nothing was changed.';
  if (err.code === 'TIMEOUT') return 'The Blynk API did not answer in time. Nothing was changed.';
  if (err.status === 403) return 'Your account is not allowed to do this.';
  if (err.status >= 500) return 'The Blynk API had a problem. Try again in a moment.';
  return err.message || fallback;
}

export const isInventoryError = (err: unknown, code: string) => err instanceof ApiError && err.code === code;
