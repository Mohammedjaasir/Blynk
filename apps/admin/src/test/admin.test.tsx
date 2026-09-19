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

describe('admin sign-in', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => tokenStore.clear());

  it('signs in an ADMIN account and stores the session', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/otp/request')) return jsonResponse({ dev_otp: '123456' });
      if (url.endsWith('/auth/otp/verify')) {
        return jsonResponse({
          access_token: 'admin-access',
          refresh_token: 'admin-refresh',
          user: ADMIN_USER,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Login />);

    await userEvent.type(screen.getByLabelText(/Mobile number/), '0775551122');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    // The dev code is surfaced, clearly labelled, exactly as the API sends it.
    expect(await screen.findByText('Dev code: 123456')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/6-digit code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await waitFor(() => expect(tokenStore.access).toBe('admin-access'));
  });

  it('refuses a customer account and keeps no session', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/otp/request')) return jsonResponse({ dev_otp: '654321' });
      if (url.endsWith('/auth/otp/verify')) {
        return jsonResponse({
          access_token: 'customer-access',
          refresh_token: 'customer-refresh',
          user: CUSTOMER_USER,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Login />);

    await userEvent.type(screen.getByLabelText(/Mobile number/), '0771234567');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '654321');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByText(NOT_ADMIN_MESSAGE)).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    // The code is spent once the API has verified it, so the form goes back
    // to the phone step instead of inviting a retry that can only fail.
    expect(screen.getByLabelText(/Mobile number/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/6-digit code/)).toBeNull();
  });

  it('shows the API error instead of a technical one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ message: 'Too many OTP requests. Try later.' }, 429))
    );

    renderWithProviders(<Login />);
    await userEvent.type(screen.getByLabelText(/Mobile number/), '0775551122');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));

    expect(
      await screen.findByText('Too many OTP requests. Try later.')
    ).toBeInTheDocument();
  });
});

describe('dev skip sign-in', () => {
  beforeEach(() => {
    tokenStore.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    tokenStore.clear();
  });

  it('is not offered unless a dev admin phone is configured', () => {
    vi.stubEnv('VITE_DEV_ADMIN_PHONE', '');
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({})));
    renderWithProviders(<Login />);
    expect(screen.queryByRole('button', { name: 'Skip sign-in' })).toBeNull();
  });

  it('signs in through the normal OTP flow with the dev code', async () => {
    vi.stubEnv('VITE_DEV_ADMIN_PHONE', '0775551122');
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/auth/otp/request')) return jsonResponse({ dev_otp: '424242' });
      if (url.endsWith('/auth/otp/verify')) {
        return jsonResponse({
          access_token: 'admin-access',
          refresh_token: 'admin-refresh',
          user: ADMIN_USER,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip sign-in' }));

    await waitFor(() => expect(tokenStore.access).toBe('admin-access'));
    expect(calls.map((c) => c.body)).toEqual([
      { phone: '0775551122' },
      { phone: '0775551122', otp: '424242' },
    ]);
  });

  it('refuses to skip when the API gives no dev code', async () => {
    vi.stubEnv('VITE_DEV_ADMIN_PHONE', '0775551122');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/auth/otp/request')
          ? jsonResponse({ expires_in_seconds: 300 })
          : jsonResponse({})
      )
    );

    renderWithProviders(<Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip sign-in' }));

    expect(
      await screen.findByText('Skip only works against a development API.')
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
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

  it('navigates to store orders, catalog and home only', async () => {
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
    expect(screen.getByRole('link', { name: 'Promotions' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(5);

    // Inventory and the Rider app are separate applications against the
    // same backend - they must not appear here in any form, not even disabled.
    for (const absent of [/inventory/i, /supplier/i, /stock/i, /rider app/i, /coming later/i]) {
      expect(screen.queryByText(absent)).toBeNull();
    }
  });
});
