import { ApiError } from '../api/client';

/**
 * One way to turn an API refusal into plain words, shared by every form.
 *
 * A 400 VALIDATION_ERROR carries per-field details. Two shapes reach the
 * browser: the validate middleware's `{ field, message }` and a raw zod
 * issue's `{ path: [...], message }`.
 */
export interface FieldIssue {
  field: string;
  message: string;
}

export function validationIssues(err: unknown): FieldIssue[] {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return [];
  return err.details.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const detail = raw as { field?: unknown; path?: unknown; message?: unknown };
    if (typeof detail.message !== 'string' || !detail.message) return [];
    const field =
      typeof detail.field === 'string'
        ? detail.field
        : Array.isArray(detail.path)
          ? detail.path.join('.')
          : '';
    return [{ field, message: detail.message }];
  });
}

/** The first server message for each field, keyed by the API's field name. */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of validationIssues(err)) {
    if (issue.field && !(issue.field in out)) out[issue.field] = issue.message;
  }
  return out;
}

/** "seller_price" -> "Seller price". */
export function fieldLabel(field: string): string {
  const words = field.split('.').pop()!.replace(/_/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : field;
}

export const NETWORK_MESSAGE = 'Could not reach Blynk. Check your internet and try again.';

/** The message to show for a failed request. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK') return NETWORK_MESSAGE;
    const issues = validationIssues(err);
    if (issues.length > 0) {
      return issues.map((i) => (i.field ? `${fieldLabel(i.field)}: ${i.message}` : i.message)).join(' ');
    }
    if (err.code === 'FILE_TOO_LARGE' || err.code === 'PAYLOAD_TOO_LARGE') return 'Photos must be 5 MB or smaller.';
    if (err.code === 'SELLER_NOT_APPROVED') {
      return 'Blynk has not approved your shop yet, so you cannot add or change products.';
    }
    if (err.code === 'TOO_MANY_REQUESTS') return tooManyMessage(err);
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Seconds the API asks us to wait after a 429, when it says so. */
export function retryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof ApiError)) return null;
  const details = err.details as { retry_after_seconds?: unknown } | undefined;
  const n = Number(details?.retry_after_seconds);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

function tooManyMessage(err: ApiError): string {
  const wait = retryAfterSeconds(err);
  return wait
    ? `Too many tries. Please wait ${wait} second${wait === 1 ? '' : 's'} and try again.`
    : 'Too many tries. Please wait a little and try again.';
}

/** Sign-in refusals in a seller's words. */
export function signInMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'PHONE_IN_USE':
        return 'This number is already used for a Blynk account (as a customer, rider or staff member). Please use a different number for your shop.';
      case 'INVALID_OTP': {
        const left = (err.details as { remaining_attempts?: number } | undefined)?.remaining_attempts;
        return left
          ? `That code is not right. Check the SMS and try again (${left} ${left === 1 ? 'try' : 'tries'} left).`
          : 'That code is not right. Check the SMS, or ask for a new code.';
      }
      case 'OTP_EXPIRED':
        return 'That code has expired. Ask for a new code.';
      case 'OTP_MAX_ATTEMPTS_EXCEEDED':
        return 'Too many wrong tries. Ask for a new code.';
      case 'TOO_MANY_REQUESTS':
        return tooManyMessage(err);
      case 'ACCOUNT_DEACTIVATED':
        return 'This account has been switched off. Please contact Blynk.';
    }
  }
  return errorMessage(err, 'Something went wrong. Please try again.');
}

export const EMAIL_IN_USE_MESSAGE = 'This email already has an account - sign in instead.';
export const WRONG_EMAIL_PASSWORD_MESSAGE = 'Wrong email or password.';
export const EMAIL_WAIT_MESSAGE = 'Too many tries - wait a few minutes and try again.';
export const EMAIL_DEACTIVATED_MESSAGE = 'This account is switched off - contact Blynk.';

/** Is this the "email already has an account" refusal (the screen then offers to sign in)? */
export function isEmailInUse(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'EMAIL_IN_USE' || err.status === 409);
}

/** "Too many wrong tries - try again in 15 minutes." (5 wrong passwords lock the account for a while). */
function lockedMessage(err: ApiError): string {
  const minutes = Number((err.details as { retry_after_minutes?: unknown } | undefined)?.retry_after_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Too many wrong tries - try again in a few minutes.';
  const n = Math.ceil(minutes);
  return `Too many wrong tries - try again in ${n} minute${n === 1 ? '' : 's'}.`;
}

/**
 * Email sign-in and sign-up refusals in a seller's words. The server answers:
 * 409 EMAIL_IN_USE, 401 INVALID_CREDENTIALS, 429 LOGIN_LOCKED (with
 * retry_after_minutes) after 5 wrong passwords, 429 TOO_MANY_REQUESTS for the
 * per-address limit, 403 ACCOUNT_DEACTIVATED and 400 VALIDATION_ERROR.
 */
export function emailAuthMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK') return NETWORK_MESSAGE;
    if (isEmailInUse(err)) return EMAIL_IN_USE_MESSAGE;
    if (err.code === 'ACCOUNT_DEACTIVATED') return EMAIL_DEACTIVATED_MESSAGE;
    if (err.code === 'LOGIN_LOCKED' || err.code === 'ACCOUNT_LOCKED' || err.status === 423) return lockedMessage(err);
    if (err.code === 'INVALID_CREDENTIALS' || err.status === 401) return WRONG_EMAIL_PASSWORD_MESSAGE;
    if (err.code === 'TOO_MANY_REQUESTS' || err.status === 429) {
      return retryAfterSeconds(err) ? tooManyMessage(err) : EMAIL_WAIT_MESSAGE;
    }
  }
  return errorMessage(err, 'Something went wrong. Please try again.');
}
