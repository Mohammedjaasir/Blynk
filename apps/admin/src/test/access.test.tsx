import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider, NOT_ADMIN_MESSAGE } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';

/**
 * Who gets into the Admin app and what they see (dispatch plan D12). The
 * Orders workflow lives here - the documented "admin/staff dashboard" - so
 * packing staff sign in too, but only to Orders. Catalog and promotions stay
 * admin-only in the UI and, authoritatively, in the API.
 */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };
const STAFF = { id: 's1', phone: '+94774443322', full_name: 'Kasun Perera', email: null, role: 'PACKING_STAFF' };
const RIDER = { id: 'r1', phone: '+94779876543', full_name: 'Farhan Mohamed', email: null, role: 'RIDER' };

function respond(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    text: () => Promise.resolve(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data })),
  } as Response);
}

/** Signed in as `user`; every list endpoint answers empty. */
function renderAs(user: typeof ADMIN, route: string) {
  tokenStore.save('access', 'refresh');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return respond(user);
      if (url.includes('/admin/orders')) return respond({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } });
      if (url.includes('/admin/riders')) return respond({ riders: [] });
      if (url.includes('/admin/products')) return respond({ products: [] });
      if (url.includes('/admin/categories')) return respond({ categories: [] });
      if (url.includes('/admin/promotions')) return respond({ promotions: [] });
      return respond({});
    })
  );
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

const navLinks = async () => {
  const nav = await screen.findByRole('navigation');
  return within(nav)
    .getAllByRole('link')
    .map((a) => a.textContent);
};

describe('Admin app access', () => {
  beforeEach(() => tokenStore.clear());
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('an admin sees Orders alongside the catalog', async () => {
    renderAs(ADMIN, '/');
    expect(await navLinks()).toEqual(['Dashboard', 'Orders', 'Products', 'Categories', 'Promotions']);
  });

  it('packing staff land on Orders and see nothing else', async () => {
    renderAs(STAFF, '/');
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(await navLinks()).toEqual(['Orders']);
  });

  it.each(['/products', '/categories', '/promotions', '/products/new'])(
    'packing staff sent to %s are brought back to Orders',
    async (route) => {
      renderAs(STAFF, route);
      expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    }
  );

  it('a rider session is not an operations session', async () => {
    renderAs(RIDER, '/orders');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(NOT_ADMIN_MESSAGE).toBe('This account is not a Blynk operations account.');
  });
});
