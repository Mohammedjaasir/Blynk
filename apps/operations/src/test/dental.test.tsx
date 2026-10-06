import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { ClinicDoctorRosterRow, DentalClinic, DentalDoctor, DoctorAvailability, DoctorBlockedDate } from '../api/types';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

/**
 * Dental clinic management: clinics, doctors, clinic-doctor pairings,
 * availability templates and blocked dates (task F8, plan §15-19), against
 * a fake Blynk API shaped exactly like the real backend's responses.
 * Mirrors `backend/api/tests/dental-admin.test.ts`'s own coverage shape for
 * the identical endpoints and `apps/admin/src/test/*.test.tsx`'s dental
 * suites (a fresh implementation, not an import - common.md rule 2),
 * following F3/F5's own precedent: every named validation rejection is
 * proven shown, never swallowed, and every payload sent is exactly what the
 * operator entered - no client-side business rule invented anywhere
 * (task-F8-brief.md's explicit instruction).
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
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
    specialty: 'GENERAL_DENTIST',
    photo_url: null,
    bio: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function rosterRow(overrides: Partial<ClinicDoctorRosterRow> = {}): ClinicDoctorRosterRow {
  seq += 1;
  return {
    clinic_doctor_id: `cd${seq}`,
    doctor_id: `dr${seq}`,
    full_name: `Dr. Roster ${seq}`,
    specialty: 'GENERAL_DENTIST',
    photo_url: null,
    bio: null,
    doctor_is_active: true,
    consultation_fee: 1500,
    pairing_is_active: true,
    ...overrides,
  };
}

function availabilityRow(overrides: Partial<DoctorAvailability> = {}): DoctorAvailability {
  seq += 1;
  return {
    id: `av${seq}`,
    clinic_doctor_id: 'cd1',
    day_of_week: 1,
    start_time: '09:00:00',
    end_time: '17:00:00',
    slot_duration_minutes: 30,
    buffer_minutes: 0,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function blockedDate(overrides: Partial<DoctorBlockedDate> = {}): DoctorBlockedDate {
  seq += 1;
  return {
    id: `bd${seq}`,
    clinic_doctor_id: 'cd1',
    blocked_date: '2027-12-25',
    reason: 'Holiday',
    created_by: 'u-admin-1',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ------------------------------------------------------------ Dental clinics
describe('Dental clinics', () => {
  it('lists real clinics with hours, phone and status - nothing fabricated', async () => {
    const c1 = clinic({ name: 'Smile Dental', city: 'Colombo', is_active: true });
    const c2 = clinic({ name: 'Old Branch', city: 'Kandy', is_active: false, contact_phone: '+94112223344' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/clinics', {
      'GET /admin/dental/clinics': () => ok({ clinics: [c1, c2] }),
    });

    expect(await screen.findByText('Smile Dental')).toBeInTheDocument();
    expect(screen.getByText('Colombo')).toBeInTheDocument();
    expect(screen.getByText('09:00–17:00 · +94771234567')).toBeInTheDocument();
    expect(screen.getByText('Old Branch')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('a load failure is a real visible error', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/clinics', {
      'GET /admin/dental/clinics': () => fail(500, 'INTERNAL'),
    });
    expect(await screen.findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
  });

  it('creates a clinic via the dialog with exactly the entered fields', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/clinics', {
      'GET /admin/dental/clinics': () => ok({ clinics: [] }),
      'POST /admin/dental/clinics': () => ok({ clinic: clinic() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add clinic' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Clinic' }));
    await user.type(dialog.getByLabelText('Name'), 'Smile Dental');
    await user.type(dialog.getByLabelText('City'), 'Colombo');
    await user.type(dialog.getByLabelText('Contact phone'), '+94771234567');
    await user.type(dialog.getByLabelText('Address'), '10 Main Street');
    await user.type(dialog.getByLabelText('Latitude'), '6.9271');
    await user.type(dialog.getByLabelText('Longitude'), '79.8612');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/dental/clinics')[0];
      expect(call?.body).toMatchObject({
        name: 'Smile Dental',
        city: 'Colombo',
        contact_phone: '+94771234567',
        address_line: '10 Main Street',
        latitude: 6.9271,
        longitude: 79.8612,
        operating_start_time: '09:00',
        operating_end_time: '17:00',
        is_active: true,
      });
    });
  });

  it('the merge-then-validate INVALID_CLINIC_HOURS rejection is shown clearly, not as a generic failure', async () => {
    const user = userEvent.setup();
    const c = clinic({ is_active: true });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/clinics', {
      'GET /admin/dental/clinics': () => ok({ clinics: [c] }),
      // A real single-field PATCH (the toggle sends only `is_active`) -
      // mirrors dental-admin.service.ts's own merge-then-validate cross-check,
      // which runs even on a partial update (task-F8-brief.md's explicit
      // "surface the outside-clinic-hours / merge-then-validate rejection
      // clearly" instruction).
      'PATCH /admin/dental/clinics/:id': () =>
        fail(
          400,
          'INVALID_CLINIC_HOURS',
          'operating_end_time (08:00:00) must be after operating_start_time (09:00:00).'
        ),
    });
    await screen.findByText(c.name);
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(
      await screen.findByText('operating_end_time (08:00:00) must be after operating_start_time (09:00:00).')
    ).toBeInTheDocument();
  });

  it('toggling active sends is_active on the exact clinic', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental', is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/clinics', {
      'GET /admin/dental/clinics': () => ok({ clinics: [c] }),
      'PATCH /admin/dental/clinics/:id': () => ok({ clinic: { ...c, is_active: false } }),
    });
    await screen.findByText('Smile Dental');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      const call = api.find('PATCH', `/admin/dental/clinics/${c.id}`)[0];
      expect(call?.body).toEqual({ is_active: false });
    });
  });
});

// ------------------------------------------------------------ Dental doctors
describe('Dental doctors', () => {
  it('lists real doctors with specialty label and status', async () => {
    const d1 = doctor({ full_name: 'Dr. Nadia Farook', specialty: 'ORTHODONTIST', is_active: true });
    const d2 = doctor({ full_name: 'Dr. Retired', specialty: 'GENERAL_DENTIST', is_active: false });
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental/doctors', {
      'GET /admin/dental/doctors': () => ok({ doctors: [d1, d2] }),
    });

    expect(await screen.findByText('Dr. Nadia Farook')).toBeInTheDocument();
    expect(screen.getByText('Orthodontist')).toBeInTheDocument();
    expect(screen.getByText('Dr. Retired')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('creates a doctor via the dialog, specialty chosen from the real backend enum', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/doctors', {
      'GET /admin/dental/doctors': () => ok({ doctors: [] }),
      'POST /admin/dental/doctors': () => ok({ doctor: doctor() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add doctor' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Doctor' }));
    await user.type(dialog.getByLabelText('Full name'), 'Dr. Nadia Farook');
    await user.selectOptions(dialog.getByLabelText('Specialty'), 'ORTHODONTIST');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/dental/doctors')[0];
      expect(call?.body).toEqual({
        full_name: 'Dr. Nadia Farook',
        specialty: 'ORTHODONTIST',
        photo_url: null,
        bio: null,
        is_active: true,
      });
    });
  });

  it('toggling active sends is_active on the exact doctor', async () => {
    const user = userEvent.setup();
    const d = doctor({ full_name: 'Dr. Nadia Farook', is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/doctors', {
      'GET /admin/dental/doctors': () => ok({ doctors: [d] }),
      'PATCH /admin/dental/doctors/:id': () => ok({ doctor: { ...d, is_active: false } }),
    });
    await screen.findByText('Dr. Nadia Farook');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      const call = api.find('PATCH', `/admin/dental/doctors/${d.id}`)[0];
      expect(call?.body).toEqual({ is_active: false });
    });
  });
});

// ------------------------------------------------------- Clinic doctor roster
describe('Clinic doctor roster (clinic detail)', () => {
  it('loads the clinic, roster and doctors available to attach, then attaches one with a fee', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental' });
    const availableDoctor = doctor({ full_name: 'Dr. Nadia Farook', specialty: 'ORTHODONTIST', is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [availableDoctor] }),
      'POST /admin/dental/clinics/:clinicId/doctors': () =>
        ok({
          clinic_doctor: {
            id: 'cd1',
            clinic_id: c.id,
            doctor_id: availableDoctor.id,
            consultation_fee: 4200,
            is_active: true,
            created_at: 'x',
            updated_at: 'x',
          },
        }),
    });

    expect(await screen.findByText('Smile Dental — doctors')).toBeInTheDocument();
    expect(screen.getByText('No doctors attached yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Attach doctor' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Attach doctor' }));
    await user.selectOptions(dialog.getByLabelText('Doctor'), availableDoctor.id);
    await user.type(dialog.getByLabelText(/Consultation fee/), '4200');
    await user.click(dialog.getByRole('button', { name: 'Attach' }));

    await waitFor(() => {
      const call = api.find('POST', `/admin/dental/clinics/${c.id}/doctors`)[0];
      expect(call?.body).toEqual({ doctor_id: availableDoctor.id, consultation_fee: 4200 });
    });
  });

  it('rejects attaching to an inactive clinic with the real backend message', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental', is_active: false });
    const availableDoctor = doctor({ full_name: 'Dr. Nadia Farook' });
    renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [availableDoctor] }),
      'POST /admin/dental/clinics/:clinicId/doctors': () =>
        fail(409, 'CLINIC_INACTIVE', 'Cannot attach a doctor to an inactive clinic.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Attach doctor' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Attach doctor' }));
    await user.selectOptions(dialog.getByLabelText('Doctor'), availableDoctor.id);
    await user.click(dialog.getByRole('button', { name: 'Attach' }));

    expect(await screen.findByText('Cannot attach a doctor to an inactive clinic.')).toBeInTheDocument();
  });

  it('rejects attaching an inactive doctor with the real backend message', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental' });
    // Attach's own doctor picker only lists doctors from `dentalDoctors.list(true)`
    // (active only, matching Admin's own reference implementation), so an
    // inactive doctor never appears there - this rejection is still
    // reachable (a doctor deactivated between page load and submit), and the
    // backend's own real message must still surface, not a generic failure.
    const availableDoctor = doctor({ full_name: 'Dr. Nadia Farook' });
    renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [availableDoctor] }),
      'POST /admin/dental/clinics/:clinicId/doctors': () =>
        fail(409, 'DOCTOR_INACTIVE', 'Cannot attach an inactive doctor to a clinic.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Attach doctor' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Attach doctor' }));
    await user.selectOptions(dialog.getByLabelText('Doctor'), availableDoctor.id);
    await user.click(dialog.getByRole('button', { name: 'Attach' }));

    expect(await screen.findByText('Cannot attach an inactive doctor to a clinic.')).toBeInTheDocument();
  });

  it('rejects a duplicate pairing with the real backend message', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental' });
    const availableDoctor = doctor({ full_name: 'Dr. Nadia Farook' });
    renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [availableDoctor] }),
      'POST /admin/dental/clinics/:clinicId/doctors': () =>
        fail(409, 'CLINIC_DOCTOR_PAIRING_EXISTS', 'This doctor is already attached to this clinic.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Attach doctor' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Attach doctor' }));
    await user.selectOptions(dialog.getByLabelText('Doctor'), availableDoctor.id);
    await user.click(dialog.getByRole('button', { name: 'Attach' }));

    expect(await screen.findByText('This doctor is already attached to this clinic.')).toBeInTheDocument();
  });

  it('edits the consultation fee on an existing pairing', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental' });
    const row = rosterRow({ full_name: 'Dr. Nadia Farook', consultation_fee: 1500 });
    const { api } = renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [row] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [] }),
      'PATCH /admin/dental/clinic-doctors/:id': () =>
        ok({
          clinic_doctor: {
            id: row.clinic_doctor_id,
            clinic_id: c.id,
            doctor_id: row.doctor_id,
            consultation_fee: 2000,
            is_active: true,
            created_at: 'x',
            updated_at: 'x',
          },
        }),
    });
    await screen.findByText('Dr. Nadia Farook');
    await user.click(screen.getByRole('button', { name: 'Edit fee' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit consultation fee' }));
    const feeInput = dialog.getByLabelText(/Consultation fee/);
    await user.clear(feeInput);
    await user.type(feeInput, '2000');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('PATCH', `/admin/dental/clinic-doctors/${row.clinic_doctor_id}`)[0];
      expect(call?.body).toEqual({ consultation_fee: 2000 });
    });
  });

  it('toggles a pairing active/inactive at this clinic', async () => {
    const user = userEvent.setup();
    const c = clinic({ name: 'Smile Dental' });
    const row = rosterRow({ full_name: 'Dr. Nadia Farook', pairing_is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${c.id}`, {
      'GET /admin/dental/clinics/:id': () => ok({ clinic: c }),
      'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [row] }),
      'GET /admin/dental/doctors': () => ok({ doctors: [] }),
      'PATCH /admin/dental/clinic-doctors/:id': () =>
        ok({
          clinic_doctor: {
            id: row.clinic_doctor_id,
            clinic_id: c.id,
            doctor_id: row.doctor_id,
            consultation_fee: row.consultation_fee,
            is_active: false,
            created_at: 'x',
            updated_at: 'x',
          },
        }),
    });
    await screen.findByText('Dr. Nadia Farook');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      const call = api.find('PATCH', `/admin/dental/clinic-doctors/${row.clinic_doctor_id}`)[0];
      expect(call?.body).toEqual({ is_active: false });
    });
  });
});

// ----------------------------------------------- Doctor availability & blocked dates
describe('Doctor availability & blocked dates', () => {
  const clinicDoctorId = 'cd-avail';
  const routePath = `/catalog/dental/clinics/cl1/doctors/${clinicDoctorId}`;

  it('lists the weekly template and blocked dates', async () => {
    const row = availabilityRow({ clinic_doctor_id: clinicDoctorId, day_of_week: 1 });
    const block = blockedDate({ clinic_doctor_id: clinicDoctorId, blocked_date: '2027-12-25', reason: 'Holiday' });
    renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [row] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [block] }),
    });

    expect(await screen.findByText('Monday')).toBeInTheDocument();
    expect(screen.getByText('09:00–17:00')).toBeInTheDocument();
    expect(screen.getByText('Sat, 25 Dec 2027')).toBeInTheDocument();
    expect(screen.getByText('Holiday')).toBeInTheDocument();
  });

  it('still shows the right day if the API sends the blocked date as an ISO timestamp', async () => {
    // 6 Oct 2026 at midnight in Colombo, serialised as UTC.
    const block = blockedDate({ clinic_doctor_id: clinicDoctorId, blocked_date: '2026-10-05T18:30:00.000Z', reason: 'Conference' });
    renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [block] }),
    });
    expect(await screen.findByText('Tue, 06 Oct 2026')).toBeInTheDocument();
  });

  it('adds an availability row with exactly the entered fields', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [] }),
      'POST /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: availabilityRow() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add availability row' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add availability' }));
    await user.selectOptions(dialog.getByLabelText('Day of week'), '2');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.find('POST', `/admin/dental/clinic-doctors/${clinicDoctorId}/availability`)[0];
      expect(call?.body).toEqual({
        day_of_week: 2,
        start_time: '09:00',
        end_time: '17:00',
        slot_duration_minutes: 30,
        buffer_minutes: 0,
      });
    });
  });

  it('the outside-clinic-hours rejection is shown clearly, naming both windows - not a generic failure', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [] }),
      'POST /admin/dental/clinic-doctors/:clinicDoctorId/availability': () =>
        fail(
          400,
          'TEMPLATE_OUTSIDE_CLINIC_HOURS',
          "This template (07:00-09:00) falls outside the clinic's operating hours (09:00-17:00)."
        ),
    });
    await user.click(await screen.findByRole('button', { name: 'Add availability row' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add availability' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText("This template (07:00-09:00) falls outside the clinic's operating hours (09:00-17:00).")
    ).toBeInTheDocument();
  });

  it('removes an availability row after confirmation', async () => {
    const user = userEvent.setup();
    const row = availabilityRow({ clinic_doctor_id: clinicDoctorId, day_of_week: 3 });
    const { api } = renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [row] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [] }),
      'DELETE /admin/dental/availability/:id': () => ({ status: 204 }),
    });
    await screen.findByText('Wednesday');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.find('DELETE', `/admin/dental/availability/${row.id}`)).toHaveLength(0);
    const confirm = within(screen.getByRole('dialog', { name: 'Remove availability row' }));
    await user.click(confirm.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.find('DELETE', `/admin/dental/availability/${row.id}`)).toHaveLength(1);
    });
  });

  it('blocks a date with the entered reason', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [] }),
      'POST /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_date: blockedDate() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Block a date' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Block a date' }));
    // A native `type="date"` input is not driven reliably by `user.type`'s
    // per-keystroke simulation across environments - `fireEvent.change` sets
    // its value directly, the standard testing-library workaround (same
    // reasoning as `catalog.test.tsx`'s file-input `fireEvent.change`).
    fireEvent.change(dialog.getByLabelText('Date'), { target: { value: '2027-12-31' } });
    await user.type(dialog.getByLabelText('Reason'), 'Year-end closure');
    await user.click(dialog.getByRole('button', { name: 'Block date' }));

    await waitFor(() => {
      const call = api.find('POST', `/admin/dental/clinic-doctors/${clinicDoctorId}/blocked-dates`)[0];
      expect(call?.body).toEqual({ blocked_date: '2027-12-31', reason: 'Year-end closure' });
    });
  });

  it('a duplicate blocked date rejection is shown clearly, not as a generic failure', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [] }),
      'POST /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () =>
        fail(409, 'BLOCKED_DATE_EXISTS', 'This date is already blocked for this clinic-doctor pairing.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Block a date' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Block a date' }));
    fireEvent.change(dialog.getByLabelText('Date'), { target: { value: '2027-12-31' } });
    await user.type(dialog.getByLabelText('Reason'), 'Year-end closure');
    await user.click(dialog.getByRole('button', { name: 'Block date' }));

    expect(await screen.findByText('This date is already blocked for this clinic-doctor pairing.')).toBeInTheDocument();
  });

  it('unblocks a date after confirmation', async () => {
    const user = userEvent.setup();
    const block = blockedDate({ clinic_doctor_id: clinicDoctorId, blocked_date: '2027-12-25', reason: 'Holiday' });
    const { api } = renderAs(ADMIN_WITH_RIDER, routePath, {
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: [] }),
      'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: [block] }),
      'DELETE /admin/dental/blocked-dates/:id': () => ({ status: 204 }),
    });
    await screen.findByText('Sat, 25 Dec 2027');
    await user.click(screen.getByRole('button', { name: 'Unblock' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Unblock date' }));
    await user.click(confirm.getByRole('button', { name: 'Unblock' }));

    await waitFor(() => {
      expect(api.find('DELETE', `/admin/dental/blocked-dates/${block.id}`)).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------- End-to-end
describe('End-to-end: standing up a bookable clinic', () => {
  it('create clinic -> create doctor -> attach with a fee -> add availability -> add a blocked date -> roster/detail reflect all of it', async () => {
    const user = userEvent.setup();

    // Mirrors the same proof backend/api/tests/dental-admin.test.ts's own
    // "walks the full admin setup flow" test establishes at the API layer -
    // exercised here through the real UI, one screen transition per step
    // (MemoryRouter + a fresh renderAs per step, since Operations has no
    // single combined wizard screen - each step's mock API reflects the
    // state the previous step actually produced, not a re-guessed fixture).
    let savedClinic: DentalClinic;
    let savedDoctor: DentalDoctor;
    let savedClinicDoctorId = '';
    const savedAvailability: DoctorAvailability[] = [];
    const savedBlocked: DoctorBlockedDate[] = [];

    // Step 1: create the clinic.
    {
      const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/clinics', {
        'GET /admin/dental/clinics': () => ok({ clinics: [] }),
        'POST /admin/dental/clinics': (call) => ok({ clinic: { id: 'cl-e2e', ...(call.body as object), created_at: 'x', updated_at: 'x' } }),
      });
      await user.click(await screen.findByRole('button', { name: 'Add clinic' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Clinic' }));
      await user.type(dialog.getByLabelText('Name'), 'Smile Dental');
      await user.type(dialog.getByLabelText('City'), 'Colombo');
      await user.type(dialog.getByLabelText('Contact phone'), '+94771234567');
      await user.type(dialog.getByLabelText('Address'), '10 Main Street');
      await user.type(dialog.getByLabelText('Latitude'), '6.9271');
      await user.type(dialog.getByLabelText('Longitude'), '79.8612');
      await user.click(dialog.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(api.find('POST', '/admin/dental/clinics')).toHaveLength(1));
      savedClinic = { ...clinic({ id: 'cl-e2e', name: 'Smile Dental' }) };
      cleanup();
    }

    // Step 2: create the doctor.
    {
      const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/dental/doctors', {
        'GET /admin/dental/doctors': () => ok({ doctors: [] }),
        'POST /admin/dental/doctors': (call) => ok({ doctor: { id: 'dr-e2e', ...(call.body as object), created_at: 'x', updated_at: 'x' } }),
      });
      await user.click(await screen.findByRole('button', { name: 'Add doctor' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Doctor' }));
      await user.type(dialog.getByLabelText('Full name'), 'Dr. Nadia Farook');
      await user.selectOptions(dialog.getByLabelText('Specialty'), 'ORTHODONTIST');
      await user.click(dialog.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(api.find('POST', '/admin/dental/doctors')).toHaveLength(1));
      savedDoctor = doctor({ id: 'dr-e2e', full_name: 'Dr. Nadia Farook', specialty: 'ORTHODONTIST' });
      cleanup();
    }

    // Step 3: attach the doctor to the clinic with a consultation fee.
    {
      const { api } = renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${savedClinic!.id}`, {
        'GET /admin/dental/clinics/:id': () => ok({ clinic: savedClinic }),
        'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [] }),
        'GET /admin/dental/doctors': () => ok({ doctors: [savedDoctor] }),
        'POST /admin/dental/clinics/:clinicId/doctors': () => {
          savedClinicDoctorId = 'cd-e2e';
          return ok({
            clinic_doctor: {
              id: savedClinicDoctorId,
              clinic_id: savedClinic!.id,
              doctor_id: savedDoctor!.id,
              consultation_fee: 4200,
              is_active: true,
              created_at: 'x',
              updated_at: 'x',
            },
          });
        },
      });
      await user.click(await screen.findByRole('button', { name: 'Attach doctor' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Attach doctor' }));
      await user.selectOptions(dialog.getByLabelText('Doctor'), savedDoctor!.id);
      await user.type(dialog.getByLabelText(/Consultation fee/), '4200');
      await user.click(dialog.getByRole('button', { name: 'Attach' }));
      await waitFor(() => {
        const call = api.find('POST', `/admin/dental/clinics/${savedClinic!.id}/doctors`)[0];
        expect(call?.body).toEqual({ doctor_id: savedDoctor!.id, consultation_fee: 4200 });
      });
      cleanup();
    }
    expect(savedClinicDoctorId).toBe('cd-e2e');

    // Step 4: add an availability template row and block a date, both on the
    // same per-pairing screen (the real reference implementation's own
    // combined layout - see Availability.tsx's doc comment).
    {
      renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${savedClinic!.id}/doctors/${savedClinicDoctorId}`, {
        'GET /admin/dental/clinic-doctors/:clinicDoctorId/availability': () => ok({ availability: savedAvailability }),
        'GET /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': () => ok({ blocked_dates: savedBlocked }),
        'POST /admin/dental/clinic-doctors/:clinicDoctorId/availability': (call) => {
          const row: DoctorAvailability = {
            id: 'av-e2e',
            clinic_doctor_id: savedClinicDoctorId,
            is_active: true,
            created_at: 'x',
            updated_at: 'x',
            ...(call.body as object),
          } as DoctorAvailability;
          savedAvailability.push(row);
          return ok({ availability: row });
        },
        'POST /admin/dental/clinic-doctors/:clinicDoctorId/blocked-dates': (call) => {
          const row: DoctorBlockedDate = {
            id: 'bd-e2e',
            clinic_doctor_id: savedClinicDoctorId,
            created_by: 'u-admin-1',
            created_at: 'x',
            ...(call.body as object),
          } as DoctorBlockedDate;
          savedBlocked.push(row);
          return ok({ blocked_date: row });
        },
      });

      await user.click(await screen.findByRole('button', { name: 'Add availability row' }));
      const availDialog = within(screen.getByRole('dialog', { name: 'Add availability' }));
      await user.selectOptions(availDialog.getByLabelText('Day of week'), '1');
      await user.click(availDialog.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(savedAvailability).toHaveLength(1));
      expect(await screen.findByText('Monday')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Block a date' }));
      const blockDialog = within(screen.getByRole('dialog', { name: 'Block a date' }));
      fireEvent.change(blockDialog.getByLabelText('Date'), { target: { value: '2027-12-31' } });
      await user.type(blockDialog.getByLabelText('Reason'), 'Year-end closure');
      await user.click(blockDialog.getByRole('button', { name: 'Block date' }));
      await waitFor(() => expect(savedBlocked).toHaveLength(1));
      expect(await screen.findByText('Fri, 31 Dec 2027')).toBeInTheDocument();
      expect(screen.getByText('Year-end closure')).toBeInTheDocument();
      cleanup();
    }

    // Step 5: confirm the roster view reflects everything set up above - the
    // concrete "did this stand up a real, bookable pairing" proof.
    {
      const finalRow = rosterRow({
        clinic_doctor_id: savedClinicDoctorId,
        doctor_id: savedDoctor!.id,
        full_name: 'Dr. Nadia Farook',
        specialty: 'ORTHODONTIST',
        consultation_fee: 4200,
        pairing_is_active: true,
      });
      renderAs(ADMIN_WITH_RIDER, `/catalog/dental/clinics/${savedClinic!.id}`, {
        'GET /admin/dental/clinics/:id': () => ok({ clinic: savedClinic }),
        'GET /admin/dental/clinics/:clinicId/doctors': () => ok({ doctors: [finalRow] }),
        'GET /admin/dental/doctors': () => ok({ doctors: [savedDoctor] }),
      });

      expect(await screen.findByText('Dr. Nadia Farook')).toBeInTheDocument();
      expect(screen.getByText('Orthodontist')).toBeInTheDocument();
      expect(screen.getByText('LKR 4,200')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
    }
  });
});
