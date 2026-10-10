import { cleanup, configure, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/** Doctors -> "Doctors need sign-in" (owner, 2026-10-10). */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const hub = {
  'GET /admin/dental/clinics': () => ok({ clinics: [] }),
  'GET /admin/dental/doctors': () => ok({ doctors: [] }),
};

describe('Doctors need sign-in switch', () => {
  it('shows the stored setting with its explanation, and turning it off saves at once', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/dental', {
      ...hub,
      'GET /admin/settings/doctors-access': () => ok({ require_sign_in: true, updated_at: null }),
      'PATCH /admin/settings/doctors-access': (call) =>
        ok({ require_sign_in: (call.body as { require_sign_in: boolean }).require_sign_in, updated_at: '2026-10-10T08:00:00.000Z' }),
    });
    const toggle = await screen.findByRole('checkbox', { name: /Doctors need sign-in/ });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/log in or create an account with their phone number/)).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/doctors-access')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/doctors-access')[0].body).toEqual({ require_sign_in: false });
    expect(await screen.findByText('Saved. Anyone can see doctors without signing in.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Doctors need sign-in/ })).not.toBeChecked();
    expect(screen.getByText(/Last changed/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Doctors need sign-in/ }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/doctors-access')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/doctors-access')[1].body).toEqual({ require_sign_in: true });
    expect(await screen.findByText('Saved. Customers must sign in to see doctors.')).toBeInTheDocument();
  });

  it('keeps the switch as it was and shows the error when saving fails', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental', {
      ...hub,
      'GET /admin/settings/doctors-access': () => ok({ require_sign_in: false, updated_at: null }),
      'PATCH /admin/settings/doctors-access': () => fail(400, 'VALIDATION_ERROR', 'Request validation failed'),
    });
    const toggle = await screen.findByRole('checkbox', { name: /Doctors need sign-in/ });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Doctors need sign-in/ })).not.toBeChecked();
  });

  it('shows a load error instead of a guessed value', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/dental', {
      ...hub,
      'GET /admin/settings/doctors-access': () => fail(500, 'INTERNAL_SERVER_ERROR', 'Something went wrong'),
    });
    await screen.findByRole('heading', { name: 'Who can see doctors' });
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Doctors need sign-in/ })).toBeNull());
    expect(screen.queryByText(/Loading the doctors sign-in setting/)).toBeNull();
  });
});
