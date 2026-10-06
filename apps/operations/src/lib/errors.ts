import { ApiError } from '../api/client';

/**
 * The operator's words for the backend's error codes. Anything not listed
 * falls back to the API's own message; a raw exception or "500" is never
 * shown. Extend this map per-domain as later tasks need specific codes
 * explained (mirrors Rider's `lib/errors.ts:MESSAGES`).
 */
export const MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Check what you entered and try again.',
  FORBIDDEN: 'Your account is not allowed to do this.',
  RIDER_PROFILE_NOT_FOUND: 'No rider profile is linked to this account.',
  RIDER_INACTIVE: "This account's rider profile isn't active.",
  ACCOUNT_NOT_FOUND: 'No Blynk account uses this number.',
  FILE_TOO_LARGE: 'That image is larger than 2 MB. Choose a smaller one.',
  PAYLOAD_TOO_LARGE: 'That is too much to send at once. Split it into smaller files and try again.',
  NETWORK: "You're offline. Nothing was sent. Try again when you have signal.",
  TIMEOUT: "The server didn't answer. Check before trying again.",
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
