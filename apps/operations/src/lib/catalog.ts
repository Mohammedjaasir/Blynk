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
