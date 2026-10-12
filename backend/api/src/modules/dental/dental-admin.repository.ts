import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type { DentalExecutor } from './dental.repository.js';
import { DentalAppointmentStatus, DentalSpecialty } from '../../database/types.js';

/** Postgres unique-constraint names this repository translates into clean
 * domain errors (007_dental_clinic_appointments.sql), the same "catch the
 * constraint by name" pattern appointment.repository.ts already uses for
 * `uq_appointments_active_slot`/`appointments_idempotency_key_key`. */
export const UQ_CLINIC_DOCTORS_PAIRING = 'uq_clinic_doctors_pairing';
export const UQ_DOCTOR_BLOCKED_DATES = 'uq_doctor_blocked_dates';

export interface AdminAppointmentListParams {
  clinicId?: string;
  doctorId?: string;
  status?: DentalAppointmentStatus;
  /** [fromUtc, toUtc) - already resolved to a UTC instant range by the
   * service (clinic-local calendar days, same convention as availability). */
  fromUtc?: Date;
  toUtc?: Date;
  limit: number;
  offset: number;
}

const ADMIN_APPOINTMENT_CONTEXT_COLUMNS = [
  'doctors.id as doctor_id',
  'doctors.full_name as doctor_name',
  'doctors.specialty as doctor_specialty',
  'dental_clinics.id as clinic_id',
  'dental_clinics.name as clinic_name',
  'dental_clinics.city as clinic_city',
] as const;

export class DentalAdminRepository {
  // --------------------------------------------------------------------------
  // CLINICS
  // --------------------------------------------------------------------------

  /** Any clinic, active or not - the admin view (unlike the customer-facing
   * B2 repository, which never returns an inactive row). */
  async findClinicById(id: string) {
    return await db.selectFrom('dental_clinics').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findAllClinicsAdmin(isActive?: boolean) {
    let query = db.selectFrom('dental_clinics').selectAll().orderBy('name', 'asc');
    if (isActive !== undefined) query = query.where('is_active', '=', isActive);
    return await query.execute();
  }

  async createClinic(data: {
    name: string;
    city: string;
    address_line: string;
    latitude: number;
    longitude: number;
    contact_phone: string;
    operating_start_time: string;
    operating_end_time: string;
    is_active?: boolean;
  }) {
    return await db
      .insertInto('dental_clinics')
      .values({ ...data, is_active: data.is_active ?? true })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateClinic(
    id: string,
    data: Partial<{
      name: string;
      city: string;
      address_line: string;
      latitude: number;
      longitude: number;
      contact_phone: string;
      operating_start_time: string;
      operating_end_time: string;
      is_active: boolean;
    }>
  ) {
    const [record] = await db
      .updateTable('dental_clinics')
      .set({ ...data, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .execute();
    return record ?? null;
  }

  // --------------------------------------------------------------------------
  // DOCTORS
  // --------------------------------------------------------------------------

  async findDoctorById(id: string) {
    return await db.selectFrom('doctors').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findAllDoctorsAdmin(isActive?: boolean) {
    let query = db.selectFrom('doctors').selectAll().orderBy('full_name', 'asc');
    if (isActive !== undefined) query = query.where('is_active', '=', isActive);
    return await query.execute();
  }

  async createDoctor(data: {
    full_name: string;
    specialty: DentalSpecialty;
    photo_url?: string | null;
    bio?: string | null;
    is_active?: boolean;
  }) {
    return await db
      .insertInto('doctors')
      .values({
        full_name: data.full_name,
        specialty: data.specialty,
        photo_url: data.photo_url ?? null,
        bio: data.bio ?? null,
        is_active: data.is_active ?? true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateDoctor(
    id: string,
    data: Partial<{
      full_name: string;
      specialty: DentalSpecialty;
      photo_url: string | null;
      bio: string | null;
      is_active: boolean;
    }>
  ) {
    const [record] = await db
      .updateTable('doctors')
      .set({ ...data, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .execute();
    return record ?? null;
  }

  // --------------------------------------------------------------------------
  // CLINIC-DOCTOR RELATIONSHIP
  // --------------------------------------------------------------------------

  async findClinicDoctorById(id: string) {
    return await db.selectFrom('clinic_doctors').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Pre-check used before insert, so the service can return a clean 409
   * without relying solely on the DB catching it (belt-and-suspenders - the
   * `uq_clinic_doctors_pairing` catch below is still the real backstop). */
  async findClinicDoctorPairing(clinicId: string, doctorId: string) {
    return await db
      .selectFrom('clinic_doctors')
      .selectAll()
      .where('clinic_id', '=', clinicId)
      .where('doctor_id', '=', doctorId)
      .executeTakeFirst();
  }

  async createClinicDoctor(data: { clinic_id: string; doctor_id: string; consultation_fee: number | null }) {
    return await db
      .insertInto('clinic_doctors')
      .values({ ...data, is_active: true })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateClinicDoctor(id: string, data: Partial<{ consultation_fee: number | null; is_active: boolean }>) {
    const [record] = await db
      .updateTable('clinic_doctors')
      .set({ ...data, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .execute();
    return record ?? null;
  }

  /** Admin roster for one clinic: every pairing (including inactive), joined
   * to the doctor's own row (also regardless of the doctor's own is_active) -
   * the admin needs to see and re-enable a paused doctor or pairing, unlike
   * the customer-facing findActiveClinicDoctors (dental.repository.ts). */
  async findClinicDoctorRosterAdmin(clinicId: string) {
    return await db
      .selectFrom('clinic_doctors')
      .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
      .select([
        'clinic_doctors.id as clinic_doctor_id',
        'clinic_doctors.consultation_fee',
        'clinic_doctors.is_active as pairing_is_active',
        'doctors.id as doctor_id',
        'doctors.full_name',
        'doctors.specialty',
        'doctors.photo_url',
        'doctors.bio',
        'doctors.is_active as doctor_is_active',
      ])
      .where('clinic_doctors.clinic_id', '=', clinicId)
      .orderBy('doctors.full_name', 'asc')
      .execute();
  }

  // --------------------------------------------------------------------------
  // AVAILABILITY TEMPLATE
  // --------------------------------------------------------------------------

  async findAvailabilityById(id: string) {
    return await db.selectFrom('doctor_availability').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findAvailabilityForClinicDoctorAdmin(clinicDoctorId: string) {
    return await db
      .selectFrom('doctor_availability')
      .selectAll()
      .where('clinic_doctor_id', '=', clinicDoctorId)
      .orderBy('day_of_week', 'asc')
      .orderBy('start_time', 'asc')
      .execute();
  }

  async createAvailability(data: {
    clinic_doctor_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    slot_duration_minutes: number;
    buffer_minutes?: number;
  }) {
    return await db
      .insertInto('doctor_availability')
      .values({ ...data, buffer_minutes: data.buffer_minutes ?? 0 })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateAvailability(
    id: string,
    data: Partial<{
      day_of_week: number;
      start_time: string;
      end_time: string;
      slot_duration_minutes: number;
      buffer_minutes: number;
      is_active: boolean;
    }>
  ) {
    const [record] = await db
      .updateTable('doctor_availability')
      .set({ ...data, updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .execute();
    return record ?? null;
  }

  /** Hard delete - a template row is configuration, not appointment history
   * (see dental-admin.service.ts for the confirmation that appointments store
   * their own start_at/end_at independently). */
  async deleteAvailability(id: string): Promise<boolean> {
    const result = await db.deleteFrom('doctor_availability').where('id', '=', id).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  // --------------------------------------------------------------------------
  // BLOCKED DATES
  // --------------------------------------------------------------------------

  async findBlockedDateById(id: string) {
    return await db.selectFrom('doctor_blocked_dates').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findBlockedDatesForClinicDoctorAdmin(clinicDoctorId: string) {
    return await db
      .selectFrom('doctor_blocked_dates')
      .selectAll()
      .where('clinic_doctor_id', '=', clinicDoctorId)
      .orderBy('blocked_date', 'asc')
      .execute();
  }

  async createBlockedDate(
    data: {
      clinic_doctor_id: string;
      blocked_date: string;
      reason: string;
      created_by: string;
    },
    executor: DentalExecutor = db
  ) {
    return await executor.insertInto('doctor_blocked_dates').values(data).returningAll().executeTakeFirstOrThrow();
  }

  /**
   * Blocking a date ends the live holds on it (security audit 2026-10):
   * held_until moves to now, the module's lazy-expiry convention (EXPIRED is
   * never written), so the hold can neither be confirmed nor reclaimed.
   * CONFIRMED bookings are left for staff to cancel with a reason.
   */
  async expireHoldsBetween(executor: DentalExecutor, clinicDoctorId: string, fromUtc: Date, toUtc: Date) {
    const now = new Date();
    const result = await executor
      .updateTable('appointments')
      .set({ held_until: now, updated_at: now })
      .where('clinic_doctor_id', '=', clinicDoctorId)
      .where('status', '=', 'HELD')
      .where('start_at', '>=', fromUtc)
      .where('start_at', '<', toUtc)
      .where('held_until', '>', now)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async deleteBlockedDate(id: string): Promise<boolean> {
    const result = await db.deleteFrom('doctor_blocked_dates').where('id', '=', id).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  // --------------------------------------------------------------------------
  // ADMIN APPOINTMENT LIST - across all customers/clinics (plan §14/§16)
  // --------------------------------------------------------------------------

  private adminAppointmentBaseQuery() {
    return db
      .selectFrom('appointments')
      .innerJoin('clinic_doctors', 'clinic_doctors.id', 'appointments.clinic_doctor_id')
      .innerJoin('doctors', 'doctors.id', 'clinic_doctors.doctor_id')
      .innerJoin('dental_clinics', 'dental_clinics.id', 'clinic_doctors.clinic_id');
  }

  async findAdminAppointments(params: AdminAppointmentListParams) {
    return await this.adminAppointmentBaseQuery()
      .selectAll('appointments')
      .select([...ADMIN_APPOINTMENT_CONTEXT_COLUMNS])
      .$if(params.clinicId !== undefined, (qb) => qb.where('dental_clinics.id', '=', params.clinicId!))
      .$if(params.doctorId !== undefined, (qb) => qb.where('doctors.id', '=', params.doctorId!))
      .$if(params.status !== undefined, (qb) => qb.where('appointments.status', '=', params.status!))
      .$if(params.fromUtc !== undefined, (qb) => qb.where('appointments.start_at', '>=', params.fromUtc!))
      .$if(params.toUtc !== undefined, (qb) => qb.where('appointments.start_at', '<', params.toUtc!))
      .orderBy('appointments.start_at', 'desc')
      .orderBy('appointments.id', 'asc')
      .limit(params.limit)
      .offset(params.offset)
      .execute();
  }

  async countAdminAppointments(params: Omit<AdminAppointmentListParams, 'limit' | 'offset'>): Promise<number> {
    const result = await this.adminAppointmentBaseQuery()
      .select(sql<string>`count(*)`.as('count'))
      .$if(params.clinicId !== undefined, (qb) => qb.where('dental_clinics.id', '=', params.clinicId!))
      .$if(params.doctorId !== undefined, (qb) => qb.where('doctors.id', '=', params.doctorId!))
      .$if(params.status !== undefined, (qb) => qb.where('appointments.status', '=', params.status!))
      .$if(params.fromUtc !== undefined, (qb) => qb.where('appointments.start_at', '>=', params.fromUtc!))
      .$if(params.toUtc !== undefined, (qb) => qb.where('appointments.start_at', '<', params.toUtc!))
      .executeTakeFirst();
    return result ? parseInt(result.count, 10) : 0;
  }
}

export const dentalAdminRepository = new DentalAdminRepository();
