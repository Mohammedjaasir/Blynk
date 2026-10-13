import { ApiError } from '@/blynk/api/client';

/* Pure rules and copy for the sign-in, registration and birthday screens. */

export const NAME_MAX = 60;
export const NAME_ERROR = 'Enter your name (at least 2 letters).';

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

const mins = (s: number) => Math.max(1, Math.ceil(s / 60));

type Details = { retry_after_seconds?: number; remaining_attempts?: number };

/** What to tell the customer when a sign-in or registration call fails. */
export function authErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Please try again.';
  const details = (e.details ?? {}) as Details;
  switch (e.code) {
    case 'VALIDATION_ERROR': return 'Enter a valid Sri Lankan mobile number.';
    case 'TOO_MANY_REQUESTS':
      return typeof details.retry_after_seconds === 'number'
        ? `Too many codes requested. Try again in ${mins(details.retry_after_seconds)} min.`
        : 'Too many codes requested. Please try again later.';
    case 'EMAIL_SIGN_IN_REQUIRED': return 'This number belongs to a Blynk staff account. Please use another number.';
    case 'RIDER_PENDING_APPROVAL': return 'This number has a rider application waiting for approval.';
    case 'OTP_DELIVERY_FAILED': return 'We could not send the code by SMS. Please try again.';
    case 'INVALID_OTP':
      return typeof details.remaining_attempts === 'number'
        ? `Wrong code. ${details.remaining_attempts} attempt${details.remaining_attempts === 1 ? '' : 's'} left.`
        : 'This code is no longer valid. Tap Resend OTP for a new one.';
    case 'OTP_EXPIRED': return 'This code has expired. Tap Resend OTP for a new one.';
    case 'OTP_MAX_ATTEMPTS_EXCEEDED': return 'Too many wrong codes. Tap Resend OTP for a new one.';
    case 'ACCOUNT_DEACTIVATED': return 'This account has been deactivated. Please contact Blynk support.';
    case 'UNAUTHENTICATED': return 'Your sign-in has expired. Please sign in again.';
    case 'REFERRAL_DISABLED': return 'Referral codes are not available right now.';
    case 'REFERRAL_CODE_NOT_FOUND': return 'We could not find that referral code.';
    case 'REFERRAL_SELF': return 'You cannot use your own referral code.';
    case 'REFERRAL_ALREADY_APPLIED': return 'A referral code is already on your account.';
    case 'REFERRAL_NOT_NEW_CUSTOMER': return 'Referral codes are for new customers only.';
    default: return e.message || 'Something went wrong. Please try again.';
  }
}

/** Errors after which the code on screen cannot work any more: offer a new one at once. */
export function needsNewCode(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.code === 'OTP_EXPIRED' || e.code === 'OTP_MAX_ATTEMPTS_EXCEEDED') return true;
  return e.code === 'INVALID_OTP' && typeof (e.details as Details | undefined)?.remaining_attempts !== 'number';
}
