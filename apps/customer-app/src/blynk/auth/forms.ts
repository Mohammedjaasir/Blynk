import { ApiError } from '@/blynk/api/client';
import { localized } from '@/blynk/i18n/localized';
import { AUTH_ERRORS } from './words';

/* Pure rules and copy for the sign-in, registration and birthday screens. */

export const NAME_MAX = 60;

/** The trimmed name when it is acceptable (2+ characters with at least one letter), else null. */
export function validName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > NAME_MAX) return null;
  return /\p{L}/u.test(name) ? name : null;
}

/** Referral codes are A-Z and 0-9, 3 to 32 characters; typing is upper-cased and stripped. */
export const cleanReferral = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
export const referralOk = (code: string) => /^[A-Z0-9]{3,32}$/.test(code);

/**
 * Day, month and year as typed -> "YYYY-MM-DD", or null when it is not a real date, is in the
 * future, or is outside the backend's age range (5 to 120 years).
 */
export function parseBirthday(d: string, m: string, y: string, today = new Date()): string | null {
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null;
  const day = +d;
  const month = +m;
  const year = +y;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const t = { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
  let age = t.y - year;
  if (t.m < month || (t.m === month && t.d < day)) age -= 1;
  const future = year > t.y || (year === t.y && (month > t.m || (month === t.m && day > t.d)));
  if (future || age < 5 || age > 120) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The server's message when it sent one, else the fallback. */
const serverText = (e: ApiError, fallback: string) => (e.message && e.message !== 'Request failed.' ? e.message : fallback);

/** Fallback copy for sign-in refusals (the server's message wins). Kept as the backend words them. */
export const REFUSED_FALLBACK: Record<string, string> = localized<Record<string, string>>(
  {
    EMAIL_SIGN_IN_REQUIRED: 'This account signs in with email and password.',
    RIDER_PENDING_APPROVAL: 'Your application is waiting for approval.',
    RIDER_APPLICATION_REJECTED: "Your application wasn't approved.",
    INVALID_CREDENTIALS: 'Sign-in failed. Check your details or ask your store admin.',
  },
  {
    si: {
      EMAIL_SIGN_IN_REQUIRED: 'මෙම ගිණුමට ඇතුල් වන්නේ ඊමේල් සහ මුරපදය මඟිනි.',
      RIDER_PENDING_APPROVAL: 'ඔබේ අයදුම්පත අනුමැතිය බලා සිටී.',
      RIDER_APPLICATION_REJECTED: 'ඔබේ අයදුම්පත අනුමත කළේ නැහැ.',
      INVALID_CREDENTIALS: 'ඇතුල් වීමට නොහැකි වුණා. ඔබේ විස්තර පරීක්ෂා කරන්න, නැත්නම් සාප්පුවේ පරිපාලකගෙන් අසන්න.',
    },
    ta: {
      EMAIL_SIGN_IN_REQUIRED: 'இந்தக் கணக்கு மின்னஞ்சல் மற்றும் கடவுச்சொல் மூலம் உள்நுழைகிறது.',
      RIDER_PENDING_APPROVAL: 'உங்கள் விண்ணப்பம் ஒப்புதலுக்காகக் காத்திருக்கிறது.',
      RIDER_APPLICATION_REJECTED: 'உங்கள் விண்ணப்பம் ஏற்றுக்கொள்ளப்படவில்லை.',
      INVALID_CREDENTIALS: 'உள்நுழைய முடியவில்லை. உங்கள் விவரங்களைச் சரிபார்க்கவும் அல்லது கடை நிர்வாகியிடம் கேளுங்கள்.',
    },
  },
  'auth.REFUSED_FALLBACK',
);

/** A sign-in the server refused for this account (not a wrong code): no new code will help. */
export function isAccountRefusal(e: unknown): boolean {
  return e instanceof ApiError && !!e.code && (e.code in REFUSED_FALLBACK || e.code === 'ACCOUNT_DEACTIVATED');
}

const mins = (s: number) => Math.max(1, Math.ceil(s / 60));

type Details = { retry_after_seconds?: number; remaining_attempts?: number };

/** What to tell the customer when a sign-in or registration call fails. */
export function authErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return AUTH_ERRORS.generic;
  const details = (e.details ?? {}) as Details;
  switch (e.code) {
    case 'VALIDATION_ERROR': return AUTH_ERRORS.invalidPhone;
    case 'TOO_MANY_REQUESTS':
      return typeof details.retry_after_seconds === 'number'
        ? AUTH_ERRORS.tooManyCodesIn(mins(details.retry_after_seconds))
        : AUTH_ERRORS.tooManyCodes;
    // Accounts this app may not sign in (Flutter shows the server's own words): Admin and
    // Inventory sign in with email only, a rider still waiting for approval, a rejected rider,
    // a disabled staff account. Riders and Operations otherwise shop like any customer.
    case 'EMAIL_SIGN_IN_REQUIRED':
    case 'RIDER_PENDING_APPROVAL':
    case 'RIDER_APPLICATION_REJECTED':
    case 'INVALID_CREDENTIALS':
      return serverText(e, REFUSED_FALLBACK[e.code]);
    case 'OTP_DELIVERY_FAILED': return AUTH_ERRORS.smsFailed;
    case 'INVALID_OTP':
      return typeof details.remaining_attempts === 'number'
        ? AUTH_ERRORS.wrongCode(details.remaining_attempts)
        : AUTH_ERRORS.codeInvalid;
    case 'OTP_EXPIRED': return AUTH_ERRORS.codeExpired;
    case 'OTP_MAX_ATTEMPTS_EXCEEDED': return AUTH_ERRORS.codeMaxAttempts;
    case 'ACCOUNT_DEACTIVATED': return serverText(e, AUTH_ERRORS.deactivated);
    case 'UNAUTHENTICATED': return AUTH_ERRORS.signInExpired;
    case 'REFERRAL_DISABLED': return AUTH_ERRORS.referralDisabled;
    case 'REFERRAL_CODE_NOT_FOUND': return AUTH_ERRORS.referralNotFound;
    case 'REFERRAL_SELF': return AUTH_ERRORS.referralSelf;
    case 'REFERRAL_ALREADY_APPLIED': return AUTH_ERRORS.referralApplied;
    case 'REFERRAL_NOT_NEW_CUSTOMER': return AUTH_ERRORS.referralNotNew;
    default: return e.message || AUTH_ERRORS.generic;
  }
}

/** Errors after which the code on screen cannot work any more: offer a new one at once. */
export function needsNewCode(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code === 'OTP_EXPIRED' || e.code === 'OTP_MAX_ATTEMPTS_EXCEEDED') return true;
  return e.code === 'INVALID_OTP' && typeof (e.details as Details | undefined)?.remaining_attempts !== 'number';
}
