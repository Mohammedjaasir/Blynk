import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/database/connection.js';
import { runMigrations } from '../src/database/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Task B1 - dental clinic/appointment schema (migration 007).
 *
 * This is the one migration-shape test in the suite (no direct precedent
 * existed for 001-006), so it does double duty: it proves the migration
 * applies through the project's real migration command, that the seven
 * tables + two enums exist with the columns the rest of this feature will
 * depend on, that `uq_appointments_active_slot` is the database-enforced
 * double-booking guarantee the plan calls for (§7.2), and that the down
 * migration's SQL genuinely reverses the schema - verified against a real
 * running Postgres, not just read as text.
 *
 * The down-migration check runs inside a transaction that is always rolled
 * back: this suite shares the persistent dev database with every other
 * task in this feature (later tasks build on these tables), so it must
 * prove reversibility without actually leaving the schema dropped.
 */
describe('Dental schema migration (007)', () => {
  const ADMIN_ID = 'a0000001-0000-0000-0000-000000000003';
  const CUSTOMER_ID = 'a0000001-0000-0000-0000-000000000001';
  const createdClinicIds: string[] = [];
  const createdDoctorIds: string[] = [];

  beforeAll(async () => {
    // Exercises the project's actual migration command. Already applied by
    // the time this suite runs in a normal `npm test` pass, so this is a
    // no-op skip - proving the mechanism is idempotent, not just present.
    await runMigrations('up');
  });

  afterAll(async () => {
    // clinic_doctors RESTRICTs deletes of its clinic/doctor, so it must go
    // first; each test already deletes its own appointments/blocked-dates.
    if (createdClinicIds.length) await pool.query('DELETE FROM clinic_doctors WHERE clinic_id = ANY($1)', [createdClinicIds]);
    if (createdClinicIds.length) await pool.query('DELETE FROM dental_clinics WHERE id = ANY($1)', [createdClinicIds]);
    if (createdDoctorIds.length) await pool.query('DELETE FROM doctors WHERE id = ANY($1)', [createdDoctorIds]);
  });

  async function makeClinicDoctor() {
    const clinic = await pool.query(
      `INSERT INTO dental_clinics (name, city, address_line, latitude, longitude, contact_phone, operating_start_time, operating_end_time)
       VALUES ('B1 Test Clinic', 'Test City', 'Test Address', 6.5, 80.0, '+94770000001', '09:00', '17:00') RETURNING id`
    );
    const doctor = await pool.query(
      `INSERT INTO doctors (full_name, specialty) VALUES ('Dr B1 Test', 'General dentist') RETURNING id`
    );
    createdClinicIds.push(clinic.rows[0].id);
    createdDoctorIds.push(doctor.rows[0].id);
    const cd = await pool.query(
      `INSERT INTO clinic_doctors (clinic_id, doctor_id, consultation_fee) VALUES ($1, $2, 1500.00) RETURNING id`,
      [clinic.rows[0].id, doctor.rows[0].id]
    );
    return cd.rows[0].id as string;
  }

  describe('shape', () => {
    it('creates the seven dental tables', async () => {
      const { rows } = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
        [
          [
            'dental_clinics',
            'doctors',
            'clinic_doctors',
            'doctor_availability',
            'doctor_blocked_dates',
            'appointments',
            'appointment_status_history',
          ],
        ]
      );
      expect(rows.map((r) => r.table_name).sort()).toEqual(
        [
          'appointment_status_history',
          'appointments',
          'clinic_doctors',
          'dental_clinics',
          'doctor_availability',
          'doctor_blocked_dates',
          'doctors',
        ].sort()
      );
    });

    it('keeps the appointment status enum; the specialty enum is gone (migration 030)', async () => {
      // 2026-10-09 (owner): a doctor's specialty is free text - migration 030
      // turned doctors.specialty into VARCHAR(64) and dropped dental_specialty_enum.
      const specialtyType = await pool.query(`SELECT typname FROM pg_type WHERE typname = 'dental_specialty_enum'`);
      expect(specialtyType.rows).toHaveLength(0);
      const column = await pool.query(
        `SELECT data_type, character_maximum_length, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'doctors' AND column_name = 'specialty'`
      );
      expect(column.rows[0]).toEqual({ data_type: 'character varying', character_maximum_length: 64, is_nullable: 'NO' });

      const status = await pool.query(
        `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'dental_appointment_status_enum' ORDER BY e.enumsortorder`
      );
      expect(status.rows.map((r) => r.enumlabel)).toEqual([
        'HELD',
        'EXPIRED',
        'CONFIRMED',
        'CANCELLED_BY_CUSTOMER',
        'CANCELLED_BY_CLINIC',
      ]);
    });

    it('has the key columns on appointments', async () => {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'appointments'`
      );
      const columns = rows.map((r) => r.column_name);
      for (const expected of [
        'id',
        'clinic_doctor_id',
        'customer_id',
        'start_at',
        'end_at',
        'status',
        'held_by',
        'held_until',
        'patient_name',
        'patient_phone',
        'patient_notes',
        'consultation_fee_snapshot',
        'cancellation_reason',
        'cancelled_by',
        'idempotency_key',
        'created_at',
        'updated_at',
      ]) {
        expect(columns).toContain(expected);
      }
    });

    it('has the uq_appointments_active_slot partial unique index scoped to HELD/CONFIRMED', async () => {
      const { rows } = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'appointments' AND indexname = 'uq_appointments_active_slot'`
      );
      expect(rows).toHaveLength(1);
      const def = rows[0].indexdef as string;
      expect(def).toContain('UNIQUE INDEX');
      expect(def).toContain('(clinic_doctor_id, start_at)');
      expect(def).toContain('HELD');
      expect(def).toContain('CONFIRMED');
    });
  });

  describe('uq_appointments_active_slot behaviour (double-booking guarantee)', () => {
    it('rejects a second HELD row for the same clinic_doctor_id + start_at', async () => {
      const clinicDoctorId = await makeClinicDoctor();
      const startAt = '2027-03-01T10:00:00Z';
      const endAt = '2027-03-01T10:30:00Z';
      await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'HELD', 'b1-test-key-1')`,
        [clinicDoctorId, CUSTOMER_ID, startAt, endAt]
      );

      await expect(
        pool.query(
          `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
           VALUES ($1, $2, $3, $4, 'CONFIRMED', 'b1-test-key-2')`,
          [clinicDoctorId, CUSTOMER_ID, startAt, endAt]
        )
      ).rejects.toMatchObject({ code: '23505' });

      await pool.query(`DELETE FROM appointments WHERE clinic_doctor_id = $1`, [clinicDoctorId]);
    });

    it('rejects a HELD row conflicting with an existing CONFIRMED row for the same slot', async () => {
      const clinicDoctorId = await makeClinicDoctor();
      const startAt = '2027-03-02T11:00:00Z';
      const endAt = '2027-03-02T11:30:00Z';
      await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'CONFIRMED', 'b1-test-key-3')`,
        [clinicDoctorId, CUSTOMER_ID, startAt, endAt]
      );

      await expect(
        pool.query(
          `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
           VALUES ($1, $2, $3, $4, 'HELD', 'b1-test-key-4')`,
          [clinicDoctorId, CUSTOMER_ID, startAt, endAt]
        )
      ).rejects.toMatchObject({ code: '23505' });

      await pool.query(`DELETE FROM appointments WHERE clinic_doctor_id = $1`, [clinicDoctorId]);
    });

    it('allows a second CANCELLED_BY_CUSTOMER row for the same slot once the active one is cancelled (slot reopens)', async () => {
      const clinicDoctorId = await makeClinicDoctor();
      const startAt = '2027-03-03T12:00:00Z';
      const endAt = '2027-03-03T12:30:00Z';
      await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'CANCELLED_BY_CUSTOMER', 'b1-test-key-5')`,
        [clinicDoctorId, CUSTOMER_ID, startAt, endAt]
      );
      // A second, independent cancelled row for the exact same slot must be
      // allowed - the partial index's WHERE clause excludes both.
      await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'EXPIRED', 'b1-test-key-6')`,
        [clinicDoctorId, CUSTOMER_ID, startAt, endAt]
      );
      // And a fresh HELD row for that now-open slot must succeed too.
      await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'HELD', 'b1-test-key-7')`,
        [clinicDoctorId, CUSTOMER_ID, startAt, endAt]
      );

      const { rows } = await pool.query(`SELECT status FROM appointments WHERE clinic_doctor_id = $1`, [clinicDoctorId]);
      expect(rows).toHaveLength(3);

      await pool.query(`DELETE FROM appointments WHERE clinic_doctor_id = $1`, [clinicDoctorId]);
    });

    it('does not contend across different clinic_doctor_id for the same start_at', async () => {
      const cdA = await makeClinicDoctor();
      const cdB = await makeClinicDoctor();
      const startAt = '2027-03-04T09:00:00Z';
      const endAt = '2027-03-04T09:30:00Z';
      await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'HELD', 'b1-test-key-8')`,
        [cdA, CUSTOMER_ID, startAt, endAt]
      );
      await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, $3, $4, 'HELD', 'b1-test-key-9')`,
        [cdB, CUSTOMER_ID, startAt, endAt]
      );

      await pool.query(`DELETE FROM appointments WHERE clinic_doctor_id = ANY($1)`, [[cdA, cdB]]);
    });
  });

  describe('doctor_blocked_dates and appointment_status_history FKs', () => {
    it('enforces UNIQUE(clinic_doctor_id, blocked_date)', async () => {
      const clinicDoctorId = await makeClinicDoctor();
      await pool.query(
        `INSERT INTO doctor_blocked_dates (clinic_doctor_id, blocked_date, reason, created_by)
         VALUES ($1, '2027-04-01', 'Leave', $2)`,
        [clinicDoctorId, ADMIN_ID]
      );
      await expect(
        pool.query(
          `INSERT INTO doctor_blocked_dates (clinic_doctor_id, blocked_date, reason, created_by)
           VALUES ($1, '2027-04-01', 'Holiday', $2)`,
          [clinicDoctorId, ADMIN_ID]
        )
      ).rejects.toMatchObject({ code: '23505' });

      await pool.query(`DELETE FROM doctor_blocked_dates WHERE clinic_doctor_id = $1`, [clinicDoctorId]);
    });

    it('records a status-history row referencing an appointment and the actor who changed it', async () => {
      const clinicDoctorId = await makeClinicDoctor();
      const appt = await pool.query(
        `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, idempotency_key)
         VALUES ($1, $2, '2027-03-05T09:00:00Z', '2027-03-05T09:30:00Z', 'HELD', 'b1-test-key-10') RETURNING id`,
        [clinicDoctorId, CUSTOMER_ID]
      );
      const appointmentId = appt.rows[0].id;
      await pool.query(
        `INSERT INTO appointment_status_history (appointment_id, old_status, new_status, changed_by)
         VALUES ($1, NULL, 'HELD', $2)`,
        [appointmentId, CUSTOMER_ID]
      );
      const { rows } = await pool.query(
        `SELECT old_status, new_status, changed_by FROM appointment_status_history WHERE appointment_id = $1`,
        [appointmentId]
      );
      expect(rows).toEqual([{ old_status: null, new_status: 'HELD', changed_by: CUSTOMER_ID }]);

      // appointment_status_history rows cascade with the appointment.
      await pool.query(`DELETE FROM appointments WHERE id = $1`, [appointmentId]);
      const after = await pool.query(`SELECT 1 FROM appointment_status_history WHERE appointment_id = $1`, [appointmentId]);
      expect(after.rows).toHaveLength(0);
    });
  });

  describe('migration 030 (doctor specialty free text)', () => {
    it('down maps the labels back to the enum (others -> GENERAL_DENTIST) and up maps them forward again (rolled back, never persisted)', async () => {
      const read = (name: string) =>
        fs.readFileSync(path.join(__dirname, '../src/database/migrations', name), 'utf-8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO doctors (full_name, specialty) VALUES
             ('Dr 030 A', 'Orthodontist'), ('Dr 030 B', 'Oral surgeon'), ('Dr 030 C', 'Cosmetic dentist')
           RETURNING id`
        );
        const ids = inserted.rows.map((r) => r.id);
        const specialties = async () =>
          (
            await client.query(
              `SELECT specialty::text AS specialty FROM doctors WHERE id = ANY($1) ORDER BY full_name`,
              [ids]
            )
          ).rows.map((r) => r.specialty);

        await client.query(read('030_doctor_specialty_free_text_down.sql'));
        expect(await specialties()).toEqual(['ORTHODONTIST', 'ORAL_SURGEON', 'GENERAL_DENTIST']);

        await client.query(read('030_doctor_specialty_free_text.sql'));
        expect(await specialties()).toEqual(['Orthodontist', 'Oral surgeon', 'General dentist']);
        const enumType = await client.query(`SELECT typname FROM pg_type WHERE typname = 'dental_specialty_enum'`);
        expect(enumType.rows).toHaveLength(0);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('down migration (007_dental_clinic_appointments_down.sql)', () => {
    it('reverses the schema cleanly against the real database (rolled back, never persisted)', async () => {
      const downSql = fs.readFileSync(
        path.join(__dirname, '../src/database/migrations/007_dental_clinic_appointments_down.sql'),
        'utf-8'
      );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(downSql);

        const { rows } = await client.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ANY($1)`,
          [
            [
              'dental_clinics',
              'doctors',
              'clinic_doctors',
              'doctor_availability',
              'doctor_blocked_dates',
              'appointments',
              'appointment_status_history',
            ],
          ]
        );
        expect(rows).toHaveLength(0);

        const enums = await client.query(
          `SELECT typname FROM pg_type WHERE typname IN ('dental_specialty_enum', 'dental_appointment_status_enum')`
        );
        expect(enums.rows).toHaveLength(0);
      } finally {
        // Always roll back: this is the shared dev database and later tasks
        // in this feature depend on the schema staying applied.
        await client.query('ROLLBACK');
        client.release();
      }

      // Prove the rollback actually restored everything for the rest of the suite.
      const { rows } = await pool.query(`SELECT to_regclass('public.appointments') AS reg`);
      expect(rows[0].reg).toBe('appointments');
    });
  });
});
