import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { DentalDoctors } from '../pages/DentalDoctors';
import { tokenStore } from '../api/client';
import { fail, mockApi, ok, type Call } from './mockApi';

/**
 * Doctors -> "Doctors need sign-in" (owner, 2026-10-10). The API contract is
 * tested against PostgreSQL in backend/api/tests/doctors-access.test.ts.
 */

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DentalDoctors />
      </ToastProvider>
    </MemoryRouter>
  );
}

const doctorsList = (c: Call) => (c.method === 'GET' && c.path === '/admin/dental/doctors' ? ok({ doctors: [] }) : undefined);

describe('Doctors need sign-in switch', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows the stored setting with its explanation; turning it off and on saves at once', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/doctors-access') {
        if (c.method === 'GET') return ok({ require_sign_in: true, updated_at: null });
        if (c.method === 'PATCH') return ok({ require_sign_in: c.body.require_sign_in, updated_at: '2026-10-10T08:00:00.000Z' });
      }
      return doctorsList(c);
    });
    renderPage();
    const toggle = await screen.findByRole('checkbox', { name: /Doctors need sign-in/ });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/log in or create an account with their phone number/)).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/doctors-access')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/doctors-access')[0].body).toEqual({ require_sign_in: false });
    expect(await screen.findByText('Saved. Anyone can see doctors without signing in.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Doctors need sign-in/ })).not.toBeChecked());

    await user.click(screen.getByRole('checkbox', { name: /Doctors need sign-in/ }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/doctors-access')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/doctors-access')[1].body).toEqual({ require_sign_in: true });
    expect(await screen.findByText('Saved. Customers must sign in to see doctors.')).toBeInTheDocument();
  });

  it('keeps the switch as it was and shows the error when saving fails', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.path === '/admin/settings/doctors-access') {
        if (c.method === 'GET') return ok({ require_sign_in: false, updated_at: null });
        return fail(403, 'FORBIDDEN', 'Forbidden');
      }
      return doctorsList(c);
    });
    renderPage();
    const toggle = await screen.findByRole('checkbox', { name: /Doctors need sign-in/ });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Doctors need sign-in/ })).not.toBeChecked();
  });

  it('shows a load error instead of a guessed value', async () => {
    mockApi((c) =>
      c.path === '/admin/settings/doctors-access' ? fail(500, 'INTERNAL_SERVER_ERROR', 'Something went wrong') : doctorsList(c)
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Who can see doctors' });
    await waitFor(() => expect(screen.queryByText(/Loading the doctors sign-in setting/)).toBeNull());
    expect(screen.queryByRole('checkbox', { name: /Doctors need sign-in/ })).toBeNull();
  });
});
