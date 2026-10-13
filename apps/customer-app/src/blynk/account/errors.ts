import { ApiError } from '@/blynk/api/client';

/*
 * What the account screens say when a call fails. The server's own words where it gives them
 * (open orders, a date of birth it refuses, a staff email), like Flutter's AppErrors.
 */
export function accountErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again.';
  switch (e.code) {
    case 'ACTIVE_ORDERS_EXIST': return e.message || 'Finish or cancel your open orders first.';
    case 'UNAUTHENTICATED':
    case 'UNAUTHORIZED':
    case 'TOKEN_EXPIRED':
    case 'INVALID_TOKEN':
      return 'Your sign-in has expired. Log in again.';
    case 'TOO_MANY_REQUESTS':
    case 'RATE_LIMITED':
      return e.message || 'Too many tries. Wait a moment, then try again.';
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return e.message;
    default:
      if (e.status === 429) return 'Too many tries. Wait a moment, then try again.';
      return e.message && e.message !== 'Request failed.' ? e.message : 'Something went wrong. Try again.';
  }
}

/** The call failed because the customer is not signed in any more: offer "Log in". */
export const needsLogin = (e: unknown) => e instanceof ApiError && e.status === 401;
