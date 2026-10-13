import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { MemoryStorage } from '../test/fixtures';
import { bookingFor, endBooking, setPatient, startBooking } from './booking';
import {
  appointmentBadge, bucketAppointments, cancelRefusalMessage, dayHasAvailability, dayStrip, formatAppointmentDateTime,
  formatDayStripLabel, formatHoldCountdown, formatSlotTime, holdCountdownText, holdRemainingMs, isoDate, localPhone,
  ratingErrorMessage, showsCancel, showsRating, validatePatient,
} from './format';
import { pairingFor, parseAppointment, parseClinicDoctor, parseDoctor, ratingLabel, specialtyLabel, withRating } from './types';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function load(signedIn: boolean) {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  if (signedIn) {
    session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  }
  const api = await import('./api');
  const client = await import('@/blynk/api/client');
  return { ...api, ...client };
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const CD = '11111111-1111-4111-8111-111111111111';
const holdDto = {
  id: 'ap1', clinic_doctor_id: CD, status: 'HELD', start_at: '2026-10-20T03:30:00.000Z', end_at: '2026-10-20T04:00:00.000Z',
  held_until: '2026-10-13T10:05:00.000Z', consultation_fee_snapshot: '2500.00',
};
const confirmedDto = {
  ...holdDto, status: 'CONFIRMED', held_until: null, patient_name: 'Nimal Perera', patient_phone: '+94771234567',
  can_cancel: true, can_rate: false, rating: null,
  doctor: { id: 'd1', full_name: 'Dr. Silva', specialty: 'ORTHODONTIST', photo_url: null },
  clinic: { id: 'c1', name: 'Smile Clinic', city: 'Dharga Town', address_line: '12 Main St' },
};

describe('discovery and the doctors sign-in switch', () => {
  test('a guest browses without a token while doctors are public', async () => {
    const { fetchClinics, API_BASE_URL } = await load(false);
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { clinics: [{ id: 'c1', name: 'Smile', city: 'Dharga Town', address_line: '1 Rd', latitude: '6.4', longitude: 80 }, { name: 'no id' }] } }));
    const list = await fetchClinics({ search: ' smile ' });
    expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/dental/clinics?search=smile&page=1&limit=20`, expect.anything());
    expect((f.mock.calls[0][1] as RequestInit).headers).toBeUndefined();
    expect(list).toHaveLength(1);
    expect(list[0].latitude).toBe(6.4);
  });

  test('"Doctors need sign-in" on: a guest gets SIGN_IN_REQUIRED and the screen asks them to sign in', async () => {
    const { fetchClinics, isSignInRequired } = await load(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { success: false, error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in with your phone number to see doctors.' } }));
    const e = await fetchClinics().catch((err) => err);
    expect(isSignInRequired(e)).toBe(true);
  });

  test('signed in, discovery carries the bearer token', async () => {
    const { fetchClinicDoctors, fetchDoctor, fetchSlots, fetchAvailability, API_BASE_URL } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { success: true, data: { doctors: [{ clinic_doctor_id: CD, doctor_id: 'd1', full_name: 'Dr. Silva', specialty: '', consultation_fee: '2500.00', rating_average: '4.56', rating_count: 12 }] } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { doctor: { id: 'd1', full_name: 'Dr. Silva', specialty: 'Cosmetic dentist', clinics: [{ clinic_doctor_id: CD, clinic_id: 'c1', name: 'Smile', consultation_fee: null }] } } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { slots: ['2026-10-20T03:30:00.000Z', 'nope'] } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { availability: [{ date: '2026-10-20', hasAvailability: true }] } }));
    const docs = await fetchClinicDoctors('c1');
    expect(docs[0]).toMatchObject({ clinicDoctorId: CD, specialty: 'Dentist', consultationFee: 2500, ratingAverage: 4.56, ratingCount: 12 });
    const doc = await fetchDoctor('d1');
    expect(pairingFor(doc, 'c1')?.clinicDoctorId).toBe(CD);
    expect(pairingFor(doc, 'other')).toBeNull();
    const slots = await fetchSlots('d1', 'c1', new Date(2026, 9, 20, 15));
    expect(slots.map((s) => s.toISOString())).toEqual(['2026-10-20T03:30:00.000Z']);
    await fetchAvailability('d1', 'c1', new Date(2026, 9, 13), new Date(2026, 9, 26));
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      `${API_BASE_URL}/dental/clinics/c1/doctors`,
      `${API_BASE_URL}/dental/doctors/d1`,
      `${API_BASE_URL}/dental/doctors/d1/slots?clinic_id=c1&date=2026-10-20`,
      `${API_BASE_URL}/dental/doctors/d1/availability?clinic_id=c1&from=2026-10-13&to=2026-10-26`,
    ]);
    for (const c of f.mock.calls) expect((c[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
  });
});

describe('hold, confirm, cancel, rate', () => {
  test('hold: POST /holds with the pairing id and the exact instant', async () => {
    const { holdSlot, API_BASE_URL } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(201, { success: true, data: { appointment: holdDto, is_idempotent_replay: false } }));
    const start = new Date('2026-10-20T03:30:00.000Z');
    const out = await holdSlot(CD, start, 'k1');
    expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/dental/appointments/holds`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ clinic_doctor_id: CD, start_at: '2026-10-20T03:30:00.000Z', idempotency_key: 'k1' }),
    }));
    expect(out.appointment?.status).toBe('HELD');
    expect(out.appointment?.consultationFeeSnapshot).toBe(2500);
    expect(out.appointment?.heldUntil?.toISOString()).toBe('2026-10-13T10:05:00.000Z');
  });

  test('hold refusals come back as outcomes: taken, passed', async () => {
    const { holdSlot, isSlotConflict, isSlotInPast } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(json(409, { success: false, error: { code: 'SLOT_HELD', message: 'Held' } }));
    const a = await holdSlot(CD, new Date());
    expect(a.appointment).toBeNull();
    expect(isSlotConflict(a.error)).toBe(true);
    f.mockResolvedValueOnce(json(409, { success: false, error: { code: 'SLOT_UNAVAILABLE', message: 'Taken' } }));
    expect(isSlotConflict((await holdSlot(CD, new Date())).error)).toBe(true);
    f.mockResolvedValueOnce(json(422, { success: false, error: { code: 'SLOT_IN_PAST', message: 'Past' } }));
    const c = await holdSlot(CD, new Date());
    expect(isSlotInPast(c.error)).toBe(true);
    expect(isSlotConflict(c.error)).toBe(false);
  });

  test('confirm sends the patient only (never the time) and an empty note is left out', async () => {
    const { confirmAppointment, API_BASE_URL } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { appointment: confirmedDto } }));
    const out = await confirmAppointment('ap1', { name: 'Nimal Perera', phone: '+94771234567', notes: '  ' });
    expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/dental/appointments/ap1/confirm`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ patient_name: 'Nimal Perera', patient_phone: '+94771234567' }),
    }));
    expect(out.appointment?.status).toBe('CONFIRMED');
    expect(out.appointment?.doctor?.specialty).toBe('Orthodontist');
    await confirmAppointment('ap1', { name: 'N P', phone: '+94771234567', notes: 'tooth pain' });
    expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string)).toEqual({ patient_name: 'N P', patient_phone: '+94771234567', patient_notes: 'tooth pain' });
  });

  test('confirm: an expired or lost hold is its own outcome', async () => {
    const { confirmAppointment, isHoldGone } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(json(410, { success: false, error: { code: 'HOLD_EXPIRED', message: 'Expired' } }));
    expect(isHoldGone((await confirmAppointment('ap1', { name: 'N P', phone: '+94771234567', notes: null })).error)).toBe(true);
    f.mockResolvedValueOnce(json(409, { success: false, error: { code: 'APPOINTMENT_NOT_HELD', message: 'Not held' } }));
    expect(isHoldGone((await confirmAppointment('ap1', { name: 'N P', phone: '+94771234567', notes: null })).error)).toBe(true);
    f.mockResolvedValueOnce(json(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Bad phone' } }));
    const v = await confirmAppointment('ap1', { name: 'N P', phone: 'x', notes: null });
    expect(isHoldGone(v.error)).toBe(false);
    expect(v.error?.message).toBe('Bad phone');
  });

  test('cancel: POST {reason} or {}; refusals are worded', async () => {
    const { cancelAppointment, API_BASE_URL } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, { success: true, data: { appointment: { ...confirmedDto, status: 'CANCELLED_BY_CUSTOMER' } } }));
    expect((await cancelAppointment('ap1', '  ')).appointment?.status).toBe('CANCELLED_BY_CUSTOMER');
    expect(f).toHaveBeenLastCalledWith(`${API_BASE_URL}/dental/appointments/ap1/cancel`, expect.objectContaining({ method: 'POST', body: '{}' }));
    await cancelAppointment('ap1', ' Travelling ');
    expect((f.mock.calls[1][1] as RequestInit).body).toBe(JSON.stringify({ reason: 'Travelling' }));
    f.mockImplementation(async () => json(409, { success: false, error: { code: 'APPOINTMENT_ALREADY_CANCELLED', message: 'x' } }));
    const r = await cancelAppointment('ap1');
    expect(cancelRefusalMessage(r.error!)).toBe('This appointment is already cancelled.');
    expect(cancelRefusalMessage(new ApiError('t', 408, 'TIMEOUT'))).toBe("We couldn't confirm the cancellation. Checking your appointment…");
  });

  test('rate: {stars, comment?} once; the server\'s own refusal is shown', async () => {
    const { rateAppointment, API_BASE_URL } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(201, {
      success: true, data: { rating: { stars: 4, comment: 'Kind', created_at: '2026-10-21T00:00:00Z' }, appointment: { ...confirmedDto, can_rate: false, rating: { stars: 4, comment: 'Kind' } } },
    }));
    const ok = await rateAppointment('ap1', 4, '  Kind ');
    expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/dental/appointments/ap1/rating`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ stars: 4, comment: 'Kind' }) }));
    expect(ok.rating?.stars).toBe(4);
    expect(ok.appointment?.rating?.comment).toBe('Kind');
    f.mockResolvedValueOnce(json(422, { success: false, error: { code: 'VISIT_NOT_FINISHED', message: 'You can rate this visit once it is over.' } }));
    const no = await rateAppointment('ap1', 5, '');
    expect(JSON.parse((f.mock.calls[1][1] as RequestInit).body as string)).toEqual({ stars: 5 });
    expect(ratingErrorMessage(no.error!)).toBe('You can rate this visit once it is over.');
  });

  test('my appointments and one appointment are signed-in reads', async () => {
    const { fetchMyAppointments, fetchAppointment, API_BASE_URL } = await load(true);
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { success: true, data: { appointments: [confirmedDto, { bad: 1 }] } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { appointment: { ...confirmedDto, patient_notes: 'pain' } } }));
    expect(await fetchMyAppointments()).toHaveLength(1);
    expect((await fetchAppointment('ap1')).patientNotes).toBe('pain');
    expect(f.mock.calls.map((c) => c[0])).toEqual([`${API_BASE_URL}/dental/appointments?page=1&limit=50`, `${API_BASE_URL}/dental/appointments/ap1`]);
  });

  test('booking calls need a session: a guest is never sent', async () => {
    const { holdSlot } = await load(false);
    const f = vi.spyOn(globalThis, 'fetch');
    const out = await holdSlot(CD, new Date());
    expect(out.error?.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the hold countdown', () => {
  test('counts the real held_until down, floored at zero', () => {
    const until = new Date('2026-10-13T10:05:00.000Z');
    expect(holdRemainingMs(until, new Date('2026-10-13T10:00:00.000Z'))).toBe(300_000);
    expect(holdCountdownText(holdRemainingMs(until, new Date('2026-10-13T10:00:00.000Z')))).toBe('Reserved for 5:00');
    expect(formatHoldCountdown(holdRemainingMs(until, new Date('2026-10-13T10:04:51.400Z')))).toBe('0:08');
    expect(holdRemainingMs(until, new Date('2026-10-13T10:06:00.000Z'))).toBe(0);
    expect(formatHoldCountdown(-5)).toBe('0:00');
    expect(holdRemainingMs(null, new Date())).toBe(0);
  });
});

describe('wording', () => {
  const now = new Date('2026-10-13T10:00:00.000Z');
  test('status badges', () => {
    const a = parseAppointment(confirmedDto)!;
    expect(appointmentBadge(a, now)).toEqual({ tone: 'positive', label: 'Confirmed' });
    expect(appointmentBadge(a, new Date('2026-10-21T00:00:00Z'))).toEqual({ tone: 'neutral', label: 'Completed' });
    const held = parseAppointment(holdDto)!;
    expect(appointmentBadge(held, now).label).toBe('Reserved');
    expect(appointmentBadge(held, new Date('2026-10-13T10:05:00.000Z')).label).toBe('Expired');
    expect(appointmentBadge({ ...a, status: 'CANCELLED_BY_CLINIC' }, now)).toEqual({ tone: 'problem', label: 'Cancelled by clinic' });
    expect(appointmentBadge({ ...a, status: 'CANCELLED_BY_CUSTOMER' }, now).label).toBe('Cancelled');
    expect(parseAppointment({ ...confirmedDto, status: 'WHAT' })!.status).toBe('UNKNOWN');
    expect(appointmentBadge({ ...a, status: 'UNKNOWN' }, now).label).toBe('Status unavailable');
  });

  test('upcoming soonest first, past newest first', () => {
    const at = (id: string, iso: string | null) => ({ id, startAt: iso ? new Date(iso) : null });
    const list = [at('p1', '2026-10-01T00:00:00Z'), at('u2', '2026-10-30T00:00:00Z'), at('u1', '2026-10-14T00:00:00Z'), at('p2', '2026-10-10T00:00:00Z'), at('n', null)];
    expect(bucketAppointments(list, now, 'upcoming').map((a) => a.id)).toEqual(['u1', 'u2']);
    expect(bucketAppointments(list, now, 'past').map((a) => a.id)).toEqual(['p2', 'p1', 'n']);
  });

  test('cancel shows for confirmed; rating when the server allows or once rated', () => {
    const a = parseAppointment(confirmedDto)!;
    expect(showsCancel(a)).toBe(true);
    expect(showsCancel({ status: 'CANCELLED_BY_CUSTOMER' })).toBe(false);
    expect(showsRating(a)).toBe(false);
    expect(showsRating({ canRate: true, rating: null })).toBe(true);
    const rated = withRating({ ...a, canRate: true }, { stars: 5, comment: null, createdAt: null });
    expect(rated.canRate).toBe(false);
    expect(showsRating(rated)).toBe(true);
  });

  test('times, days, specialties and ratings', () => {
    const t = new Date(2026, 5, 7, 8, 0);
    expect(formatSlotTime(t)).toBe('8:00 AM');
    expect(formatSlotTime(new Date(2026, 5, 7, 0, 5))).toBe('12:05 AM');
    expect(formatSlotTime(new Date(2026, 5, 7, 13, 30))).toBe('1:30 PM');
    expect(formatAppointmentDateTime(t)).toBe('Sun, 7 Jun · 8:00 AM');
    expect(formatDayStripLabel(t)).toBe('Sun 7');
    expect(isoDate(t)).toBe('2026-06-07');
    expect(specialtyLabel('PEDIATRIC_DENTIST')).toBe('Pediatric dentist');
    expect(specialtyLabel(null)).toBe('Dentist');
    expect(ratingLabel(4.56, 12)).toBe('★ 4.6 (12)');
    expect(ratingLabel(null, 3)).toBeNull();
    expect(ratingLabel(4, 0)).toBeNull();
    expect(parseClinicDoctor({ doctor_id: 'x' })).toBeNull();
    expect(parseDoctor({ full_name: 'x' })).toBeNull();
  });

  test('the date strip: 14 days from today; days without times are marked', () => {
    const days = dayStrip(new Date(2026, 9, 30, 22, 0));
    expect(days).toHaveLength(14);
    expect(isoDate(days[0])).toBe('2026-10-30');
    expect(isoDate(days[2])).toBe('2026-11-01');
    const av = [{ date: '2026-10-30', hasAvailability: true }, { date: '2026-10-31', hasAvailability: false }];
    expect(dayHasAvailability(days[0], av)).toBe(true);
    expect(dayHasAvailability(days[1], av)).toBe(false);
    expect(dayHasAvailability(days[5], av)).toBe(false);
  });
});

describe('patient details', () => {
  test('name, Sri Lankan mobile and an optional note', () => {
    const ok = validatePatient({ name: '  Nimal   Perera ', phone: '077 123 4567', notes: '  tooth   pain ' });
    expect(ok.details).toEqual({ name: 'Nimal Perera', phone: '+94771234567', notes: 'tooth pain' });
    expect(validatePatient({ name: 'N', phone: '0771234567', notes: '' }).errors.name).toBe('Enter a valid name');
    expect(validatePatient({ name: 'Nimal 2', phone: '0771234567', notes: '' }).errors.name).toBe('Enter a valid name');
    expect(validatePatient({ name: 'Nimal', phone: '0111234567', notes: '' }).errors.phone).toBe('Enter a valid Sri Lankan mobile number');
    expect(validatePatient({ name: 'Nimal', phone: '771234567', notes: 'x'.repeat(501) }).errors.notes).toBe('Keep this under 500 characters');
    expect(validatePatient({ name: 'Nimal', phone: '771234567', notes: '' }).details?.notes).toBeNull();
    expect(localPhone('+94771234567')).toBe('771234567');
  });

  test('the booking in progress belongs to one hold', () => {
    const hold = parseAppointment(holdDto)!;
    const doctor = parseDoctor({ id: 'd1', full_name: 'Dr. Silva', clinics: [{ clinic_doctor_id: CD, clinic_id: 'c1', name: 'Smile' }] })!;
    startBooking(hold, doctor, doctor.clinics[0]);
    expect(bookingFor('other')).toBeNull();
    setPatient('ap1', { name: 'N P', phone: '+94771234567', notes: null });
    expect(bookingFor('ap1')?.patient?.name).toBe('N P');
    endBooking();
    expect(bookingFor('ap1')).toBeNull();
  });
});

describe('the doctors sign-in switch (GET /store doctors_require_sign_in)', async () => {
  const { doctorsGate } = await import('./access');
  test('signed in: always open', () => {
    expect(doctorsGate(true, { doctors_require_sign_in: true })).toBe('open');
  });
  test('guest: open only while the switch is off; unknown means on', () => {
    expect(doctorsGate(false, { doctors_require_sign_in: false })).toBe('open');
    expect(doctorsGate(false, { doctors_require_sign_in: true })).toBe('sign-in');
    expect(doctorsGate(false, null)).toBe('sign-in');
    expect(doctorsGate(false, {})).toBe('sign-in');
  });
});
