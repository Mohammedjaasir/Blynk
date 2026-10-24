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

/** Product requests (2026-10-24 plan, section C): "Can't find it? Ask us", grouped for staff. */
// Many clicks and typing on a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderAt(handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={['/product-requests']}>
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

const GROUPS = [
  {
    key: 'oat milk',
    name: 'Oat milk',
    count: 2,
    last_requested_at: '2026-10-24T05:00:00.000Z',
    status: 'NEW',
    category_name: 'Dairy',
    requests: [
      // Shaped like backend catalog/product-requests.ts: `customer` for a signed-in requester, `guest` otherwise.
      { id: 'q1', name: 'Oat milk', note: 'Oatly please', created_at: '2026-10-24T05:00:00.000Z', guest: false, customer: { id: 'u1', name: 'Ahmed Rizvi', phone: '+94771234567' } },
      { id: 'q2', name: 'oat  milk', note: null, created_at: '2026-10-20T05:00:00.000Z', guest: true, customer: null },
    ],
  },
  {
    key: 'kithul treacle',
    name: 'Kithul treacle',
    count: 7,
    last_requested_at: '2026-10-10T05:00:00.000Z',
    status: 'PLANNED',
    category_name: null,
    staff_note: 'Supplier visits Friday',
    requests: [],
  },
  {
    key: 'durian',
    name: 'Durian',
    count: 1,
    last_requested_at: '2026-10-15T05:00:00.000Z',
    status: 'DECLINED',
    category_name: 'Fruit',
    requests: [],
  },
];

function handler(c: Call): Reply | undefined {
  if (c.method === 'GET' && c.path === '/admin/product-requests') return ok({ groups: GROUPS });
  if (c.method === 'PATCH' && c.path.startsWith('/admin/product-requests/')) return ok({ updated: 1 });
  if (c.method === 'GET' && c.path === '/admin/products')
    return ok({ products: [{ id: 'p77', name: 'Oatly Oat Drink 1L', category_name: 'Dairy', is_active: true }] });
  return undefined;
}

const names = () =>
  within(screen.getByRole('list', { name: 'Requested products' }))
    .getAllByRole('listitem')
    .filter((li) => li.classList.contains('request-group'))
    .map((li) => li.getAttribute('aria-label'));

describe('Product requests page', () => {
  it('groups requests, sorts most requested or newest, and filters by status with counts', async () => {
    const user = userEvent.setup();
    const api = renderAt(handler);
    await screen.findByRole('list', { name: 'Requested products' });
    expect(names()).toEqual(['Kithul treacle', 'Oat milk', 'Durian']);
    expect(api.find('GET', '/admin/product-requests')[0]!.query.get('sort')).toBe('popular');
    expect(screen.getByTestId('requests-total')).toHaveTextContent('3 products asked for · 10 requests');
    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not stocking (1)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Newest' }));
    await waitFor(() => expect(api.find('GET', '/admin/product-requests').at(-1)!.query.get('sort')).toBe('newest'));
    await waitFor(() => expect(names()).toEqual(['Oat milk', 'Durian', 'Kithul treacle']));

    await user.click(screen.getByRole('button', { name: 'Planned (1)' }));
    expect(names()).toEqual(['Kithul treacle']);
    expect(screen.getByText('Note: Supplier visits Friday')).toBeInTheDocument();
  });

  it("shows a group's requests", async () => {
    const user = userEvent.setup();
    renderAt(handler);
    await user.click(await screen.findByRole('button', { name: 'Show requests for Oat milk' }));
    const list = screen.getByRole('list', { name: 'Requests for Oat milk' });
    expect(list).toHaveTextContent('Ahmed Rizvi');
    expect(list).toHaveTextContent('Oatly please');
    expect(list).toHaveTextContent('Guest');
  });

  it('marks a group Planned with a note, and Not stocking', async () => {
    const user = userEvent.setup();
    const api = renderAt(handler);
    await user.click(await screen.findByRole('button', { name: 'Update Oat milk' }));
    const form = screen.getByRole('form', { name: 'Update Oat milk' });
    await user.type(within(form).getByRole('textbox'), 'Ordering next week');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/product-requests/oat%20milk')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/product-requests/oat%20milk')[0]!.body).toEqual({ status: 'PLANNED', staff_note: 'Ordering next week' });

    await user.click(screen.getByRole('button', { name: 'Update Durian' }));
    const durian = screen.getByRole('form', { name: 'Update Durian' });
    await user.click(within(durian).getByRole('button', { name: 'Not stocking' }));
    await user.click(within(durian).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/product-requests/durian')[0]?.body).toEqual({ status: 'DECLINED' }));
  });

  it('marks a group Added only once the product is picked', async () => {
    const user = userEvent.setup();
    const api = renderAt(handler);
    await user.click(await screen.findByRole('button', { name: 'Update Oat milk' }));
    const form = screen.getByRole('form', { name: 'Update Oat milk' });
    await user.click(within(form).getByRole('button', { name: 'Added' }));
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(within(form).getByText('Pick the product it was added as.')).toBeInTheDocument();
    await user.type(within(form).getByRole('searchbox', { name: 'Search products' }), 'oat');
    await user.click(await within(form).findByRole('button', { name: /Oatly Oat Drink 1L/ }));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/product-requests/oat%20milk')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/product-requests/oat%20milk')[0]!.body).toEqual({ status: 'ADDED', product_id: 'p77' });
    expect(await screen.findByText(/Oat milk marked added. The 2 customers are told it is in./)).toBeInTheDocument();
  });

  it('says to run migration 056 while the server is not ready', async () => {
    renderAt((c) => (c.path === '/admin/product-requests' ? fail(503, 'PRODUCT_REQUESTS_NOT_READY') : undefined));
    expect(await screen.findByRole('alert')).toHaveTextContent('run database migration 056 in Coolify');
  });
});
