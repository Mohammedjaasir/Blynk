import { ApiError, apiGet, apiPost } from '@/blynk/api/client';
import { authed, getSession } from '@/blynk/auth/session';
import { normaliseReferralCode, REFERRAL_CODE_PATTERN } from '@/blynk/share/links';
import { storage } from '@/blynk/lib/storage';
import {
  parseBirthdayOffer, parsePoints, parseReferral, REFERRAL_NOT_A_CODE, referralAppliedText,
  type BirthdayOffer, type PointsInfo, type ReferralInfo,
} from './models';

/* Signed-in reward calls (Bearer; authed() refreshes once on a 401). */

export async function fetchReferral(): Promise<ReferralInfo> {
  const info = parseReferral(await authed((t) => apiGet<unknown>('/me/referral', t)));
  if (!info) throw new ApiError("Couldn't load your referral code", 500);
  return info;
}

export async function fetchPoints(): Promise<PointsInfo> {
  const info = parsePoints(await authed((t) => apiGet<unknown>('/me/points', t)));
  if (!info) throw new ApiError('Points were not returned by the server.', 500);
  return info;
}

/** GET /me's birthday_offer; null when there is none. */
export async function fetchBirthdayOffer(signal?: AbortSignal): Promise<BirthdayOffer | null> {
  const r = await authed((t) => apiGet<{ profile?: { birthday_offer?: unknown } }>('/me', t, signal));
  return parseBirthdayOffer(r?.profile?.birthday_offer);
}

export type ApplyOutcome = {
  ok: boolean;
  /** The success sentence, or the customer's words for a refusal. */
  text: string;
  status?: number;
  /** The code was never sent: it is not a code at all. */
  invalidCode?: boolean;
};

/** The customer's words for a refused code. */
export function referralRefusalMessage(e: unknown): string {
  if (e instanceof ApiError && e.code === 'VALIDATION_ERROR') return REFERRAL_NOT_A_CODE;
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

/** POST /me/referral/apply. Never throws. */
export async function applyReferralCode(rawCode: string): Promise<ApplyOutcome> {
  const code = normaliseReferralCode(rawCode);
  if (!REFERRAL_CODE_PATTERN.test(code)) {
    return { ok: false, invalidCode: true, text: code ? REFERRAL_NOT_A_CODE : 'Enter a code.' };
  }
  try {
    const data = await authed((t) => apiPost<{ inviter_first_name?: unknown } | null>('/me/referral/apply', { code }, t));
    const name = typeof data?.inviter_first_name === 'string' && data.inviter_first_name.trim() ? data.inviter_first_name.trim() : null;
    return { ok: true, text: referralAppliedText(name) };
  } catch (e) {
    return { ok: false, text: referralRefusalMessage(e), status: e instanceof ApiError ? e.status : undefined };
  }
}

// ---------------------------------------------------------------- a friend's code from a link

/**
 * A friend's code that arrived in a link (`/app/?ref=CODE`) waits here until the customer
 * signs in, when it is applied once and forgotten (Flutter ReferralStorage / PendingReferralSync).
 */
export const PENDING_REFERRAL_KEY = 'blynk.app.pendingReferral.v1';

export const readPendingReferral = (): string | null => {
  const v = (storage.get(PENDING_REFERRAL_KEY) ?? '').trim();
  return v ? v : null;
};
export const writePendingReferral = (code: string) => storage.set(PENDING_REFERRAL_KEY, code);
export const clearPendingReferral = () => storage.set(PENDING_REFERRAL_KEY, '');

/**
 * A real "no" from the server (the code is unknown, the customer's own, already applied, not a
 * new customer...). A timeout, a rate limit, an expired login or a server fault might work next time.
 */
export const isReferralRefusal = (status: number | undefined) =>
  status !== undefined && status >= 400 && status < 500 && ![401, 408, 429, 499].includes(status);

let syncing = false;

/**
 * Applies a code kept from a shared link, once, after sign-in. Returns the success text to show,
 * or null. A refusal (4xx) forgets the code quietly; a network failure keeps it for next time.
 */
export async function applyPendingReferral(apply: (code: string) => Promise<ApplyOutcome> = applyReferralCode): Promise<string | null> {
  if (syncing || !getSession()) return null;
  const code = readPendingReferral();
  if (!code) return null;
  syncing = true;
  try {
    const outcome = await apply(code);
    if (outcome.ok || outcome.invalidCode || isReferralRefusal(outcome.status)) clearPendingReferral();
    return outcome.ok ? outcome.text : null;
  } catch {
    return null;
  } finally {
    syncing = false;
  }
}
