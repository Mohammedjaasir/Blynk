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
};

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
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
