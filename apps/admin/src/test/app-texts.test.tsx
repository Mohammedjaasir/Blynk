import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { EMPTY_APP_TEXTS, appTextsPayload, appTextsProblem } from '../lib/appTexts';
import { mockApi, ok, type Call, type Reply } from './mockApi';

/** App texts (owner, 2026-10-18: "make sure each and everything was editable from the admin"). */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };
const CAT = { id: 'c1', name: 'Groceries', slug: 'groceries', description: null, image_url: null, display_order: 1, is_active: true, parent_id: null };

function renderApp(handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={['/app-texts']}>
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

describe('App texts page', () => {
  it('shows the app\'s own words as placeholders and saves only what was typed', async () => {
    const user = userEvent.setup();
    const api = renderApp((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/app-texts') return ok({ ...EMPTY_APP_TEXTS, updated_at: null });
      if (c.method === 'GET' && c.path.startsWith('/admin/categories')) return ok({ categories: [CAT] });
      if (c.method === 'PATCH' && c.path === '/admin/settings/app-texts') return ok({ ...EMPTY_APP_TEXTS, ...(c.body as object), updated_at: null });
      return undefined;
    });

    const pill = await screen.findByLabelText('Header pill');
    expect(pill).toHaveAttribute('placeholder', 'Fresh groceries, every day');
    expect(screen.getByLabelText('Cart bar strip')).toHaveAttribute('placeholder', 'Great picks, every time!');
    expect(await screen.findByLabelText('Groceries colour')).toBeInTheDocument();

    await user.type(pill, '  Weekend specials ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-texts')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/app-texts')[0]!.body).toMatchObject({ cart_header_pill: 'Weekend specials', cart_bar_line: '' });
  });

  it('payload trims and drops blank list lines; the Under amount is checked', () => {
    const d = { ...EMPTY_APP_TEXTS, home_aisle_lines: [' One ', '', 'Two'], placed_title: ' Done ' };
    expect(appTextsPayload(d)).toMatchObject({ home_aisle_lines: ['One', 'Two'], placed_title: 'Done' });
    expect(appTextsProblem({ ...EMPTY_APP_TEXTS, home_under_amount: 10 })).toMatch(/from 50/);
    expect(appTextsProblem({ ...EMPTY_APP_TEXTS, home_under_amount: 500 })).toBeNull();
  });
});
