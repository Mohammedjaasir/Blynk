import { ApiError } from '@/blynk/api/client';
import { toE164 } from '@/blynk/auth/phone';
import type { Appointment } from './types';
import { DOCTOR_FORMAT as W } from './words';

/*
 * Booking flow wording and small rules, the Flutter shop's (Models/dental_format.dart,
 * dental_status_labels.dart, Services/Validation/app_validators.dart, the cancel and rating
 * sections). Times are the device's local time, like the Flutter app. `now` is always passed in.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** A plain calendar date (YYYY-MM-DD) from the local calendar fields: the day the customer picked. */
export const isoDate = (d: Date) => `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** '8:00 AM'. */
export function formatSlotTime(at: Date): string {
  const h = at.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(at.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}
/** 'Mon, 7 Jun'. */
export const formatAppointmentDate = (at: Date) => W.date(W.weekdays[at.getDay()], at.getDate(), W.months[at.getMonth()]);
/** 'Mon, 7 Jun · 8:00 AM'. */
export const formatAppointmentDateTime = (at: Date) => `${formatAppointmentDate(at)} · ${formatSlotTime(at)}`;
/** 'Mon 7', one day-strip chip. */
export const formatDayStripLabel = (d: Date) => W.dayChip(W.weekdays[d.getDay()], d.getDate());

/** Local midnight of `d`. */
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The date strip: 14 days from today (well under the server's 30-day availability cap). */
export const DAY_STRIP_LENGTH = 14;
export function dayStrip(now: Date, length = DAY_STRIP_LENGTH): Date[] {
  const t = startOfDay(now);
  return Array.from({ length }, (_, i) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + i));
}

/** Whether the server said this day has times. No entry reads as "nothing known to be open". */
export function dayHasAvailability(day: Date, availability: { date: string; hasAvailability: boolean }[]): boolean {
  const iso = isoDate(day);
  return availability.find((a) => a.date === iso)?.hasAvailability ?? false;
}

/** The hold's real time left (held_until - now), never below zero. Cosmetic: confirm's answer is the real gate. */
export function holdRemainingMs(heldUntil: Date | null, now: Date): number {
  if (!heldUntil) return 0;
  return Math.max(0, heldUntil.getTime() - now.getTime());
}
/** 'm:ss', floored at zero. */
export function formatHoldCountdown(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
export const holdCountdownText = (ms: number) => W.reservedFor(formatHoldCountdown(ms));

// ---------------------------------------------------------------- status

export type BadgeTone = 'positive' | 'notice' | 'neutral' | 'problem';
export type Badge = { tone: BadgeTone; label: string };

/** A HELD row whose hold lapsed (display only; the row stays HELD on the server). */
export const isHoldExpiredAt = (a: Pick<Appointment, 'status' | 'heldUntil'>, now: Date) =>
  a.status === 'HELD' && (!a.heldUntil || a.heldUntil.getTime() <= now.getTime());
export const isCompletedAt = (a: Pick<Appointment, 'status' | 'startAt'>, now: Date) =>
  a.status === 'CONFIRMED' && !!a.startAt && a.startAt.getTime() < now.getTime();

export function appointmentBadge(a: Pick<Appointment, 'status' | 'heldUntil' | 'startAt'>, now: Date): Badge {
  if (a.status === 'HELD' && isHoldExpiredAt(a, now)) return { tone: 'neutral', label: W.expired };
  switch (a.status) {
    case 'HELD': return { tone: 'notice', label: W.reserved };
    case 'EXPIRED': return { tone: 'neutral', label: W.expired };
    case 'CONFIRMED': return isCompletedAt(a, now) ? { tone: 'neutral', label: W.completed } : { tone: 'positive', label: W.confirmed };
    case 'CANCELLED_BY_CUSTOMER': return { tone: 'neutral', label: W.cancelled };
    case 'CANCELLED_BY_CLINIC': return { tone: 'problem', label: W.cancelledByClinic };
    default: return { tone: 'neutral', label: W.statusUnavailable };
  }
}

/** Upcoming (start >= now, soonest first) or past (newest first; no start time counts as past). */
export function bucketAppointments<T extends Pick<Appointment, 'startAt'>>(list: T[], now: Date, bucket: 'upcoming' | 'past'): T[] {
  const t = (a: T) => a.startAt?.getTime() ?? 0;
  const upcoming = list.filter((a) => a.startAt && a.startAt.getTime() >= now.getTime()).sort((a, b) => t(a) - t(b));
  const past = list.filter((a) => !(a.startAt && a.startAt.getTime() >= now.getTime())).sort((a, b) => t(b) - t(a));
  return bucket === 'upcoming' ? upcoming : past;
}

/** The cancel section shows for a confirmed appointment (the server is the judge of the rest). */
export const showsCancel = (a: Pick<Appointment, 'status'>) => a.status === 'CONFIRMED';
/** The rating card shows when the server says it can be rated, or once rated. */
export const showsRating = (a: Pick<Appointment, 'canRate' | 'rating'>) => a.canRate || a.rating != null;

// ---------------------------------------------------------------- messages

const transport = (e: ApiError): boolean => e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT' || e.status === 0 || e.status === 408;

/** What to tell the customer about a refused (or unconfirmed) cancellation. */
export function cancelRefusalMessage(e: ApiError): string {
  switch (e.code) {
    case 'APPOINTMENT_NOT_CONFIRMED': return W.notConfirmed;
    case 'APPOINTMENT_ALREADY_CANCELLED': return W.alreadyCancelled;
    case 'APPOINTMENT_EXPIRED': return W.appointmentExpired;
    case 'APPOINTMENT_NOT_FOUND': return W.appointmentNotFound;
  }
  if (transport(e) || e.status === 503) return W.cancelUnconfirmed;
  return e.message || W.generic;
}

/**
 * A rating refusal: the server's own sentence for a deliberate one (not rateable, visit not over,
 * already rated); the client's own words already cover a dropped connection or a server fault.
 */
export const ratingErrorMessage = (e: ApiError) => e.message.trim() || W.generic;

/** The slot picker's two refusals (read while rendering: they follow the language). */
export const slotTakenText = () => W.slotTaken;
export const slotPassedText = () => W.slotPassed;

// ---------------------------------------------------------------- patient form

export const PATIENT_NAME_MIN = 2;
export const PATIENT_NAME_MAX = 128;
export const PATIENT_NOTES_MAX = 500;
const NAME_CHARS = /^[\p{L} '\-.]+$/u;

export const normalizeText = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');

export function patientNameError(v: string): string | null {
  const t = normalizeText(v);
  return !t || t.length < PATIENT_NAME_MIN || t.length > PATIENT_NAME_MAX || !NAME_CHARS.test(t) ? W.nameError : null;
}
export const patientPhoneError = (v: string) => (toE164(v) ? null : W.phoneError);
export function patientNotesError(v: string): string | null {
  const t = normalizeText(v);
  return t.length > PATIENT_NOTES_MAX ? W.notesError(PATIENT_NOTES_MAX) : null;
}

/** The form's fields checked; the details to confirm with when all are fine. */
export function validatePatient(f: { name: string; phone: string; notes: string }) {
  const errors = { name: patientNameError(f.name), phone: patientPhoneError(f.phone), notes: patientNotesError(f.notes) };
  const ok = !errors.name && !errors.phone && !errors.notes;
  const notes = normalizeText(f.notes);
  return { errors, details: ok ? { name: normalizeText(f.name), phone: toE164(f.phone) as string, notes: notes ? notes : null } : null };
}

/** The signed-in phone without +94, for the form's +94 prefix. */
export const localPhone = (e164: string | null | undefined) => {
  const p = e164 ?? '';
  return p.startsWith('+94') ? p.slice(3) : p;
};
