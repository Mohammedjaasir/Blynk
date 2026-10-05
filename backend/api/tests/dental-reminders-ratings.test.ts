import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { NotificationTemplates, setPushSenderForTests, type PushMessage, type PushSender, type PushTokenOutcome } from '../src/modules/notifications/index.js';
import {
  chooseReminderChannel,
  doctorLabel,
  isReminderDue,
  reminderMessage,
  reminderWindow,
  remindIfDue,
  runAppointmentReminders,
  runRatingPrompts,
  smsFallbackFrom,
  SMS_FALLBACK_KEY,
} from '../src/modules/dental/appointment-reminders.js';
import { ADMIN, adminToken, auth, dentalFixtures, type SlotFixture, type TestCustomer } from './helpers/dental.js';

/**
 * Migration 023: day-before appointment reminders (push, SMS fallback,
 * exactly once, Colombo time) and doctor ratings after a visit.
 *
 * The reminder clock is injected: every "now" here is in 2031, and every
 * appointment is a row this file inserts directly on its own clinic-doctor
 * pairings, so a pass never touches anyone else's data (`clinicDoctorIds`).
 * Google is never called: a fake PushSender stands in for FCM.
 */

class FakeSender implements PushSender {
  async send(tokens: string[], _message: PushMessage): Promise<PushTokenOutcome[]> {
    return tokens.map((token) => ({ token, ok: true as const }));
  }
}

const app = createApp();
const fx = dentalFixtures({ idPrefix: 'b6a00001', namePrefix: 'B6 Reminders', phoneBase: '+9475300' });
const opsToken = generateAccessToken({ id: ADMIN.id, phone: ADMIN.phone, role: 'OPERATIONS' });

// 18:30 in Colombo (UTC+5:30) on 10 March 2031; "tomorrow" there is
// 2031-03-10T18:30Z .. 2031-03-11T18:30Z.
const NOW = new Date('2031-03-10T13:00:00Z');
const TOMORROW_0900 = '2031-03-11T03:30:00Z'; // 09:00 Colombo
const PHONE = '+94771230001';

let alice: TestCustomer; // has an app device
let bob: TestCustomer; // no device
let carol: TestCustomer;
let seqMinutes = 0;
let originalSetting: { value: unknown; updated_at: Date } | undefined;

async function insertAppointment(
  s: SlotFixture,
  customer: TestCustomer,
  startIso: string,
  opts: { status?: string; minutes?: number; phone?: string | null } = {}
) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + (opts.minutes ?? 30) * 60_000);
  const { rows } = await pool.query(
    `INSERT INTO appointments (clinic_doctor_id, customer_id, start_at, end_at, status, held_by, patient_name, patient_phone, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $2, 'Nimal Perera', $6, $7) RETURNING id`,
    [s.clinicDoctorId, customer.id, start, end, opts.status ?? 'CONFIRMED', opts.phone === undefined ? PHONE : opts.phone, `b6_${Date.now()}_${++seqMinutes}`]
  );
  return rows[0].id as string;
}

const notificationsFor = async (appointmentId: string) =>
  (
    await pool.query(
      `SELECT channel, notification_type, recipient, payload, idempotency_key FROM notifications
        WHERE idempotency_key LIKE $1 ORDER BY created_at`,
      [`dental_appointment_${appointmentId}_%`]
    )
  ).rows;
const remindedAt = async (id: string) => (await fx.appointmentRow(id)).reminded_at as Date | null;
const scope = (s: SlotFixture) => ({ now: NOW, clinicDoctorIds: [s.clinicDoctorId] });
const doctorName = async (s: SlotFixture) => (await pool.query('SELECT full_name FROM doctors WHERE id = $1', [s.doctorId])).rows[0].full_name as string;
const clinicName = async (s: SlotFixture) => (await pool.query('SELECT name FROM dental_clinics WHERE id = $1', [s.clinicId])).rows[0].name as string;

async function setSmsFallback(enabled: boolean) {
  await pool.query('UPDATE system_configurations SET value = $2 WHERE key = $1', [SMS_FALLBACK_KEY, JSON.stringify({ enabled })]);
}

beforeAll(async () => {
  await fx.purge();
  alice = await fx.customer(1);
  bob = await fx.customer(2);
  carol = await fx.customer(3);
  await pool.query(
    `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`,
    [alice.id, `b6-test-device-${alice.id}`]
  );
  originalSetting = (await pool.query('SELECT value, updated_at FROM system_configurations WHERE key = $1', [SMS_FALLBACK_KEY])).rows[0];
});

afterEach(async () => {
  setPushSenderForTests(undefined);
  if (originalSetting) {
    await pool.query('UPDATE system_configurations SET value = $2, updated_at = $3 WHERE key = $1', [
      SMS_FALLBACK_KEY,
      JSON.stringify(originalSetting.value),
      originalSetting.updated_at,
    ]);
  }
});

afterAll(async () => {
  setPushSenderForTests(undefined);
  await fx.cleanup(); // ratings cascade from appointments; device tokens from users
});

// ============================================================================
describe('Reminder time window (Asia/Colombo, injectable clock)', () => {
  it('opens at 18:00 Colombo time, not 18:00 UTC', () => {
    expect(reminderWindow(new Date('2031-03-10T12:29:00Z'))).toBeNull(); // 17:59 Colombo
    const w = reminderWindow(new Date('2031-03-10T12:30:00Z')); // 18:00 Colombo
    expect(w?.from.toISOString()).toBe('2031-03-10T18:30:00.000Z'); // midnight Colombo
    expect(w?.to.toISOString()).toBe('2031-03-11T18:30:00.000Z');
    // 18:00 UTC is 23:30 Colombo - still the 10th there, so still open.
    expect(reminderWindow(new Date('2031-03-10T18:00:00Z'))).not.toBeNull();
    // 19:00 UTC on the 10th is 00:30 on the 11th in Colombo: closed.
    expect(reminderWindow(new Date('2031-03-10T19:00:00Z'))).toBeNull();
  });

  it('covers tomorrow (clinic-local) only', () => {
    expect(isReminderDue(new Date(TOMORROW_0900), NOW)).toBe(true);
    expect(isReminderDue(new Date('2031-03-10T15:00:00Z'), NOW)).toBe(false); // 20:30 today
    expect(isReminderDue(new Date('2031-03-11T18:29:00Z'), NOW)).toBe(true); // 23:59 tomorrow
    expect(isReminderDue(new Date('2031-03-11T18:30:00Z'), NOW)).toBe(false); // 00:00 the day after
  });

  it('a late booking is reminded only when more than two hours away', () => {
    const late = new Date('2031-03-10T18:00:00Z'); // 23:30 Colombo
    expect(isReminderDue(new Date('2031-03-10T19:00:00Z'), late)).toBe(false); // 00:30, one hour away
    expect(isReminderDue(new Date('2031-03-10T20:00:00Z'), late)).toBe(false); // exactly two hours
    expect(isReminderDue(new Date('2031-03-10T20:01:00Z'), late)).toBe(true);
  });

  it('builds the reminder text with clinic-local time', () => {
    expect(reminderMessage({ doctorName: 'Dr. Silva', clinicName: 'Smile Dental', startAt: new Date(TOMORROW_0900) })).toEqual({
      title: 'Appointment tomorrow',
      body: "Dr Silva, Smile Dental at 9:00 AM. Reply in the app to cancel if you can't make it.",
    });
    expect(doctorLabel('Perera')).toBe('Dr Perera');
  });
});

describe('Reminder channel choice', () => {
  it('push when configured and the customer has a device, else SMS if allowed, else nothing', () => {
    const base = { pushEnabled: true, hasDevice: true, smsFallback: true, hasPhone: true };
    expect(chooseReminderChannel(base)).toBe('PUSH');
    expect(chooseReminderChannel({ ...base, hasDevice: false })).toBe('SMS');
    expect(chooseReminderChannel({ ...base, pushEnabled: false })).toBe('SMS');
    expect(chooseReminderChannel({ ...base, hasDevice: false, smsFallback: false })).toBe('NONE');
    expect(chooseReminderChannel({ ...base, hasDevice: false, hasPhone: false })).toBe('NONE');
  });

  it('reads the SMS fallback setting, defaulting to on', () => {
    expect(smsFallbackFrom({ enabled: false })).toBe(false);
    expect(smsFallbackFrom(false)).toBe(false);
    expect(smsFallbackFrom({ enabled: true })).toBe(true);
    expect(smsFallbackFrom(undefined)).toBe(true);
    expect(smsFallbackFrom({ enabled: 'no' })).toBe(true);
  });
});

describe('Reminder pass (database)', () => {
  it('pushes to a customer with a device, once', async () => {
    setPushSenderForTests(new FakeSender());
    const s = await fx.slot();
    const id = await insertAppointment(s, alice, TOMORROW_0900);

    expect(await runAppointmentReminders(scope(s))).toEqual([{ appointmentId: id, channel: 'PUSH' }]);
    const rows = await notificationsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'PUSH', notification_type: 'PUSH_APPOINTMENT_REMINDER', recipient: alice.id });
    expect(rows[0].payload).toEqual({
      title: 'Appointment tomorrow',
      body: `${doctorLabel(await doctorName(s))}, ${await clinicName(s)} at 9:00 AM. Reply in the app to cancel if you can't make it.`,
      data: { type: 'appointment', appointment_id: id },
    });
    expect(await remindedAt(id)).not.toBeNull();

    // The next pass finds nothing left to do.
    expect(await runAppointmentReminders(scope(s))).toEqual([]);
    expect(await notificationsFor(id)).toHaveLength(1);
  });

  it('falls back to SMS to the booking phone without a device, or without push configured', async () => {
    setPushSenderForTests(new FakeSender());
    const s = await fx.slot();
    const noDevice = await insertAppointment(s, bob, TOMORROW_0900);
    expect(await runAppointmentReminders(scope(s))).toEqual([{ appointmentId: noDevice, channel: 'SMS' }]);
    const [sms] = await notificationsFor(noDevice);
    expect(sms).toMatchObject({ channel: 'SMS', notification_type: 'DENTAL_APPOINTMENT_REMINDER', recipient: PHONE });
    expect(NotificationTemplates.render(sms.notification_type, sms.payload)).toMatch(
      /^Blynk: Appointment tomorrow - Dr .+ at 9:00 AM\. Reply in the app to cancel if you can't make it\.$/
    );

    setPushSenderForTests(null); // no Firebase key
    const s2 = await fx.slot();
    const pushOff = await insertAppointment(s2, alice, TOMORROW_0900);
    expect(await runAppointmentReminders(scope(s2))).toEqual([{ appointmentId: pushOff, channel: 'SMS' }]);
  });

  it('sends nothing (but still marks it handled) when the SMS fallback is switched off', async () => {
    setPushSenderForTests(null);
    await setSmsFallback(false);
    const s = await fx.slot();
    const id = await insertAppointment(s, bob, TOMORROW_0900);
    expect(await runAppointmentReminders(scope(s))).toEqual([{ appointmentId: id, channel: 'NONE' }]);
    expect(await notificationsFor(id)).toHaveLength(0);
    expect(await remindedAt(id)).not.toBeNull();
    expect(await runAppointmentReminders(scope(s))).toEqual([]);
  });

  it('never reminds a cancelled (or held) appointment, nor one outside tomorrow', async () => {
    setPushSenderForTests(new FakeSender());
    const s = await fx.slot();
    const byCustomer = await insertAppointment(s, alice, TOMORROW_0900, { status: 'CANCELLED_BY_CUSTOMER' });
    const byClinic = await insertAppointment(s, alice, '2031-03-11T04:00:00Z', { status: 'CANCELLED_BY_CLINIC' });
    const held = await insertAppointment(s, alice, '2031-03-11T04:30:00Z', { status: 'HELD', phone: null });
    const dayAfter = await insertAppointment(s, alice, '2031-03-12T04:30:00Z');

    expect(await runAppointmentReminders(scope(s))).toEqual([]);
    for (const id of [byCustomer, byClinic, held, dayAfter]) {
      expect(await remindedAt(id)).toBeNull();
      expect(await notificationsFor(id)).toHaveLength(0);
    }
    // Before 18:00 nothing goes out at all.
    expect(await runAppointmentReminders({ now: new Date('2031-03-10T12:00:00Z'), clinicDoctorIds: [s.clinicDoctorId] })).toEqual([]);
  });

  it('two passes racing send each reminder exactly once', async () => {
    setPushSenderForTests(new FakeSender());
    const s = await fx.slot();
    const ids = await Promise.all(
      ['03:30', '04:00', '04:30', '05:00', '05:30'].map((t) => insertAppointment(s, carol, `2031-03-11T${t}:00Z`))
    );
    const [a, b] = await Promise.all([runAppointmentReminders(scope(s)), runAppointmentReminders(scope(s))]);
    const handled = [...a, ...b].map((o) => o.appointmentId).sort();
    expect(handled).toEqual([...ids].sort());
    for (const id of ids) expect(await notificationsFor(id)).toHaveLength(1);
  });

  it('a late booking is reminded at once when due, through remindIfDue', async () => {
    setPushSenderForTests(new FakeSender());
    const s = await fx.slot();
    const late = new Date('2031-03-10T17:00:00Z'); // 22:30 Colombo
    const soon = await insertAppointment(s, alice, '2031-03-10T18:45:00Z'); // 00:15 tomorrow, under 2h
    const later = await insertAppointment(s, alice, '2031-03-11T02:30:00Z'); // 08:00 tomorrow

    expect(await db.transaction().execute((trx) => remindIfDue(trx, soon, late))).toBeNull();
    expect(await db.transaction().execute((trx) => remindIfDue(trx, later, late))).toEqual({ appointmentId: later, channel: 'PUSH' });
    expect(await db.transaction().execute((trx) => remindIfDue(trx, later, late))).toBeNull(); // once
    expect(await remindedAt(soon)).toBeNull();
    expect(await notificationsFor(later)).toHaveLength(1);
  });

  it('confirming through the API still works, and does not remind outside the window', async () => {
    const s = await fx.slot();
    const hold = await request(app)
      .post('/api/v1/dental/appointments/holds')
      .set(auth(bob.token))
      .send({ clinic_doctor_id: s.clinicDoctorId, start_at: s.slots[0] });
    expect(hold.status).toBe(201);
    const id = hold.body.data.appointment.id as string;
    const res = await request(app)
      .post(`/api/v1/dental/appointments/${id}/confirm`)
      .set(auth(bob.token))
      .send({ patient_name: 'Nimal Perera', patient_phone: '0771234567' });
    expect(res.status).toBe(200);
    expect(await remindedAt(id)).toBeNull();
    expect((await notificationsFor(id)).map((n) => n.notification_type)).toEqual(['DENTAL_APPOINTMENT_CONFIRMED']);
  });
});

describe('Rating prompt push', () => {
  it('pushes once, two hours after the slot ends, to unrated visits only', async () => {
    setPushSenderForTests(new FakeSender());
    const s = await fx.slot();
    const due = await insertAppointment(s, alice, '2031-03-10T09:00:00Z'); // ended 09:30Z, 3.5h ago
    const tooSoon = await insertAppointment(s, alice, '2031-03-10T11:00:00Z'); // ended 1.5h ago
    const tooOld = await insertAppointment(s, alice, '2031-03-08T09:00:00Z');
    const rated = await insertAppointment(s, alice, '2031-03-10T08:00:00Z');
    await pool.query(
      `INSERT INTO doctor_ratings (appointment_id, doctor_id, clinic_id, customer_id, stars) VALUES ($1, $2, $3, $4, 5)`,
      [rated, s.doctorId, s.clinicId, alice.id]
    );

    expect(await runRatingPrompts(scope(s))).toEqual([due]);
    const [push] = await notificationsFor(due);
    expect(push).toMatchObject({ channel: 'PUSH', notification_type: 'PUSH_RATING_PROMPT' });
    expect(push.payload.title).toBe(`How was your visit with ${doctorLabel(await doctorName(s))}?`);
    expect(push.payload.data).toEqual({ type: 'appointment', appointment_id: due });
    expect(await runRatingPrompts(scope(s))).toEqual([]);
    for (const id of [tooSoon, tooOld, rated]) expect(await notificationsFor(id)).toHaveLength(0);
  });

  it('sends nothing when push is not configured', async () => {
    setPushSenderForTests(null);
    const s = await fx.slot();
    const id = await insertAppointment(s, alice, '2031-03-10T09:00:00Z');
    expect(await runRatingPrompts(scope(s))).toEqual([]);
    expect((await fx.appointmentRow(id)).rating_prompted_at).toBeNull();
  });
});

// ============================================================================
describe('Doctor ratings', () => {
  const PAST = '2026-01-05T04:00:00Z';
  const rate = (customer: TestCustomer, id: string, body: unknown) =>
    request(app).post(`/api/v1/dental/appointments/${id}/rating`).set(auth(customer.token)).send(body as object);

  it('rates a past confirmed visit once, and shows it on the appointment', async () => {
    const s = await fx.slot();
    const id = await insertAppointment(s, alice, PAST);

    const before = await request(app).get(`/api/v1/dental/appointments/${id}`).set(auth(alice.token));
    expect(before.body.data.appointment).toMatchObject({ can_rate: true, rating: null });

    const res = await rate(alice, id, { stars: 4, comment: '  Gentle and on time.  ' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.rating).toMatchObject({ stars: 4, comment: 'Gentle and on time.' });
    expect(res.body.data.appointment).toMatchObject({ can_rate: false, rating: { stars: 4, comment: 'Gentle and on time.' } });

    const again = await rate(alice, id, { stars: 5 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RATED');

    const list = await request(app).get('/api/v1/dental/appointments?bucket=past').set(auth(alice.token));
    const row = list.body.data.appointments.find((a: { id: string }) => a.id === id);
    expect(row).toMatchObject({ can_rate: false, rating: { stars: 4 } });
  });

  it('refuses visits that are not over, not confirmed, or not yours', async () => {
    const s = await fx.slot();
    const future = await insertAppointment(s, alice, '2031-01-01T04:00:00Z');
    const cancelled = await insertAppointment(s, alice, PAST, { status: 'CANCELLED_BY_CLINIC' });
    const bobs = await insertAppointment(s, bob, '2026-01-05T05:00:00Z');

    const r1 = await rate(alice, future, { stars: 5 });
    expect([r1.status, r1.body.error.code]).toEqual([422, 'VISIT_NOT_FINISHED']);
    const r2 = await rate(alice, cancelled, { stars: 5 });
    expect([r2.status, r2.body.error.code]).toEqual([422, 'APPOINTMENT_NOT_RATEABLE']);
    const r3 = await rate(alice, bobs, { stars: 5 });
    expect([r3.status, r3.body.error.code]).toEqual([404, 'APPOINTMENT_NOT_FOUND']);

    const listed = await request(app).get(`/api/v1/dental/appointments/${future}`).set(auth(alice.token));
    expect(listed.body.data.appointment.can_rate).toBe(false);
  });

  it('validates stars (1-5 whole) and the comment (max 500, blank means none)', async () => {
    const s = await fx.slot();
    const id = await insertAppointment(s, alice, PAST);
    for (const stars of [0, 6, 2.5, '4', undefined]) {
      const r = await rate(alice, id, { stars });
      expect(r.status, String(stars)).toBe(400);
    }
    expect((await rate(alice, id, { stars: 3, comment: 'x'.repeat(501) })).status).toBe(400);
    const ok = await rate(alice, id, { stars: 3, comment: '   ' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.rating.comment).toBeNull();
  });

  it('the doctor profile and clinic list show the visible average (1 decimal) and count', async () => {
    const s = await fx.slot();
    const noRatings = await request(app).get(`/api/v1/dental/doctors/${s.doctorId}`);
    expect(noRatings.body.data.doctor).toMatchObject({ rating_average: null, rating_count: 0 });

    const ids = await Promise.all(
      ['2026-01-05T04:00:00Z', '2026-01-05T04:30:00Z', '2026-01-05T05:00:00Z'].map((t) => insertAppointment(s, alice, t))
    );
    for (const [i, stars] of [5, 4, 4].entries()) expect((await rate(alice, ids[i], { stars })).status).toBe(201);

    const profile = await request(app).get(`/api/v1/dental/doctors/${s.doctorId}`);
    expect(profile.body.data.doctor).toMatchObject({ rating_average: 4.3, rating_count: 3 });
    const roster = await request(app).get(`/api/v1/dental/clinics/${s.clinicId}/doctors`);
    expect(roster.body.data.doctors[0]).toMatchObject({ doctor_id: s.doctorId, rating_average: 4.3, rating_count: 3 });

    // Staff list them, hide one, and the public numbers drop it.
    const list = await request(app).get(`/api/v1/admin/dental/doctors/${s.doctorId}/ratings`).set(auth(opsToken));
    expect(list.status).toBe(200);
    expect(list.body.data.ratings).toHaveLength(3);
    expect(list.body.data.doctor).toMatchObject({ rating_average: 4.3, rating_count: 3 });
    const five = list.body.data.ratings.find((r: { stars: number }) => r.stars === 5);
    expect(five).toMatchObject({ is_hidden: false, patient_name: 'Nimal Perera', clinic: { id: s.clinicId } });

    const hide = await request(app).patch(`/api/v1/admin/dental/ratings/${five.id}/hidden`).set(auth(adminToken)).send({ hidden: true });
    expect(hide.status).toBe(200);
    expect(hide.body.data.rating.is_hidden).toBe(true);
    expect((await request(app).get(`/api/v1/dental/doctors/${s.doctorId}`)).body.data.doctor).toMatchObject({
      rating_average: 4.0,
      rating_count: 2,
    });
    const after = await request(app).get(`/api/v1/admin/dental/doctors/${s.doctorId}/ratings`).set(auth(adminToken));
    expect(after.body.data.hidden_count).toBe(1);
    expect(after.body.data.ratings).toHaveLength(3); // staff still see hidden ones
    const adminDoctors = await request(app).get('/api/v1/admin/dental/doctors').set(auth(opsToken));
    expect(adminDoctors.body.data.doctors.find((d: { id: string }) => d.id === s.doctorId)).toMatchObject({ rating_count: 2 });

    const unhide = await request(app).patch(`/api/v1/admin/dental/ratings/${five.id}/hidden`).set(auth(opsToken)).send({ hidden: false });
    expect(unhide.body.data.rating.is_hidden).toBe(false);
    expect((await request(app).get(`/api/v1/dental/doctors/${s.doctorId}`)).body.data.doctor.rating_count).toBe(3);
  });

  it('only staff moderate, and unknown ids are 404', async () => {
    const s = await fx.slot();
    expect((await request(app).get(`/api/v1/admin/dental/doctors/${s.doctorId}/ratings`).set(auth(alice.token))).status).toBe(403);
    const missing = await request(app)
      .patch('/api/v1/admin/dental/ratings/00000000-0000-4000-8000-000000000000/hidden')
      .set(auth(adminToken))
      .send({ hidden: true });
    expect([missing.status, missing.body.error.code]).toEqual([404, 'RATING_NOT_FOUND']);
    expect((await request(app).patch(`/api/v1/admin/dental/ratings/not-a-uuid/hidden`).set(auth(adminToken)).send({ hidden: true })).status).toBe(400);
    const noDoctor = await request(app).get('/api/v1/admin/dental/doctors/00000000-0000-4000-8000-000000000000/ratings').set(auth(adminToken));
    expect(noDoctor.status).toBe(404);
  });
});
