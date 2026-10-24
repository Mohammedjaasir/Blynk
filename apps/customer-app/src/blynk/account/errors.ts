import { ApiError } from '@/blynk/api/client';
import { localized } from '@/blynk/i18n/localized';

const ERRORS = localized(
  {
    generic: 'Something went wrong. Try again.',
    openOrders: 'Finish or cancel your open orders first.',
    expired: 'Your sign-in has expired. Log in again.',
    tooMany: 'Too many tries. Wait a moment, then try again.',
  } as const,
  {
    si: {
      generic: 'යම් දෙයක් වැරදුණා. නැවත උත්සාහ කරන්න.',
      openOrders: 'මුලින්ම ඔබේ විවෘත ඇණවුම් අවසන් කරන්න, නැත්නම් අවලංගු කරන්න.',
      expired: 'ඔබේ ඇතුල්වීමේ කාලය ඉකුත් වී ඇත. නැවත ඇතුල් වන්න.',
      tooMany: 'උත්සාහ කිරීම් වැඩියි. පොඩ්ඩක් ඉඳලා නැවත උත්සාහ කරන්න.',
    },
    ta: {
      generic: 'ஏதோ தவறாகிவிட்டது. மீண்டும் முயற்சிக்கவும்.',
      openOrders: 'முதலில் உங்கள் நடப்பில் உள்ள ஆர்டர்களை முடிக்கவும் அல்லது ரத்து செய்யவும்.',
      expired: 'உங்கள் உள்நுழைவு காலாவதியாகிவிட்டது. மீண்டும் உள்நுழையுங்கள்.',
      tooMany: 'அதிக முயற்சிகள். சிறிது நேரம் காத்திருந்து மீண்டும் முயற்சிக்கவும்.',
    },
  },
  'account.ERRORS',
);

/*
 * What the account screens say when a call fails. The server's own words where it gives them
 * (open orders, a date of birth it refuses, a staff email), like Flutter's AppErrors.
 */
export function accountErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return ERRORS.generic;
  switch (e.code) {
    case 'ACTIVE_ORDERS_EXIST': return e.message || ERRORS.openOrders;
    case 'UNAUTHENTICATED':
    case 'UNAUTHORIZED':
    case 'TOKEN_EXPIRED':
    case 'INVALID_TOKEN':
      return ERRORS.expired;
    case 'TOO_MANY_REQUESTS':
    case 'RATE_LIMITED':
      return e.message || ERRORS.tooMany;
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return e.message;
    default:
      if (e.status === 429) return ERRORS.tooMany;
      return e.message && e.message !== 'Request failed.' ? e.message : ERRORS.generic;
  }
}

/** The call failed because the customer is not signed in any more: offer "Log in". */
export const needsLogin = (e: unknown) => e instanceof ApiError && e.status === 401;
