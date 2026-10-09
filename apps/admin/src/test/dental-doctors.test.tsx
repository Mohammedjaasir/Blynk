import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { DentalDoctors, specialtyLabel } from '../pages/DentalDoctors';
import { tokenStore } from '../api/client';
import type { DentalDoctor } from '../api/types';
import { fail, mockApi, ok } from './mockApi';

/**
 * Dental doctors in Admin (owner, 2026-10-09): list, add, edit (free-text
 * specialty with quick-pick chips) and activate/deactivate, over the same
 * /admin/dental/doctors endpoints as Operations. The API contract is tested
 * against PostgreSQL in backend/api/tests/dental-admin.test.ts.
 */

function doctor(overrides: Partial<DentalDoctor> = {}): DentalDoctor {
  return {
    id: 'dr1',
    full_name: 'Dr. Nadia Farook',
    specialty: 'Orthodontist',
    photo_url: null,
    bio: null,
    is_active: true,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    rating_average: 4.6,
    rating_count: 12,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DentalDoctors />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('Dental doctors', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows a specialty as written, and an old enum code as its label', () => {
    expect(specialtyLabel('Cosmetic dentist')).toBe('Cosmetic dentist');
    expect(specialtyLabel('ORAL_SURGEON')).toBe('Oral surgeon');
    expect(specialtyLabel(null)).toBe('');
  });

  it('lists doctors with specialty, rating and status', async () => {
    mockApi((c) =>
      c.method === 'GET' && c.path === '/admin/dental/doctors'
        ? ok({
            doctors: [
              doctor(),
              doctor({ id: 'dr2', full_name: 'Dr. Retired', specialty: 'PEDIATRIC_DENTIST', is_active: false, rating_count: 0 }),
            ],
          })
        : undefined
    );
    renderPage();

    const table = await screen.findByRole('table', { name: 'Doctors' });
    expect(within(table).getByText('Dr. Nadia Farook')).toBeInTheDocument();
    expect(within(table).getByText('Orthodontist')).toBeInTheDocument();
    expect(within(table).getByText('★ 4.6 (12)')).toBeInTheDocument();
    expect(within(table).getByText('Pediatric dentist')).toBeInTheDocument();
    expect(within(table).getByText('Inactive')).toBeInTheDocument();
  });

  it('adds a doctor with a chip-picked specialty', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/dental/doctors') return ok({ doctors: [] });
      if (c.method === 'POST' && c.path === '/admin/dental/doctors') return ok({ doctor: doctor({ ...c.body }) });
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add doctor' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Doctor' }));
    expect(dialog.queryByRole('combobox')).not.toBeInTheDocument();
    await user.type(dialog.getByLabelText('Full name'), 'Dr. Nadia Farook');
    const chip = dialog.getByRole('button', { name: 'Cardiologist' });
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(dialog.getByLabelText('Specialty')).toHaveValue('Cardiologist');
    await user.type(dialog.getByLabelText(/^Bio/), 'Twenty years in practice.');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.find('POST', '/admin/dental/doctors')).toHaveLength(1));
    expect(api.find('POST', '/admin/dental/doctors')[0].body).toEqual({
      full_name: 'Dr. Nadia Farook',
      specialty: 'Cardiologist',
      photo_url: null,
      bio: 'Twenty years in practice.',
      is_active: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Doctor' })).not.toBeInTheDocument());
  });

  it('refuses a missing specialty before sending anything', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => (c.method === 'GET' ? ok({ doctors: [] }) : undefined));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add doctor' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Doctor' }));
    await user.type(dialog.getByLabelText('Full name'), 'Dr. Nadia Farook');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('Specialty must be 2 to 64 characters.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/dental/doctors')).toHaveLength(0);
  });

  it('edits a doctor to a typed specialty; typing turns the chip off', async () => {
    const user = userEvent.setup();
    const d = doctor({ specialty: 'ORTHODONTIST' });
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/dental/doctors') return ok({ doctors: [d] });
      if (c.method === 'PATCH' && c.path === '/admin/dental/doctors/dr1') return ok({ doctor: { ...d, ...c.body } });
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit Dr. Nadia Farook' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Doctor' }));
    const input = dialog.getByLabelText('Specialty');
    expect(input).toHaveValue('Orthodontist');
    expect(dialog.getByRole('button', { name: 'Dentist' })).toHaveAttribute('aria-pressed', 'false');

    await user.clear(input);
    await user.type(input, ' Prosthodontist ');
    expect(dialog.getByRole('button', { name: 'Dentist' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/dental/doctors/dr1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/dental/doctors/dr1')[0].body).toMatchObject({
      full_name: 'Dr. Nadia Farook',
      specialty: 'Prosthodontist',
    });
  });

  it('shows the API refusal in the form', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.method === 'GET') return ok({ doctors: [doctor()] });
      if (c.method === 'PATCH') return fail(404, 'DOCTOR_NOT_FOUND', 'Doctor not found');
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit Dr. Nadia Farook' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Doctor' }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Doctor not found');
  });

  it('deactivates a doctor', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET') return ok({ doctors: [doctor()] });
      if (c.method === 'PATCH') return ok({ doctor: doctor({ is_active: false }) });
      return undefined;
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Deactivate Dr. Nadia Farook' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/dental/doctors/dr1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/dental/doctors/dr1')[0].body).toEqual({ is_active: false });
  });
});
