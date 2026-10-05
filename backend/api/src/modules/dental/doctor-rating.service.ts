import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { appointmentService, canRateVisit } from './appointment.service.js';

/**
 * Doctor ratings (migration 023). A customer rates a visit - a CONFIRMED
 * appointment whose slot has ended - once: 1-5 stars and an optional comment.
 * The public doctor views carry the average (one decimal) and count of
 * ratings staff have not hidden. Staff (ADMIN/OPERATIONS) list a doctor's
 * ratings and hide or unhide an abusive one.
 */

// ----------------------------------------------------------------------------
// SCHEMAS
// ----------------------------------------------------------------------------

export const MAX_RATING_COMMENT = 500;

export const rateAppointmentSchema = z
  .object({
    stars: z
      .number({ required_error: 'stars is required', invalid_type_error: 'stars must be a number' })
      .int('stars must be a whole number')
      .min(1, 'stars must be between 1 and 5')
      .max(5, 'stars must be between 1 and 5'),
    comment: z
      .string()
      .trim()
      .max(MAX_RATING_COMMENT, `A comment can be at most ${MAX_RATING_COMMENT} characters`)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .strict();
export type RateAppointmentInput = z.infer<typeof rateAppointmentSchema>;

export const ratingIdParamSchema = z.object({ id: z.string().uuid('Invalid rating id') });

export const ratingHiddenSchema = z.object({ hidden: z.boolean({ required_error: 'hidden is required' }) }).strict();

export const doctorRatingsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .pipe(z.number().int().min(1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().int().min(1).max(100)),
});

// ----------------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------------

export interface RatingSummary {
  /** One decimal; null when there are no visible ratings. */
  rating_average: number | null;
  rating_count: number;
}

export const NO_RATINGS: RatingSummary = { rating_average: null, rating_count: 0 };

/** Visible (not hidden) rating average and count per doctor. */
export async function ratingSummaries(doctorIds: string[]): Promise<Map<string, RatingSummary>> {
  const out = new Map<string, RatingSummary>();
  if (doctorIds.length === 0) return out;
  const rows = await db
    .selectFrom('doctor_ratings')
    .select([
      'doctor_id',
      sql<string>`round(avg(stars)::numeric, 1)`.as('average'),
      sql<string>`count(*)`.as('count'),
    ])
    .where('doctor_id', 'in', [...new Set(doctorIds)])
    .where('hidden_at', 'is', null)
    .groupBy('doctor_id')
    .execute();
  for (const r of rows) out.set(r.doctor_id, { rating_average: Number(r.average), rating_count: Number(r.count) });
  return out;
}

// ----------------------------------------------------------------------------
// SERVICE
// ----------------------------------------------------------------------------

function toRatingDto(row: { stars: number; comment: string | null; created_at: Date }) {
  return { stars: row.stars, comment: row.comment, created_at: row.created_at };
}

export class DoctorRatingService {
  /** POST /dental/appointments/:id/rating - the customer's own visit only. */
  async rateAppointment(customerId: string, appointmentId: string, input: RateAppointmentInput, now: Date = new Date()) {
    let rating;
    try {
      rating = await db.transaction().execute(async (trx) => {
        const appointment = await trx
          .selectFrom('appointments')
          .innerJoin('clinic_doctors', 'clinic_doctors.id', 'appointments.clinic_doctor_id')
          .select([
            'appointments.id',
            'appointments.customer_id',
            'appointments.status',
            'appointments.end_at',
            'clinic_doctors.doctor_id',
            'clinic_doctors.clinic_id',
          ])
          .where('appointments.id', '=', appointmentId)
          .forUpdate('appointments')
          .executeTakeFirst();
        // Same 404 for missing and not-yours (appointment.service.ts).
        if (!appointment || appointment.customer_id !== customerId) {
          throw new AppError('Appointment not found.', 404, 'APPOINTMENT_NOT_FOUND');
        }
        if (appointment.status !== 'CONFIRMED') {
          throw new AppError('Only a confirmed visit can be rated.', 422, 'APPOINTMENT_NOT_RATEABLE', {
            status: appointment.status,
          });
        }
        if (!canRateVisit(appointment, now)) {
          throw new AppError('You can rate this visit once the appointment is over.', 422, 'VISIT_NOT_FINISHED');
        }
        const existing = await trx
          .selectFrom('doctor_ratings')
          .select('id')
          .where('appointment_id', '=', appointmentId)
          .executeTakeFirst();
        if (existing) throw alreadyRated();

        return await trx
          .insertInto('doctor_ratings')
          .values({
            appointment_id: appointmentId,
            doctor_id: appointment.doctor_id,
            clinic_id: appointment.clinic_id,
            customer_id: customerId,
            stars: input.stars,
            comment: input.comment ?? null,
            hidden_at: null,
            hidden_by: null,
          })
          .returning(['stars', 'comment', 'created_at'])
          .executeTakeFirstOrThrow();
      });
    } catch (err) {
      // Two simultaneous submissions: the unique appointment_id settles it.
      if ((err as { code?: string }).code === '23505') throw alreadyRated();
      throw err;
    }
    const appointment = await appointmentService.getOwnedAppointment(customerId, appointmentId);
    return { rating: toRatingDto(rating), appointment };
  }

  /** GET /admin/dental/doctors/:id/ratings - every rating, hidden ones included. */
  async listDoctorRatings(doctorId: string, query: { page: number; limit: number }) {
    const doctor = await db.selectFrom('doctors').select(['id', 'full_name']).where('id', '=', doctorId).executeTakeFirst();
    if (!doctor) throw new AppError('Doctor not found.', 404, 'DOCTOR_NOT_FOUND');

    const [rows, totals, summary] = await Promise.all([
      db
        .selectFrom('doctor_ratings')
        .innerJoin('appointments', 'appointments.id', 'doctor_ratings.appointment_id')
        .innerJoin('dental_clinics', 'dental_clinics.id', 'doctor_ratings.clinic_id')
        .select([
          'doctor_ratings.id',
          'doctor_ratings.appointment_id',
          'doctor_ratings.stars',
          'doctor_ratings.comment',
          'doctor_ratings.created_at',
          'doctor_ratings.hidden_at',
          'appointments.start_at',
          'appointments.patient_name',
          'dental_clinics.id as clinic_id',
          'dental_clinics.name as clinic_name',
        ])
        .where('doctor_ratings.doctor_id', '=', doctorId)
        .orderBy('doctor_ratings.created_at', 'desc')
        .orderBy('doctor_ratings.id')
        .limit(query.limit)
        .offset((query.page - 1) * query.limit)
        .execute(),
      db
        .selectFrom('doctor_ratings')
        .select([sql<string>`count(*)`.as('total'), sql<string>`count(*) FILTER (WHERE hidden_at IS NOT NULL)`.as('hidden')])
        .where('doctor_id', '=', doctorId)
        .executeTakeFirstOrThrow(),
      ratingSummaries([doctorId]),
    ]);
    const total = Number(totals.total);

    return {
      doctor: { id: doctor.id, full_name: doctor.full_name, ...(summary.get(doctorId) ?? NO_RATINGS) },
      hidden_count: Number(totals.hidden),
      ratings: rows.map((r) => ({
        id: r.id,
        appointment_id: r.appointment_id,
        stars: r.stars,
        comment: r.comment,
        created_at: r.created_at,
        hidden_at: r.hidden_at,
        is_hidden: r.hidden_at !== null,
        visit_at: r.start_at,
        patient_name: r.patient_name,
        clinic: { id: r.clinic_id, name: r.clinic_name },
      })),
      pagination: { page: query.page, limit: query.limit, total, total_pages: Math.ceil(total / query.limit) || 1 },
    };
  }

  /** PATCH /admin/dental/ratings/:id/hidden - hide (or show again) one rating. */
  async setHidden(actorId: string, ratingId: string, hidden: boolean) {
    const row = await db
      .updateTable('doctor_ratings')
      .set(hidden ? { hidden_at: new Date(), hidden_by: actorId } : { hidden_at: null, hidden_by: null })
      .where('id', '=', ratingId)
      .returning(['id', 'doctor_id', 'stars', 'comment', 'created_at', 'hidden_at'])
      .executeTakeFirst();
    if (!row) throw new AppError('Rating not found.', 404, 'RATING_NOT_FOUND');
    return { ...row, is_hidden: row.hidden_at !== null };
  }
}

function alreadyRated(): AppError {
  return new AppError('You have already rated this visit.', 409, 'ALREADY_RATED');
}

export const doctorRatingService = new DoctorRatingService();
