import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { ADMIN, adminToken, auth, dentalFixtures, REFERENCE_MONDAY, type TestCustomer } from './helpers/dental.js';

/**
 * Task B4 - admin CRUD for clinics, doctors, clinic-doctor pairings,
 * availability templates, blocked dates, and the admin appointment list.
 * Self-contained fixtures for the CRUD sections (own tracked ids, direct
 * pool cleanup in afterAll, purge of aborted-run leftovers in beforeAll) -
 * the same discipline tests/dental-discovery.test.ts already established for
 * a module that (like this one) drives entities through the API itself
 * rather than needing dentalFixtures' pre-built bookable slot. The admin
 * appointment-list section below reuses dentalFixtures for exactly that
 * bookable slot, since those tests are about querying appointments, not
 * about clinic/doctor CRUD.
 */
describe('Dental admin CRUD API (task B4, /api/v1/admin/dental/*)', () => {
  const app = createApp();
  const NAME_PREFIX = 'B4Admin';

  const clinicIds: string[] = [];
  const doctorIds: string[] = [];
  const clinicDoctorIds: string[] = [];
  const availabilityIds: string[] = [];
  const blockedDateIds: string[] = [];

  const CUSTOMER_ID = 'b4a00001-0000-0000-0000-000000000001';
  const CUSTOMER_PHONE = '+94741009901';
  const customerToken = generateAccessToken({ id: CUSTOMER_ID, phone: CUSTOMER_PHONE, role: 'CUSTOMER' });

  beforeAll(async () => {
    // Leftovers of an aborted earlier run of this file.
    const stale = (
      await pool.query('SELECT id FROM dental_clinics WHERE name LIKE $1', [`${NAME_PREFIX}%`])
    ).rows.map((r) => r.id as string);
    if (stale.length) {
      await pool.query(
        'DELETE FROM appointments WHERE clinic_doctor_id IN (SELECT id FROM clinic_doctors WHERE clinic_id = ANY($1))',
        [stale]
      );
      await pool.query(
        'DELETE FROM doctor_blocked_dates WHERE clinic_doctor_id IN (SELECT id FROM clinic_doctors WHERE clinic_id = ANY($1))',
        [stale]
      );
      await pool.query(
        'DELETE FROM doctor_availability WHERE clinic_doctor_id IN (SELECT id FROM clinic_doctors WHERE clinic_id = ANY($1))',
        [stale]
      );
      await pool.query('DELETE FROM clinic_doctors WHERE clinic_id = ANY($1)', [stale]);
      await pool.query('DELETE FROM dental_clinics WHERE id = ANY($1)', [stale]);
    }
    await pool.query('DELETE FROM doctors WHERE full_name LIKE $1', [`${NAME_PREFIX}%`]);
    await pool.query('DELETE FROM users WHERE id = $1', [CUSTOMER_ID]);
    await pool.query(
      `INSERT INTO users (id, phone, full_name, role) VALUES ($1, $2, $3, 'CUSTOMER')`,
      [CUSTOMER_ID, CUSTOMER_PHONE, `${NAME_PREFIX} Customer`]
    );
  });

  afterAll(async () => {
    if (blockedDateIds.length) {
      await pool.query('DELETE FROM doctor_blocked_dates WHERE id = ANY($1)', [blockedDateIds]);
    }
    if (availabilityIds.length) {
      await pool.query('DELETE FROM doctor_availability WHERE id = ANY($1)', [availabilityIds]);
    }
    if (clinicDoctorIds.length) {
      await pool.query('DELETE FROM appointments WHERE clinic_doctor_id = ANY($1)', [clinicDoctorIds]);
      await pool.query('DELETE FROM doctor_blocked_dates WHERE clinic_doctor_id = ANY($1)', [clinicDoctorIds]);
      await pool.query('DELETE FROM doctor_availability WHERE clinic_doctor_id = ANY($1)', [clinicDoctorIds]);
      await pool.query('DELETE FROM clinic_doctors WHERE id = ANY($1)', [clinicDoctorIds]);
    }
    if (clinicIds.length) await pool.query('DELETE FROM dental_clinics WHERE id = ANY($1)', [clinicIds]);
    if (doctorIds.length) await pool.query('DELETE FROM doctors WHERE id = ANY($1)', [doctorIds]);
    await pool.query('DELETE FROM users WHERE id = $1', [CUSTOMER_ID]);
  });

  let seq = 0;
  function uniqueName(label: string): string {
    seq += 1;
    return `${NAME_PREFIX} ${label} ${seq}`;
  }

  function clinicPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: uniqueName('Clinic'),
      city: 'Colombo',
      address_line: '1 Test Road',
      latitude: 6.9271,
      longitude: 79.8612,
      contact_phone: '+94770000001',
      operating_start_time: '08:00',
      operating_end_time: '18:00',
      ...overrides,
    };
  }

  function doctorPayload(overrides: Record<string, unknown> = {}) {
    return {
      full_name: uniqueName('Doctor'),
      specialty: 'GENERAL_DENTIST',
      ...overrides,
    };
  }

  async function createClinic(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post('/api/v1/admin/dental/clinics')
      .set(auth(adminToken))
      .send(clinicPayload(overrides));
    expect(res.status).toBe(201);
    clinicIds.push(res.body.data.clinic.id);
    return res.body.data.clinic as { id: string; is_active: boolean };
  }

  async function createDoctor(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post('/api/v1/admin/dental/doctors')
      .set(auth(adminToken))
      .send(doctorPayload(overrides));
    expect(res.status).toBe(201);
    doctorIds.push(res.body.data.doctor.id);
    return res.body.data.doctor as { id: string; is_active: boolean };
  }

  async function attachDoctor(clinicId: string, doctorId: string, fee = 2500) {
    const res = await request(app)
      .post(`/api/v1/admin/dental/clinics/${clinicId}/doctors`)
      .set(auth(adminToken))
      .send({ doctor_id: doctorId, consultation_fee: fee });
    expect(res.status).toBe(201);
    clinicDoctorIds.push(res.body.data.clinic_doctor.id);
    return res.body.data.clinic_doctor as { id: string };
  }

  // ==========================================================================
  // CLINICS
  // ==========================================================================
  describe('Clinics', () => {
    it('POST creates a clinic (is_active defaults true)', async () => {
      const clinic = await createClinic();
      expect(clinic.is_active).toBe(true);
    });

    it('POST rejects operating_end_time <= operating_start_time', async () => {
      const res = await request(app)
        .post('/api/v1/admin/dental/clinics')
        .set(auth(adminToken))
        .send(clinicPayload({ operating_start_time: '18:00', operating_end_time: '08:00' }));
      expect(res.status).toBe(400);
    });

    it('GET list includes inactive clinics (unlike the public B2 endpoint)', async () => {
      const clinic = await createClinic();
      const patchRes = await request(app)
        .patch(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.clinic.is_active).toBe(false);

      const listRes = await request(app).get('/api/v1/admin/dental/clinics').set(auth(adminToken));
      expect(listRes.status).toBe(200);
      const ids = listRes.body.data.clinics.map((c: { id: string }) => c.id);
      expect(ids).toContain(clinic.id);
    });

    it('GET :id returns detail even when inactive', async () => {
      const clinic = await createClinic();
      await request(app)
        .patch(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });

      const res = await request(app).get(`/api/v1/admin/dental/clinics/${clinic.id}`).set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.clinic.is_active).toBe(false);
    });

    it('GET :id returns 404 for an unknown clinic', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dental/clinics/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_NOT_FOUND');
    });

    it('PATCH partially updates a clinic', async () => {
      const clinic = await createClinic();
      const res = await request(app)
        .patch(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken))
        .send({ city: 'Kandy' });
      expect(res.status).toBe(200);
      expect(res.body.data.clinic.city).toBe('Kandy');
    });

    it('PATCH returns 404 for an unknown clinic', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/dental/clinics/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken))
        .send({ city: 'Galle' });
      expect(res.status).toBe(404);
    });

    // Fix round 1 (review finding I1): a single-field hours PATCH must be
    // cross-checked against the clinic's *existing* other bound - previously
    // this reached the DB unchecked and surfaced a raw 500 from Postgres's
    // own chk_dental_clinic_hours constraint (23514) instead of a clean 4xx.
    it('PATCH rejects a single-field operating_start_time update that would invert the stored hours', async () => {
      const clinic = await createClinic({ operating_start_time: '08:00', operating_end_time: '18:00' });

      const res = await request(app)
        .patch(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken))
        .send({ operating_start_time: '19:00' }); // stored end (18:00) would now precede it
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CLINIC_HOURS');

      // The clinic's stored hours are untouched by the rejected request.
      const detail = await request(app)
        .get(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken));
      expect(detail.body.data.clinic.operating_start_time).toContain('08:00');
    });

    it('PATCH rejects a single-field operating_end_time update that would invert the stored hours', async () => {
      const clinic = await createClinic({ operating_start_time: '08:00', operating_end_time: '18:00' });

      const res = await request(app)
        .patch(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken))
        .send({ operating_end_time: '07:00' }); // stored start (08:00) would now be after it
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CLINIC_HOURS');
    });

    it('PATCH still accepts a single-field hours update that does not invert the stored hours', async () => {
      const clinic = await createClinic({ operating_start_time: '08:00', operating_end_time: '18:00' });

      const res = await request(app)
        .patch(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken))
        .send({ operating_end_time: '20:00' }); // still after the stored 08:00 start
      expect(res.status).toBe(200);
      expect(res.body.data.clinic.operating_end_time).toContain('20:00');
    });
  });

  // ==========================================================================
  // DOCTORS
  // ==========================================================================
  describe('Doctors', () => {
    it('POST creates a doctor', async () => {
      const doctor = await createDoctor();
      expect(doctor.is_active).toBe(true);
    });

    it('POST rejects an invalid specialty', async () => {
      const res = await request(app)
        .post('/api/v1/admin/dental/doctors')
        .set(auth(adminToken))
        .send(doctorPayload({ specialty: 'NOT_A_REAL_SPECIALTY' }));
      expect(res.status).toBe(400);
    });

    it('GET list includes inactive doctors', async () => {
      const doctor = await createDoctor();
      await request(app)
        .patch(`/api/v1/admin/dental/doctors/${doctor.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });

      const res = await request(app).get('/api/v1/admin/dental/doctors').set(auth(adminToken));
      expect(res.status).toBe(200);
      const ids = res.body.data.doctors.map((d: { id: string }) => d.id);
      expect(ids).toContain(doctor.id);
    });

    it('GET :id returns 404 for an unknown doctor', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dental/doctors/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });

    it('PATCH toggles is_active', async () => {
      const doctor = await createDoctor();
      const res = await request(app)
        .patch(`/api/v1/admin/dental/doctors/${doctor.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });
      expect(res.status).toBe(200);
      expect(res.body.data.doctor.is_active).toBe(false);
    });
  });

  // ==========================================================================
  // CLINIC-DOCTOR RELATIONSHIP
  // ==========================================================================
  describe('Clinic-doctor relationship', () => {
    it('POST attaches a doctor to a clinic with a fee', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      const clinicDoctor = await attachDoctor(clinic.id, doctor.id, 3000);
      expect(clinicDoctor.id).toBeTruthy();
    });

    it('POST rejects an unknown clinic_id', async () => {
      const doctor = await createDoctor();
      const res = await request(app)
        .post('/api/v1/admin/dental/clinics/00000000-0000-0000-0000-000000000000/doctors')
        .set(auth(adminToken))
        .send({ doctor_id: doctor.id });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_NOT_FOUND');
    });

    it('POST rejects an inactive clinic', async () => {
      const clinic = await createClinic();
      await request(app)
        .patch(`/api/v1/admin/dental/clinics/${clinic.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });
      const doctor = await createDoctor();

      const res = await request(app)
        .post(`/api/v1/admin/dental/clinics/${clinic.id}/doctors`)
        .set(auth(adminToken))
        .send({ doctor_id: doctor.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLINIC_INACTIVE');
    });

    it('POST rejects an unknown doctor_id', async () => {
      const clinic = await createClinic();
      const res = await request(app)
        .post(`/api/v1/admin/dental/clinics/${clinic.id}/doctors`)
        .set(auth(adminToken))
        .send({ doctor_id: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCTOR_NOT_FOUND');
    });

    it('POST rejects an inactive doctor', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      await request(app)
        .patch(`/api/v1/admin/dental/doctors/${doctor.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });

      const res = await request(app)
        .post(`/api/v1/admin/dental/clinics/${clinic.id}/doctors`)
        .set(auth(adminToken))
        .send({ doctor_id: doctor.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DOCTOR_INACTIVE');
    });

    it('POST rejects a duplicate pairing cleanly (uq_clinic_doctors_pairing backstop)', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      await attachDoctor(clinic.id, doctor.id);

      const res = await request(app)
        .post(`/api/v1/admin/dental/clinics/${clinic.id}/doctors`)
        .set(auth(adminToken))
        .send({ doctor_id: doctor.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLINIC_DOCTOR_PAIRING_EXISTS');
    });

    it('PATCH updates fee and is_active on the pairing', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      const clinicDoctor = await attachDoctor(clinic.id, doctor.id, 1000);

      const res = await request(app)
        .patch(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}`)
        .set(auth(adminToken))
        .send({ consultation_fee: 1500, is_active: false });
      expect(res.status).toBe(200);
      expect(res.body.data.clinic_doctor.consultation_fee).toBe(1500);
      expect(res.body.data.clinic_doctor.is_active).toBe(false);
    });

    it('PATCH returns 404 for an unknown pairing', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/dental/clinic-doctors/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken))
        .send({ is_active: false });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_DOCTOR_NOT_FOUND');
    });

    it('GET roster includes an inactive pairing and an inactive doctor', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      const clinicDoctor = await attachDoctor(clinic.id, doctor.id);
      await request(app)
        .patch(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });

      const res = await request(app)
        .get(`/api/v1/admin/dental/clinics/${clinic.id}/doctors`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      const row = res.body.data.doctors.find(
        (d: { clinic_doctor_id: string }) => d.clinic_doctor_id === clinicDoctor.id
      );
      expect(row).toBeTruthy();
      expect(row.pairing_is_active).toBe(false);
    });
  });

  // ==========================================================================
  // AVAILABILITY TEMPLATE
  // ==========================================================================
  describe('Availability template', () => {
    async function bookableClinicDoctor() {
      const clinic = await createClinic({ operating_start_time: '08:00', operating_end_time: '18:00' });
      const doctor = await createDoctor();
      return attachDoctor(clinic.id, doctor.id);
    }

    it('POST creates a template row within clinic hours', async () => {
      const clinicDoctor = await bookableClinicDoctor();
      const res = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken))
        .send({ day_of_week: 1, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30 });
      expect(res.status).toBe(201);
      availabilityIds.push(res.body.data.availability.id);
      expect(res.body.data.availability.buffer_minutes).toBe(0);
    });

    it('POST rejects end_time <= start_time', async () => {
      const clinicDoctor = await bookableClinicDoctor();
      const res = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken))
        .send({ day_of_week: 1, start_time: '11:00', end_time: '09:00', slot_duration_minutes: 30 });
      expect(res.status).toBe(400);
    });

    it('POST rejects a template that extends outside the clinic operating hours', async () => {
      const clinicDoctor = await bookableClinicDoctor(); // clinic hours 08:00-18:00
      const res = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken))
        .send({ day_of_week: 1, start_time: '17:00', end_time: '19:00', slot_duration_minutes: 30 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TEMPLATE_OUTSIDE_CLINIC_HOURS');
    });

    it('POST returns 404 for an unknown clinic_doctor_id', async () => {
      const res = await request(app)
        .post('/api/v1/admin/dental/clinic-doctors/00000000-0000-0000-0000-000000000000/availability')
        .set(auth(adminToken))
        .send({ day_of_week: 1, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_DOCTOR_NOT_FOUND');
    });

    it('POST returns 409 for an inactive clinic_doctor pairing', async () => {
      const clinicDoctor = await bookableClinicDoctor();
      await request(app)
        .patch(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}`)
        .set(auth(adminToken))
        .send({ is_active: false });

      const res = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken))
        .send({ day_of_week: 1, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLINIC_DOCTOR_INACTIVE');
    });

    it('GET lists the template rows for a pairing', async () => {
      const clinicDoctor = await bookableClinicDoctor();
      const created = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken))
        .send({ day_of_week: 2, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30 });
      availabilityIds.push(created.body.data.availability.id);

      const res = await request(app)
        .get(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.availability.length).toBeGreaterThanOrEqual(1);
    });

    it('PATCH re-validates the cross-entity clinic-hours rule', async () => {
      const clinicDoctor = await bookableClinicDoctor();
      const created = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken))
        .send({ day_of_week: 3, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30 });
      const id = created.body.data.availability.id;
      availabilityIds.push(id);

      const okUpdate = await request(app)
        .patch(`/api/v1/admin/dental/availability/${id}`)
        .set(auth(adminToken))
        .send({ end_time: '12:00' });
      expect(okUpdate.status).toBe(200);
      expect(okUpdate.body.data.availability.end_time).toContain('12:00');

      const badUpdate = await request(app)
        .patch(`/api/v1/admin/dental/availability/${id}`)
        .set(auth(adminToken))
        .send({ end_time: '19:00' }); // clinic closes at 18:00
      expect(badUpdate.status).toBe(400);
      expect(badUpdate.body.error.code).toBe('TEMPLATE_OUTSIDE_CLINIC_HOURS');
    });

    it('PATCH returns 404 for an unknown availability row', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/dental/availability/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken))
        .send({ buffer_minutes: 5 });
      expect(res.status).toBe(404);
    });

    it('DELETE hard-deletes a template row', async () => {
      const clinicDoctor = await bookableClinicDoctor();
      const created = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/availability`)
        .set(auth(adminToken))
        .send({ day_of_week: 4, start_time: '09:00', end_time: '11:00', slot_duration_minutes: 30 });
      const id = created.body.data.availability.id;

      const del = await request(app).delete(`/api/v1/admin/dental/availability/${id}`).set(auth(adminToken));
      expect(del.status).toBe(204);

      const { rows } = await pool.query('SELECT id FROM doctor_availability WHERE id = $1', [id]);
      expect(rows.length).toBe(0);
    });

    it('DELETE returns 404 for an unknown availability row', async () => {
      const res = await request(app)
        .delete('/api/v1/admin/dental/availability/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken));
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // BLOCKED DATES
  // ==========================================================================
  describe('Blocked dates', () => {
    it('POST creates a blocked date with created_by from req.user.id', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      const clinicDoctor = await attachDoctor(clinic.id, doctor.id);

      const res = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/blocked-dates`)
        .set(auth(adminToken))
        .send({ blocked_date: '2027-12-25', reason: 'Public holiday' });
      expect(res.status).toBe(201);
      blockedDateIds.push(res.body.data.blocked_date.id);
      expect(res.body.data.blocked_date.created_by).toBe(ADMIN.id);
      // A plain calendar date, never a timezone-shifted ISO timestamp.
      expect(res.body.data.blocked_date.blocked_date).toBe('2027-12-25');
    });

    it('POST rejects a duplicate pairing+date cleanly (uq_doctor_blocked_dates backstop)', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      const clinicDoctor = await attachDoctor(clinic.id, doctor.id);

      const first = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/blocked-dates`)
        .set(auth(adminToken))
        .send({ blocked_date: '2027-11-01', reason: 'Leave' });
      blockedDateIds.push(first.body.data.blocked_date.id);

      const res = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/blocked-dates`)
        .set(auth(adminToken))
        .send({ blocked_date: '2027-11-01', reason: 'Leave (duplicate attempt)' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BLOCKED_DATE_EXISTS');
    });

    it('POST returns 404 for an unknown clinic_doctor_id', async () => {
      const res = await request(app)
        .post('/api/v1/admin/dental/clinic-doctors/00000000-0000-0000-0000-000000000000/blocked-dates')
        .set(auth(adminToken))
        .send({ blocked_date: '2027-10-10', reason: 'Leave' });
      expect(res.status).toBe(404);
    });

    it('GET lists blocked dates for a pairing', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      const clinicDoctor = await attachDoctor(clinic.id, doctor.id);
      const created = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/blocked-dates`)
        .set(auth(adminToken))
        .send({ blocked_date: '2027-09-09', reason: 'Leave' });
      blockedDateIds.push(created.body.data.blocked_date.id);

      const res = await request(app)
        .get(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/blocked-dates`)
        .set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.blocked_dates.length).toBeGreaterThanOrEqual(1);
      const listed = res.body.data.blocked_dates.find((b: { id: string }) => b.id === created.body.data.blocked_date.id);
      expect(listed.blocked_date).toBe('2027-09-09');
    });

    it('DELETE unblocks a date', async () => {
      const clinic = await createClinic();
      const doctor = await createDoctor();
      const clinicDoctor = await attachDoctor(clinic.id, doctor.id);
      const created = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctor.id}/blocked-dates`)
        .set(auth(adminToken))
        .send({ blocked_date: '2027-08-08', reason: 'Leave' });
      const id = created.body.data.blocked_date.id;

      const del = await request(app).delete(`/api/v1/admin/dental/blocked-dates/${id}`).set(auth(adminToken));
      expect(del.status).toBe(204);

      const { rows } = await pool.query('SELECT id FROM doctor_blocked_dates WHERE id = $1', [id]);
      expect(rows.length).toBe(0);
    });

    it('DELETE returns 404 for an unknown blocked date', async () => {
      const res = await request(app)
        .delete('/api/v1/admin/dental/blocked-dates/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken));
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // ROLE GUARD
  // ==========================================================================
  describe('requireRoles(ADMIN)', () => {
    it('rejects a CUSTOMER-role token on a read route with 403', async () => {
      const res = await request(app).get('/api/v1/admin/dental/clinics').set(auth(customerToken));
      expect(res.status).toBe(403);
    });

    it('rejects a CUSTOMER-role token on a mutating route with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/dental/clinics')
        .set(auth(customerToken))
        .send(clinicPayload());
      expect(res.status).toBe(403);
    });

    it('rejects an anonymous request with 401', async () => {
      const res = await request(app).get('/api/v1/admin/dental/doctors');
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // FULL ADMIN SETUP FLOW - plan §26 Phase 5 acceptance criterion
  // ==========================================================================
  it('walks the full admin setup flow: clinic -> doctor -> pairing+fee -> availability -> blocked date -> roster', async () => {
    const clinic = await createClinic({ operating_start_time: '08:00', operating_end_time: '18:00' });
    const doctor = await createDoctor({ specialty: 'ORTHODONTIST' });

    const attach = await request(app)
      .post(`/api/v1/admin/dental/clinics/${clinic.id}/doctors`)
      .set(auth(adminToken))
      .send({ doctor_id: doctor.id, consultation_fee: 4200 });
    expect(attach.status).toBe(201);
    const clinicDoctorId = attach.body.data.clinic_doctor.id as string;
    clinicDoctorIds.push(clinicDoctorId);

    const availability = await request(app)
      .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctorId}/availability`)
      .set(auth(adminToken))
      .send({ day_of_week: 1, start_time: '09:00', end_time: '12:00', slot_duration_minutes: 30, buffer_minutes: 5 });
    expect(availability.status).toBe(201);
    availabilityIds.push(availability.body.data.availability.id);

    const blockedDate = await request(app)
      .post(`/api/v1/admin/dental/clinic-doctors/${clinicDoctorId}/blocked-dates`)
      .set(auth(adminToken))
      .send({ blocked_date: '2027-12-31', reason: 'Year-end closure' });
    expect(blockedDate.status).toBe(201);
    blockedDateIds.push(blockedDate.body.data.blocked_date.id);

    const roster = await request(app)
      .get(`/api/v1/admin/dental/clinics/${clinic.id}/doctors`)
      .set(auth(adminToken));
    expect(roster.status).toBe(200);
    const row = roster.body.data.doctors.find(
      (d: { clinic_doctor_id: string }) => d.clinic_doctor_id === clinicDoctorId
    );
    expect(row).toBeTruthy();
    expect(row.doctor_id).toBe(doctor.id);
    expect(row.consultation_fee).toBe(4200);
    expect(row.pairing_is_active).toBe(true);
    expect(row.specialty).toBe('ORTHODONTIST');

    // The freshly-configured clinic-doctor is now genuinely bookable through
    // B2's public endpoint - the concrete proof the admin surface stood up a
    // real, working slot, not just rows in isolated tables.
    const publicSlots = await request(app)
      .get(`/api/v1/dental/doctors/${doctor.id}/slots`)
      .query({ clinic_id: clinic.id, date: REFERENCE_MONDAY });
    expect(publicSlots.status).toBe(200);
    expect(publicSlots.body.data.slots.length).toBeGreaterThan(0);

    const availList = await request(app)
      .get(`/api/v1/admin/dental/clinic-doctors/${clinicDoctorId}/availability`)
      .set(auth(adminToken));
    expect(availList.status).toBe(200);
    expect(availList.body.data.availability.length).toBe(1);

    const blockedList = await request(app)
      .get(`/api/v1/admin/dental/clinic-doctors/${clinicDoctorId}/blocked-dates`)
      .set(auth(adminToken));
    expect(blockedList.status).toBe(200);
    expect(blockedList.body.data.blocked_dates.length).toBe(1);
    expect(blockedList.body.data.blocked_dates[0].reason).toBe('Year-end closure');
  });

  // ==========================================================================
  // ADMIN APPOINTMENT LIST - reuses dentalFixtures' bookable slot, since
  // these tests are about querying appointments, not clinic/doctor CRUD.
  // ==========================================================================
  describe('Admin appointment list (GET /admin/dental/appointments)', () => {
    const fx = dentalFixtures({ idPrefix: 'b4a00002', namePrefix: 'B4A List', phoneBase: '+9474100' });
    let patient: TestCustomer;

    beforeAll(async () => {
      await fx.purge();
      patient = await fx.customer(1);
    });

    afterAll(async () => {
      await fx.cleanup();
    });

    it('filters by clinic_id/doctor_id and returns patient_name/phone/notes plus doctor/clinic context', async () => {
      const s = await fx.slot();
      const holdRes = await request(app)
        .post('/api/v1/dental/appointments/holds')
        .set(auth(patient.token))
        .send({ clinic_doctor_id: s.clinicDoctorId, start_at: s.slots[0] });
      expect(holdRes.status).toBe(201);
      const appointmentId = holdRes.body.data.appointment.id as string;

      const confirmRes = await request(app)
        .post(`/api/v1/dental/appointments/${appointmentId}/confirm`)
        .set(auth(patient.token))
        .send({ patient_name: 'Kamal Silva', patient_phone: '0771230000', patient_notes: 'Sensitive tooth' });
      expect(confirmRes.status).toBe(200);

      const res = await request(app)
        .get('/api/v1/admin/dental/appointments')
        .set(auth(adminToken))
        .query({ clinic_id: s.clinicId, doctor_id: s.doctorId });
      expect(res.status).toBe(200);
      const row = res.body.data.appointments.find((a: { id: string }) => a.id === appointmentId);
      expect(row).toBeTruthy();
      expect(row.patient_name).toBe('Kamal Silva');
      expect(row.patient_notes).toBe('Sensitive tooth');
      expect(row.status).toBe('CONFIRMED');
      expect(row.is_expired_hold).toBe(false);
      expect(row.clinic.id).toBe(s.clinicId);
      expect(row.doctor.id).toBe(s.doctorId);

      // A different clinic never shows up.
      const otherClinic = await fx.slot();
      const otherRes = await request(app)
        .get('/api/v1/admin/dental/appointments')
        .set(auth(adminToken))
        .query({ clinic_id: otherClinic.clinicId });
      const ids = otherRes.body.data.appointments.map((a: { id: string }) => a.id);
      expect(ids).not.toContain(appointmentId);
    });

    it('marks a stale HELD row is_expired_hold=true without rewriting status (B3 carry-forward)', async () => {
      const s = await fx.slot();
      const holdRes = await request(app)
        .post('/api/v1/dental/appointments/holds')
        .set(auth(patient.token))
        .send({ clinic_doctor_id: s.clinicDoctorId, start_at: s.slots[0] });
      const appointmentId = holdRes.body.data.appointment.id as string;
      await fx.expireHold(appointmentId);

      const res = await request(app)
        .get('/api/v1/admin/dental/appointments')
        .set(auth(adminToken))
        .query({ clinic_id: s.clinicId });
      const row = res.body.data.appointments.find((a: { id: string }) => a.id === appointmentId);
      expect(row).toBeTruthy();
      // Status stays the raw DB value (HELD) - never silently rewritten to a
      // synthetic EXPIRED (plan §7.5 lazy-expiry mandate) - but the derived
      // flag tells the admin it is stale.
      expect(row.status).toBe('HELD');
      expect(row.is_expired_hold).toBe(true);
    });

    it('filters by status and by clinic-local from/to date range', async () => {
      const s = await fx.slot();
      const holdRes = await request(app)
        .post('/api/v1/dental/appointments/holds')
        .set(auth(patient.token))
        .send({ clinic_doctor_id: s.clinicDoctorId, start_at: s.slots[1] });
      const appointmentId = holdRes.body.data.appointment.id as string;

      const statusRes = await request(app)
        .get('/api/v1/admin/dental/appointments')
        .set(auth(adminToken))
        .query({ clinic_id: s.clinicId, status: 'HELD' });
      expect(statusRes.body.data.appointments.map((a: { id: string }) => a.id)).toContain(appointmentId);

      const inRangeRes = await request(app)
        .get('/api/v1/admin/dental/appointments')
        .set(auth(adminToken))
        .query({ clinic_id: s.clinicId, from: REFERENCE_MONDAY, to: REFERENCE_MONDAY });
      expect(inRangeRes.body.data.appointments.map((a: { id: string }) => a.id)).toContain(appointmentId);

      const outOfRangeRes = await request(app)
        .get('/api/v1/admin/dental/appointments')
        .set(auth(adminToken))
        .query({ clinic_id: s.clinicId, from: '2027-06-08', to: '2027-06-08' });
      expect(outOfRangeRes.body.data.appointments.map((a: { id: string }) => a.id)).not.toContain(appointmentId);
    });

    it('rejects from > to with 400', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dental/appointments')
        .set(auth(adminToken))
        .query({ from: '2027-06-10', to: '2027-06-01' });
      expect(res.status).toBe(400);
    });
  });
});
