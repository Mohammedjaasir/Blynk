import { ApiError } from '../api/client';

/**
 * The API's refusals in the operator's words, for Products/Categories/
 * Promotions (task F5). Mirrors `lib/orders.ts`'s `orderErrorMessage` shape
 * (a small, per-domain code→copy table, never swallowing a rejection - task
 * F3 established this pattern), but this domain has no lifecycle state
 * machine, so most of what the backend returns is already a clean, specific
 * message (`AppError`'s own `message`, e.g. "Product with SKU 'X' already
 * exists.") - this function's job is mostly to pick the *best available*
 * message, not to invent new copy.
 *
 * `VALIDATION_ERROR` is the one case worth special-casing: the backend's
 * `validate` middleware (backend/api/src/middleware/validate.middleware.ts)
 * always sends the generic "Request validation failed" as `message`, with
 * the real, field-specific reason in `details[0].message` - using the
 * generic one would be strictly less useful to the operator.
 */
export function catalogErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Nothing was saved.';
  if (err.code === 'NETWORK') return 'Could not reach the Blynk API. Nothing was saved.';
  if (err.code === 'TIMEOUT') return 'The Blynk API did not answer in time. Nothing was saved.';
  if (err.code === 'VALIDATION_ERROR') {
    const details = err.details as Array<{ field?: string; message?: string }> | undefined;
    const first = details?.[0]?.message;
    return first ?? err.message;
  }
  if (err.code === 'FILE_TOO_LARGE') return 'That image is larger than 2 MB. Choose a smaller one.';
  if (err.code === 'PAYLOAD_TOO_LARGE' || err.status === 413) {
    return 'That is too much to send at once (over 1 MB). Split it into smaller files and try again. Nothing was saved.';
  }
  if (err.status >= 500) return 'The Blynk API had a problem. Try again in a moment.';
  return err.message;
}

/** The delivery fee the API accepts: LKR 0-1000, at most 2 decimals. */
export const MAX_DELIVERY_FEE_LKR = 1000;

/** Client-side check for the Delivery fee setting (the server checks again). */
export function parseDeliveryFee(input: string): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { error: 'Enter a fee in LKR (0 for free delivery).' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter a number, like 250 or 199.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Use at most 2 decimals.' };
  const value = Number(s);
  if (value > MAX_DELIVERY_FEE_LKR) return { error: `The fee can be at most LKR ${MAX_DELIVERY_FEE_LKR}.` };
  return { value };
}

/** The API's display_order range for promotions (promotion.schema.ts). */
export const MAX_PROMOTION_ORDER = 1000;

/**
 * A display order typed into a form: a whole number within [0, max] (max
 * omitted = no upper bound, e.g. categories). Empty means 0, the API default.
 */
export function parseDisplayOrder(input: string, max?: number): { value: number } | { error: string } {
  const s = input.trim();
  if (s === '') return { value: 0 };
  if (!/^\d+$/.test(s)) {
    return { error: max === undefined ? 'Order must be a whole number, 0 or more.' : `Order must be a whole number from 0 to ${max}.` };
  }
  const value = Number(s);
  if (max !== undefined && value > max) return { error: `Order must be a whole number from 0 to ${max}.` };
  return { value };
}

/**
 * The `{id, display_order}` updates that move one row up (-1) or down (+1)
 * in a list already sorted by display_order. Distinct neighbours just swap
 * their values. When they are EQUAL (two promotions saved with the same
 * order, the default 0 included) a swap would change nothing, so the whole
 * list is renumbered 10, 20, 30... in the new order (staying within the
 * API's 0-1000 range) and every row whose number changed is sent. Returns
 * [] when there is nowhere to move.
 */
export function planReorder(
  rows: ReadonlyArray<{ id: string; display_order: number }>,
  id: string,
  direction: -1 | 1,
  max = MAX_PROMOTION_ORDER
): { id: string; display_order: number }[] {
  const index = rows.findIndex((row) => row.id === id);
  const neighbour = index < 0 ? undefined : rows[index + direction];
  if (index < 0 || !neighbour) return [];
  const row = rows[index]!;
  if (row.display_order !== neighbour.display_order) {
    return [
      { id: row.id, display_order: neighbour.display_order },
      { id: neighbour.id, display_order: row.display_order },
    ];
  }
  const order = [...rows];
  order[index] = neighbour;
  order[index + direction] = row;
  const step = Math.max(1, Math.min(10, Math.floor(max / Math.max(1, order.length))));
  return order
    .map((r, i) => ({ id: r.id, display_order: Math.min(max, (i + 1) * step), before: r.display_order }))
    .filter((r) => r.display_order !== r.before)
    .map(({ id: rowId, display_order }) => ({ id: rowId, display_order }));
}
