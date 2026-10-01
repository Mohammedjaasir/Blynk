import { ApiError } from '../api/client';

/**
 * The rider's words for the backend's error codes. Anything not listed falls
 * back to the API's own message; a raw exception or "500" is never shown.
 */
export const MESSAGES: Record<string, string> = {
  ORDER_NOT_READY_FOR_PICKUP: "This order isn't packed yet. Check with the store.",
  ORDER_NOT_ACTIVE: 'This order was cancelled or closed. Do not deliver it.',
  INVALID_DELIVERY_TRANSITION: 'This delivery changed. Showing the latest.',
  COD_ALREADY_COLLECTED: 'Cash for this order is already recorded.',
  INVALID_COD_AMOUNT: 'The amount to collect changed. Showing the latest total.',
  NOT_COD_ORDER: 'This order is not cash on delivery. Check with the store.',
  DELIVERY_NOT_FOUND: 'This delivery is no longer assigned to you.',
  VALIDATION_ERROR: 'Check what you entered and try again.',
  FORBIDDEN: 'Your account is not allowed to do this.',
  NETWORK: "You're offline. Nothing was sent. Try again when you have signal.",
  TIMEOUT: "The server didn't answer. Check the delivery before trying again.",
  // Used when the API leaves out the details the fuller messages below need.
  WRONG_DELIVERY_CODE: "That code doesn't match. Ask the customer to check it.",
  DELIVERY_CODE_LOCKED: 'Too many wrong codes. Try again later.',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function detailsOf(err: ApiError): Record<string, unknown> {
  return err.details && typeof err.details === 'object' ? (err.details as Record<string, unknown>) : {};
}

/**
 * When a DELIVERY_CODE_LOCKED refusal lifts, as epoch ms; null if the error
 * isn't one or says nothing usable. retry_after_seconds wins over
 * locked_until, so a skewed phone clock can't shorten or stretch the wait.
 */
export function deliveryCodeLockedUntil(err: unknown, now = Date.now()): number | null {
  if (!(err instanceof ApiError)) return null;
  // The 5th wrong code is itself the one that locks: 422 with no tries left and locked_until.
  const lockingWrongCode = err.code === 'WRONG_DELIVERY_CODE' && detailsOf(err).attempts_remaining === 0;
  if (err.code !== 'DELIVERY_CODE_LOCKED' && !lockingWrongCode) return null;
  const { retry_after_seconds: seconds, locked_until: until } = detailsOf(err);
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
  const parsed = typeof until === 'string' ? Date.parse(until) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Messages that depend on error.details, not just the code. */
function detailedMessage(err: ApiError): string | null {
  if (err.code === 'WRONG_DELIVERY_CODE') {
    const left = detailsOf(err).attempts_remaining;
    if (typeof left !== 'number' || left < 0) return null;
    if (left === 0) {
      const until = deliveryCodeLockedUntil(err);
      const minutes = until === null ? 15 : Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return `That code doesn't match. Too many wrong codes. Try again in ${plural(minutes, 'minute', 'minutes')}.`;
    }
    return `That code doesn't match. ${plural(left, 'try', 'tries')} left.`;
  }
  if (err.code === 'DELIVERY_CODE_LOCKED') {
    const now = Date.now();
    const until = deliveryCodeLockedUntil(err, now);
    if (until === null) return null;
    const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
    return `Too many wrong codes. Try again in ${plural(minutes, 'minute', 'minutes')}.`;
  }
  return null;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    const detailed = detailedMessage(err);
    if (detailed) return detailed;
    if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    if (err.status === 403) return MESSAGES.FORBIDDEN;
    if (err.status >= 500) return 'The Blynk API had a problem. Try again in a moment.';
    return err.message || fallback;
  }
  return fallback;
}

export const errorCode = (err: unknown) => (err instanceof ApiError ? err.code : undefined);

/** The request may or may not have reached the server. */
export const isConnectionProblem = (err: unknown) => {
  const code = errorCode(err);
  return code === 'NETWORK' || code === 'TIMEOUT';
};
