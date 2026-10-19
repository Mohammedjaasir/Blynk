import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { mockApi, ok, type Call, type Reply } from './mockApi';

/** Notifications (owner, 2026-10-19: "store is open now, start ordering"). */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderApp(handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={['/notifications']}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('Notifications page', () => {
  it('fills the store-open message, asks to confirm, then sends', async () => {
    const user = userEvent.setup();
    const api = renderApp((c) => {
      if (c.path === '/admin/push-broadcasts/audience') return ok({ push_enabled: true, customers: 42, devices: 50 });
      if (c.method === 'GET' && c.path === '/admin/push-broadcasts') return ok({ broadcasts: [] });
      if (c.method === 'POST' && c.path === '/admin/push-broadcasts') return ok({ id: 'b1', queued: 42 });
      return undefined;
    });
    expect(await screen.findByTestId('audience')).toHaveTextContent('42 customers');
    await user.click(screen.getByRole('button', { name: /Store is open/ }));
    expect(screen.getByLabelText('Title')).toHaveValue('Blynk is open now!');
    await user.click(screen.getByRole('button', { name: 'Send notification' }));
    expect(api.find('POST', '/admin/push-broadcasts')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Yes, send' }));
    await waitFor(() => expect(api.find('POST', '/admin/push-broadcasts')).toHaveLength(1));
    expect(api.find('POST', '/admin/push-broadcasts')[0]!.body).toMatchObject({ title: 'Blynk is open now!' });
  });

  it('says so when push is not set up on the server, and cannot send', async () => {
    renderApp((c) => {
      if (c.path === '/admin/push-broadcasts/audience') return ok({ push_enabled: false, customers: 3, devices: 3 });
      if (c.path === '/admin/push-broadcasts') return ok({ broadcasts: [] });
      return undefined;
    });
    expect(await screen.findByText(/not set up on the server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send notification' })).toBeDisabled();
  });
});
