import type { StaffStock } from '../api/types';

/**
 * Stock and delivery lead time (migration 045; owner, 2026-10-14). Staff see
 * the counts; customers never do - they can order a tracked item until its
 * sellable stock reaches 0, then it shows as sold out.
 */

/** The API's stock limits (PUT /admin/inventory/:productId/stock). */
export const MAX_STOCK = 100_000;
/** products.delivery_lead_days: whole days 0..30. */
export const MAX_LEAD_DAYS = 30;

export type StockTone = 'out' | 'low' | 'ok';

/** The badge for a tracked item: Sold out / Low (n) / n in stock; null when untracked. */
export function stockBadge(stock: StaffStock | null | undefined): { tone: StockTone; text: string } | null {
  if (!stock || !stock.tracked) return null;
  const left = stock.sellable ?? stock.on_hand;
  if (stock.is_out_of_stock) return { tone: 'out', text: 'Sold out' };
  if (stock.is_low_stock) return { tone: 'low', text: `Low · ${left}` };
  return { tone: 'ok', text: `${left} in stock` };
}

/** "Same day" / "+1 day" / "+3 days". */
export function leadTimeText(days: number | null | undefined): string {
  const n = Number(days ?? 0);
  if (!(n > 0)) return 'Same day';
  return `+${n} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * A whole number typed into a form, `min`..`max`. '' = none. Returns the
 * number, null for blank, or an error message.
 */
export function parseWhole(
  text: string,
  { min = 0, max = MAX_STOCK, what }: { min?: number; max?: number; what: string }
): { value: number | null } | { error: string } {
  const raw = text.trim();
  if (raw === '') return { value: null };
  if (!/^\d+$/.test(raw)) return { error: `${what} must be a whole number` };
  const value = Number(raw);
  if (value < min || value > max) return { error: `${what} must be from ${min} to ${max.toLocaleString('en-US')}` };
  return { value };
}
