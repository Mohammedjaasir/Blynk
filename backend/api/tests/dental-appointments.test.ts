import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { availabilityService } from '../src/modules/dental/availability.service.js';
import { canCustomerCancel, HOLD_TTL_MINUTES } from '../src/modules/dental/appointment.service.js';
import {
  ADMIN,
  adminToken,
  auth,
  dentalFixtures,
  REFERENCE_MONDAY,
  type TestCustomer,
} from './helpers/dental.js';

/**
 * Task B3 - appointment booking lifecycle (hold / confirm / cancel), the
 * state-transition rules from plan §5.2, and the IDOR/tampering rules from
 * plan §15. The genuine two-customers-one-slot race lives in its own file,
 * tests/dental-booking-concurrency.test.ts.
 */
describe('Dental appointments API (POST/GET /api/v1/dental/appointments)', () => {
  const app = createApp();
  const fx = dentalFixtures({
    idPrefix: 'b3a00001',
    namePrefix: 'B3A Appointments',
    phoneBase: '+9474100',
  });

  let alice: TestCustomer;
  let bob: TestCustomer;

  beforeAll(async () => {
    await fx.purge();
    alice = await fx.customer(1);
    bob = await fx.customer(2);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

  const hold = (customer: TestCustomer, clinicDoctorId: string, startAt: string, body: object = {}) =>
    request(app)
      .post('/api/v1/dental/appointments/holds')
      .set(auth(customer.token))
      .send({ clinic_doctor_id: clinicDoctorId, start_at: startAt, ...body });

  const confirm = (customer: TestCustomer, id: string, body: object = {}) =>
    request(app)
      .post(`/api/v1/dental/appointments/${id}/confirm`)
      .set(auth(customer.token))
      .send({ patient_name: 'Nimal Perera', patient_phone: '0771234567', ...body });

  const cancel = (customer: TestCustomer, id: string, body: object = {}) =>
    request(app).post(`/api/v1/dental/appointments/${id}/cancel`).set(auth(customer.token)).send(body);

  const adminCancel = (id: string, body: object = { reason: 'Doctor unavailable' }) =>
    request(app).post(`/api/v1/admin/dental/appointments/${id}/cancel`).set(auth(adminToken)).send(body);

  /** A fresh slot already held by `customer`. */
  async function heldSlot(customer: TestCustomer) {
    const s = await fx.slot();
    const res = await hold(customer, s.clinicDoctorId, s.slots[0]);
    expect(res.status).toBe(201);
    return { ...s, startAt: s.slots[0], id: res.body.data.appointment.id as string };
  }

  /** A fresh slot already confirmed by `customer`. */
  async function confirmedSlot(customer: TestCustomer) {
    const held = await heldSlot(customer);
    const res = await confirm(customer, held.id);
    expect(res.status).toBe(200);
    return held;
  }

  // ==========================================================================
  // HOLD
  // ==========================================================================
  describe('POST /dental/appointments/holds', () => {
    it('creates a five-minute hold with a server-derived end_at, fee snapshot and one history row', async () => {
      const s = await fx.slot({ fee: 3150 });
      const before = Date.now();

      const res = await hold(alice, s.clinicDoctorId, s.slots[0]);

      expect(res.status).toBe(201);
      const appt = res.body.data.appointment;
      expect(res.body.data.is_idempotent_replay).toBe(false);
      expect(appt.status).toBe('HELD');
      expect(appt.clinic_doctor_id).toBe(s.clinicDoctorId);
      expect(iso(appt.start_at)).toBe(iso(s.slots[0]));
      // end_at is derived from the template's slot_duration_minutes, never sent.
      expect(new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()).toBe(30 * 60_000);
      // The fee is read server-side at hold time (plan §15 price manipulation).
      expect(appt.consultation_fee_snapshot).toBe(3150);

      const heldUntilMs = new Date(appt.held_until).getTime();
      expect(heldUntilMs).toBeGreaterThanOrEqual(before + HOLD_TTL_MINUTES * 60_000 - 5_000);
      expect(heldUntilMs).toBeLessThanOrEqual(Date.now() + HOLD_TTL_MINUTES * 60_000 + 5_000);

      const row = await fx.appointmentRow(appt.id);
      expect(row.customer_id).toBe(alice.id);
      expect(row.held_by).toBe(alice.id);
      expect(await fx.history(appt.id)).toEqual([
        { old_status: null, new_status: 'HELD', changed_by: alice.id },
      ]);
    });

    it('rejects a start_at that is not on the doctor template, even though the client asked for it', async () => {
      const s = await fx.slot();

      const res = await hold(alice, s.clinicDoctorId, `${REFERENCE_MONDAY}T03:37:00Z`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(await fx.rowsForSlot(s.clinicDoctorId, `${REFERENCE_MONDAY}T03:37:00Z`)).toHaveLength(0);
    });

    it('rejects a slot on a blocked date', async () => {
      const s = await fx.slot();
      await fx.blockDate(s.clinicDoctorId, REFERENCE_MONDAY);

      const res = await hold(alice, s.clinicDoctorId, s.slots[0]);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('404s for an unknown clinic_doctor_id and for a paused pairing (no FK 500, no leak)', async () => {
      const unknown = await hold(alice, '00000000-0000-0000-0000-000000000000', `${REFERENCE_MONDAY}T03:30:00Z`);
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('CLINIC_DOCTOR_NOT_FOUND');

      const paused = await fx.slot({ active: false });
      const res = await hold(alice, paused.clinicDoctorId, paused.slots[0]);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLINIC_DOCTOR_NOT_FOUND');
    });

    it('409 SLOT_HELD when someone else is holding the slot and the hold is still live', async () => {
      const held = await heldSlot(alice);

      const res = await hold(bob, held.clinicDoctorId, held.startAt);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_HELD');
      expect(await fx.activeRowsForSlot(held.clinicDoctorId, held.startAt)).toHaveLength(1);
    });

    it('409 SLOT_UNAVAILABLE when the slot is already CONFIRMED', async () => {
      const confirmed = await confirmedSlot(alice);

      const res = await hold(bob, confirmed.clinicDoctorId, confirmed.startAt);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
    });

    it('lets a second customer reclaim an EXPIRED hold, reusing the same row rather than inserting a second', async () => {
      const held = await heldSlot(alice);
      await fx.expireHold(held.id);

      const res = await hold(bob, held.clinicDoctorId, held.startAt);

      expect(res.status).toBe(201);
      expect(res.body.data.appointment.id).toBe(held.id); // same row, reclaimed
      const rows = await fx.rowsForSlot(held.clinicDoctorId, held.startAt);
      expect(rows).toHaveLength(1);
      // customer_id moves with held_by, or the previous holder would still own it.
      expect(rows[0].customer_id).toBe(bob.id);
      expect(rows[0].held_by).toBe(bob.id);
      expect(new Date(rows[0].held_until).getTime()).toBeGreaterThan(Date.now());
    });

    it('lets the same customer re-hold their own live slot, extending it in place', async () => {
      const held = await heldSlot(alice);
      const first = (await fx.appointmentRow(held.id)).held_until;

      const res = await hold(alice, held.clinicDoctorId, held.startAt, { idempotency_key: 'b3a-rehold-1' });

      expect(res.status).toBe(201);
      expect(res.body.data.appointment.id).toBe(held.id);
      expect(await fx.rowsForSlot(held.clinicDoctorId, held.startAt)).toHaveLength(1);
      expect(new Date((await fx.appointmentRow(held.id)).held_until).getTime()).toBeGreaterThanOrEqual(
        new Date(first).getTime()
      );
      // A reclaim is not a new appointment: no second history row.
      expect(await fx.history(held.id)).toHaveLength(1);
    });

    // Security audit 2026-10: a HELD row made before staff blocked the date
    // must not be reclaimed (or confirmed) on the blocked day.
    it('refuses re-holding your own live slot once its date is blocked, and the confirm too', async () => {
      const held = await heldSlot(alice);
      await fx.blockDate(held.clinicDoctorId, REFERENCE_MONDAY); // direct insert: the HELD row stays live

      const res = await hold(alice, held.clinicDoctorId, held.startAt);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(res.body.error.details).toEqual({ reason: 'BLOCKED' });

      const confirmed = await confirm(alice, held.id);
      expect(confirmed.status).toBe(409);
      expect(confirmed.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect((await fx.appointmentRow(held.id)).status).toBe('HELD');
    });

    it("refuses another customer reclaiming an expired hold on a blocked date", async () => {
      const held = await heldSlot(alice);
      await fx.blockDate(held.clinicDoctorId, REFERENCE_MONDAY);
      await fx.expireHold(held.id);

      const res = await hold(bob, held.clinicDoctorId, held.startAt);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
      const row = await fx.appointmentRow(held.id);
      expect(row.customer_id).toBe(alice.id);
    });

    it('refuses reclaiming a slot that is no longer on the template', async () => {
      const held = await heldSlot(alice);
      await pool.query('DELETE FROM doctor_availability WHERE clinic_doctor_id = $1', [held.clinicDoctorId]);

      const res = await hold(alice, held.clinicDoctorId, held.startAt);
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual({ reason: 'NOT_ON_TEMPLATE' });
    });

    it('blocking a date in Admin/Ops expires the live holds on that date only', async () => {
      const held = await heldSlot(alice);
      // A hold on another day stays live.
      const other = await heldSlot(bob);
      await pool.query(
        `UPDATE appointments SET start_at = start_at + interval '7 days', end_at = end_at + interval '7 days' WHERE id = $1`,
        [other.id]
      );

      const res = await request(app)
        .post(`/api/v1/admin/dental/clinic-doctors/${held.clinicDoctorId}/blocked-dates`)
        .set(auth(adminToken))
        .send({ blocked_date: REFERENCE_MONDAY, reason: 'Clinic closed' });
      expect(res.status).toBe(201);

      expect(new Date((await fx.appointmentRow(held.id)).held_until).getTime()).toBeLessThanOrEqual(Date.now());
      expect(new Date((await fx.appointmentRow(other.id)).held_until).getTime()).toBeGreaterThan(Date.now());
      const confirmed = await confirm(alice, held.id);
      expect(confirmed.status).toBe(410);
      expect(confirmed.body.error.code).toBe('HOLD_EXPIRED');
    });

    it('replays an identical idempotency key instead of creating a second appointment (body field)', async () => {
      const s = await fx.slot();
      const key = 'b3a-idem-body-1';

      const first = await hold(alice, s.clinicDoctorId, s.slots[0], { idempotency_key: key });
      const second = await hold(alice, s.clinicDoctorId, s.slots[0], { idempotency_key: key });

      expect(first.status).toBe(201);
      expect(first.body.data.is_idempotent_replay).toBe(false);
      expect(second.status).toBe(200);
      expect(second.body.data.is_idempotent_replay).toBe(true);
      expect(second.body.data.appointment.id).toBe(first.body.data.appointment.id);
      expect(await fx.rowsForSlot(s.clinicDoctorId, s.slots[0])).toHaveLength(1);
    });

    it('accepts the idempotency key from the Idempotency-Key header too', async () => {
      const s = await fx.slot();
      const key = 'b3a-idem-header-1';
      const call = () =>
        request(app)
          .post('/api/v1/dental/appointments/holds')
          .set(auth(alice.token))
          .set('Idempotency-Key', key)
          .send({ clinic_doctor_id: s.clinicDoctorId, start_at: s.slots[1] });

      const first = await call();
      const second = await call();

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.appointment.id).toBe(first.body.data.appointment.id);
      expect(await fx.rowsForSlot(s.clinicDoctorId, s.slots[1])).toHaveLength(1);
    });

    it('never replays another customer’s appointment for a leaked idempotency key', async () => {
      const s = await fx.slot();
      const key = 'b3a-idem-leak-1';
      const mine = await hold(alice, s.clinicDoctorId, s.slots[0], { idempotency_key: key });
      expect(mine.status).toBe(201);

      const theirs = await hold(bob, s.clinicDoctorId, s.slots[1], { idempotency_key: key });

      expect(theirs.status).toBe(409);
      expect(theirs.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(theirs.body.data).toBeUndefined();
    });

    it('rejects malformed input and unknown body fields with a 400, never a 500', async () => {
      const s = await fx.slot();

      const badId = await hold(alice, 'not-a-uuid', s.slots[0]);
      expect(badId.status).toBe(400);
      expect(badId.body.error.code).toBe('VALIDATION_ERROR');

      const badTime = await hold(alice, s.clinicDoctorId, '2027-06-07 09:00');
      expect(badTime.status).toBe(400);

      const noOffset = await hold(alice, s.clinicDoctorId, '2027-06-07T09:00:00');
      expect(noOffset.status).toBe(400);

      const extra = await hold(alice, s.clinicDoctorId, s.slots[0], { consultation_fee_snapshot: 1 });
      expect(extra.status).toBe(400);
    });

    it('requires a CUSTOMER identity', async () => {
      const s = await fx.slot();
      const anonymous = await request(app)
        .post('/api/v1/dental/appointments/holds')
        .send({ clinic_doctor_id: s.clinicDoctorId, start_at: s.slots[0] });
      expect(anonymous.status).toBe(401);

      const asAdmin = await request(app)
        .post('/api/v1/dental/appointments/holds')
        .set(auth(adminToken))
        .send({ clinic_doctor_id: s.clinicDoctorId, start_at: s.slots[0] });
      expect(asAdmin.status).toBe(403);
    });
  });

  // ==========================================================================
  // CONFIRM
  // ==========================================================================
  describe('POST /dental/appointments/:id/confirm', () => {
    it('confirms a live hold, clears held_until and records HELD -> CONFIRMED', async () => {
      const held = await heldSlot(alice);

      const res = await confirm(alice, held.id, { patient_notes: 'Upper left molar ache' });

      expect(res.status).toBe(200);
      const appt = res.body.data.appointment;
      expect(appt.status).toBe('CONFIRMED');
      expect(appt.held_until).toBeNull();
      expect(appt.patient_name).toBe('Nimal Perera');
      expect(appt.patient_phone).toBe('+94771234567'); // normalised server-side
      expect(appt.patient_notes).toBe('Upper left molar ache');
      expect(appt.can_cancel).toBe(true);
      expect(appt.is_completed).toBe(false);

      expect(await fx.history(held.id)).toEqual([
        { old_status: null, new_status: 'HELD', changed_by: alice.id },
        { old_status: 'HELD', new_status: 'CONFIRMED', changed_by: alice.id },
      ]);
    });

    it('410 HOLD_EXPIRED once held_until has passed, even though nobody else took the row', async () => {
      const held = await heldSlot(alice);
      await fx.expireHold(held.id);

      const res = await confirm(alice, held.id);

      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('HOLD_EXPIRED');
      expect((await fx.appointmentRow(held.id)).status).toBe('HELD'); // untouched
    });

    it('409 APPOINTMENT_NOT_HELD for an already-confirmed row', async () => {
      const confirmed = await confirmedSlot(alice);

      const res = await confirm(alice, confirmed.id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_HELD');
    });

    it('409 APPOINTMENT_NOT_HELD for a cancelled row and for an EXPIRED row', async () => {
      const confirmed = await confirmedSlot(alice);
      expect((await cancel(alice, confirmed.id)).status).toBe(200);
      const cancelled = await confirm(alice, confirmed.id);
      expect(cancelled.status).toBe(409);
      expect(cancelled.body.error.code).toBe('APPOINTMENT_NOT_HELD');

      const held = await heldSlot(alice);
      await fx.setStatus(held.id, 'EXPIRED');
      const expired = await confirm(alice, held.id);
      expect(expired.status).toBe(409);
      expect(expired.body.error.code).toBe('APPOINTMENT_NOT_HELD');
    });

    it('404s when the hold belongs to another customer, and the row stays HELD', async () => {
      const held = await heldSlot(alice);

      const res = await confirm(bob, held.id);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
      expect((await fx.appointmentRow(held.id)).status).toBe('HELD');
    });

    it('refuses a confirm body carrying clinic_doctor_id/start_at (slot tampering)', async () => {
      const held = await heldSlot(alice);
      const other = await fx.slot();

      const res = await confirm(alice, held.id, {
        clinic_doctor_id: other.clinicDoctorId,
        start_at: other.slots[3],
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const row = await fx.appointmentRow(held.id);
      expect(row.status).toBe('HELD');
      expect(row.clinic_doctor_id).toBe(held.clinicDoctorId);
    });

    it('400s a malformed id and an invalid phone; 404s an unknown id', async () => {
      const malformed = await confirm(alice, 'not-a-uuid');
      expect(malformed.status).toBe(400);

      const unknown = await confirm(alice, '00000000-0000-0000-0000-000000000000');
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('APPOINTMENT_NOT_FOUND');

      const held = await heldSlot(alice);
      const badPhone = await confirm(alice, held.id, { patient_phone: '12345' });
      expect(badPhone.status).toBe(400);
      expect(badPhone.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ==========================================================================
  // CUSTOMER CANCEL
  // ==========================================================================
  describe('POST /dental/appointments/:id/cancel', () => {
    it('cancels a confirmed appointment the customer owns and records the transition', async () => {
      const confirmed = await confirmedSlot(alice);

      const res = await cancel(alice, confirmed.id, { reason: 'Travelling that day' });

      expect(res.status).toBe(200);
      expect(res.body.data.appointment.status).toBe('CANCELLED_BY_CUSTOMER');
      expect(res.body.data.appointment.cancellation_reason).toBe('Travelling that day');
      expect(res.body.data.appointment.can_cancel).toBe(false);
      const row = await fx.appointmentRow(confirmed.id);
      expect(row.cancelled_by).toBe(alice.id);
      expect(await fx.history(confirmed.id)).toContainEqual({
        old_status: 'CONFIRMED',
        new_status: 'CANCELLED_BY_CUSTOMER',
        changed_by: alice.id,
      });
    });

    it('frees the slot immediately: a different customer can hold it right after', async () => {
      const confirmed = await confirmedSlot(alice);
      expect((await cancel(alice, confirmed.id)).status).toBe(200);

      const res = await hold(bob, confirmed.clinicDoctorId, confirmed.startAt);

      expect(res.status).toBe(201);
      expect(res.body.data.appointment.status).toBe('HELD');
      expect(await fx.activeRowsForSlot(confirmed.clinicDoctorId, confirmed.startAt)).toHaveLength(1);
    });

    it('422 APPOINTMENT_NOT_CONFIRMED for a HELD row', async () => {
      const held = await heldSlot(alice);

      const res = await cancel(alice, held.id);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_CONFIRMED');
      expect((await fx.appointmentRow(held.id)).status).toBe('HELD');
    });

    it('409 APPOINTMENT_ALREADY_CANCELLED on a second cancel', async () => {
      const confirmed = await confirmedSlot(alice);
      expect((await cancel(alice, confirmed.id)).status).toBe(200);

      const res = await cancel(alice, confirmed.id);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPOINTMENT_ALREADY_CANCELLED');
    });

    it('422 APPOINTMENT_EXPIRED for an EXPIRED row', async () => {
      const held = await heldSlot(alice);
      await fx.setStatus(held.id, 'EXPIRED');

      const res = await cancel(alice, held.id);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('APPOINTMENT_EXPIRED');
    });

    it('404s another customer’s appointment without changing it', async () => {
      const confirmed = await confirmedSlot(alice);

      const res = await cancel(bob, confirmed.id, { reason: 'not mine' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
      expect((await fx.appointmentRow(confirmed.id)).status).toBe('CONFIRMED');
    });

    it('DENTAL-07: canCustomerCancel allows a CONFIRMED appointment at any distance from start_at', () => {
      const oneMinuteAway = new Date(Date.now() + 60_000);
      const longPast = new Date(Date.now() - 30 * 24 * 3_600_000);

      expect(canCustomerCancel({ status: 'CONFIRMED', start_at: oneMinuteAway })).toBe(true);
      expect(canCustomerCancel({ status: 'CONFIRMED', start_at: longPast })).toBe(true);
      expect(canCustomerCancel({ status: 'HELD', start_at: oneMinuteAway })).toBe(false);
      expect(canCustomerCancel({ status: 'EXPIRED', start_at: oneMinuteAway })).toBe(false);
      expect(canCustomerCancel({ status: 'CANCELLED_BY_CUSTOMER', start_at: oneMinuteAway })).toBe(false);
      expect(canCustomerCancel({ status: 'CANCELLED_BY_CLINIC', start_at: oneMinuteAway })).toBe(false);
    });

    it('cancels a confirmed appointment minutes before start_at (no cutoff is enforced yet)', async () => {
      const confirmed = await confirmedSlot(alice);
      await fx.setStartAt(confirmed.id, new Date(Date.now() + 60_000).toISOString());

      const res = await cancel(alice, confirmed.id);

      expect(res.status).toBe(200);
      expect(res.body.data.appointment.status).toBe('CANCELLED_BY_CUSTOMER');
    });
  });

  // ==========================================================================
  // ADMIN CANCEL
  // ==========================================================================
  describe('POST /admin/dental/appointments/:id/cancel', () => {
    it('cancels any customer’s confirmed appointment as CANCELLED_BY_CLINIC, at any time', async () => {
      const confirmed = await confirmedSlot(bob);
      await fx.setStartAt(confirmed.id, new Date(Date.now() + 60_000).toISOString());

      const res = await adminCancel(confirmed.id, { reason: 'Doctor called away' });

      expect(res.status).toBe(200);
      expect(res.body.data.appointment.status).toBe('CANCELLED_BY_CLINIC');
      expect(res.body.data.appointment.cancellation_reason).toBe('Doctor called away');
      const row = await fx.appointmentRow(confirmed.id);
      expect(row.cancelled_by).toBe(ADMIN.id);
      expect(await fx.history(confirmed.id)).toContainEqual({
        old_status: 'CONFIRMED',
        new_status: 'CANCELLED_BY_CLINIC',
        changed_by: ADMIN.id,
      });
    });

    it('force-releases a stuck HELD row, and the slot becomes bookable again', async () => {
      const held = await heldSlot(alice);

      const res = await adminCancel(held.id, { reason: 'Stuck hold' });

      expect(res.status).toBe(200);
      expect(res.body.data.appointment.status).toBe('CANCELLED_BY_CLINIC');
      expect((await hold(bob, held.clinicDoctorId, held.startAt)).status).toBe(201);
      expect(await fx.activeRowsForSlot(held.clinicDoctorId, held.startAt)).toHaveLength(1);
    });

    it('requires a reason', async () => {
      const confirmed = await confirmedSlot(alice);

      const res = await adminCancel(confirmed.id, {});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((await fx.appointmentRow(confirmed.id)).status).toBe('CONFIRMED');
    });

    it('409 on an already-cancelled row, 422 on an EXPIRED row, 404 on an unknown id', async () => {
      const confirmed = await confirmedSlot(alice);
      expect((await cancel(alice, confirmed.id)).status).toBe(200);
      const already = await adminCancel(confirmed.id);
      expect(already.status).toBe(409);
      expect(already.body.error.code).toBe('APPOINTMENT_ALREADY_CANCELLED');

      const held = await heldSlot(alice);
      await fx.setStatus(held.id, 'EXPIRED');
      const expired = await adminCancel(held.id);
      expect(expired.status).toBe(422);
      expect(expired.body.error.code).toBe('APPOINTMENT_EXPIRED');

      const unknown = await adminCancel('00000000-0000-0000-0000-000000000000');
      expect(unknown.status).toBe(404);
    });

    it('is not reachable with a customer token', async () => {
      const confirmed = await confirmedSlot(alice);

      const res = await request(app)
        .post(`/api/v1/admin/dental/appointments/${confirmed.id}/cancel`)
        .set(auth(alice.token))
        .send({ reason: 'let me through' });

      expect(res.status).toBe(403);
      expect((await fx.appointmentRow(confirmed.id)).status).toBe('CONFIRMED');
    });
  });

  // ==========================================================================
  // LIST + DETAIL
  // ==========================================================================
  describe('GET /dental/appointments and /dental/appointments/:id', () => {
    it('lists only the caller’s own appointments, without patient_notes', async () => {
      const mine = await confirmedSlot(alice);
      const theirs = await heldSlot(bob);

      const res = await request(app)
        .get('/api/v1/dental/appointments?limit=100')
        .set(auth(alice.token));

      expect(res.status).toBe(200);
      const ids = res.body.data.appointments.map((a: { id: string }) => a.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
      const row = res.body.data.appointments.find((a: { id: string }) => a.id === mine.id);
      // Plan §16: the free-text note is detail-view-only.
      expect(row).not.toHaveProperty('patient_notes');
      expect(row.doctor.id).toBe(mine.doctorId);
      expect(row.clinic.id).toBe(mine.clinicId);
      expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 100 });
    });

    it('filters by status and by bucket, and derives is_completed at read time', async () => {
      const past = await confirmedSlot(alice);
      await fx.setStartAt(past.id, new Date(Date.now() - 3_600_000).toISOString());

      const confirmedOnly = await request(app)
        .get('/api/v1/dental/appointments?status=CONFIRMED&limit=100')
        .set(auth(alice.token));
      expect(confirmedOnly.status).toBe(200);
      expect(
        confirmedOnly.body.data.appointments.every((a: { status: string }) => a.status === 'CONFIRMED')
      ).toBe(true);

      const pastBucket = await request(app)
        .get('/api/v1/dental/appointments?bucket=past&limit=100')
        .set(auth(alice.token));
      expect(pastBucket.status).toBe(200);
      const row = pastBucket.body.data.appointments.find((a: { id: string }) => a.id === past.id);
      expect(row).toBeDefined();
      // Plan §5.1: "completed" is derived, never a stored status.
      expect(row.is_completed).toBe(true);
      expect(row.status).toBe('CONFIRMED');

      const upcoming = await request(app)
        .get('/api/v1/dental/appointments?bucket=upcoming&limit=100')
        .set(auth(alice.token));
      expect(upcoming.body.data.appointments.map((a: { id: string }) => a.id)).not.toContain(past.id);
    });

    it('returns the detail view with patient_notes to its owner only', async () => {
      const held = await heldSlot(alice);
      expect((await confirm(alice, held.id, { patient_notes: 'Sensitive tooth' })).status).toBe(200);

      const owner = await request(app)
        .get(`/api/v1/dental/appointments/${held.id}`)
        .set(auth(alice.token));
      expect(owner.status).toBe(200);
      expect(owner.body.data.appointment.patient_notes).toBe('Sensitive tooth');

      const other = await request(app)
        .get(`/api/v1/dental/appointments/${held.id}`)
        .set(auth(bob.token));
      expect(other.status).toBe(404);
      expect(other.body.error.code).toBe('APPOINTMENT_NOT_FOUND');
      expect(other.body.data).toBeUndefined();
    });

    it('gives the same 404 for a non-existent id as for someone else’s id', async () => {
      const theirs = await heldSlot(bob);

      const missing = await request(app)
        .get('/api/v1/dental/appointments/00000000-0000-0000-0000-000000000000')
        .set(auth(alice.token));
      const notMine = await request(app)
        .get(`/api/v1/dental/appointments/${theirs.id}`)
        .set(auth(alice.token));

      expect(missing.status).toBe(404);
      expect(notMine.status).toBe(404);
      expect(notMine.body.error.code).toBe(missing.body.error.code);
      expect(notMine.body.error.message).toBe(missing.body.error.message);
    });

    it('400s a malformed id instead of 500ing, and requires auth', async () => {
      const malformed = await request(app)
        .get('/api/v1/dental/appointments/not-a-uuid')
        .set(auth(alice.token));
      expect(malformed.status).toBe(400);

      const anonymous = await request(app).get('/api/v1/dental/appointments');
      expect(anonymous.status).toBe(401);
    });
  });

  // ==========================================================================
  // A SLOT IN THE PAST IS NOT A SLOT (review finding I1)
  // ==========================================================================
  describe('past slots are neither listed nor bookable', () => {
    // A real Monday (day_of_week = 1, the fixture template's day) that has
    // already happened, so the weekly template matches it but the clock does
    // not. Verified against luxon in Asia/Colombo, not assumed.
    const PAST_MONDAY = '2024-06-03';
    const PAST_SLOT = `${PAST_MONDAY}T03:30:00Z`; // 09:00 Asia/Colombo

    it('422 SLOT_IN_PAST when holding an on-template time that has already elapsed', async () => {
      const s = await fx.slot();

      const res = await hold(alice, s.clinicDoctorId, PAST_SLOT);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SLOT_IN_PAST');
      expect(await fx.rowsForSlot(s.clinicDoctorId, PAST_SLOT)).toHaveLength(0);
    });

    it('422 SLOT_IN_PAST even when a stale row already occupies that past slot (reclaim branch)', async () => {
      const s = await fx.slot();
      // A row that predates the guard: without the pre-lock check the hold
      // flow would take the reclaim branch and never reach resolveOpenSlot.
      const stale = (
        await pool.query(
          `INSERT INTO appointments
             (clinic_doctor_id, customer_id, start_at, end_at, status, held_by, held_until, idempotency_key)
           VALUES ($1, $2, $3, $3::timestamptz + interval '30 minutes', 'HELD', $2,
                   now() - interval '1 minute', $4)
           RETURNING id`,
          [s.clinicDoctorId, alice.id, PAST_SLOT, `b3a-past-stale-${Date.now()}`]
        )
      ).rows[0].id as string;

      const res = await hold(bob, s.clinicDoctorId, PAST_SLOT);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SLOT_IN_PAST');
      const row = await fx.appointmentRow(stale);
      expect(row.customer_id).toBe(alice.id); // untouched, not reclaimed
      expect(await fx.rowsForSlot(s.clinicDoctorId, PAST_SLOT)).toHaveLength(1);
    });

    it('GET /dental/doctors/:id/slots does not list an elapsed date', async () => {
      const s = await fx.slot();

      const past = await request(app).get(
        `/api/v1/dental/doctors/${s.doctorId}/slots?clinic_id=${s.clinicId}&date=${PAST_MONDAY}`
      );
      expect(past.status).toBe(200);
      expect(past.body.data.slots).toEqual([]);
      expect(past.body.data.blockedReason).toBeNull(); // elapsed, not blocked

      // The same template on a future Monday still lists its four slots, so
      // the guard filters by clock rather than breaking the computation.
      const future = await request(app).get(
        `/api/v1/dental/doctors/${s.doctorId}/slots?clinic_id=${s.clinicId}&date=${REFERENCE_MONDAY}`
      );
      expect(future.status).toBe(200);
      expect(future.body.data.slots).toHaveLength(4);
    });

    it('GET /dental/doctors/:id/availability reports no availability for elapsed days', async () => {
      const s = await fx.slot();

      const past = await request(app).get(
        `/api/v1/dental/doctors/${s.doctorId}/availability?clinic_id=${s.clinicId}&from=${PAST_MONDAY}&to=2024-06-10`
      );
      expect(past.status).toBe(200);
      expect(past.body.data.availability.every((d: { hasAvailability: boolean }) => !d.hasAvailability)).toBe(
        true
      );

      const future = await request(app).get(
        `/api/v1/dental/doctors/${s.doctorId}/availability?clinic_id=${s.clinicId}&from=${REFERENCE_MONDAY}&to=${REFERENCE_MONDAY}`
      );
      expect(future.body.data.availability).toEqual([{ date: REFERENCE_MONDAY, hasAvailability: true }]);
    });

    it('computeDaySlots drops only the candidates at or before the injected clock', async () => {
      const s = await fx.slot();

      // 09:30 Asia/Colombo on the reference Monday: 09:00 has gone, 09:30 is
      // exactly "now" (not bookable), 10:00 and 10:30 remain.
      const midMorning = await availabilityService.computeDaySlots(
        s.clinicDoctorId,
        REFERENCE_MONDAY,
        new Date(`${REFERENCE_MONDAY}T04:00:00Z`)
      );
      expect(midMorning.slots).toEqual([
        `${REFERENCE_MONDAY}T04:30:00Z`,
        `${REFERENCE_MONDAY}T05:00:00Z`,
      ]);

      const beforeOpening = await availabilityService.computeDaySlots(
        s.clinicDoctorId,
        REFERENCE_MONDAY,
        new Date(`${REFERENCE_MONDAY}T00:00:00Z`)
      );
      expect(beforeOpening.slots).toHaveLength(4);

      const afterClosing = await availabilityService.computeDaySlots(
        s.clinicDoctorId,
        REFERENCE_MONDAY,
        new Date(`${REFERENCE_MONDAY}T23:00:00Z`)
      );
      expect(afterClosing.slots).toEqual([]);
    });

    it('computeRangeAvailability and resolveOpenSlot agree with the listing on the same clock', async () => {
      const s = await fx.slot();

      const afterClosing = await availabilityService.computeRangeAvailability(
        s.clinicDoctorId,
        REFERENCE_MONDAY,
        REFERENCE_MONDAY,
        new Date(`${REFERENCE_MONDAY}T23:00:00Z`)
      );
      expect(afterClosing).toEqual([{ date: REFERENCE_MONDAY, hasAvailability: false }]);

      const elapsed = await availabilityService.resolveOpenSlot(
        s.clinicDoctorId,
        new Date(s.slots[0]),
        undefined,
        new Date(`${REFERENCE_MONDAY}T23:00:00Z`)
      );
      expect(elapsed).toEqual({ ok: false, reason: 'IN_PAST' });

      const stillOpen = await availabilityService.resolveOpenSlot(
        s.clinicDoctorId,
        new Date(s.slots[0]),
        undefined,
        new Date(`${REFERENCE_MONDAY}T00:00:00Z`)
      );
      expect(stillOpen).toEqual({ ok: true, durationMinutes: 30 });
    });
  });
});
