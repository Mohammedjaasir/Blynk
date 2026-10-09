import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';

/**
 * Task B2 - dental discovery/availability endpoints (customer-facing,
 * public, read-only). Fixtures follow tests/dental-schema-migration.test.ts
 * / tests/dental-availability.test.ts's real-DB-fixture convention: every
 * row this file creates is deleted in afterAll, in FK-safe order
 * (appointments -> clinic_doctors -> dental_clinics/doctors).
 */
describe('Dental discovery API (GET /api/v1/dental/*)', () => {
  const app = createApp();
  const ADMIN_ID = 'a0000001-0000-0000-0000-000000000003';

  const clinicIds: string[] = [];
  const doctorIds: string[] = [];
  const clinicDoctorIds: string[] = [];

  afterAll(async () => {
    if (clinicDoctorIds.length) await pool.query('DELETE FROM appointments WHERE clinic_doctor_id = ANY($1)', [clinicDoctorIds]);
    if (clinicIds.length) await pool.query('DELETE FROM clinic_doctors WHERE clinic_id = ANY($1)', [clinicIds]);
    if (clinicIds.length) await pool.query('DELETE FROM dental_clinics WHERE id = ANY($1)', [clinicIds]);
    if (doctorIds.length) await pool.query('DELETE FROM doctors WHERE id = ANY($1)', [doctorIds]);
  });

  async function makeClinic(opts: { name: string; city?: string; is_active?: boolean }) {
    const { rows } = await pool.query(
      `INSERT INTO dental_clinics (name, city, address_line, latitude, longitude, contact_phone, operating_start_time, operating_end_time, is_active)
       VALUES ($1, $2, 'B2 Test Address', 6.5, 80.0, '+94770000003', '09:00', '17:00', $3) RETURNING id`,
      [opts.name, opts.city ?? 'Test City', opts.is_active ?? true]
    );
    clinicIds.push(rows[0].id);
    return rows[0].id as string;
  }

  async function makeDoctor(opts: { full_name: string; is_active?: boolean }) {
    const { rows } = await pool.query(
      `INSERT INTO doctors (full_name, specialty, is_active) VALUES ($1, 'Orthodontist', $2) RETURNING id`,
      [opts.full_name, opts.is_active ?? true]
    );
    doctorIds.push(rows[0].id);
    return rows[0].id as string;
  }

  async function makeClinicDoctor(
    clinicId: string,
    doctorId: string,
    opts: { fee?: number; is_active?: boolean } = {}
  ) {
    const { rows } = await pool.query(
      `INSERT INTO clinic_doctors (clinic_id, doctor_id, consultation_fee, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
      [clinicId, doctorId, opts.fee ?? 1800.0, opts.is_active ?? true]
    );
    clinicDoctorIds.push(rows[0].id);
    return rows[0].id as string;
  }

  // --------------------------------------------------------------------------
  // CLINIC LIST
  // --------------------------------------------------------------------------
  describe('GET /dental/clinics', () => {
    it('lists active clinics with pagination and excludes internal fields', async () => {
      const clinicId = await makeClinic({ name: 'B2 Active Clinic Alpha', city: 'Beruwala' });

      const res = await request(app).get('/api/v1/dental/clinics?limit=50');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const found = res.body.data.clinics.find((c: any) => c.id === clinicId);
      expect(found).toBeDefined();
      expect(found.name).toBe('B2 Active Clinic Alpha');
      expect(found).not.toHaveProperty('created_at');
      expect(found).not.toHaveProperty('updated_at');
      expect(found).not.toHaveProperty('is_active');
      expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 50 });
    });

    it('excludes inactive clinics from the list', async () => {
      const inactiveId = await makeClinic({ name: 'B2 Inactive Clinic', is_active: false });

      const res = await request(app).get('/api/v1/dental/clinics?limit=100');

      expect(res.status).toBe(200);
      expect(res.body.data.clinics.find((c: any) => c.id === inactiveId)).toBeUndefined();
    });

    it('filters by city', async () => {
      const dhargaId = await makeClinic({ name: 'B2 Dharga Clinic', city: 'Dharga Town' });
      await makeClinic({ name: 'B2 Colombo Clinic', city: 'Colombo' });

      const res = await request(app).get('/api/v1/dental/clinics?city=Dharga Town&limit=100');

      expect(res.status).toBe(200);
      const ids = res.body.data.clinics.map((c: any) => c.id);
      expect(ids).toContain(dhargaId);
      expect(
        res.body.data.clinics.every((c: any) => c.city.toLowerCase().includes('dharga town'))
      ).toBe(true);
    });

    it('filters by search across name and address', async () => {
      const targetId = await makeClinic({ name: 'B2 Unique Search Target Clinic' });

      const res = await request(app).get('/api/v1/dental/clinics?search=Unique Search Target');

      expect(res.status).toBe(200);
      expect(res.body.data.clinics.map((c: any) => c.id)).toContain(targetId);
    });
  });

  // --------------------------------------------------------------------------
  // CLINIC DETAIL
  // --------------------------------------------------------------------------
  describe('GET /dental/clinics/:id', () => {
    it('returns an active clinic by id', async () => {
      const clinicId = await makeClinic({ name: 'B2 Detail Clinic' });

      const res = await request(app).get(`/api/v1/dental/clinics/${clinicId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.clinic.id).toBe(clinicId);
      expect(res.body.data.clinic.name).toBe('B2 Detail Clinic');
    });

    it('returns 404 for a non-existent clinic id', async () => {
      const res = await request(app).get('/api/v1/dental/clinics/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_NOT_FOUND');
    });

    it('returns the same 404 for an inactive clinic id (no existence leak)', async () => {
      const inactiveId = await makeClinic({ name: 'B2 Inactive Detail Clinic', is_active: false });

      const res = await request(app).get(`/api/v1/dental/clinics/${inactiveId}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_NOT_FOUND');
    });

    it('returns 400 for a malformed clinic id', async () => {
      const res = await request(app).get('/api/v1/dental/clinics/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // CLINIC -> DOCTORS
  // --------------------------------------------------------------------------
  describe('GET /dental/clinics/:id/doctors', () => {
    it('lists only active doctors with an active pairing, each with their clinic-scoped fee', async () => {
      const clinicId = await makeClinic({ name: 'B2 Clinic With Doctors' });
      const activeDoctorId = await makeDoctor({ full_name: 'Dr B2 Active' });
      const inactiveDoctorId = await makeDoctor({ full_name: 'Dr B2 Inactive Doctor', is_active: false });
      const pausedDoctorId = await makeDoctor({ full_name: 'Dr B2 Paused Pairing' });

      await makeClinicDoctor(clinicId, activeDoctorId, { fee: 2500 });
      await makeClinicDoctor(clinicId, inactiveDoctorId, { fee: 1000 });
      await makeClinicDoctor(clinicId, pausedDoctorId, { fee: 1200, is_active: false });

      const res = await request(app).get(`/api/v1/dental/clinics/${clinicId}/doctors`);

      expect(res.status).toBe(200);
      const doctorIdsInResponse = res.body.data.doctors.map((d: any) => d.doctor_id);
      expect(doctorIdsInResponse).toContain(activeDoctorId);
      expect(doctorIdsInResponse).not.toContain(inactiveDoctorId);
      expect(doctorIdsInResponse).not.toContain(pausedDoctorId);

      const active = res.body.data.doctors.find((d: any) => d.doctor_id === activeDoctorId);
      expect(active.consultation_fee).toBe(2500);
      expect(active.clinic_doctor_id).toBeDefined();
    });

    it('returns 404 when the clinic itself is missing or inactive', async () => {
      const inactiveClinicId = await makeClinic({ name: 'B2 Inactive Clinic For Doctors', is_active: false });

      const res = await request(app).get(`/api/v1/dental/clinics/${inactiveClinicId}/doctors`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_NOT_FOUND');
    });
  });

  // --------------------------------------------------------------------------
  // DOCTOR DETAIL
  // --------------------------------------------------------------------------
  describe('GET /dental/doctors/:id', () => {
    it('returns an active doctor with the active clinics they work at, each with its own fee', async () => {
      const clinicA = await makeClinic({ name: 'B2 Doctor Clinic A' });
      const clinicB = await makeClinic({ name: 'B2 Doctor Clinic B' });
      const inactiveClinic = await makeClinic({ name: 'B2 Doctor Inactive Clinic', is_active: false });
      const doctorId = await makeDoctor({ full_name: 'Dr B2 Multi Clinic' });

      await makeClinicDoctor(clinicA, doctorId, { fee: 1500 });
      await makeClinicDoctor(clinicB, doctorId, { fee: 3000 });
      await makeClinicDoctor(inactiveClinic, doctorId, { fee: 999 });

      const res = await request(app).get(`/api/v1/dental/doctors/${doctorId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.doctor.id).toBe(doctorId);
      const clinicIdsInResponse = res.body.data.doctor.clinics.map((c: any) => c.clinic_id);
      expect(clinicIdsInResponse).toContain(clinicA);
      expect(clinicIdsInResponse).toContain(clinicB);
      expect(clinicIdsInResponse).not.toContain(inactiveClinic);

      const feeAtA = res.body.data.doctor.clinics.find((c: any) => c.clinic_id === clinicA).consultation_fee;
      const feeAtB = res.body.data.doctor.clinics.find((c: any) => c.clinic_id === clinicB).consultation_fee;
      expect(feeAtA).toBe(1500);
      expect(feeAtB).toBe(3000);
    });

    it('returns 404 for a non-existent doctor id', async () => {
      const res = await request(app).get('/api/v1/dental/doctors/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });

    it('returns the same 404 for an inactive doctor id', async () => {
      const inactiveDoctorId = await makeDoctor({ full_name: 'Dr B2 Inactive Solo', is_active: false });

      const res = await request(app).get(`/api/v1/dental/doctors/${inactiveDoctorId}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });
  });

  // --------------------------------------------------------------------------
  // DOCTOR AVAILABILITY (range) + SLOTS (single day)
  // --------------------------------------------------------------------------
  describe('GET /dental/doctors/:id/availability', () => {
    it('returns the per-day hasAvailability shape for a valid clinic/doctor pairing', async () => {
      const clinicId = await makeClinic({ name: 'B2 Avail Endpoint Clinic' });
      const doctorId = await makeDoctor({ full_name: 'Dr B2 Avail Endpoint' });
      const clinicDoctorId = await makeClinicDoctor(clinicId, doctorId);
      await pool.query(
        `INSERT INTO doctor_availability (clinic_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes)
         VALUES ($1, 1, '09:00', '10:00', 30, 0)`,
        [clinicDoctorId]
      );

      const res = await request(app).get(
        `/api/v1/dental/doctors/${doctorId}/availability?clinic_id=${clinicId}&from=2027-06-07&to=2027-06-08`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.availability).toEqual([
        { date: '2027-06-07', hasAvailability: true },
        { date: '2027-06-08', hasAvailability: false },
      ]);
    });

    it('returns 400 for a clinic_id that is not an active pairing for this doctor', async () => {
      const clinicId = await makeClinic({ name: 'B2 Mismatch Clinic' });
      const otherClinicId = await makeClinic({ name: 'B2 Other Clinic Not Linked' });
      const doctorId = await makeDoctor({ full_name: 'Dr B2 Mismatch' });
      await makeClinicDoctor(clinicId, doctorId);

      const res = await request(app).get(
        `/api/v1/dental/doctors/${doctorId}/availability?clinic_id=${otherClinicId}&from=2027-06-07&to=2027-06-08`
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CLINIC_DOCTOR_MISMATCH');
    });

    it('returns 404 when the doctor does not exist', async () => {
      const clinicId = await makeClinic({ name: 'B2 Avail No Doctor Clinic' });

      const res = await request(app).get(
        `/api/v1/dental/doctors/00000000-0000-0000-0000-000000000000/availability?clinic_id=${clinicId}&from=2027-06-07&to=2027-06-08`
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });

    it('rejects a range longer than 30 days', async () => {
      const clinicId = await makeClinic({ name: 'B2 Range Cap Clinic' });
      const doctorId = await makeDoctor({ full_name: 'Dr B2 Range Cap' });
      await makeClinicDoctor(clinicId, doctorId);

      const res = await request(app).get(
        `/api/v1/dental/doctors/${doctorId}/availability?clinic_id=${clinicId}&from=2027-06-01&to=2027-08-01`
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /dental/doctors/:id/slots', () => {
    it('returns the candidate start times for the requested date', async () => {
      const clinicId = await makeClinic({ name: 'B2 Slots Endpoint Clinic' });
      const doctorId = await makeDoctor({ full_name: 'Dr B2 Slots Endpoint' });
      const clinicDoctorId = await makeClinicDoctor(clinicId, doctorId);
      await pool.query(
        `INSERT INTO doctor_availability (clinic_doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes)
         VALUES ($1, 1, '09:00', '10:30', 30, 10)`,
        [clinicDoctorId]
      );

      const res = await request(app).get(
        `/api/v1/dental/doctors/${doctorId}/slots?clinic_id=${clinicId}&date=2027-06-07`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.date).toBe('2027-06-07');
      expect(res.body.data.slots).toEqual(['2027-06-07T03:30:00Z', '2027-06-07T04:10:00Z']);
      expect(res.body.data.blockedReason).toBeNull();
    });

    it('returns 400 for a clinic_id/doctor pairing that does not exist', async () => {
      const clinicId = await makeClinic({ name: 'B2 Slots Mismatch Clinic' });
      const otherClinicId = await makeClinic({ name: 'B2 Slots Other Clinic' });
      const doctorId = await makeDoctor({ full_name: 'Dr B2 Slots Mismatch' });
      await makeClinicDoctor(clinicId, doctorId);

      const res = await request(app).get(
        `/api/v1/dental/doctors/${doctorId}/slots?clinic_id=${otherClinicId}&date=2027-06-07`
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CLINIC_DOCTOR_MISMATCH');
    });

    it('returns 404 when the doctor does not exist', async () => {
      const clinicId = await makeClinic({ name: 'B2 Slots No Doctor Clinic' });

      const res = await request(app).get(
        `/api/v1/dental/doctors/00000000-0000-0000-0000-000000000000/slots?clinic_id=${clinicId}&date=2027-06-07`
      );

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });

    it('returns 400 for a malformed date', async () => {
      const clinicId = await makeClinic({ name: 'B2 Slots Bad Date Clinic' });
      const doctorId = await makeDoctor({ full_name: 'Dr B2 Slots Bad Date' });
      await makeClinicDoctor(clinicId, doctorId);

      const res = await request(app).get(
        `/api/v1/dental/doctors/${doctorId}/slots?clinic_id=${clinicId}&date=07-06-2027`
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
