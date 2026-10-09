import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AdminAppointment, DentalClinic, DentalDoctor } from '../api/types';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';
// The maplibre-gl stand-in from test/setup.ts exposes what the map was asked.
// @ts-expect-error - mapInstances exists only on the test stand-in.
import { mapInstances } from 'maplibre-gl';

/**
 * Dental appointments (admin list + admin-cancel) and the clinic location
 * map (task F9, plan §20-21), against a fake Blynk API shaped exactly like
 * the real backend's responses. A fresh implementation, not an import
 * (common.md rule 2) - follows the same discipline `test/dental.test.tsx`
 * (F8) established: every named rejection is proven shown, never swallowed,
 * and every payload sent is exactly what the operator entered. Kept in its
 * own file rather than appended to F8's already-reviewed `dental.test.tsx`,
 * since this is a distinct task with its own brief.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

let seq = 0;

function clinic(overrides: Partial<DentalClinic> = {}): DentalClinic {
  seq += 1;
  return {
    id: `cl${seq}`,
    name: `Clinic ${seq}`,
    city: 'Colombo',
    address_line: '123 Galle Road',
    latitude: 6.9271,
    longitude: 79.8612,
    contact_phone: '+94771234567',
    operating_start_time: '09:00:00',
    operating_end_time: '17:00:00',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function doctor(overrides: Partial<DentalDoctor> = {}): DentalDoctor {
  seq += 1;
  return {
    id: `dr${seq}`,
    full_name: `Dr. Doctor ${seq}`,
    specialty: 'General dentist',
    photo_url: null,
    bio: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function appointment(overrides: Partial<AdminAppointment> = {}): AdminAppointment {
  seq += 1;
  return {
    id: `apt${seq}`,
    clinic_doctor_id: `cd${seq}`,
    customer_id: `cust${seq}`,
    start_at: '2027-06-10T04:00:00.000Z',
    end_at: '2027-06-10T04:30:00.000Z',
    status: 'CONFIRMED',
    held_until: null,
    is_expired_hold: false,
    is_completed: false,
    patient_name: 'Nadia Farook',
    patient_phone: '+94771234567',
    patient_notes: null,
    consultation_fee_snapshot: 4200,
    cancellation_reason: null,
    cancelled_by: null,
    created_at: '2027-06-01T00:00:00.000Z',
    doctor: { id: 'dr1', full_name: 'Dr. Amal Perera', specialty: 'Orthodontist' },
    clinic: { id: 'cl1', name: 'Smile Dental', city: 'Colombo' },
    ...overrides,
  };
}

/** Same offset trick the component itself uses (Appointments.tsx's
 * `todayColombo`) - a fresh, independent copy for the test's own
 * expectation, not a shared import. */
function todayColombo(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function listResult(appointments: AdminAppointment[], total = appointments.length) {
  return ok({ appointments, pagination: { page: 1, limit: 20, total, total_pages: Math.max(1, Math.ceil(total / 20)) } });
}

// ------------------------------------------------------------ Appointments list
describe('Dental appointments - list', () => {
  it('defaults to today onward (from=today, no to bound) on first load', async () => {
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => listResult([]),
    });
    await screen.findByText('No appointments match');
    await waitFor(() => {
      const call = api.find('GET', '/admin/dental/appointments')[0];
      expect(call?.query.from).toBe(todayColombo());
      expect(call?.query.to).toBeUndefined();
      expect(call?.query.page).toBe('1');
      expect(call?.query.limit).toBe('20');
    });
  });

  it('applies the clinic/doctor/status/date filters to the query', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental' });
    const d = doctor({ full_name: 'Dr. Amal Perera' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/clinics': () => ok({ clinics: [c] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [d] }),
      'GET /admin/dental/appointments': () => listResult([]),
    });
    // Wait for the clinic/doctor lists to actually load into the `<select>`s
    // (the filter controls themselves render immediately; their options
    // arrive asynchronously) before selecting from them. Timeout raised from
    // the 1000ms default: under full-suite parallel execution (16 files at
    // once) this test's two sequential mocked fetches can take longer than
    // that to resolve and re-render, causing an intermittent, otherwise-real
    // timeout here even though the test passes reliably in isolation.
    await screen.findByRole('option', { name: c.name }, { timeout: 3000 });
    await screen.findByRole('option', { name: d.full_name }, { timeout: 3000 });
    await user.selectOptions(screen.getByLabelText('Filter by clinic'), c.id);
    await user.selectOptions(screen.getByLabelText('Filter by doctor'), d.id);
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'HELD');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2027-06-30' } });

    await waitFor(() => {
      const call = api.find('GET', '/admin/dental/appointments').at(-1);
      expect(call?.query).toMatchObject({
        clinic_id: c.id,
        doctor_id: d.id,
        status: 'HELD',
        from: '2027-06-01',
        to: '2027-06-30',
      });
    });
  });

  it('renders a stale HELD row as visibly "Hold expired" - never an indistinguishable active hold', async () => {
    const expiredHold = appointment({
      status: 'HELD',
      is_expired_hold: true,
      held_until: '2027-06-01T00:00:00.000Z',
      patient_name: 'Expired Hold Patient',
    });
    const liveHold = appointment({ status: 'HELD', is_expired_hold: false, patient_name: 'Live Hold Patient' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => listResult([expiredHold, liveHold]),
    });
    expect(await screen.findByText('Hold expired')).toBeInTheDocument();
    // Scoped to the status badge, not the filter `<select>`'s own "Held"
    // `<option>` (both legitimately contain the text "Held").
    expect(screen.getByText('Held', { selector: '.status' })).toBeInTheDocument();
  });

  it('renders exactly the patient fields the mock returns - name, phone, notes - nothing invented', async () => {
    const row = appointment({
      patient_name: 'Ishara De Silva',
      patient_phone: '+94119998877',
      patient_notes: 'Allergic to penicillin',
    });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => listResult([row]),
    });
    expect(await screen.findByText('Ishara De Silva')).toBeInTheDocument();
    expect(screen.getByText('+94119998877')).toBeInTheDocument();
    expect(screen.getByText('Notes: Allergic to penicillin')).toBeInTheDocument();
  });

  it('a row with no notes shows no notes line at all (never a fabricated placeholder)', async () => {
    const row = appointment({ patient_notes: null });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => listResult([row]),
    });
    await screen.findByText(row.patient_name!);
    expect(screen.queryByText(/^Notes:/)).not.toBeInTheDocument();
  });

  it('a load failure is a real visible error', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => fail(500, 'INTERNAL'),
    });
    expect(await screen.findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------ Admin-cancel
describe('Dental appointments - admin cancel', () => {
  it('only offers Cancel for HELD/CONFIRMED, never a terminal or expired status', async () => {
    const held = appointment({ id: 'a-held', status: 'HELD', patient_name: 'Held Patient' });
    const confirmed = appointment({ id: 'a-confirmed', status: 'CONFIRMED', patient_name: 'Confirmed Patient' });
    const cancelled = appointment({ id: 'a-cancelled', status: 'CANCELLED_BY_CLINIC', patient_name: 'Cancelled Patient' });
    const expired = appointment({ id: 'a-expired', status: 'EXPIRED', patient_name: 'Expired Patient' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => listResult([held, confirmed, cancelled, expired]),
    });
    await screen.findByText('Held Patient');
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2);
  });

  it('blocks an empty-reason submit client-side; sends exactly the entered reason once filled in', async () => {
    const user = userEvent.setup();
    const row = appointment({ status: 'CONFIRMED', patient_name: 'Confirmed Patient' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => listResult([row]),
      'POST /admin/dental/appointments/:id/cancel': () => ok({ appointment: { ...row, status: 'CANCELLED_BY_CLINIC' } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Cancel appointment' }));
    const confirmButton = dialog.getByRole('button', { name: 'Cancel appointment' });
    expect(confirmButton).toBeDisabled();

    await user.type(dialog.getByLabelText(/Reason/), 'Doctor unavailable');
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => {
      const call = api.find('POST', `/admin/dental/appointments/${row.id}/cancel`)[0];
      expect(call?.body).toEqual({ reason: 'Doctor unavailable' });
    });
    expect(await screen.findByText('Appointment cancelled.')).toBeInTheDocument();
  });

  it('a backend rejection (already cancelled) surfaces as a real error, not a generic failure', async () => {
    const user = userEvent.setup();
    const row = appointment({ status: 'CONFIRMED', patient_name: 'Confirmed Patient' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/appointments', {
      'GET /admin/dental/appointments': () => listResult([row]),
      'POST /admin/dental/appointments/:id/cancel': () =>
        fail(409, 'APPOINTMENT_ALREADY_CANCELLED', 'This appointment is already cancelled.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Cancel appointment' }));
    await user.type(dialog.getByLabelText(/Reason/), 'Doctor unavailable');
    await user.click(dialog.getByRole('button', { name: 'Cancel appointment' }));

    expect(await screen.findByText('This appointment is already cancelled.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------ Clinic location map
describe('Clinic location map (ClinicDetail)', () => {
  // 2026-09-28: the free MapLibre + OpenFreeMap map replaced the Google static
  // image (which needed a key and showed "Map unavailable" without one).
  afterEach(() => {
    mapInstances.length = 0;
  });

  it("pins the clinic's real coordinates on the free map, no key needed", async () => {
    const c = clinic({ name: 'Smile Dental', latitude: 6.9271, longitude: 79.8612 });
    renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [] }),
    });
    await screen.findByText('Smile Dental — doctors');

    expect(await screen.findByRole('img', { name: "Map showing Smile Dental's location" })).toBeInTheDocument();
    const map = mapInstances[mapInstances.length - 1];
    expect(map.options.center).toEqual([79.8612, 6.9271]);
    expect(map.markers[0].lngLat).toEqual([79.8612, 6.9271]);
    expect(screen.queryByText('Map unavailable')).not.toBeInTheDocument();
  });

  it('says "Map unavailable" when the clinic has no usable coordinates, without crashing', async () => {
    const c = clinic({ name: 'Smile Dental', latitude: 0, longitude: 0 });
    renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [] }),
    });
    await screen.findByText('Smile Dental — doctors');
    expect(await screen.findByText('Map unavailable')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------ Dental hub card
describe('Dental hub - Appointments card', () => {
  it("links to /catalog/dental/appointments and shows today's real total from pagination, not a capped list length", async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental', {
      'GET /admin/dental/clinics': () => ok({ clinics: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [] }),
      'GET /admin/dental/appointments': () =>
        ok({ appointments: [], pagination: { page: 1, limit: 1, total: 5, total_pages: 5 } }),
    });
    const link = await screen.findByRole('link', { name: /Appointments/ });
    expect(link).toHaveAttribute('href', '/catalog/dental/appointments');
    await waitFor(() => expect(within(link).getByText('5')).toBeInTheDocument());
  });
});
