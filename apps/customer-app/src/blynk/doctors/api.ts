import { ApiError, apiGet, apiPost } from '@/blynk/api/client';
import { authed, getSession } from '@/blynk/auth/session';
import {
  parseAppointment, parseAvailability, parseClinic, parseClinicDoctor, parseDoctor, parseRating,
  type Appointment, type AppointmentRating, type Clinic, type ClinicDoctor, type DayAvailability, type Doctor,
} from './types';
import { isoDate } from './format';

/*
 * Channel doctors (Flutter DentalProvider). Discovery (clinics, doctors, slots) is public only
 * while Admin/Operations have "Doctors need sign-in" off; with it on a guest gets
 * 401 SIGN_IN_REQUIRED. Signed in, every call carries the bearer token. Booking, my appointments,
 * cancel and rating are always signed in. Availability is never cached here: every call asks.
 */

/** A discovery read: with the token when signed in (refreshed once on a 401), without when not. */
function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  return getSession() ? authed((t) => apiGet<T>(path, t, signal)) : apiGet<T>(path, null, signal);
}

const missing = (what: string) => new ApiError(`${what} was not returned by the server.`, 500);

/** The guest must sign in first (Doctors need sign-in is on). */
export const isSignInRequired = (e: unknown) =>
  e instanceof ApiError && (e.code === 'SIGN_IN_REQUIRED' || (e.status === 401 && !getSession()));

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

export function clinicsPath(q: { search?: string; city?: string; page?: number; limit?: number } = {}): string {
  const p = new URLSearchParams();
  if (q.city?.trim()) p.set('city', q.city.trim());
  if (q.search?.trim()) p.set('search', q.search.trim());
  p.set('page', String(q.page ?? 1));
  p.set('limit', String(q.limit ?? 20));
  return `/dental/clinics?${p.toString()}`;
}

export async function fetchClinics(q: { search?: string; city?: string } = {}, signal?: AbortSignal): Promise<Clinic[]> {
  const r = await read<{ clinics?: unknown[] }>(clinicsPath(q), signal);
  return (r?.clinics ?? []).map(parseClinic).filter((c): c is Clinic => !!c);
}

export async function fetchClinic(id: string, signal?: AbortSignal): Promise<Clinic> {
  const c = parseClinic((await read<{ clinic?: unknown }>(`/dental/clinics/${encodeURIComponent(id)}`, signal))?.clinic);
  if (!c) throw missing('Clinic');
  return c;
}

export async function fetchClinicDoctors(clinicId: string, signal?: AbortSignal): Promise<ClinicDoctor[]> {
  const r = await read<{ doctors?: unknown[] }>(`/dental/clinics/${encodeURIComponent(clinicId)}/doctors`, signal);
  return (r?.doctors ?? []).map(parseClinicDoctor).filter((d): d is ClinicDoctor => !!d);
}

export async function fetchDoctor(id: string, signal?: AbortSignal): Promise<Doctor> {
  const d = parseDoctor((await read<{ doctor?: unknown }>(`/dental/doctors/${encodeURIComponent(id)}`, signal))?.doctor);
  if (!d) throw missing('Doctor');
  return d;
}

/** GET /dental/doctors/:id/availability (the server caps the range at 30 days). */
export async function fetchAvailability(doctorId: string, clinicId: string, from: Date, to: Date, signal?: AbortSignal): Promise<DayAvailability[]> {
  const q = new URLSearchParams({ clinic_id: clinicId, from: isoDate(from), to: isoDate(to) });
  const r = await read<{ availability?: unknown[] }>(`/dental/doctors/${encodeURIComponent(doctorId)}/availability?${q.toString()}`, signal);
  return (r?.availability ?? []).map(parseAvailability).filter((a): a is DayAvailability => !!a);
}

/** GET /dental/doctors/:id/slots: the instants exactly as the server computed them (elapsed and taken ones already out). */
export async function fetchSlots(doctorId: string, clinicId: string, day: Date, signal?: AbortSignal): Promise<Date[]> {
  const q = new URLSearchParams({ clinic_id: clinicId, date: isoDate(day) });
  const r = await read<{ slots?: unknown[] }>(`/dental/doctors/${encodeURIComponent(doctorId)}/slots?${q.toString()}`, signal);
  return (r?.slots ?? []).map((s) => new Date(String(s))).filter((d) => !Number.isNaN(d.getTime()));
}

// ---------------------------------------------------------------- booking

export type HoldOutcome = { appointment: Appointment | null; error: ApiError | null; replay?: boolean };
/** 409 SLOT_HELD / SLOT_UNAVAILABLE: someone else has it. Retry with a different slot. */
export const isSlotConflict = (e: ApiError | null) => e?.code === 'SLOT_HELD' || e?.code === 'SLOT_UNAVAILABLE';
/** 422 SLOT_IN_PAST: the time elapsed on the way to the server. */
export const isSlotInPast = (e: ApiError | null) => e?.code === 'SLOT_IN_PAST';

const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError('Something went wrong. Please try again.', 0));

export const newIdempotencyKey = () => `app_dental_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** POST /dental/appointments/holds. Refusals come back as an outcome, never thrown. */
export async function holdSlot(clinicDoctorId: string, startAt: Date, idempotencyKey?: string): Promise<HoldOutcome> {
  try {
    const body: Record<string, string> = { clinic_doctor_id: clinicDoctorId, start_at: startAt.toISOString() };
    if (idempotencyKey?.trim()) body.idempotency_key = idempotencyKey.trim();
    const r = await authed((t) => apiPost<{ appointment?: unknown; is_idempotent_replay?: boolean }>('/dental/appointments/holds', body, t));
    const a = parseAppointment(r?.appointment);
    return a ? { appointment: a, error: null, replay: r?.is_idempotent_replay === true } : { appointment: null, error: missing('Hold') };
  } catch (e) {
    return { appointment: null, error: asApiError(e) };
  }
}

export type ConfirmOutcome = { appointment: Appointment | null; error: ApiError | null };
/** 410 HOLD_EXPIRED or 409 APPOINTMENT_NOT_HELD: the hold is gone; pick a new time. */
export const isHoldGone = (e: ApiError | null) => e?.code === 'HOLD_EXPIRED' || e?.code === 'APPOINTMENT_NOT_HELD';

export type PatientDetails = { name: string; phone: string; notes: string | null };

/** POST /dental/appointments/:id/confirm, with the patient only (the time comes from the hold). */
export async function confirmAppointment(id: string, patient: PatientDetails): Promise<ConfirmOutcome> {
  try {
    const body: Record<string, string> = { patient_name: patient.name, patient_phone: patient.phone };
    if (patient.notes?.trim()) body.patient_notes = patient.notes.trim();
    const r = await authed((t) => apiPost<{ appointment?: unknown }>(`/dental/appointments/${encodeURIComponent(id)}/confirm`, body, t));
    const a = parseAppointment(r?.appointment);
    return a ? { appointment: a, error: null } : { appointment: null, error: missing('Appointment') };
  } catch (e) {
    return { appointment: null, error: asApiError(e) };
  }
}

export async function fetchMyAppointments(limit = 50, signal?: AbortSignal): Promise<Appointment[]> {
  const r = await authed((t) => apiGet<{ appointments?: unknown[] }>(`/dental/appointments?page=1&limit=${limit}`, t, signal));
  return (r?.appointments ?? []).map(parseAppointment).filter((a): a is Appointment => !!a);
}

export async function fetchAppointment(id: string, signal?: AbortSignal): Promise<Appointment> {
  const a = parseAppointment((await authed((t) => apiGet<{ appointment?: unknown }>(`/dental/appointments/${encodeURIComponent(id)}`, t, signal)))?.appointment);
  if (!a) throw missing('Appointment');
  return a;
}

export type CancelOutcome = { appointment: Appointment | null; error: ApiError | null };

/** POST /dental/appointments/:id/cancel, `{reason?}`. Never thrown. */
export async function cancelAppointment(id: string, reason?: string | null): Promise<CancelOutcome> {
  try {
    const r = reason?.trim() ? { reason: reason.trim() } : {};
    const res = await authed((t) => apiPost<{ appointment?: unknown }>(`/dental/appointments/${encodeURIComponent(id)}/cancel`, r, t));
    const a = parseAppointment(res?.appointment);
    return a ? { appointment: a, error: null } : { appointment: null, error: missing('Appointment') };
  } catch (e) {
    return { appointment: null, error: asApiError(e) };
  }
}

export const RATING_COMMENT_MAX = 500;
export type RatingOutcome = { rating: AppointmentRating | null; appointment: Appointment | null; error: ApiError | null };

/** POST /dental/appointments/:id/rating, `{stars: 1..5, comment?}` (a blank comment is not sent). Never thrown. */
export async function rateAppointment(id: string, stars: number, comment?: string | null): Promise<RatingOutcome> {
  try {
    const body: { stars: number; comment?: string } = { stars };
    const c = comment?.trim();
    if (c) body.comment = c;
    const r = await authed((t) => apiPost<{ rating?: unknown; appointment?: unknown }>(`/dental/appointments/${encodeURIComponent(id)}/rating`, body, t));
    const rating = parseRating(r?.rating);
    if (!rating) return { rating: null, appointment: null, error: missing('Rating') };
    return { rating, appointment: parseAppointment(r?.appointment), error: null };
  } catch (e) {
    return { rating: null, appointment: null, error: asApiError(e) };
  }
}
