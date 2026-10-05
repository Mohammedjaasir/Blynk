import { DateTime } from 'luxon';
import { AppError } from '../../middleware/error.middleware.js';
import { DentalAppointmentStatus } from '../../database/types.js';
import { dentalRepository } from './dental.repository.js';
import { CLINIC_TIMEZONE } from './availability.service.js';
import {
  dentalAdminRepository,
  UQ_CLINIC_DOCTORS_PAIRING,
  UQ_DOCTOR_BLOCKED_DATES,
} from './dental-admin.repository.js';
import { timeToMinutes } from './dental-admin.schema.js';
import type {
  AdminAppointmentListQueryInput,
  AttachDoctorToClinicInput,
  CreateAvailabilityInput,
  CreateBlockedDateInput,
  CreateClinicInput,
  CreateDoctorInput,
  UpdateAvailabilityInput,
  UpdateClinicDoctorInput,
  UpdateClinicInput,
  UpdateDoctorInput,
} from './dental-admin.schema.js';
import { NO_RATINGS, ratingSummaries } from './doctor-rating.service.js';

function money(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function notFound(entity: string, code: string): AppError {
  return new AppError(`${entity} not found.`, 404, code);
}

/**
 * Task B4 - admin CRUD for clinics, doctors, clinic-doctor pairings,
 * availability templates, blocked dates, and the admin appointment list.
 * Every method here is reached only through ADMIN-guarded routes
 * (dental/index.ts's adminDentalRouter) - no role check lives in this file,
 * matching clinic.service.ts/doctor.service.ts's separation (the guard is
 * the route's job, not the service's).
 */
export class DentalAdminService {
  // --------------------------------------------------------------------------
  // CLINICS - no hard delete; deactivated via is_active=false only, to
  // preserve appointment history integrity (an appointment referencing a
  // deleted clinic would break the customer's history view - brief's
  // explicit rule, and appointments.clinic_doctor_id is ON DELETE RESTRICT
  // in B1's migration anyway, so a hard delete of a clinic with any
  // clinic_doctors row would fail at the database level regardless).
  // --------------------------------------------------------------------------

  async listClinicsAdmin(isActive?: boolean) {
    const rows = await dentalAdminRepository.findAllClinicsAdmin(isActive);
    return rows.map(toClinicAdminDto);
  }

  async getClinicByIdAdmin(id: string) {
    const clinic = await dentalAdminRepository.findClinicById(id);
    if (!clinic) throw notFound('Clinic', 'CLINIC_NOT_FOUND');
    return toClinicAdminDto(clinic);
  }

  async createClinicAdmin(input: CreateClinicInput) {
    const created = await dentalAdminRepository.createClinic(input);
    return toClinicAdminDto(created);
  }

  /**
   * Fix round 1 (review finding I1): a single-field PATCH of only
   * `operating_start_time` OR only `operating_end_time` used to reach the DB
   * with no cross-check against the *other*, already-stored bound - Postgres
   * would correctly reject an inverted window via `chk_dental_clinic_hours`,
   * but as a raw, uncaught 23514 that fell through to a generic 500
   * (error.middleware.ts has no translation for that code). Fixed with the
   * same merge-then-validate pattern `updateAvailability` already uses for
   * its own cross-entity check: merge the partial PATCH body over the
   * existing row, validate the merged result, and reject with a clean 400
   * *before* the UPDATE ever runs - so the CHECK constraint is now a backstop
   * that can never actually fire from this endpoint, not the only thing
   * standing between a bad request and a 500.
   */
  async updateClinicAdmin(id: string, input: UpdateClinicInput) {
    const existing = await dentalAdminRepository.findClinicById(id);
    if (!existing) throw notFound('Clinic', 'CLINIC_NOT_FOUND');

    const mergedStart = input.operating_start_time ?? existing.operating_start_time;
    const mergedEnd = input.operating_end_time ?? existing.operating_end_time;
    if (timeToMinutes(mergedEnd) <= timeToMinutes(mergedStart)) {
      throw new AppError(
        `operating_end_time (${mergedEnd}) must be after operating_start_time (${mergedStart}).`,
        400,
        'INVALID_CLINIC_HOURS'
      );
    }

    const updated = await dentalAdminRepository.updateClinic(id, input);
    if (!updated) throw notFound('Clinic', 'CLINIC_NOT_FOUND');
    return toClinicAdminDto(updated);
  }

  // --------------------------------------------------------------------------
  // DOCTORS - no hard delete, same reasoning as clinics.
  // --------------------------------------------------------------------------

  async listDoctorsAdmin(isActive?: boolean) {
    const rows = await dentalAdminRepository.findAllDoctorsAdmin(isActive);
    // Migration 023: each doctor's visible rating average and count.
    const ratings = await ratingSummaries(rows.map((r) => r.id));
    return rows.map((row) => ({ ...toDoctorAdminDto(row), ...(ratings.get(row.id) ?? NO_RATINGS) }));
  }

  async getDoctorByIdAdmin(id: string) {
    const doctor = await dentalAdminRepository.findDoctorById(id);
    if (!doctor) throw notFound('Doctor', 'DOCTOR_NOT_FOUND');
    return toDoctorAdminDto(doctor);
  }

  async createDoctorAdmin(input: CreateDoctorInput) {
    const created = await dentalAdminRepository.createDoctor(input);
    return toDoctorAdminDto(created);
  }

  async updateDoctorAdmin(id: string, input: UpdateDoctorInput) {
    const existing = await dentalAdminRepository.findDoctorById(id);
    if (!existing) throw notFound('Doctor', 'DOCTOR_NOT_FOUND');

    const updated = await dentalAdminRepository.updateDoctor(id, input);
    if (!updated) throw notFound('Doctor', 'DOCTOR_NOT_FOUND');
    return toDoctorAdminDto(updated);
  }

  // --------------------------------------------------------------------------
  // CLINIC-DOCTOR RELATIONSHIP
  // --------------------------------------------------------------------------

  /**
   * Attaches a doctor to a clinic with an optional fee. Real FK-existence +
   * active-flag checks happen here in the service layer before insert (the
   * brief's explicit requirement - not just relying on the DB FK to throw a
   * raw error). The `uq_clinic_doctors_pairing` catch below is still kept as
   * the last line of defence for a genuine race between two concurrent admin
   * requests, exactly the `assignRider()`/B3 shape.
   */
  async attachDoctorToClinic(clinicId: string, input: AttachDoctorToClinicInput) {
    const clinic = await dentalAdminRepository.findClinicById(clinicId);
    if (!clinic) throw notFound('Clinic', 'CLINIC_NOT_FOUND');
    if (!clinic.is_active) {
      throw new AppError('Cannot attach a doctor to an inactive clinic.', 409, 'CLINIC_INACTIVE');
    }

    const doctor = await dentalAdminRepository.findDoctorById(input.doctor_id);
    if (!doctor) throw notFound('Doctor', 'DOCTOR_NOT_FOUND');
    if (!doctor.is_active) {
      throw new AppError('Cannot attach an inactive doctor to a clinic.', 409, 'DOCTOR_INACTIVE');
    }

    const existingPairing = await dentalAdminRepository.findClinicDoctorPairing(clinicId, input.doctor_id);
    if (existingPairing) {
      throw new AppError(
        'This doctor is already attached to this clinic.',
        409,
        'CLINIC_DOCTOR_PAIRING_EXISTS'
      );
    }

    try {
      const created = await dentalAdminRepository.createClinicDoctor({
        clinic_id: clinicId,
        doctor_id: input.doctor_id,
        consultation_fee: input.consultation_fee ?? null,
      });
      return toClinicDoctorRecordDto(created);
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === UQ_CLINIC_DOCTORS_PAIRING) {
        throw new AppError(
          'This doctor is already attached to this clinic.',
          409,
          'CLINIC_DOCTOR_PAIRING_EXISTS'
        );
      }
      throw err;
    }
  }

  async updateClinicDoctor(id: string, input: UpdateClinicDoctorInput) {
    const existing = await dentalAdminRepository.findClinicDoctorById(id);
    if (!existing) throw notFound('Clinic-doctor pairing', 'CLINIC_DOCTOR_NOT_FOUND');

    const updated = await dentalAdminRepository.updateClinicDoctor(id, input);
    if (!updated) throw notFound('Clinic-doctor pairing', 'CLINIC_DOCTOR_NOT_FOUND');
    return toClinicDoctorRecordDto(updated);
  }

  /** Admin roster: every pairing for this clinic, including inactive ones and
   * inactive doctors - the admin needs to see and re-enable them. */
  async listClinicDoctorRosterAdmin(clinicId: string) {
    const clinic = await dentalAdminRepository.findClinicById(clinicId);
    if (!clinic) throw notFound('Clinic', 'CLINIC_NOT_FOUND');

    const rows = await dentalAdminRepository.findClinicDoctorRosterAdmin(clinicId);
    return rows.map((row) => ({
      clinic_doctor_id: row.clinic_doctor_id,
      doctor_id: row.doctor_id,
      full_name: row.full_name,
      specialty: row.specialty,
      photo_url: row.photo_url,
      bio: row.bio,
      doctor_is_active: row.doctor_is_active,
      consultation_fee: money(row.consultation_fee),
      pairing_is_active: row.pairing_is_active,
    }));
  }

  // --------------------------------------------------------------------------
  // AVAILABILITY TEMPLATE
  // --------------------------------------------------------------------------

  /** Fetches the clinic-doctor pairing and its parent clinic's hours in one
   * place, so create/update share exactly one cross-validation path. */
  private async resolveBookableClinicDoctorForAdmin(clinicDoctorId: string) {
    const clinicDoctor = await dentalAdminRepository.findClinicDoctorById(clinicDoctorId);
    if (!clinicDoctor) throw notFound('Clinic-doctor pairing', 'CLINIC_DOCTOR_NOT_FOUND');
    if (!clinicDoctor.is_active) {
      throw new AppError(
        'This clinic-doctor pairing is inactive.',
        409,
        'CLINIC_DOCTOR_INACTIVE'
      );
    }

    const clinic = await dentalAdminRepository.findClinicById(clinicDoctor.clinic_id);
    if (!clinic) throw notFound('Clinic', 'CLINIC_NOT_FOUND'); // unreachable given the FK, defensive
    return { clinicDoctor, clinic };
  }

  /** Plan §9.3: "Clinic working hours ... bounds what a clinic-doctor's
   * template is allowed to be (validated at admin-write time)." Compares
   * minutes-since-midnight, never raw strings (see dental-admin.schema.ts's
   * `timeToMinutes`). */
  private assertWithinClinicHours(
    startTime: string,
    endTime: string,
    clinic: { operating_start_time: string; operating_end_time: string }
  ): void {
    const withinHours =
      timeToMinutes(startTime) >= timeToMinutes(clinic.operating_start_time) &&
      timeToMinutes(endTime) <= timeToMinutes(clinic.operating_end_time);
    if (!withinHours) {
      throw new AppError(
        `This template (${startTime}-${endTime}) falls outside the clinic's operating hours (${clinic.operating_start_time}-${clinic.operating_end_time}).`,
        400,
        'TEMPLATE_OUTSIDE_CLINIC_HOURS'
      );
    }
  }

  async createAvailability(clinicDoctorId: string, input: CreateAvailabilityInput) {
    const { clinic } = await this.resolveBookableClinicDoctorForAdmin(clinicDoctorId);
    this.assertWithinClinicHours(input.start_time, input.end_time, clinic);

    const created = await dentalAdminRepository.createAvailability({
      clinic_doctor_id: clinicDoctorId,
      day_of_week: input.day_of_week,
      start_time: input.start_time,
      end_time: input.end_time,
      slot_duration_minutes: input.slot_duration_minutes,
      buffer_minutes: input.buffer_minutes,
    });
    return toAvailabilityDto(created);
  }

  async listAvailabilityAdmin(clinicDoctorId: string) {
    const clinicDoctor = await dentalAdminRepository.findClinicDoctorById(clinicDoctorId);
    if (!clinicDoctor) throw notFound('Clinic-doctor pairing', 'CLINIC_DOCTOR_NOT_FOUND');

    const rows = await dentalAdminRepository.findAvailabilityForClinicDoctorAdmin(clinicDoctorId);
    return rows.map(toAvailabilityDto);
  }

  async updateAvailability(id: string, input: UpdateAvailabilityInput) {
    const existing = await dentalAdminRepository.findAvailabilityById(id);
    if (!existing) throw notFound('Availability template row', 'AVAILABILITY_NOT_FOUND');

    const clinicDoctor = await dentalAdminRepository.findClinicDoctorById(existing.clinic_doctor_id);
    if (!clinicDoctor) throw notFound('Clinic-doctor pairing', 'CLINIC_DOCTOR_NOT_FOUND'); // unreachable, defensive (CASCADE FK)
    const clinic = await dentalAdminRepository.findClinicById(clinicDoctor.clinic_id);
    if (!clinic) throw notFound('Clinic', 'CLINIC_NOT_FOUND'); // unreachable, defensive

    const mergedStart = input.start_time ?? existing.start_time;
    const mergedEnd = input.end_time ?? existing.end_time;
    this.assertWithinClinicHours(mergedStart, mergedEnd, clinic);

    const updated = await dentalAdminRepository.updateAvailability(id, input);
    if (!updated) throw notFound('Availability template row', 'AVAILABILITY_NOT_FOUND');
    return toAvailabilityDto(updated);
  }

  /** Hard delete is fine here: a template row is configuration, not history.
   * Confirmed against B1's actual schema - `appointments.start_at`/`end_at`
   * are their own TIMESTAMPTZ columns with no FK to `doctor_availability` at
   * all, so deleting a template row can never affect an existing appointment
   * row (007_dental_clinic_appointments.sql has no such reference). */
  async deleteAvailability(id: string): Promise<void> {
    const existing = await dentalAdminRepository.findAvailabilityById(id);
    if (!existing) throw notFound('Availability template row', 'AVAILABILITY_NOT_FOUND');
    await dentalAdminRepository.deleteAvailability(id);
  }

  // --------------------------------------------------------------------------
  // BLOCKED DATES
  // --------------------------------------------------------------------------

  async createBlockedDate(clinicDoctorId: string, input: CreateBlockedDateInput, createdBy: string) {
    const clinicDoctor = await dentalAdminRepository.findClinicDoctorById(clinicDoctorId);
    if (!clinicDoctor) throw notFound('Clinic-doctor pairing', 'CLINIC_DOCTOR_NOT_FOUND');

    // Pre-check via dental.repository.ts's existing read (reused, not
    // duplicated - it queries doctor_blocked_dates unscoped by any active
    // flag, exactly what this check needs).
    const existingBlock = await dentalRepository.findBlockedDate(clinicDoctorId, input.blocked_date);
    if (existingBlock) {
      throw new AppError(
        'This date is already blocked for this clinic-doctor pairing.',
        409,
        'BLOCKED_DATE_EXISTS'
      );
    }

    try {
      const created = await dentalAdminRepository.createBlockedDate({
        clinic_doctor_id: clinicDoctorId,
        blocked_date: input.blocked_date,
        reason: input.reason,
        created_by: createdBy,
      });
      return toBlockedDateDto(created);
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === UQ_DOCTOR_BLOCKED_DATES) {
        throw new AppError(
          'This date is already blocked for this clinic-doctor pairing.',
          409,
          'BLOCKED_DATE_EXISTS'
        );
      }
      throw err;
    }
  }

  async listBlockedDatesAdmin(clinicDoctorId: string) {
    const clinicDoctor = await dentalAdminRepository.findClinicDoctorById(clinicDoctorId);
    if (!clinicDoctor) throw notFound('Clinic-doctor pairing', 'CLINIC_DOCTOR_NOT_FOUND');

    const rows = await dentalAdminRepository.findBlockedDatesForClinicDoctorAdmin(clinicDoctorId);
    return rows.map(toBlockedDateDto);
  }

  /** Hard delete = unblocking a date (brief's explicit wording). */
  async deleteBlockedDate(id: string): Promise<void> {
    const existing = await dentalAdminRepository.findBlockedDateById(id);
    if (!existing) throw notFound('Blocked date', 'BLOCKED_DATE_NOT_FOUND');
    await dentalAdminRepository.deleteBlockedDate(id);
  }

  // --------------------------------------------------------------------------
  // ADMIN APPOINTMENT LIST (plan §14/§16 - operational visibility, patient
  // name/phone/notes included; see toAdminAppointmentDto for the B3-carry-
  // forward on a stale HELD row)
  // --------------------------------------------------------------------------

  async listAdminAppointments(query: AdminAppointmentListQueryInput) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const now = new Date();

    // Clinic-local (Asia/Colombo) calendar-date bounds converted to a UTC
    // instant range - the exact convention availability.service.ts already
    // established for `from`/`to` (dental.schema.ts's availabilityQuerySchema).
    const fromUtc = query.from
      ? DateTime.fromISO(query.from, { zone: CLINIC_TIMEZONE }).startOf('day').toUTC().toJSDate()
      : undefined;
    const toUtc = query.to
      ? DateTime.fromISO(query.to, { zone: CLINIC_TIMEZONE }).plus({ days: 1 }).startOf('day').toUTC().toJSDate()
      : undefined;

    const filters = {
      clinicId: query.clinic_id,
      doctorId: query.doctor_id,
      status: query.status as DentalAppointmentStatus | undefined,
      fromUtc,
      toUtc,
    };

    const [rows, total] = await Promise.all([
      dentalAdminRepository.findAdminAppointments({ ...filters, limit, offset: (page - 1) * limit }),
      dentalAdminRepository.countAdminAppointments(filters),
    ]);

    return {
      appointments: rows.map((row) => toAdminAppointmentDto(row, now)),
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 },
    };
  }
}

// ----------------------------------------------------------------------------
// DTOs
// ----------------------------------------------------------------------------

function toClinicAdminDto(row: {
  id: string;
  name: string;
  city: string;
  address_line: string;
  latitude: number | string;
  longitude: number | string;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    address_line: row.address_line,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    contact_phone: row.contact_phone,
    operating_start_time: row.operating_start_time,
    operating_end_time: row.operating_end_time,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toDoctorAdminDto(row: {
  id: string;
  full_name: string;
  specialty: string;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    full_name: row.full_name,
    specialty: row.specialty,
    photo_url: row.photo_url,
    bio: row.bio,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toClinicDoctorRecordDto(row: {
  id: string;
  clinic_id: string;
  doctor_id: string;
  consultation_fee: number | string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    clinic_id: row.clinic_id,
    doctor_id: row.doctor_id,
    consultation_fee: money(row.consultation_fee),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAvailabilityDto(row: {
  id: string;
  clinic_doctor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: row.id,
    clinic_doctor_id: row.clinic_doctor_id,
    day_of_week: row.day_of_week,
    start_time: row.start_time,
    end_time: row.end_time,
    slot_duration_minutes: row.slot_duration_minutes,
    buffer_minutes: row.buffer_minutes,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toBlockedDateDto(row: {
  id: string;
  clinic_doctor_id: string;
  blocked_date: string | Date;
  reason: string;
  created_by: string;
  created_at: Date;
}) {
  return {
    id: row.id,
    clinic_doctor_id: row.clinic_doctor_id,
    blocked_date: row.blocked_date,
    reason: row.reason,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/**
 * B3 carry-forward (task-B3-report.md §10 concern 2): `EXPIRED` is never
 * written - expiry is purely lazy. B3's own customer-facing list does not
 * relabel `status`; it returns the raw status plus `held_until` so the
 * caller can tell. This admin DTO follows the exact same convention (raw
 * `status`, raw `held_until`) and adds one derived, read-time-only flag -
 * `is_expired_hold` - so an admin list is never presented as if a stale
 * HELD row were an active hold, without inventing a persisted EXPIRED
 * write anywhere (that would contradict plan §7.5's lazy-expiry mandate).
 */
function toAdminAppointmentDto(
  row: {
    id: string;
    clinic_doctor_id: string;
    customer_id: string;
    start_at: Date;
    end_at: Date;
    status: DentalAppointmentStatus;
    held_until: Date | null;
    patient_name: string | null;
    patient_phone: string | null;
    patient_notes: string | null;
    consultation_fee_snapshot: number | string | null;
    cancellation_reason: string | null;
    cancelled_by: string | null;
    created_at: Date;
    doctor_id: string;
    doctor_name: string;
    doctor_specialty: string;
    clinic_id: string;
    clinic_name: string;
    clinic_city: string;
  },
  now: Date
) {
  return {
    id: row.id,
    clinic_doctor_id: row.clinic_doctor_id,
    customer_id: row.customer_id,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status,
    held_until: row.held_until,
    is_expired_hold: row.status === 'HELD' && row.held_until !== null && row.held_until <= now,
    is_completed: row.status === 'CONFIRMED' && row.start_at < now,
    patient_name: row.patient_name,
    patient_phone: row.patient_phone,
    patient_notes: row.patient_notes,
    consultation_fee_snapshot: money(row.consultation_fee_snapshot),
    cancellation_reason: row.cancellation_reason,
    cancelled_by: row.cancelled_by,
    created_at: row.created_at,
    doctor: { id: row.doctor_id, full_name: row.doctor_name, specialty: row.doctor_specialty },
    clinic: { id: row.clinic_id, name: row.clinic_name, city: row.clinic_city },
  };
}

export const dentalAdminService = new DentalAdminService();
