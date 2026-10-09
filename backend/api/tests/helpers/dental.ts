import { pool } from '../../src/database/connection.js';
import { generateAccessToken } from '../../src/modules/auth/token.service.js';

/**
 * Test-owned dental fixtures for task B3 (booking lifecycle). Every row a
 * test file creates through here is removed by `cleanup()` in FK-safe order,
 * and `purge()` first clears leftovers of an aborted earlier run - the same
 * discipline tests/helpers/stock.ts follows, because this suite runs against
 * the shared dev database (see task-B1-report.md's concern).
 */

/** Seeded admin (tests/helpers/stock.ts's `users.admin`). */
export const ADMIN = {
  id: 'a0000001-0000-0000-0000-000000000003',
  phone: '+94775551122',
  role: 'ADMIN' as const,
};
export const adminToken = generateAccessToken(ADMIN);
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface TestCustomer {
  id: string;
  phone: string;
  token: string;
}

export interface SlotFixture {
  clinicId: string;
  doctorId: string;
  clinicDoctorId: string;
  /** ISO-8601 UTC instants that are genuinely on the template. */
  slots: string[];
  fee: number;
}

/**
 * A fixed Monday far enough in the future that no test ever races real
 * "now". 2027-06-07 is a Monday in Asia/Colombo (day_of_week = 1), the same
 * reference date tests/dental-availability.test.ts pinned - deliberately the
 * same constant in both files so a day-of-week regression cannot hide by
 * being re-derived identically twice.
 */
export const REFERENCE_MONDAY = '2027-06-07';
export const REFERENCE_DOW = 1;

/** 09:00, 09:30, 10:00, 10:30 Asia/Colombo (UTC+5:30) on REFERENCE_MONDAY. */
export const SLOT_MINUTES = 30;
const SLOT_UTC = ['03:30', '04:00', '04:30', '05:00'].map((t) => `${REFERENCE_MONDAY}T${t}:00Z`);

export interface FixtureIdentity {
  /** 8 hex characters - the first group of every user UUID this file owns. */
  idPrefix: string;
  /** Prefixes every clinic/doctor row this file creates, for purge + cleanup. */
  namePrefix: string;
  /** `+94` + 2-digit operator prefix + 5 digits; a 2-digit index completes it. */
  phoneBase: string;
}

export function dentalFixtures({ idPrefix, namePrefix, phoneBase }: FixtureIdentity) {
  const created = {
    clinics: [] as string[],
    doctors: [] as string[],
    clinicDoctors: [] as string[],
    users: [] as string[],
  };
  let seq = 0;

  function customerIdentity(index: number): { id: string; phone: string } {
    return {
      id: `${idPrefix}-0000-0000-0000-${String(index).padStart(12, '0')}`,
      phone: `${phoneBase}${String(index).padStart(2, '0')}`,
    };
  }

  /** Leftovers of an aborted earlier run of the same file. */
  async function purge() {
    const stale = (
      await pool.query('SELECT id FROM dental_clinics WHERE name LIKE $1', [`${namePrefix}%`])
    ).rows.map((r) => r.id as string);
    if (stale.length) {
      await pool.query(
        'DELETE FROM appointments WHERE clinic_doctor_id IN (SELECT id FROM clinic_doctors WHERE clinic_id = ANY($1))',
        [stale]
      );
      await pool.query('DELETE FROM clinic_doctors WHERE clinic_id = ANY($1)', [stale]);
      await pool.query('DELETE FROM dental_clinics WHERE id = ANY($1)', [stale]);
    }
    await pool.query('DELETE FROM doctors WHERE full_name LIKE $1', [`${namePrefix}%`]);
    for (let i = 1; i <= 4; i++) {
      const { id } = customerIdentity(i);
      // B5: confirm/cancel now enqueue outbox rows keyed by user_id - purge
      // them ahead of the user row itself, or a leftover notification (its
      // user_id FK is ON DELETE SET NULL, not CASCADE) would survive the user
      // it belonged to and fail the DB hygiene check on a later run.
      await pool.query('DELETE FROM notifications WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM appointments WHERE customer_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
  }

  async function cleanup() {
    if (created.clinicDoctors.length) {
      // appointment_status_history cascades from appointments.
      await pool.query('DELETE FROM appointments WHERE clinic_doctor_id = ANY($1)', [created.clinicDoctors]);
      await pool.query('DELETE FROM doctor_blocked_dates WHERE clinic_doctor_id = ANY($1)', [created.clinicDoctors]);
      await pool.query('DELETE FROM doctor_availability WHERE clinic_doctor_id = ANY($1)', [created.clinicDoctors]);
      await pool.query('DELETE FROM clinic_doctors WHERE id = ANY($1)', [created.clinicDoctors]);
    }
    if (created.clinics.length) await pool.query('DELETE FROM dental_clinics WHERE id = ANY($1)', [created.clinics]);
    if (created.doctors.length) await pool.query('DELETE FROM doctors WHERE id = ANY($1)', [created.doctors]);
    for (const id of created.users) {
      // B5: same reasoning as purge() above - delete notification rows this
      // customer's confirms/cancels enqueued before deleting the user.
      await pool.query('DELETE FROM notifications WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM appointments WHERE customer_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
  }

  /** A CUSTOMER account owned by this file, with a signed access token. */
  async function customer(index: number): Promise<TestCustomer> {
    const { id, phone } = customerIdentity(index);
    await pool.query(
      `INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, $3, 'CUSTOMER')
       ON CONFLICT (id) DO NOTHING`,
      [id, phone, `${namePrefix} Customer ${index}`]
    );
    created.users.push(id);
    return { id, phone, token: generateAccessToken({ id, phone, role: 'CUSTOMER' }) };
  }

  /**
   * One clinic + doctor + active pairing + a Monday 09:00-11:00 template
   * (30-minute slots, no buffer). A fresh pairing per call, so two tests can
   * never contend for the same `(clinic_doctor_id, start_at)` by accident -
   * contention is only ever what a test asks for explicitly.
   */
  async function slot(opts: { fee?: number; active?: boolean } = {}): Promise<SlotFixture> {
    seq += 1;
    const fee = opts.fee ?? 2400;
    const clinicId = (
      await pool.query(
        `INSERT INTO dental_clinics (name, city, address_line, latitude, longitude, contact_phone, operating_start_time, operating_end_time)
         VALUES ($1, 'Beruwala', 'B3 Test Address', 6.5, 80.0, '+94770000009', '08:00', '18:00') RETURNING id`,
        [`${namePrefix} Clinic ${seq}`]
      )
    ).rows[0].id as string;
    created.clinics.push(clinicId);

    const doctorId = (
      await pool.query(
        `INSERT INTO doctors (full_name, specialty) VALUES ($1, 'General dentist') RETURNING id`,
        [`${namePrefix} Doctor ${seq}`]
      )
    ).rows[0].id as string;
    created.doctors.push(doctorId);

    const clinicDoctorId = (
      await pool.query(
        `INSERT INTO clinic_doctors (clinic_id, doctor_id, consultation_fee, is_active)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [clinicId, doctorId, fee, opts.active ?? true]
      )
    ).rows[0].id as string;
    created.clinicDoctors.push(clinicDoctorId);

    await pool.query(
      `INSERT INTO doctor_availability (clinic_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes)
       VALUES ($1, $2, '09:00', '11:00', $3, 0)`,
      [clinicDoctorId, REFERENCE_DOW, SLOT_MINUTES]
    );

    return { clinicId, doctorId, clinicDoctorId, slots: [...SLOT_UTC], fee };
  }

  async function blockDate(clinicDoctorId: string, date: string, reason = 'B3 clinic closed') {
    await pool.query(
      `INSERT INTO doctor_blocked_dates (clinic_doctor_id, blocked_date, reason, created_by)
       VALUES ($1, $2, $3, $4)`,
      [clinicDoctorId, date, reason, ADMIN.id]
    );
  }

  // ---- direct DB reads/writes the tests assert on or use to simulate time --

  async function rowsForSlot(clinicDoctorId: string, startAt: string) {
    const { rows } = await pool.query(
      `SELECT * FROM appointments WHERE clinic_doctor_id = $1 AND start_at = $2 ORDER BY created_at`,
      [clinicDoctorId, startAt]
    );
    return rows;
  }

  async function activeRowsForSlot(clinicDoctorId: string, startAt: string) {
    const { rows } = await pool.query(
      `SELECT * FROM appointments
        WHERE clinic_doctor_id = $1 AND start_at = $2 AND status IN ('HELD','CONFIRMED')`,
      [clinicDoctorId, startAt]
    );
    return rows;
  }

  async function appointmentRow(id: string) {
    const { rows } = await pool.query('SELECT * FROM appointments WHERE id = $1', [id]);
    return rows[0];
  }

  async function history(appointmentId: string) {
    const { rows } = await pool.query(
      'SELECT old_status, new_status, changed_by FROM appointment_status_history WHERE appointment_id = $1 ORDER BY created_at, new_status',
      [appointmentId]
    );
    return rows;
  }

  /** Simulates the five minutes passing without sleeping for them. */
  async function expireHold(id: string) {
    await pool.query(`UPDATE appointments SET held_until = now() - interval '1 minute' WHERE id = $1`, [id]);
  }

  async function setStatus(id: string, status: string) {
    await pool.query('UPDATE appointments SET status = $2 WHERE id = $1', [id, status]);
  }

  async function setStartAt(id: string, startAt: string) {
    await pool.query(
      `UPDATE appointments SET start_at = $2, end_at = $2::timestamptz + interval '30 minutes' WHERE id = $1`,
      [id, startAt]
    );
  }

  return {
    created,
    purge,
    cleanup,
    customer,
    slot,
    blockDate,
    rowsForSlot,
    activeRowsForSlot,
    appointmentRow,
    history,
    expireHold,
    setStatus,
    setStartAt,
  };
}
