/*
 * Channel doctors (dental clinics) - the backend's DTOs (backend/api/src/modules/dental), parsed
 * the way the Flutter shop does it (Models/dental_*.dart): missing fields read as empty, money
 * that arrives as a NUMERIC string is a number, and an unknown status is 'UNKNOWN'.
 */

import { DOCTOR_FORMAT as W } from './words';

const str = (v: unknown) => (v == null ? '' : String(v));
const optStr = (v: unknown) => (v == null ? null : String(v));
const numOr = (v: unknown, fallback: number) => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
};
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const date = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const fee = (v: unknown): number | null => { if (v == null) return null; const m = numOr(v, NaN); return Number.isNaN(m) ? null : m; };
const avg = (v: unknown): number | null => fee(v);

/** The six enum codes `doctors.specialty` held before migration 030. */
/** Free text since migration 030 ("Cosmetic dentist"); an old code reads as its label, nothing as "Dentist". */
export function specialtyLabel(raw: unknown): string {
  const t = str(raw).trim();
  if (!t) return W.dentist;
  return W.specialties[t] ?? t;
}

/** "★ 4.6 (12)", or null when there is nothing real to show. */
export function ratingLabel(average: number | null, count: number): string | null {
  if (average == null || count <= 0) return null;
  return `★ ${average.toFixed(1)} (${count})`;
}

export type Clinic = {
  id: string; name: string; city: string; addressLine: string; latitude: number; longitude: number;
  contactPhone: string; operatingStartTime: string; operatingEndTime: string;
};
export function parseClinic(raw: unknown): Clinic | null {
  const m = obj(raw);
  if (!m || !str(m.id)) return null;
  return {
    id: str(m.id), name: str(m.name), city: str(m.city), addressLine: str(m.address_line),
    latitude: numOr(m.latitude, 0), longitude: numOr(m.longitude, 0), contactPhone: str(m.contact_phone),
    operatingStartTime: str(m.operating_start_time), operatingEndTime: str(m.operating_end_time),
  };
}

/** One row of GET /dental/clinics/:id/doctors: a doctor at ONE clinic, with that pairing's fee. */
export type ClinicDoctor = {
  clinicDoctorId: string; doctorId: string; fullName: string; specialty: string; photoUrl: string | null;
  bio: string | null; consultationFee: number | null; ratingAverage: number | null; ratingCount: number;
};
export function parseClinicDoctor(raw: unknown): ClinicDoctor | null {
  const m = obj(raw);
  if (!m || !str(m.clinic_doctor_id)) return null;
  return {
    clinicDoctorId: str(m.clinic_doctor_id), doctorId: str(m.doctor_id), fullName: str(m.full_name),
    specialty: specialtyLabel(m.specialty), photoUrl: optStr(m.photo_url), bio: optStr(m.bio),
    consultationFee: fee(m.consultation_fee), ratingAverage: avg(m.rating_average),
    ratingCount: Math.trunc(numOr(m.rating_count, 0)),
  };
}

/** One clinic a doctor practices at, inside GET /dental/doctors/:id. */
export type DoctorClinic = {
  clinicDoctorId: string; clinicId: string; name: string; city: string; addressLine: string;
  latitude: number; longitude: number; consultationFee: number | null;
};
export type Doctor = {
  id: string; fullName: string; specialty: string; photoUrl: string | null; bio: string | null;
  clinics: DoctorClinic[]; ratingAverage: number | null; ratingCount: number;
};
export function parseDoctor(raw: unknown): Doctor | null {
  const m = obj(raw);
  if (!m || !str(m.id)) return null;
  return {
    id: str(m.id), fullName: str(m.full_name), specialty: specialtyLabel(m.specialty), photoUrl: optStr(m.photo_url), bio: optStr(m.bio),
    clinics: (Array.isArray(m.clinics) ? m.clinics : []).flatMap((c) => {
      const o = obj(c);
      return o ? [{
        clinicDoctorId: str(o.clinic_doctor_id), clinicId: str(o.clinic_id), name: str(o.name), city: str(o.city),
        addressLine: str(o.address_line), latitude: numOr(o.latitude, 0), longitude: numOr(o.longitude, 0), consultationFee: fee(o.consultation_fee),
      }] : [];
    }),
    ratingAverage: avg(m.rating_average),
    ratingCount: Math.trunc(numOr(m.rating_count, 0)),
  };
}

/** The one clinic-doctor pairing a screen is scoped to; null when the doctor no longer practices there. */
export const pairingFor = (doctor: Doctor | null, clinicId: string) => doctor?.clinics.find((c) => c.clinicId === clinicId) ?? null;

export type DayAvailability = { date: string; hasAvailability: boolean };
/** GET /dental/doctors/:id/availability rows: plain `date` / `hasAvailability` keys (not snake_case). */
export function parseAvailability(raw: unknown): DayAvailability | null {
  const m = obj(raw);
  if (!m || !str(m.date)) return null;
  return { date: str(m.date), hasAvailability: m.hasAvailability === true };
}

export type AppointmentStatus = 'HELD' | 'EXPIRED' | 'CONFIRMED' | 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_CLINIC' | 'UNKNOWN';
const STATUSES = new Set(['HELD', 'EXPIRED', 'CONFIRMED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_CLINIC']);

export type AppointmentRating = { stars: number; comment: string | null; createdAt: Date | null };
export function parseRating(raw: unknown): AppointmentRating | null {
  const m = obj(raw);
  if (!m) return null;
  const stars = Math.trunc(numOr(m.stars, NaN));
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) return null;
  const c = optStr(m.comment)?.trim();
  return { stars, comment: c ? c : null, createdAt: date(m.created_at) };
}

/** One model for the hold, list and detail DTOs (the narrower ones simply omit fields). */
export type Appointment = {
  id: string; clinicDoctorId: string; status: AppointmentStatus; startAt: Date | null; endAt: Date | null;
  heldUntil: Date | null; consultationFeeSnapshot: number | null; patientName: string | null; patientPhone: string | null;
  patientNotes: string | null; cancellationReason: string | null; isCompleted: boolean; canCancel: boolean;
  /** The backend's own rule; the only thing that decides whether "Rate your visit" shows. */
  canRate: boolean; rating: AppointmentRating | null;
  doctor: { id: string; fullName: string; specialty: string; photoUrl: string | null } | null;
  clinic: { id: string; name: string; city: string; addressLine: string } | null;
  createdAt: Date | null;
};
export function parseAppointment(raw: unknown): Appointment | null {
  const m = obj(raw);
  if (!m || !str(m.id)) return null;
  const d = obj(m.doctor);
  const c = obj(m.clinic);
  const status = str(m.status);
  return {
    id: str(m.id), clinicDoctorId: str(m.clinic_doctor_id),
    status: (STATUSES.has(status) ? status : 'UNKNOWN') as AppointmentStatus,
    startAt: date(m.start_at), endAt: date(m.end_at), heldUntil: date(m.held_until),
    consultationFeeSnapshot: fee(m.consultation_fee_snapshot),
    patientName: optStr(m.patient_name), patientPhone: optStr(m.patient_phone), patientNotes: optStr(m.patient_notes),
    cancellationReason: optStr(m.cancellation_reason),
    isCompleted: m.is_completed === true, canCancel: m.can_cancel === true, canRate: m.can_rate === true,
    rating: parseRating(m.rating),
    doctor: d ? { id: str(d.id), fullName: str(d.full_name), specialty: specialtyLabel(d.specialty), photoUrl: optStr(d.photo_url) } : null,
    clinic: c ? { id: str(c.id), name: str(c.name), city: str(c.city), addressLine: str(c.address_line) } : null,
    createdAt: date(m.created_at),
  };
}

/** This appointment with `rating` as its rating and can_rate off (a rating answer without the appointment). */
export const withRating = (a: Appointment, rating: AppointmentRating): Appointment => ({ ...a, canRate: false, rating });
