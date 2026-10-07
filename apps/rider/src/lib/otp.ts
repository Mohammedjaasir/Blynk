import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';

/**
 * Phone + SMS-code helpers shared by sign-in and the rider application
 * (2026-10-07: riders sign in with their phone only, and apply in the app).
 */

/**
 * The backend's Sri Lankan mobile rule (backend/api/src/utils/phone.ts,
 * normalizeSriLankanPhone): 07X / 947X / +947X with an operator prefix of
 * 70-72 or 74-78, then 7 digits. Checked here only so a typo is caught before
 * a code is spent; the API checks again.
 */
export function isSriLankanMobile(input: string): boolean {
  const cleaned = input.replace(/[\s\-()]/g, '');
  let normalized = cleaned;
  if (cleaned.startsWith('0')) normalized = '+94' + cleaned.slice(1);
  else if (cleaned.startsWith('94')) normalized = '+' + cleaned;
  else if (!cleaned.startsWith('+')) normalized = '+94' + cleaned;
  return /^\+94(70|71|72|74|75|76|77|78)[0-9]{7}$/.test(normalized);
}

export const PHONE_FORMAT_MESSAGE = 'Enter a Sri Lankan mobile number, like 077 123 4567.';

export const OTP_LENGTH = 6;

/** How long before another code can be asked for. */
export const RESEND_AFTER_SECONDS = 60;

/** A countdown to the next "Resend code". start() restarts it; clear() lets a resend happen now. */
export function useResendTimer(seconds = RESEND_AFTER_SECONDS) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  const start = useCallback(() => setLeft(seconds), [seconds]);
  const clear = useCallback(() => setLeft(0), []);
  return { left, start, clear };
}

export const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** error.details.reason on a RIDER_APPLICATION_REJECTED refusal, if Ops gave one. */
export function rejectionReason(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== 'object') return null;
  const reason = (err.details as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : null;
}

/** Codes after which the current SMS code can't be used again: a new one may be asked for at once. */
export const CODE_SPENT = new Set(['OTP_EXPIRED', 'OTP_MAX_ATTEMPTS_EXCEEDED']);
