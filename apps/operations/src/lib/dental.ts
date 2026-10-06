import { ApiError } from '../api/client';

/**
 * The API's refusals in the operator's words, for Dental clinic management
 * (task F8, plan §15-19). Mirrors `lib/catalog.ts`'s `catalogErrorMessage`
 * shape exactly - this domain's own `AppError` messages
 * (`backend/api/src/modules/dental/dental-admin.service.ts`) are already
 * specific and complete (the cross-entity "outside clinic operating hours"
 * rejection names both windows, the duplicate-pairing/duplicate-blocked-date
 * rejections say exactly what collided, the merge-then-validate
 * `INVALID_CLINIC_HOURS` message states both bounds), so this function's job
 * is picking the *best available* message, never inventing new copy - the
 * same discipline F5's `catalogErrorMessage` doc comment describes.
 */
export function dentalErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Nothing was saved.';
  if (err.code === 'NETWORK') return 'Could not reach the Blynk API. Nothing was saved.';
  if (err.code === 'TIMEOUT') return 'The Blynk API did not answer in time. Nothing was saved.';
  if (err.code === 'VALIDATION_ERROR') {
    // This module's controller parses with `schema.parse()` directly (no
    // `validate()` middleware - dental-admin.controller.ts's own doc
    // comment), so a ZodError reaches error.middleware.ts's generic
    // handler, which puts the raw zod issues array on `details` (each
    // `{message, path, ...}` - still `.message`, same shape catalog's own
    // `details[0].message` read already handles).
    const details = err.details as Array<{ message?: string }> | undefined;
    return details?.[0]?.message ?? err.message;
  }
  if (err.status >= 500) return 'The Blynk API had a problem. Try again in a moment.';
  return err.message;
}

export const isDentalError = (err: unknown, code: string) => err instanceof ApiError && err.code === code;

/** A doctor's rating as the customer app shows it: "★ 4.6 (12)", or null
 * when there are no (visible) ratings (migration 023). */
export function formatRating(average: number | null | undefined, count: number | null | undefined): string | null {
  if (!count || average === null || average === undefined) return null;
  return `★ ${average.toFixed(1)} (${count})`;
}

const visitDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Colombo',
});
/** "05 Jan 2026" in clinic time. */
export const formatVisitDate = (iso: string) => visitDate.format(new Date(iso));

/**
 * A blocked date's calendar day as 'YYYY-MM-DD'. The API now sends exactly
 * that (a date, no time); an older API sent the DATE column as a timestamp
 * (e.g. '2026-10-05T18:30:00.000Z' for 6 Oct in Colombo), which still works:
 * it is read as the day it is in clinic time (Asia/Colombo), never shifted
 * by the device's own time zone. Null when it is neither.
 */
export function blockedDay(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  // Colombo is UTC+05:30 all year (no daylight saving).
  return new Date(instant.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

const blockedDayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Mon, 05 Oct 2026" for a blocked date - formatted from the calendar day
 * itself (at UTC, so no device time zone can move it a day). */
export function formatBlockedDate(value: string): string {
  const day = blockedDay(value);
  if (!day) return value;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return blockedDayFormat.format(new Date(Date.UTC(y, m - 1, d)));
}
