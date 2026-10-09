import { describe, it, expect, afterAll } from 'vitest';
import { pool } from '../src/database/connection.js';
import { availabilityService } from '../src/modules/dental/availability.service.js';

/**
 * Task B2 - availability.service.ts slot computation (plan §9.2), tested
 * directly against real fixture rows in the shared dev database (no
 * mocking layer exists in this codebase - see tests/dental-schema-
 * migration.test.ts for the same real-DB-fixture convention this follows).
 *
 * Fixed reference date: 2027-06-07 is a Monday in Asia/Colombo
 * (day_of_week=1, Postgres EXTRACT(DOW) convention) - verified once via
 * luxon directly, not re-derived inside the test, so a bug in the
 * service's own day-of-week mapping cannot mask itself.
 */
describe('availability.service.ts - slot computation', () => {
  const ADMIN_ID = 'a0000001-0000-0000-0000-000000000003';
  const CUSTOMER_ID = 'a0000001-0000-0000-0000-000000000001';
  const MONDAY = '2027-06-07'; // day_of_week = 1
  const TUESDAY = '2027-06-08'; // day_of_week = 2, deliberately never templated
  const createdClinicIds: string[] = [];
  const createdDoctorIds: string[] = [];
  const createdClinicDoctorIds: string[] = [];

  afterAll(async () => {
    // appointments RESTRICTs deletes of its clinic_doctor, so it must go
    // first; doctor_availability/doctor_blocked_dates CASCADE from
    // clinic_doctors and need no explicit delete.
    if (createdClinicDoctorIds.length) {
      await pool.query('DELETE FROM appointments WHERE clinic_doctor_id = ANY($1)', [createdClinicDoctorIds]);
    }
    if (createdClinicIds.length) await pool.query('DELETE FROM clinic_doctors WHERE clinic_id = ANY($1)', [createdClinicIds]);
    if (createdClinicIds.length) await pool.query('DELETE FROM dental_clinics WHERE id = ANY($1)', [createdClinicIds]);
    if (createdDoctorIds.length) await pool.query('DELETE FROM doctors WHERE id = ANY($1)', [createdDoctorIds]);
  });

  async function makeClinicDoctor(): Promise<string> {
    const clinic = await pool.query(
      `INSERT INTO dental_clinics (name, city, address_line, latitude, longitude, contact_phone, operating_start_time, operating_end_time)
       VALUES ('B2 Avail Test Clinic', 'Test City', 'Test Address', 6.5, 80.0, '+94770000002', '08:00', '18:00') RETURNING id`
    );
    const doctor = await pool.query(
      `INSERT INTO doctors (full_name, specialty) VALUES ('Dr B2 Avail Test', 'General dentist') RETURNING id`
    );
    createdClinicIds.push(clinic.rows[0].id);
    createdDoctorIds.push(doctor.rows[0].id);
    const cd = await pool.query(
      `INSERT INTO clinic_doctors (clinic_id, doctor_id, consultation_fee) VALUES ($1, $2, 2000.00) RETURNING id`,
      [clinic.rows[0].id, doctor.rows[0].id]
    );
    createdClinicDoctorIds.push(cd.rows[0].id);
    return cd.rows[0].id as string;
  }

  /** 09:00-10:30 Monday template, 30 min slots, 10 min buffer -> exactly
   * two candidates: 09:00 and 09:40 Asia/Colombo (10:20+30min=10:50 would
   * overshoot the 10:30 window end, so a third candidate never appears). */
  async function makeMondayTemplate(clinicDoctorId: string) {
    await pool.query(
      `INSERT INTO doctor_availability (clinic_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes)
       VALUES ($1, 1, '09:00', '10:30', 30, 10)`,
      [clinicDoctorId]
    );
  }

  async function insertAppointment(
    clinicDoctorId: string,
    startAtUtcIso: string,
    status: string,
    idempotencyKey: string,
    heldUntilUtcIso: string | null = null
  ) {
    await pool.query(
      `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, held_by, held_until, idempotency_key)
       VALUES ($1, $2, $3, $3::timestamptz + interval '30 minutes', $4, $5, $6, $7)`,
      [
        clinicDoctorId,
        CUSTOMER_ID,
        startAtUtcIso,
        status,
        status === 'HELD' ? CUSTOMER_ID : null,
        heldUntilUtcIso,
        idempotencyKey,
      ]
    );
  }

  // 09:00 and 09:40 Asia/Colombo (UTC+5:30, no DST) as UTC instants.
  const SLOT_0900_UTC = '2027-06-07T03:30:00Z';
  const SLOT_0940_UTC = '2027-06-07T04:10:00Z';

  it('a doctor with no template that day returns an empty list', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId); // only Monday (dow=1) is templated

    const result = await availabilityService.computeDaySlots(clinicDoctorId, TUESDAY);

    expect(result.slots).toEqual([]);
    expect(result.blockedReason).toBeNull();
  });

  it('a fully blocked date returns an empty list with the reason surfaced', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId);
    await pool.query(
      `INSERT INTO doctor_blocked_dates (clinic_doctor_id, blocked_date, reason, created_by) VALUES ($1, $2, 'Doctor on leave', $3)`,
      [clinicDoctorId, MONDAY, ADMIN_ID]
    );

    const result = await availabilityService.computeDaySlots(clinicDoctorId, MONDAY);

    expect(result.slots).toEqual([]);
    expect(result.blockedReason).toBe('Doctor on leave');
  });

  it('a template with buffer time produces the correct candidate count and spacing', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId);

    const result = await availabilityService.computeDaySlots(clinicDoctorId, MONDAY);

    expect(result.blockedReason).toBeNull();
    expect(result.slots).toEqual([SLOT_0900_UTC, SLOT_0940_UTC]);
  });

  it('excludes a slot with an existing unexpired CONFIRMED appointment, leaves the other present', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId);
    await insertAppointment(clinicDoctorId, SLOT_0900_UTC, 'CONFIRMED', 'b2-avail-key-confirmed');

    const result = await availabilityService.computeDaySlots(clinicDoctorId, MONDAY);

    expect(result.slots).toEqual([SLOT_0940_UTC]);
  });

  it('excludes a slot with an existing unexpired HELD appointment, leaves the other present', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId);
    const futureHold = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await insertAppointment(clinicDoctorId, SLOT_0940_UTC, 'HELD', 'b2-avail-key-held-active', futureHold);

    const result = await availabilityService.computeDaySlots(clinicDoctorId, MONDAY);

    expect(result.slots).toEqual([SLOT_0900_UTC]);
  });

  it('does NOT exclude a slot whose appointment is EXPIRED', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId);
    await insertAppointment(clinicDoctorId, SLOT_0900_UTC, 'EXPIRED', 'b2-avail-key-expired');

    const result = await availabilityService.computeDaySlots(clinicDoctorId, MONDAY);

    expect(result.slots).toEqual([SLOT_0900_UTC, SLOT_0940_UTC]);
  });

  it('does NOT exclude a slot whose appointment is CANCELLED_BY_CUSTOMER', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId);
    await insertAppointment(clinicDoctorId, SLOT_0940_UTC, 'CANCELLED_BY_CUSTOMER', 'b2-avail-key-cancelled');

    const result = await availabilityService.computeDaySlots(clinicDoctorId, MONDAY);

    expect(result.slots).toEqual([SLOT_0900_UTC, SLOT_0940_UTC]);
  });

  it('does NOT exclude a HELD row whose held_until has already passed (lazy expiry, plan §7.5)', async () => {
    const clinicDoctorId = await makeClinicDoctor();
    await makeMondayTemplate(clinicDoctorId);
    const pastHold = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await insertAppointment(clinicDoctorId, SLOT_0900_UTC, 'HELD', 'b2-avail-key-held-expired', pastHold);

    const result = await availabilityService.computeDaySlots(clinicDoctorId, MONDAY);

    // Still HELD in the DB (B2 never writes/mutates appointments), but the
    // read-time computation must treat the expired hold as free.
    expect(result.slots).toEqual([SLOT_0900_UTC, SLOT_0940_UTC]);
  });

  describe('computeRangeAvailability (calendar view)', () => {
    it('returns hasAvailability=true for the open Monday and false for the untemplated Tuesday and the blocked date', async () => {
      const clinicDoctorId = await makeClinicDoctor();
      // day_of_week=1 applies to every Monday date in the range, including
      // the second one (2027-06-14) - block that one explicitly so the
      // range has a clean true/false/false spread across its 8 days.
      await makeMondayTemplate(clinicDoctorId);
      const secondMonday = '2027-06-14';
      await pool.query(
        `INSERT INTO doctor_blocked_dates (clinic_doctor_id, blocked_date, reason, created_by) VALUES ($1, $2, 'Clinic closed', $3)`,
        [clinicDoctorId, secondMonday, ADMIN_ID]
      );

      const result = await availabilityService.computeRangeAvailability(clinicDoctorId, MONDAY, secondMonday);

      const byDate = new Map(result.map((r) => [r.date, r.hasAvailability]));
      expect(byDate.get(MONDAY)).toBe(true);
      expect(byDate.get(TUESDAY)).toBe(false); // no template
      expect(byDate.get(secondMonday)).toBe(false); // blocked
      expect(result).toHaveLength(8); // 2027-06-07 .. 2027-06-14 inclusive
    });
  });
});
