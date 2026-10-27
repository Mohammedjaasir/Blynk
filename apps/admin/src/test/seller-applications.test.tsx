import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';
import {
  addSellerState,
  applicationCounts,
  localPhone,
  readAddSellerState,
  sortApplications,
  telHref,
  type SellerApplication,
} from '../lib/sellerApplications';

/** Seller applications (2026-10-27 plan, section S2): the form at blynk.lk/seller, reviewed by staff. */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

const APPS: SellerApplication[] = [
  {
    id: 'ap1',
    shop_name: 'Sunrise Spices',
    owner_name: 'Kamal Perera',
    phone: '+94771234567',
    email: 'kamal@example.com',
    town: 'Aluthgama',
    what_they_sell: 'Spices and dry fish',
    message: 'Please call after 4',
    status: 'NEW',
    staff_note: null,
    created_at: '2026-10-27T05:00:00.000Z',
  },
  {
    id: 'ap2',
    shop_name: 'Lanka Sweets',
    owner_name: 'Nimali Silva',
    phone: '+94719876543',
    email: null,
    town: 'Dharga Town',
    what_they_sell: 'Short eats',
    message: null,
    status: 'CONTACTED',
    staff_note: 'Visit on Friday',
    created_at: '2026-10-26T05:00:00.000Z',
  },
  {
    id: 'ap3',
    shop_name: 'Old Shop',
    owner_name: 'Somebody',
    phone: '+94701112223',
    email: null,
    town: 'Bentota',
    what_they_sell: 'Toys',
    message: null,
    status: 'DECLINED',
    staff_note: null,
    created_at: '2026-10-20T05:00:00.000Z',
  },
];

function renderAt(path: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={[path]}>
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

function handler(c: Call): Reply | undefined {
  if (c.method === 'GET' && c.path === '/admin/seller-applications') return ok({ applications: APPS, new_count: 1 });
  if (c.method === 'PATCH' && c.path === '/admin/seller-applications/ap1') {
    return ok({ application: { ...APPS[0], ...c.body, handled_by_name: 'Nawaz Mansoor', handled_at: '2026-10-27T06:00:00.000Z' }, new_count: 0 });
  }
  if (c.method === 'GET' && c.path === '/admin/sellers') return ok({ sellers: [] });
  if (c.method === 'GET' && c.path === '/admin/seller-payout-requests') return ok({ payout_requests: [] });
  if (c.method === 'POST' && c.path === '/admin/sellers') {
    return ok({ seller: { id: 's9', shop_name: c.body.shop_name, status: c.body.status, phone: c.body.phone, created_at: '2026-10-27T06:00:00.000Z', products_live: 0, submissions_pending: 0, due: 0 } });
  }
  return undefined;
}

describe('seller application helpers', () => {
  it('shows the number the way staff dial it and builds the call link', () => {
    expect(localPhone('+94771234567')).toBe('077 123 4567');
    expect(localPhone('whatever')).toBe('whatever');
    expect(telHref('+94771234567')).toBe('tel:+94771234567');
  });
  it('counts by status and sorts NEW first, then newest first', () => {
    expect(applicationCounts(APPS)).toEqual({ ALL: 3, NEW: 1, CONTACTED: 1, APPROVED: 0, DECLINED: 1 });
    expect(sortApplications([...APPS].reverse()).map((a) => a.id)).toEqual(['ap1', 'ap2', 'ap3']);
  });
  it('hands the application to the Add seller form and reads it back', () => {
    const state = addSellerState(APPS[0]);
    expect(state).toEqual({ addSeller: { application_id: 'ap1', shop_name: 'Sunrise Spices', contact_name: 'Kamal Perera', phone: '077 123 4567' } });
    expect(readAddSellerState(state)).toEqual(state.addSeller);
    expect(readAddSellerState(null)).toBeNull();
    expect(readAddSellerState({ addSeller: { shop_name: 'x' } })).toBeNull();
  });
});

describe('Seller applications page', () => {
  it('lists the applications with a tap-to-call phone, filters by status and shows the NEW badge in the menu', async () => {
    const user = userEvent.setup();
    renderAt('/seller-applications', handler);
    const table = await screen.findByRole('table', { name: 'Seller applications' });
    const rows = () => within(table).getAllByRole('row').slice(1).map((r) => r.getAttribute('aria-label'));
    expect(rows()).toEqual(['Sunrise Spices', 'Lanka Sweets', 'Old Shop']);
    const first = within(table).getByRole('row', { name: 'Sunrise Spices' });
    expect(first).toHaveTextContent('Kamal Perera');
    expect(first).toHaveTextContent('Aluthgama');
    expect(first).toHaveTextContent('Spices and dry fish');
    expect(first).toHaveTextContent('“Please call after 4”');
    expect(within(first).getByRole('link', { name: /Call Kamal Perera on 077 123 4567/ })).toHaveAttribute('href', 'tel:+94771234567');
    expect(within(first).getByRole('link', { name: 'kamal@example.com' })).toHaveAttribute('href', 'mailto:kamal@example.com');
    expect(within(screen.getByRole('row', { name: 'Lanka Sweets' })).getByText('Note: Visit on Friday')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Contacted (1)' }));
    expect(rows()).toEqual(['Lanka Sweets']);
    await user.click(screen.getByRole('button', { name: 'Approved (0)' }));
    expect(await screen.findByText('No applications here')).toBeInTheDocument();

    // the sidebar link carries the NEW count
    const link = screen.getByRole('link', { name: /Seller applications/ });
    await waitFor(() => expect(within(link).getByLabelText('1 new')).toBeInTheDocument());
  });

  it('sets the status and a staff note with one save', async () => {
    const user = userEvent.setup();
    const api = renderAt('/seller-applications', handler);
    await user.click(await screen.findByRole('button', { name: 'Update Sunrise Spices' }));
    const form = screen.getByRole('form', { name: 'Update Sunrise Spices' });
    await user.click(within(form).getByRole('button', { name: 'Contacted' }));
    await user.type(within(form).getByRole('textbox'), 'Rang, will send photos');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/seller-applications/ap1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/seller-applications/ap1')[0]!.body).toEqual({ status: 'CONTACTED', staff_note: 'Rang, will send photos' });
    expect(await screen.findByText('Sunrise Spices is marked contacted.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Update Sunrise Spices' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: 'Sunrise Spices' })).getByText('Contacted')).toBeInTheDocument();
  });

  it('shows the server error and keeps the form when saving fails', async () => {
    const user = userEvent.setup();
    renderAt('/seller-applications', (c) =>
      c.method === 'PATCH' ? fail(500, 'INTERNAL', 'Something broke') : handler(c)
    );
    await user.click(await screen.findByRole('button', { name: 'Update Sunrise Spices' }));
    const form = screen.getByRole('form', { name: 'Update Sunrise Spices' });
    await user.click(within(form).getByRole('button', { name: 'Declined' }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Something broke');
  });

  it('"Add as seller" opens the Add seller form with the shop, name and phone filled in, then marks the application Approved', async () => {
    const user = userEvent.setup();
    const api = renderAt('/seller-applications', handler);
    await user.click(await screen.findByRole('button', { name: 'Add Sunrise Spices as seller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add seller' });
    expect(within(dialog).getByLabelText('Shop name')).toHaveValue('Sunrise Spices');
    expect(within(dialog).getByLabelText('Phone')).toHaveValue('077 123 4567');
    expect(within(dialog).getByLabelText('Contact name (optional)')).toHaveValue('Kamal Perera');
    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers')).toHaveLength(1));
    expect(api.find('POST', '/admin/sellers')[0]!.body).toMatchObject({ shop_name: 'Sunrise Spices', phone: '+94771234567', contact_name: 'Kamal Perera', status: 'APPROVED' });
    await waitFor(() => expect(api.find('PATCH', '/admin/seller-applications/ap1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/seller-applications/ap1')[0]!.body).toEqual({ status: 'APPROVED' });
  });

  it('the Add seller button on the Sellers page still opens an empty form', async () => {
    const user = userEvent.setup();
    renderAt('/sellers', handler);
    await user.click(await screen.findByRole('button', { name: 'Add seller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add seller' });
    expect(within(dialog).getByLabelText('Shop name')).toHaveValue('');
    expect(within(dialog).getByLabelText('Phone')).toHaveValue('');
  });

  it('says to run migration 064 while the server is not ready', async () => {
    renderAt('/seller-applications', (c) => (c.path === '/admin/seller-applications' ? fail(503, 'SELLER_APPLICATIONS_NOT_READY') : undefined));
    expect(await screen.findByRole('alert')).toHaveTextContent('run database migration 064 in Coolify');
  });

  it('shows an empty state when nobody has applied', async () => {
    renderAt('/seller-applications', (c) => (c.path === '/admin/seller-applications' ? ok({ applications: [], new_count: 0 }) : undefined));
    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
  });
});
