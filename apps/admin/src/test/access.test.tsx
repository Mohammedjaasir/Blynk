import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import {
  AuthProvider,
  INVENTORY_STAFF_MESSAGE,
  NOT_ADMIN_MESSAGE,
  OPERATIONS_ROLES,
  OPERATIONS_STAFF_MESSAGE,
  wrongAppMessage,
} from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';

/**
 * Who gets into the Admin app and what they see. Since 2026-09-30 (backend
 * migration 014) only ADMIN accounts hold a session here: packing staff use
 * the Inventory site and Operations staff the Operations app, and a stored
 * session of either is dropped on load. The API remains the authority.
 */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };
const STAFF = { id: 's1', phone: '+94774443322', full_name: 'Kasun Perera', email: null, role: 'PACKING_STAFF' };
const OPS = { id: 'o1', phone: '+94771112233', full_name: 'Ops Person', email: null, role: 'OPERATIONS' };
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
      if (url.includes('/admin/feedback')) return respond({ feedback: [], pagination: { page: 1, limit: 50, total: 0, total_pages: 1 } });
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

  it('an admin sees Orders alongside the catalog and Staff accounts', async () => {
    renderAs(ADMIN, '/');
    expect(await navLinks()).toEqual([
      'Dashboard',
      'Orders',
      'Sales',
      'Rider cash',
      'Products',
      'Categories',
      'Promotions',
      'Coupons',
      'Customers',
      'Feedback',
      'Staff accounts',
      'Settings',
    ]);
  });

  it.each([
    ['packing staff', STAFF],
    ['operations staff', OPS],
  ])('a stored %s session is dropped and sent to sign in', async (_name, user) => {
    renderAs(user, '/orders');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('tells each kind of staff which app to use instead', () => {
    expect(wrongAppMessage('PACKING_STAFF')).toBe(INVENTORY_STAFF_MESSAGE);
    expect(INVENTORY_STAFF_MESSAGE).toMatch(/Inventory site/);
    expect(wrongAppMessage('OPERATIONS')).toBe(OPERATIONS_STAFF_MESSAGE);
    expect(OPERATIONS_STAFF_MESSAGE).toMatch(/Operations app/);
    expect(wrongAppMessage('RIDER')).toBe(NOT_ADMIN_MESSAGE);
    expect(OPERATIONS_ROLES).toEqual(['ADMIN']);
  });

  it('a rider session is not an operations session', async () => {
    renderAs(RIDER, '/orders');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(NOT_ADMIN_MESSAGE).toBe('This account is not a Blynk operations account.');
  });
});
