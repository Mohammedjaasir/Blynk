import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import { Database, DentalAppointmentStatus } from '../../database/types.js';

/** An open booking transaction. Every mutating query in this file takes one:
 * a hold/confirm/cancel is never allowed to touch `appointments` outside the
 * transaction that locked the row (plan §7.3). */
export type AppointmentTrx = Transaction<Database>;

/** Statuses that occupy a slot - mirrors `uq_appointments_active_slot`'s
 * predicate exactly. If these ever diverge the index stops being the
 * backstop the pre-check believes it is. */
export const OCCUPYING_STATUSES: DentalAppointmentStatus[] = ['HELD', 'CONFIRMED'];

/** Postgres constraint names the booking flow translates into domain errors. */
export const UQ_ACTIVE_SLOT = 'uq_appointments_active_slot';
export const UQ_IDEMPOTENCY_KEY = 'appointments_idempotency_key_key';

export interface InsertHoldValues {
  clinic_doctor_id: string;
  customer_id: string;
  start_at: Date;
  end_at: Date;
  held_by: string;
  held_until: Date;
  consultation_fee_snapshot: number | null;
  idempotency_key: string;
}

/** `start_at`/`end_at` are deliberately absent: a reclaim reuses the row's
 * existing window, it never redefines which slot the row is for. */
export interface ReclaimHoldValues {
  customer_id: string;
  held_by: string;
  held_until: Date;
  consultation_fee_snapshot: number | null;
  idempotency_key: string;
}

export interface ConfirmValues {
  patient_name: string;
  patient_phone: string;
  patient_notes: string | null;
}

export interface CancelValues {
  status: Extract<DentalAppointmentStatus, 'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_CLINIC'>;
  cancellation_reason: string | null;
  cancelled_by: string;
}

export interface AppointmentFilters {
  status?: DentalAppointmentStatus;
  bucket?: 'upcoming' | 'past';
  /** One instant shared by the list and its count, so the two can never
   * bucket a row that straddles `now` differently. */
  now: Date;
}

export interface AppointmentListParams extends AppointmentFilters {
  customerId: string;
  limit: number;
  offset: number;
}

/** The clinic/doctor context every appointment view carries, so the customer
 * app does not have to re-fetch discovery data per row. All of it is already
 * public through B2's endpoints. */
const CONTEXT_COLUMNS = [
  'doctors.id as doctor_id',
  'doctors.full_name as doctor_name',
  'doctors.specialty as doctor_specialty',
  'doctors.photo_url as doctor_photo_url',
  'dental_clinics.id as clinic_id',
  'dental_clinics.name as clinic_name',
  'dental_clinics.city as clinic_city',
  'dental_clinics.address_line as clinic_address_line',
] as const;

/** The appointment's rating (null columns when it has none). */
const RATING_COLUMNS = [
  'doctor_ratings.stars as rating_stars',
  'doctor_ratings.comment as rating_comment',
  'doctor_ratings.created_at as rating_created_at',
] as const;

export class AppointmentRepository {
  // --------------------------------------------------------------------------
  // BOOKING-TIME READS (inside the transaction)
  // --------------------------------------------------------------------------

  /**
   * The clinic-doctor pairing a hold is allowed to be created against, and
   * the fee snapshot's source of truth. All three legs must be active: a
   * paused pairing, a deactivated doctor or a closed clinic is not bookable.
   * Resolving it here also means a bogus `clinic_doctor_id` becomes a clean
   * 404 instead of a raw FK violation.
   */
  async findBookableClinicDoctor(clinicDoctorId: string, trx: AppointmentTrx) {
    return await trx
      .selectFrom('clinic_doctors')
      .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
      .innerJoin('dental_clinics', 'dental_clinics.id', 'clinic_doctors.clinic_id')
      .select(['clinic_doctors.id as id', 'clinic_doctors.consultation_fee'])
      .where('clinic_doctors.id', '=', clinicDoctorId)
      .where('clinic_doctors.is_active', '=', true)
      .where('doctors.is_active', '=', true)
      .where('dental_clinics.is_active', '=', true)
      .executeTakeFirst();
  }

  /**
   * Step 1 of the hold flow: lock whatever row currently occupies this exact
   * `(clinic_doctor_id, start_at)`. `FOR UPDATE` serialises every *further*
   * attempt against an existing row; it cannot protect two brand-new inserts
   * (there is no row to lock yet) - that case is the partial unique index's,
   * caught as 23505 by the caller.
   */
  async lockActiveSlotRow(trx: AppointmentTrx, clinicDoctorId: string, startAt: Date) {
    return await trx
      .selectFrom('appointments')
      .selectAll()
      .where('clinic_doctor_id', '=', clinicDoctorId)
      .where('start_at', '=', startAt)
      .where('status', 'in', OCCUPYING_STATUSES)
      .forUpdate()
      .executeTakeFirst();
  }

  /** Locks one appointment by id for confirm/cancel. Ownership is decided by
   * the caller against the locked row, never by the WHERE clause, so
   * "missing" and "someone else's" can be answered with the same 404. */
  async lockAppointmentById(trx: AppointmentTrx, id: string) {
    return await trx
      .selectFrom('appointments')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
  }

  /**
   * B5: the clinic/doctor names a confirm/cancel notification message needs.
   * Read-only reference data, not the row under mutation, so it takes no
   * lock - it must still run on the caller's `trx` (not the module-level
   * `db`), for the same pool-exhaustion reason `resolveOpenSlot` was
   * threaded through in B3 (§2 of task-B3-report.md): a second connection
   * borrowed mid-transaction can self-deadlock the pool under concurrency.
   */
  async findNotificationContext(trx: AppointmentTrx, clinicDoctorId: string) {
    return await trx
      .selectFrom('clinic_doctors')
      .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
      .innerJoin('dental_clinics', 'dental_clinics.id', 'clinic_doctors.clinic_id')
      .select(['doctors.full_name as doctor_name', 'dental_clinics.name as clinic_name'])
      .where('clinic_doctors.id', '=', clinicDoctorId)
      .executeTakeFirst();
  }

  // --------------------------------------------------------------------------
  // BOOKING-TIME WRITES (inside the transaction)
  // --------------------------------------------------------------------------

  async insertHold(trx: AppointmentTrx, values: InsertHoldValues) {
    return await trx
      .insertInto('appointments')
      .values({ ...values, status: 'HELD' })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Reclaims an existing HELD row (expired, or already this customer's)
   * rather than inserting a second one - so a slot never has two rows, even
   * transiently. `customer_id` moves with `held_by`: B1 keeps the two equal,
   * and ownership everywhere else is decided on `customer_id`, so leaving it
   * pointing at the previous holder would hand them a row they no longer
   * hold. Patient fields are reset defensively; a HELD row never carries them.
   */
  async reclaimHold(trx: AppointmentTrx, id: string, values: ReclaimHoldValues) {
    return await trx
      .updateTable('appointments')
      .set({
        ...values,
        status: 'HELD',
        patient_name: null,
        patient_phone: null,
        patient_notes: null,
        cancellation_reason: null,
        cancelled_by: null,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async confirmAppointment(trx: AppointmentTrx, id: string, values: ConfirmValues) {
    return await trx
      .updateTable('appointments')
      .set({
        ...values,
        status: 'CONFIRMED',
        held_until: null, // a confirmed row is no longer time-limited
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async cancelAppointment(trx: AppointmentTrx, id: string, values: CancelValues) {
    return await trx
      .updateTable('appointments')
      .set({ ...values, held_until: null, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async insertStatusHistory(
    trx: AppointmentTrx,
    entry: {
      appointment_id: string;
      old_status: DentalAppointmentStatus | null;
      new_status: DentalAppointmentStatus;
      changed_by: string;
    }
  ) {
    await trx.insertInto('appointment_status_history').values(entry).execute();
  }

  // --------------------------------------------------------------------------
  // READS OUTSIDE THE TRANSACTION
  // --------------------------------------------------------------------------

  /**
   * Idempotency replay (order.service.ts `createOrder`'s pattern): the same
   * customer retrying with the same key gets their existing live booking
   * back instead of a second one. Scoped to the customer as well as the key
   * so a guessed/leaked key can never replay someone else's appointment.
   */
  async findReplayableByIdempotencyKey(customerId: string, idempotencyKey: string) {
    return await this.detailQuery()
      .where('appointments.customer_id', '=', customerId)
      .where('appointments.idempotency_key', '=', idempotencyKey)
      .where('appointments.status', 'in', OCCUPYING_STATUSES)
      .executeTakeFirst();
  }

  /** Single appointment, always scoped to its owner. */
  async findOwnedAppointment(id: string, customerId: string) {
    return await this.detailQuery()
      .where('appointments.id', '=', id)
      .where('appointments.customer_id', '=', customerId)
      .executeTakeFirst();
  }

  /** Single appointment, unscoped - admin only. */
  async findAppointmentById(id: string) {
    return await this.detailQuery().where('appointments.id', '=', id).executeTakeFirst();
  }

  async findCustomerAppointments(params: AppointmentListParams) {
    // Upcoming reads soonest-first (what the customer acts on next);
    // everything else reads newest-first.
    return await this.detailQuery()
      .where('appointments.customer_id', '=', params.customerId)
      .$if(params.status !== undefined, (qb) => qb.where('appointments.status', '=', params.status!))
      .$if(params.bucket !== undefined, (qb) =>
        qb.where('appointments.start_at', params.bucket === 'upcoming' ? '>=' : '<', params.now)
      )
      .orderBy('appointments.start_at', params.bucket === 'upcoming' ? 'asc' : 'desc')
      .orderBy('appointments.id', 'asc')
      .limit(params.limit)
      .offset(params.offset)
      .execute();
  }

  async countCustomerAppointments(params: AppointmentFilters & { customerId: string }): Promise<number> {
    const result = await db
      .selectFrom('appointments')
      .select(sql<string>`count(*)`.as('count'))
      .where('appointments.customer_id', '=', params.customerId)
      .$if(params.status !== undefined, (qb) => qb.where('appointments.status', '=', params.status!))
      .$if(params.bucket !== undefined, (qb) =>
        qb.where('appointments.start_at', params.bucket === 'upcoming' ? '>=' : '<', params.now)
      )
      .executeTakeFirst();
    return result ? parseInt(result.count, 10) : 0;
  }

  /** `appointments` joined to the clinic/doctor context both views return. */
  private detailQuery() {
    return db
      .selectFrom('appointments')
      .innerJoin('clinic_doctors', 'clinic_doctors.id', 'appointments.clinic_doctor_id')
      .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
      .innerJoin('dental_clinics', 'dental_clinics.id', 'clinic_doctors.clinic_id')
      // Migration 023: the customer's own rating of this visit, if any.
      .leftJoin('doctor_ratings', 'doctor_ratings.appointment_id', 'appointments.id')
      .selectAll('appointments')
      .select([...CONTEXT_COLUMNS, ...RATING_COLUMNS]);
  }
}

export const appointmentRepository = new AppointmentRepository();
