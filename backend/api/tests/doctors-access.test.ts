import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { DOCTORS_ACCESS_KEY, doctorsAccess } from '../src/modules/configuration/doctors-access.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Doctors need sign-in (owner, 2026-10-10): "For the doctor thing, they must
 * add their phone number and get registered. Otherwise it should not show the
 * doctor things." GET/PATCH /admin/settings/doctors-access (Admin and
 * Operations, audited) switches it; GET /store tells the customer app; the
 * customer dental discovery routes refuse guests with 401 SIGN_IN_REQUIRED
 * while it is on (the default). This file reads the real stored setting
 * (tests/setup/doctors-access.ts pins it off for every other suite) and puts
 * the row, the fixtures and its audit entries back afterwards.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const pinnedRead = doctorsAccess.read;

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;
let saved: SavedRow = null;
let testStart: Date;
let clinicId = '';
let doctorId = '';
let clinicDoctorId = '';

const getSetting = (token = tokens.admin) =>
  request(app).get('/api/v1/admin/settings/doctors-access').set(auth(token));
const patchSetting = (body: unknown, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/doctors-access').set(auth(token)).send(body as object);
const storeFlag = async () => (await request(app).get('/api/v1/store')).body.data.doctors_require_sign_in;

/** Every customer discovery read: clinics list/detail, a clinic's doctors, doctor profile, availability, slots. */
const discoveryPaths = () => [
  '/api/v1/dental/clinics?limit=100',
  `/api/v1/dental/clinics/${clinicId}`,
  `/api/v1/dental/clinics/${clinicId}/doctors`,
  `/api/v1/dental/doctors/${doctorId}`,
  `/api/v1/dental/doctors/${doctorId}/availability?clinic_id=${clinicId}&from=2030-01-07&to=2030-01-08`,
  `/api/v1/dental/doctors/${doctorId}/slots?clinic_id=${clinicId}&date=2030-01-07`,
];
const browse = (path: string, token?: string) => {
  const r = request(app).get(path);
  return token ? r.set(auth(token)) : r;
};

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved =
    (
      await pool.query(
        'SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1',
        [DOCTORS_ACCESS_KEY]
      )
    ).rows[0] ?? null;
  doctorsAccess.read = doctorsAccess.realRead;

  clinicId = (
    await pool.query(
      `INSERT INTO dental_clinics (name, city, address_line, latitude, longitude, contact_phone, operating_start_time, operating_end_time, is_active)
       VALUES ('DA Sign-in Clinic', 'Beruwala', 'DA Test Address', 6.5, 80.0, '+94770000003', '09:00', '17:00', true) RETURNING id`
    )
  ).rows[0].id;
  doctorId = (
    await pool.query(`INSERT INTO doctors (full_name, specialty, is_active) VALUES ('Dr DA Sign-in', 'Orthodontist', true) RETURNING id`)
  ).rows[0].id;
  clinicDoctorId = (
    await pool.query(
      `INSERT INTO clinic_doctors (clinic_id, doctor_id, consultation_fee, is_active) VALUES ($1, $2, 1800, true) RETURNING id`,
      [clinicId, doctorId]
    )
  ).rows[0].id;
});

afterAll(async () => {
  doctorsAccess.read = pinnedRead;
  if (clinicDoctorId) await pool.query('DELETE FROM appointments WHERE clinic_doctor_id = $1', [clinicDoctorId]);
  if (clinicId) await pool.query('DELETE FROM clinic_doctors WHERE clinic_id = $1', [clinicId]);
  if (clinicId) await pool.query('DELETE FROM dental_clinics WHERE id = $1', [clinicId]);
  if (doctorId) await pool.query('DELETE FROM doctors WHERE id = $1', [doctorId]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'DOCTORS_ACCESS_UPDATED' AND created_at >= $1`, [testStart]);
  // Put the stored row back exactly as it was (the hygiene check compares whole rows).
  if (!saved) {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [DOCTORS_ACCESS_KEY]);
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [DOCTORS_ACCESS_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
});

describe('Doctors need sign-in setting', () => {
  it('is ON when nothing is stored, and GET /store says so', async () => {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [DOCTORS_ACCESS_KEY]);
    const res = await getSetting(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ require_sign_in: true, updated_at: null });
    expect(await storeFlag()).toBe(true);
  });

  it('a malformed stored row also means ON', async () => {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, '{"require_sign_in":"no"}'::jsonb, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [DOCTORS_ACCESS_KEY]
    );
    expect((await getSetting()).body.data.require_sign_in).toBe(true);
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [DOCTORS_ACCESS_KEY]);
  });

  it('Operations and Admin switch it, audited; GET /store follows', async () => {
    const off = await patchSetting({ require_sign_in: false }, opsToken);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.data.require_sign_in).toBe(false);
    expect(off.body.data.updated_at).toBeTruthy();
    expect(await storeFlag()).toBe(false);

    const on = await patchSetting({ require_sign_in: true });
    expect(on.status).toBe(200);
    expect(on.body.data.require_sign_in).toBe(true);
    expect((await getSetting(opsToken)).body.data.require_sign_in).toBe(true);
    expect(await storeFlag()).toBe(true);

    const audit = (
      await pool.query(
        `SELECT actor_user_id, old_values, new_values FROM audit_logs
          WHERE action = 'DOCTORS_ACCESS_UPDATED' AND created_at >= $1 ORDER BY created_at`,
        [testStart]
      )
    ).rows;
    expect(audit).toHaveLength(2);
    // The first change had no stored row: the old values are just the key.
    expect(audit[0].old_values).toEqual({ key: DOCTORS_ACCESS_KEY });
    expect(audit[0].new_values).toEqual({ key: DOCTORS_ACCESS_KEY, require_sign_in: false });
    expect(audit[1].old_values).toEqual({ key: DOCTORS_ACCESS_KEY, require_sign_in: false });
    expect(audit[1].new_values).toEqual({ key: DOCTORS_ACCESS_KEY, require_sign_in: true });
    expect(audit.every((a) => a.actor_user_id === users.admin.id)).toBe(true);
  });

  it('refuses malformed bodies (strict) and changes nothing', async () => {
    await patchSetting({ require_sign_in: true });
    for (const body of [{}, { require_sign_in: 'false' }, { require_sign_in: 0 }, { require_sign_in: null }, { require_sign_in: false, extra: 1 }]) {
      const res = await patchSetting(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await getSetting()).body.data.require_sign_in).toBe(true);
  });

  it('is Admin and Operations only', async () => {
    for (const token of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await getSetting(token)).status).toBe(403);
      expect((await patchSetting({ require_sign_in: false }, token)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/settings/doctors-access')).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/settings/doctors-access').send({ require_sign_in: false })).status).toBe(401);
  });
});

describe('Customer dental discovery with the setting ON', () => {
  beforeAll(async () => {
    await patchSetting({ require_sign_in: true });
  });

  it('a guest gets 401 SIGN_IN_REQUIRED with the friendly message on every discovery read', async () => {
    for (const path of discoveryPaths()) {
      const res = await browse(path);
      expect(res.status, path).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code, path).toBe('SIGN_IN_REQUIRED');
      expect(res.body.error.message).toBe('Sign in with your phone number to see doctors.');
      expect(JSON.stringify(res.body)).not.toContain('DA Sign-in');
    }
  });

  it('a signed-in shopper (customer, rider, Operations) sees clinics, doctors and slots', async () => {
    for (const token of [tokens.customer, tokens.rider, opsToken]) {
      for (const path of discoveryPaths()) {
        const res = await browse(path, token);
        expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(200);
      }
    }
    const list = await browse('/api/v1/dental/clinics?limit=100', tokens.customer);
    expect(list.body.data.clinics.map((c: { id: string }) => c.id)).toContain(clinicId);
    const doctors = await browse(`/api/v1/dental/clinics/${clinicId}/doctors`, tokens.customer);
    expect(JSON.stringify(doctors.body.data)).toContain(doctorId);
  });

  it('a bad or expired token gets the usual token error (the app refreshes), not SIGN_IN_REQUIRED', async () => {
    const res = await browse('/api/v1/dental/clinics', 'not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).not.toBe('SIGN_IN_REQUIRED');
  });

  it('an account that cannot shop (Admin, packing staff) is refused like other shopping routes', async () => {
    for (const token of [tokens.admin, tokens.staff]) {
      expect((await browse('/api/v1/dental/clinics', token)).status).toBe(403);
    }
  });

  it('booking still needs sign-in', async () => {
    const res = await request(app).post('/api/v1/dental/appointments/holds').send({});
    expect(res.status).toBe(401);
  });
});

describe('Customer dental discovery with the setting OFF', () => {
  beforeAll(async () => {
    await patchSetting({ require_sign_in: false });
  });

  it('a guest browses as before', async () => {
    for (const path of discoveryPaths()) {
      const res = await browse(path);
      expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(200);
    }
    const list = await browse('/api/v1/dental/clinics?limit=100');
    expect(list.body.data.clinics.map((c: { id: string }) => c.id)).toContain(clinicId);
  });

  it('a signed-in customer is unaffected', async () => {
    for (const path of discoveryPaths()) {
      expect((await browse(path, tokens.customer)).status, path).toBe(200);
    }
  });

  it('booking still needs sign-in', async () => {
    const res = await request(app).post('/api/v1/dental/appointments/holds').send({});
    expect(res.status).toBe(401);
  });
});
