import { sql, type Kysely } from 'kysely';
import { db } from '../../database/connection.js';
import { Database, DentalAppointmentStatus } from '../../database/types.js';

export interface ClinicListParams {
  city?: string;
  search?: string;
  limit: number;
  offset: number;
}

/**
 * Either the shared pool handle or an open transaction. B3's hold flow
 * re-runs the availability reads *inside* its booking transaction, so they
 * must be able to run on that transaction's own connection - borrowing a
 * second pool connection while holding a row lock is how a 20-connection
 * pool deadlocks itself under concurrency. `Transaction<Database>` is a
 * `Kysely<Database>`, so one type covers both. Defaults to `db`, so every
 * B2 caller is unchanged.
 */
export type DentalExecutor = Kysely<Database>;

/** Statuses that hold a slot - see plan §7.2/§9.2 step 4. Mirrors the
 * partial unique index's predicate on `appointments`. */
const OCCUPYING_STATUSES: DentalAppointmentStatus[] = ['HELD', 'CONFIRMED'];

export class DentalRepository {
  // --------------------------------------------------------------------------
  // CLINICS
  // --------------------------------------------------------------------------

  /** Customer: active clinics only, optionally filtered by city/search. */
  async findActiveClinics(params: ClinicListParams) {
    let query = db.selectFrom('dental_clinics').selectAll().where('is_active', '=', true);

    if (params.city) {
      query = query.where('city', 'ilike', `%${params.city}%`);
    }
    if (params.search) {
      const pattern = `%${params.search}%`;
      query = query.where((eb) =>
        eb.or([eb('name', 'ilike', pattern), eb('address_line', 'ilike', pattern)])
      );
    }

    return await query.orderBy('name', 'asc').limit(params.limit).offset(params.offset).execute();
  }

  async countActiveClinics(params: Omit<ClinicListParams, 'limit' | 'offset'>): Promise<number> {
    let query = db
      .selectFrom('dental_clinics')
      .select(sql<string>`count(*)`.as('count'))
      .where('is_active', '=', true);

    if (params.city) {
      query = query.where('city', 'ilike', `%${params.city}%`);
    }
    if (params.search) {
      const pattern = `%${params.search}%`;
      query = query.where((eb) =>
        eb.or([eb('name', 'ilike', pattern), eb('address_line', 'ilike', pattern)])
      );
    }

    const result = await query.executeTakeFirst();
    return result ? parseInt(result.count, 10) : 0;
  }

  /** Customer: a single active clinic by id. Same query shape whether the
   * id doesn't exist or is inactive - caller (service) turns "no row" into
   * one uniform 404, never leaking which case it was. */
  async findActiveClinicById(id: string) {
    return await db
      .selectFrom('dental_clinics')
      .selectAll()
      .where('id', '=', id)
      .where('is_active', '=', true)
      .executeTakeFirst();
  }

  // --------------------------------------------------------------------------
  // DOCTORS
  // --------------------------------------------------------------------------

  async findActiveDoctorById(id: string) {
    return await db
      .selectFrom('doctors')
      .selectAll()
      .where('id', '=', id)
      .where('is_active', '=', true)
      .executeTakeFirst();
  }

  /** Active doctors working at a clinic, with their clinic-scoped fee. */
  async findActiveClinicDoctors(clinicId: string) {
    return await db
      .selectFrom('clinic_doctors')
      .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
      .select([
        'clinic_doctors.id as clinic_doctor_id',
        'clinic_doctors.consultation_fee',
        'doctors.id as doctor_id',
        'doctors.full_name',
        'doctors.specialty',
        'doctors.photo_url',
        'doctors.bio',
      ])
      .where('clinic_doctors.clinic_id', '=', clinicId)
      .where('clinic_doctors.is_active', '=', true)
      .where('doctors.is_active', '=', true)
      .orderBy('doctors.full_name', 'asc')
      .execute();
  }

  /** Active clinics a doctor works at, each with its own fee (plan §8.2:
   * fee is scoped to the clinic-doctor pairing, not the doctor globally). */
  async findActiveDoctorClinics(doctorId: string) {
    return await db
      .selectFrom('clinic_doctors')
      .innerJoin('dental_clinics', 'dental_clinics.id', 'clinic_doctors.clinic_id')
      .select([
        'clinic_doctors.id as clinic_doctor_id',
        'clinic_doctors.consultation_fee',
        'dental_clinics.id as clinic_id',
        'dental_clinics.name',
        'dental_clinics.city',
        'dental_clinics.address_line',
        'dental_clinics.latitude',
        'dental_clinics.longitude',
      ])
      .where('clinic_doctors.doctor_id', '=', doctorId)
      .where('clinic_doctors.is_active', '=', true)
      .where('dental_clinics.is_active', '=', true)
      .orderBy('dental_clinics.name', 'asc')
      .execute();
  }

  /** The one relationship row a slots/availability request is allowed to
   * compute against: doctor active, clinic active, and the pairing itself
   * active. Missing any leg => undefined => caller 404s, never silently
   * computes availability against a non-relationship (brief's rule). */
  async findActiveClinicDoctorRelationship(doctorId: string, clinicId: string) {
    return await db
      .selectFrom('clinic_doctors')
      .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
      .innerJoin('dental_clinics', 'dental_clinics.id', 'clinic_doctors.clinic_id')
      .select(['clinic_doctors.id as clinic_doctor_id', 'clinic_doctors.consultation_fee'])
      .where('clinic_doctors.doctor_id', '=', doctorId)
      .where('clinic_doctors.clinic_id', '=', clinicId)
      .where('clinic_doctors.is_active', '=', true)
      .where('doctors.is_active', '=', true)
      .where('dental_clinics.is_active', '=', true)
      .executeTakeFirst();
  }

  // --------------------------------------------------------------------------
  // AVAILABILITY (template + blocked dates + occupied appointments)
  // --------------------------------------------------------------------------

  /** The weekly template row(s) for one clinic-doctor pairing on one
   * day-of-week (0=Sunday..6=Saturday, Postgres EXTRACT(DOW) convention). */
  async findAvailabilityTemplate(clinicDoctorId: string, dayOfWeek: number, executor: DentalExecutor = db) {
    return await executor
      .selectFrom('doctor_availability')
      .selectAll()
      .where('clinic_doctor_id', '=', clinicDoctorId)
      .where('day_of_week', '=', dayOfWeek)
      .where('is_active', '=', true)
      .orderBy('start_time', 'asc')
      .execute();
  }

  /** A blocked-date exception for one exact calendar date, if any. */
  async findBlockedDate(clinicDoctorId: string, date: string, executor: DentalExecutor = db) {
    return await executor
      .selectFrom('doctor_blocked_dates')
      .selectAll()
      .where('clinic_doctor_id', '=', clinicDoctorId)
      .where('blocked_date', '=', date)
      .executeTakeFirst();
  }

  /** HELD/CONFIRMED appointments whose start_at falls within [dayStartUtc,
   * dayEndUtc). Held-expiry (`held_until`) is NOT filtered here - it's
   * enforced lazily by the caller (plan §7.5), so a HELD row past its
   * held_until still comes back and the availability computation decides
   * whether it still counts as occupying the slot. */
  async findOccupyingAppointments(
    clinicDoctorId: string,
    dayStartUtc: Date,
    dayEndUtc: Date,
    executor: DentalExecutor = db,
    excludeAppointmentId?: string
  ) {
    let q = executor
      .selectFrom('appointments')
      .select(['start_at', 'status', 'held_until'])
      .where('clinic_doctor_id', '=', clinicDoctorId)
      .where('start_at', '>=', dayStartUtc)
      .where('start_at', '<', dayEndUtc)
      .where('status', 'in', OCCUPYING_STATUSES);
    // A reclaim re-checks its own locked row's slot: that row is not "someone else".
    if (excludeAppointmentId) q = q.where('id', '!=', excludeAppointmentId);
    return await q.execute();
  }
}

export const dentalRepository = new DentalRepository();
