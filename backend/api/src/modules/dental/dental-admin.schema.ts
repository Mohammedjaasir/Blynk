import { z } from 'zod';
import { APPOINTMENT_LIST_STATUSES } from './appointment.schema.js';

// ----------------------------------------------------------------------------
// TASK B4 - Admin CRUD (clinics, doctors, clinic-doctor pairings, availability
// templates, blocked dates, admin appointment listing). All routes this
// schema file backs are ADMIN-only. Inline `schema.parse(...)` in the
// controller (dental.controller.ts / catalog.controller.ts's pattern - this
// module doesn't use the `validate()` middleware).
// ----------------------------------------------------------------------------

/** A doctor's specialty is free text since migration 030 (owner, 2026-10-09):
 * any specialty, e.g. "Cosmetic dentist" or "Prosthodontist". The apps offer
 * these as quick suggestions only. */
export const DENTAL_SPECIALTY_SUGGESTIONS = [
  'General dentist',
  'Orthodontist',
  'Periodontist',
  'Endodontist',
  'Oral surgeon',
  'Pediatric dentist',
] as const;

// ----------------------------------------------------------------------------
// SHARED FIELD HELPERS
// ----------------------------------------------------------------------------

/** `HH:MM` or `HH:MM:SS` - accepted in either form because Postgres TIME
 * round-trips as `HH:MM:SS` (see availability.service.ts's luxon parse of
 * `doctor_availability.start_time`), but an admin typing a form only has
 * `HH:MM`. Comparison uses `timeToMinutes`, never string comparison, so the
 * two forms can never disagree. */
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const timeSchema = z.string().trim().regex(TIME_REGEX, 'Must be a time in HH:MM (or HH:MM:SS) 24-hour format');

/** Minutes since midnight, for cross-entity hour-window comparisons. Not a
 * string compare - a regex-valid `HH:MM:SS` and `HH:MM` for the same instant
 * must compare equal, which plain string `<`/`>` cannot guarantee once
 * seconds are involved. */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const dateOnlySchema = z
  .string()
  .regex(DATE_ONLY_REGEX, 'Must be a date in YYYY-MM-DD format')
  .refine((val) => !Number.isNaN(new Date(`${val}T00:00:00Z`).getTime()), {
    message: 'Must be a valid calendar date',
  });

// ----------------------------------------------------------------------------
// PATH PARAM SCHEMAS
// ----------------------------------------------------------------------------
export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });
export type IdParamInput = z.infer<typeof idParamSchema>;

export const clinicIdPathParamSchema = z.object({ clinic_id: z.string().uuid('Invalid clinic id') });
export const clinicDoctorIdPathParamSchema = z.object({
  clinic_doctor_id: z.string().uuid('Invalid clinic_doctor id'),
});

// ----------------------------------------------------------------------------
// CLINICS
// ----------------------------------------------------------------------------
export const createClinicSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(128),
    city: z.string().trim().min(1).max(64),
    address_line: z.string().trim().min(1).max(2000),
    latitude: z.number().min(-90, 'latitude must be between -90 and 90').max(90),
    longitude: z.number().min(-180, 'longitude must be between -180 and 180').max(180),
    contact_phone: z.string().trim().min(7).max(20),
    operating_start_time: timeSchema,
    operating_end_time: timeSchema,
    is_active: z.boolean().default(true).optional(),
  })
  .refine((d) => timeToMinutes(d.operating_end_time) > timeToMinutes(d.operating_start_time), {
    message: 'operating_end_time must be after operating_start_time',
    path: ['operating_end_time'],
  });
export type CreateClinicInput = z.infer<typeof createClinicSchema>;

export const updateClinicSchema = z
  .object({
    name: z.string().trim().min(2).max(128).optional(),
    city: z.string().trim().min(1).max(64).optional(),
    address_line: z.string().trim().min(1).max(2000).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    contact_phone: z.string().trim().min(7).max(20).optional(),
    operating_start_time: timeSchema.optional(),
    operating_end_time: timeSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.operating_start_time === undefined ||
      d.operating_end_time === undefined ||
      timeToMinutes(d.operating_end_time) > timeToMinutes(d.operating_start_time),
    {
      message: 'operating_end_time must be after operating_start_time',
      path: ['operating_end_time'],
    }
  );
export type UpdateClinicInput = z.infer<typeof updateClinicSchema>;

// ----------------------------------------------------------------------------
// DOCTORS
// ----------------------------------------------------------------------------
export const createDoctorSchema = z.object({
  full_name: z.string().trim().min(2, 'Name must be at least 2 characters').max(128),
  specialty: z
    .string()
    .trim()
    .min(2, 'Specialty must be at least 2 characters')
    .max(64, 'Specialty must be at most 64 characters'),
  photo_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  is_active: z.boolean().default(true).optional(),
});
export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;

export const updateDoctorSchema = createDoctorSchema.partial();
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;

// ----------------------------------------------------------------------------
// CLINIC-DOCTOR RELATIONSHIP (the join table)
// ----------------------------------------------------------------------------
export const attachDoctorToClinicSchema = z
  .object({
    doctor_id: z.string().uuid('doctor_id must be a valid UUID'),
    consultation_fee: z.number().min(0, 'Fee cannot be negative').max(99999999.99).nullable().optional(),
  })
  .strict();
export type AttachDoctorToClinicInput = z.infer<typeof attachDoctorToClinicSchema>;

export const updateClinicDoctorSchema = z
  .object({
    consultation_fee: z.number().min(0, 'Fee cannot be negative').max(99999999.99).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();
export type UpdateClinicDoctorInput = z.infer<typeof updateClinicDoctorSchema>;

// ----------------------------------------------------------------------------
// AVAILABILITY TEMPLATE
// ----------------------------------------------------------------------------
export const createAvailabilitySchema = z
  .object({
    day_of_week: z.number().int().min(0, 'day_of_week must be 0-6').max(6),
    start_time: timeSchema,
    end_time: timeSchema,
    slot_duration_minutes: z.number().int().min(1, 'slot_duration_minutes must be positive'),
    buffer_minutes: z.number().int().min(0).default(0).optional(),
  })
  .strict()
  .refine((d) => timeToMinutes(d.end_time) > timeToMinutes(d.start_time), {
    message: 'end_time must be after start_time',
    path: ['end_time'],
  });
export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;

export const updateAvailabilitySchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6).optional(),
    start_time: timeSchema.optional(),
    end_time: timeSchema.optional(),
    slot_duration_minutes: z.number().int().min(1).optional(),
    buffer_minutes: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.start_time === undefined ||
      d.end_time === undefined ||
      timeToMinutes(d.end_time) > timeToMinutes(d.start_time),
    { message: 'end_time must be after start_time', path: ['end_time'] }
  );
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

// ----------------------------------------------------------------------------
// BLOCKED DATES
// ----------------------------------------------------------------------------
export const createBlockedDateSchema = z
  .object({
    blocked_date: dateOnlySchema,
    reason: z.string().trim().min(1, 'A reason is required.').max(128),
  })
  .strict();
export type CreateBlockedDateInput = z.infer<typeof createBlockedDateSchema>;

// ----------------------------------------------------------------------------
// ADMIN APPOINTMENT LIST - GET /admin/dental/appointments
// ----------------------------------------------------------------------------
export const adminAppointmentListQuerySchema = z
  .object({
    clinic_id: z.string().uuid('clinic_id must be a valid UUID').optional(),
    doctor_id: z.string().uuid('doctor_id must be a valid UUID').optional(),
    status: z.enum(APPOINTMENT_LIST_STATUSES).optional(),
    // Clinic-local (Asia/Colombo) calendar-date bounds on start_at, same
    // convention as dental.schema.ts's availability range query.
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    page: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 1))
      .pipe(z.number().int().min(1).default(1)),
    limit: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 20))
      .pipe(z.number().int().min(1).max(100).default(20)),
  })
  .refine((d) => d.from === undefined || d.to === undefined || d.from <= d.to, {
    message: '`from` must not be after `to`',
    path: ['to'],
  });
export type AdminAppointmentListQueryInput = z.infer<typeof adminAppointmentListQuerySchema>;
