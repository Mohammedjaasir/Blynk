import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { NotificationTemplates } from '../src/modules/notifications/notification.templates.js';
import { adminToken, auth, dentalFixtures, type TestCustomer } from './helpers/dental.js';

/**
 * Task B5 - the confirmation/cancellation notifications B3 left as
 * `// TODO(B5)` markers inside its confirm/cancel transactions. No reminder
 * is tested here (or implemented anywhere): DENTAL-11 is blocked this pass.
 */
describe('Dental appointment notifications (B5)', () => {
  const app = createApp();
  const fx = dentalFixtures({
    idPrefix: 'b5a00001',
    namePrefix: 'B5 Notifications',
    phoneBase: '+9475200',
  });

  const PATIENT_PHONE = '0771234567';
  const NORMALIZED_PHONE = '+94771234567';

  let alice: TestCustomer;

  beforeAll(async () => {
    await fx.purge();
    alice = await fx.customer(1);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  const hold = (customer: TestCustomer, clinicDoctorId: string, startAt: string) =>
    request(app)
      .post('/api/v1/dental/appointments/holds')
      .set(auth(customer.token))
      .send({ clinic_doctor_id: clinicDoctorId, start_at: startAt });

  const confirm = (customer: TestCustomer, id: string) =>
    request(app)
      .post(`/api/v1/dental/appointments/${id}/confirm`)
      .set(auth(customer.token))
      .send({ patient_name: 'Nimal Perera', patient_phone: PATIENT_PHONE });

  const cancel = (customer: TestCustomer, id: string, reason?: string) =>
    request(app)
      .post(`/api/v1/dental/appointments/${id}/cancel`)
      .set(auth(customer.token))
      .send(reason ? { reason } : {});

  const adminCancel = (id: string, reason: string) =>
    request(app)
      .post(`/api/v1/admin/dental/appointments/${id}/cancel`)
      .set(auth(adminToken))
      .send({ reason });

  async function notificationsFor(idempotencyKey: string) {
    const { rows } = await pool.query('SELECT * FROM notifications WHERE idempotency_key = $1', [idempotencyKey]);
    return rows;
  }

  async function names(clinicId: string, doctorId: string) {
    const clinic = (await pool.query('SELECT name FROM dental_clinics WHERE id = $1', [clinicId])).rows[0];
    const doctor = (await pool.query('SELECT full_name FROM doctors WHERE id = $1', [doctorId])).rows[0];
    return { clinicName: clinic.name as string, doctorName: doctor.full_name as string };
  }

  it('confirming an appointment enqueues exactly one CONFIRMED notification with the right idempotency key, recipient and rendered copy', async () => {
    const s = await fx.slot();
    const holdRes = await hold(alice, s.clinicDoctorId, s.slots[0]);
    expect(holdRes.status).toBe(201);
    const id = holdRes.body.data.appointment.id as string;

    const confirmRes = await confirm(alice, id);
    expect(confirmRes.status).toBe(200);

    const rows = await notificationsFor(`dental_appointment_${id}_CONFIRMED`);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.channel).toBe('SMS');
    expect(row.notification_type).toBe('DENTAL_APPOINTMENT_CONFIRMED');
    expect(row.recipient).toBe(NORMALIZED_PHONE);
    expect(row.user_id).toBe(alice.id);
    expect(row.status).toBe('QUEUED');
    expect(row.payload.appointment_id).toBe(id);

    const { clinicName, doctorName } = await names(s.clinicId, s.doctorId);
    const message = NotificationTemplates.render(row.notification_type, row.payload);
    expect(message).toContain(clinicName);
    expect(message).toContain(doctorName);
    expect(message).toContain('payable at the clinic');
    expect(message).not.toContain('!');
  });

  it('a customer cancelling their confirmed appointment enqueues exactly one CANCELLED notification attributed to the customer', async () => {
    const s = await fx.slot();
    const holdRes = await hold(alice, s.clinicDoctorId, s.slots[0]);
    const id = holdRes.body.data.appointment.id as string;
    const confirmRes = await confirm(alice, id);
    expect(confirmRes.status).toBe(200);

    // Security audit 2026-10: the customer's own text never reaches the SMS
    // (patient_phone is a number they typed and never proved). It stays on
    // the appointment for staff.
    const cancelRes = await cancel(alice, id, 'X-MARKER visit http://marker.invalid/z');
    expect(cancelRes.status).toBe(200);

    const rows = await notificationsFor(`dental_appointment_${id}_CANCELLED`);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.notification_type).toBe('DENTAL_APPOINTMENT_CANCELLED');
    expect(row.recipient).toBe(NORMALIZED_PHONE);
    expect(row.user_id).toBe(alice.id);
    expect(row.payload.cancelled_by).toBe('customer');
    expect(row.payload.reason).toBeNull();
    expect(JSON.stringify(row.payload)).not.toContain('X-MARKER');

    const message = NotificationTemplates.render(row.notification_type, row.payload);
    expect(message).toContain('cancelled by you');
    expect(message).not.toContain('X-MARKER');
    expect(message).not.toContain('Reason:');
    expect(message).not.toContain('!');

    const stored = await pool.query('SELECT cancellation_reason FROM appointments WHERE id = $1', [id]);
    expect(stored.rows[0].cancellation_reason).toBe('X-MARKER visit http://marker.invalid/z');
  });

  it('a customer cancel payload queued with a reason (before the fix) still renders without it', () => {
    const message = NotificationTemplates.render('DENTAL_APPOINTMENT_CANCELLED', {
      clinic_name: 'C',
      doctor_name: 'D',
      start_at: new Date().toISOString(),
      cancelled_by: 'customer',
      reason: 'X-MARKER',
    });
    expect(message).not.toContain('X-MARKER');
  });

  it('an admin cancelling a confirmed appointment enqueues exactly one CANCELLED notification, addressed to the customer and attributed to the clinic', async () => {
    const s = await fx.slot();
    const holdRes = await hold(alice, s.clinicDoctorId, s.slots[0]);
    const id = holdRes.body.data.appointment.id as string;
    const confirmRes = await confirm(alice, id);
    expect(confirmRes.status).toBe(200);

    const adminRes = await adminCancel(id, 'Doctor unavailable');
    expect(adminRes.status).toBe(200);

    const rows = await notificationsFor(`dental_appointment_${id}_CANCELLED`);
    expect(rows.length).toBe(1);
    const row = rows[0];
    // Goes to the appointment's owner, never to the acting admin.
    expect(row.user_id).toBe(alice.id);
    expect(row.recipient).toBe(NORMALIZED_PHONE);
    expect(row.payload.cancelled_by).toBe('clinic');
    expect(row.payload.reason).toBe('Doctor unavailable');

    const message = NotificationTemplates.render(row.notification_type, row.payload);
    expect(message).toContain('cancelled by the clinic');
    expect(message).toContain('Doctor unavailable');
  });

  it('an admin force-cancelling an abandoned HELD row enqueues no notification (never confirmed, no phone captured yet)', async () => {
    const s = await fx.slot();
    const holdRes = await hold(alice, s.clinicDoctorId, s.slots[0]);
    const id = holdRes.body.data.appointment.id as string;

    const adminRes = await adminCancel(id, 'Freed for testing');
    expect(adminRes.status).toBe(200);

    const rows = await notificationsFor(`dental_appointment_${id}_CANCELLED`);
    expect(rows.length).toBe(0);
  });

  it('a retried confirm call (client retry / double click) never double-enqueues the CONFIRMED notification', async () => {
    const s = await fx.slot();
    const holdRes = await hold(alice, s.clinicDoctorId, s.slots[0]);
    const id = holdRes.body.data.appointment.id as string;

    const first = await confirm(alice, id);
    expect(first.status).toBe(200);

    // B3's own state check rejects the second call (status is no longer
    // HELD) before this task's enqueue call is ever reached.
    const second = await confirm(alice, id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('APPOINTMENT_NOT_HELD');

    const rows = await notificationsFor(`dental_appointment_${id}_CONFIRMED`);
    expect(rows.length).toBe(1);
  });

  it('a retried cancel call (already cancelled) never double-enqueues the CANCELLED notification', async () => {
    const s = await fx.slot();
    const holdRes = await hold(alice, s.clinicDoctorId, s.slots[0]);
    const id = holdRes.body.data.appointment.id as string;
    await confirm(alice, id);

    const first = await cancel(alice, id, 'Cannot make it');
    expect(first.status).toBe(200);

    const second = await cancel(alice, id, 'Cannot make it');
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('APPOINTMENT_ALREADY_CANCELLED');

    const rows = await notificationsFor(`dental_appointment_${id}_CANCELLED`);
    expect(rows.length).toBe(1);
  });

  it('leaves notification.repository.ts and notification.service.ts byte-identical to the committed pre-task version', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const files = [
      'backend/api/src/modules/notifications/notification.repository.ts',
      'backend/api/src/modules/notifications/notification.service.ts',
    ];
    const diff = execSync(`git diff --stat HEAD -- ${files.join(' ')}`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(diff.trim()).toBe('');
  });
});
