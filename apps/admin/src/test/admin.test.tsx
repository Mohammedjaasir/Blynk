import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, NOT_ADMIN_MESSAGE } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { Layout } from '../components/Layout';
import { Login } from '../pages/Login';
import { Promotions } from '../pages/Promotions';
import { apiRequest, tokenStore } from '../api/client';
import { validateImageFile } from '../lib/image';

/**
 * These cover the admin app's own logic. The API contract itself (RBAC,
 * ordering, uploads) is tested for real against PostgreSQL in
 * backend/api/tests/promotions.test.ts - this file does not re-mock it.
 */

const ADMIN_USER = {
  id: 'a1',
  phone: '+94775551122',
  full_name: 'Nawaz Mansoor',
  email: 'ops.admin@blynk.lk',
  role: 'ADMIN',
};

const CUSTOMER_USER = { ...ADMIN_USER, id: 'c1', role: 'CUSTOMER' };

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    text: () =>
      Promise.resolve(
        JSON.stringify(
          status < 400
            ? { success: true, data }
            : { success: false, error: data }
        )
      ),
  } as Response);
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>{ui}</AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('admin sign-in (email + password only, backend migration 028)', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => tokenStore.clear());

  it('offers no SMS code: no mobile number field, no switch, a password-reset note', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<Login />);

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SMS code/i })).toBeNull();
    expect(screen.queryByLabelText(/Mobile number/)).toBeNull();
    expect(screen.queryByText(/6-digit code/)).toBeNull();
    expect(screen.getByText('Forgot your password? Ask another admin to reset it.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/auth/otp'))).toBe(false);
  });

  it('shows the API error instead of a technical one', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ message: 'Too many sign-in attempts. Try later.' }, 429)));

    renderWithProviders(<Login />);
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@blynk.test');
    await userEvent.type(screen.getByLabelText('Password'), 'Blynk@1960');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Too many sign-in attempts. Try later.')).toBeInTheDocument();
  });
});

describe('admin email + password sign-in (backend migration 012)', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => tokenStore.clear());

  async function signIn(email: string, password: string) {
    await userEvent.type(await screen.findByLabelText('Email'), email);
    await userEvent.type(screen.getByLabelText('Password'), password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('is the default method and signs an ADMIN in with exactly the email and password', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).endsWith('/auth/staff/login')
        ? jsonResponse({ access_token: 'admin-access', refresh_token: 'admin-refresh', user: ADMIN_USER })
        : jsonResponse({})
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Login />);
    expect(await screen.findByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await signIn('owner@blynk.test', 'Blynk@1960');

    await waitFor(() => expect(tokenStore.access).toBe('admin-access'));
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/auth/staff/login'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ email: 'owner@blynk.test', password: 'Blynk@1960' });
  });

  it('the show/hide toggle reveals and hides the password', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({})));
    renderWithProviders(<Login />);
    const password = await screen.findByLabelText('Password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('refuses a customer account and keeps no session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ access_token: 'c-access', refresh_token: 'c-refresh', user: CUSTOMER_USER }))
    );
    renderWithProviders(<Login />);
    await signIn('customer@blynk.test', 'Blynk@1960');
    expect(await screen.findByText(NOT_ADMIN_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('a wrong password says so and clears the field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ code: 'INVALID_CREDENTIALS', message: 'Wrong email or password.' }, 401))
    );
    renderWithProviders(<Login />);
    await signIn('owner@blynk.test', 'not-the-password');
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('a locked account is told how long to wait', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(
          { code: 'LOGIN_LOCKED', message: 'Too many wrong passwords.', details: { retry_after_minutes: 15 } },
          429
        )
      )
    );
    renderWithProviders(<Login />);
    await signIn('owner@blynk.test', 'not-the-password');
    expect(await screen.findByText('Too many attempts. Try again in 15 minutes.')).toBeInTheDocument();
  });
});

describe('no development shortcut', () => {
  // 2026-09-29, owner's request: the "Skip sign-in" dev button is gone.
  it('never offers "Skip sign-in"', async () => {
    renderWithProviders(<Login />);
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', { name: 'Skip sign-in' })).toBeNull();
    expect(screen.queryByText('Dev')).toBeNull();
  });
});

describe('session refresh', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => tokenStore.clear());

  it('refreshes once for simultaneous 401s and retries with the new token', async () => {
    tokenStore.save('expired-access', 'refresh-1');
    let refreshCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'refresh-1' });
        return jsonResponse({ access_token: 'fresh-access', refresh_token: 'refresh-2' });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === 'Bearer fresh-access'
        ? jsonResponse({ ok: url })
        : jsonResponse({ message: 'Token expired' }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([
      apiRequest<{ ok: string }>('/admin/products'),
      apiRequest<{ ok: string }>('/admin/categories'),
      apiRequest<{ ok: string }>('/admin/promotions'),
    ]);

    // The backend treats a reused refresh token as a replay, so the three
    // requests must share one refresh.
    expect(refreshCalls).toBe(1);
    expect(results.map((r) => r.ok.split('/').pop())).toEqual([
      'products',
      'categories',
      'promotions',
    ]);
    expect(tokenStore.access).toBe('fresh-access');
    expect(tokenStore.refresh).toBe('refresh-2');
  });

  it('drops the session when the refresh is rejected', async () => {
    tokenStore.save('expired-access', 'revoked-refresh');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/auth/refresh')
          ? jsonResponse({ message: 'Refresh token has already been used' }, 401)
          : jsonResponse({ message: 'Token expired' }, 401)
      )
    );

    await expect(apiRequest('/admin/products')).rejects.toMatchObject({ status: 401 });
    expect(tokenStore.access).toBeNull();
    expect(tokenStore.refresh).toBeNull();
  });
});

describe('promotions screen', () => {
  const promotions = [
    {
      id: 'p1',
      title: 'Everyday Essentials',
      subtitle: 'Daily staples',
      image_url: null,
      background_type: 'SOLID',
      background_color: '#FFE141',
      background_color_end: null,
      background_image_url: null,
      cta_label: 'Explore',
      cta_destination_type: 'CATEGORY',
      cta_destination_value: 'dairy-eggs',
      display_order: 1,
      is_active: true,
    },
    {
      id: 'p2',
      title: 'Snack Time',
      subtitle: null,
      image_url: null,
      background_type: 'GRADIENT',
      background_color: '#FFF3C4',
      background_color_end: '#E4F2E6',
      background_image_url: null,
      cta_label: null,
      cta_destination_type: null,
      cta_destination_value: null,
      display_order: 2,
      is_active: false,
    },
  ];

  beforeEach(() => {
    tokenStore.save('admin-access');
    vi.restoreAllMocks();
  });

  afterEach(() => tokenStore.clear());

  function stubApi(onRequest?: (url: string, init?: RequestInit) => void) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      onRequest?.(url, init);
      if (url.includes('/admin/promotions/reorder')) return jsonResponse({ promotions });
      if (url.includes('/admin/promotions')) return jsonResponse({ promotions });
      if (url.includes('/admin/categories')) return jsonResponse({ categories: [] });
      if (url.includes('/auth/me')) return jsonResponse(ADMIN_USER);
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('lists promotions with their status and destination', async () => {
    stubApi();
    renderWithProviders(<Promotions />);

    expect(await screen.findByText('Everyday Essentials')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    // The background each promotion uses is visible at a glance.
    expect(screen.getByText('Blynk Yellow')).toBeInTheDocument();
    expect(screen.getByText('Gradient')).toBeInTheDocument();
    expect(screen.getByText('Explore → category "dairy-eggs"')).toBeInTheDocument();
    // A promotion with no destination is labelled honestly.
    expect(screen.getByText('Informational')).toBeInTheDocument();
  });

  it('reorders by swapping display_order with the neighbour', async () => {
    const calls: { url: string; body?: string }[] = [];
    stubApi((url, init) => calls.push({ url, body: init?.body as string }));

    renderWithProviders(<Promotions />);
    await screen.findByText('Everyday Essentials');

    await userEvent.click(
      screen.getByRole('button', { name: 'Move Everyday Essentials down' })
    );

    await waitFor(() => {
      const reorder = calls.find((call) => call.url.includes('/reorder'));
      expect(reorder).toBeDefined();
      expect(JSON.parse(reorder!.body!)).toEqual({
        items: [
          { id: 'p1', display_order: 2 },
          { id: 'p2', display_order: 1 },
        ],
      });
    });
  });

  it('activates an inactive promotion through the API', async () => {
    const calls: { url: string; body?: string; method?: string }[] = [];
    stubApi((url, init) =>
      calls.push({ url, body: init?.body as string, method: init?.method })
    );

    renderWithProviders(<Promotions />);
    await screen.findByText('Snack Time');

    const rows = screen.getAllByRole('row');
    const snackRow = rows.find((row) => row.textContent?.includes('Snack Time'))!;
    const activate = within(snackRow).getByRole('button', { name: 'Show' });
    await userEvent.click(activate);

    await waitFor(() => {
      const patch = calls.find(
        (call) => call.method === 'PATCH' && call.url.includes('/admin/promotions/p2')
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch!.body!)).toEqual({ is_active: true });
    });
  });

  it('asks before deleting', async () => {
    stubApi();
    renderWithProviders(<Promotions />);
    await screen.findByText('Everyday Essentials');

    const rows = screen.getAllByRole('row');
    const row = rows.find((r) => r.textContent?.includes('Everyday Essentials'))!;
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Delete promotion')).toBeInTheDocument();
  });
});

describe('image validation', () => {
  it('accepts the formats the API accepts and rejects the rest', () => {
    const png = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    const pdf = new File([new Uint8Array([1, 2, 3])], 'a.pdf', { type: 'application/pdf' });

    expect(validateImageFile(png).ok).toBe(true);
    expect(validateImageFile(pdf).ok).toBe(false);
    expect(validateImageFile(pdf).message).toMatch(/JPEG, PNG or WebP/);
  });

  it('rejects an absurdly large original', () => {
    const huge = new File([new Uint8Array(13 * 1024 * 1024)], 'huge.jpg', {
      type: 'image/jpeg',
    });
    expect(validateImageFile(huge).ok).toBe(false);
  });
});

describe('admin scope', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
    tokenStore.save('access', 'refresh');
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(ADMIN_USER)));
  });
  afterEach(() => tokenStore.clear());

  it('navigates to store orders, sales, cash, catalog, home, coupons, customers, SMS offers, feedback, staff accounts and settings only', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <Layout />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    // Admin owns store order operations (the documented admin/staff
    // dashboard), catalog and customer-facing content.
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Category groups' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Promotions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff accounts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rider requests' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    // Sales, rider cash, coupons and customers (ADMIN only).
    expect(screen.getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rider cash' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Coupons' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SMS offers' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(15);

    // Inventory and the Rider app are separate applications against the
    // same backend - they must not appear here in any form, not even disabled.
    for (const absent of [/inventory/i, /supplier/i, /stock/i, /rider app/i, /coming later/i]) {
      expect(screen.queryByText(absent)).toBeNull();
    }
  });
});
