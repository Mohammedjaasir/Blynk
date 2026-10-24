import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Seller portal, Admin side (2026-10-24): Sellers list and detail (approve / reject / suspend, commission,
 * statement, payouts) and the Seller products approval queue. The API is the fake in mockApi; the contract
 * is docs/superpowers/plans/2026-10-24-seller-portal.md.
 */
vi.setConfig({ testTimeout: 20_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

const seller = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1',
  shop_name: 'Jaffna Spice House',
  contact_name: 'Kumar',
  address: '12 Temple Rd, Jaffna',
  note: 'Home-ground spices',
  status: 'PENDING',
  rejection_reason: null,
  commission_percent: 0,
  created_at: '2026-10-20T04:00:00.000Z',
  phone: '+94771234567',
  full_name: 'Kumar',
  products_live: 0,
  submissions_pending: 2,
  due: 0,
  ...over,
});
const statement = (over: Record<string, unknown> = {}): Statement => ({
  commission_percent: 10,
  gross: 1000,
  commission: 100,
  earned: 900,
  paid: 300,
  due: 600,
  lines: [{ product_id: 'p1', name: 'Curry powder 250g', units: 10, gross: 1000 }],
  payouts: [{ id: 'po1', amount: 300, note: 'Bank transfer', paid_on: '2026-10-22' }],
  ...over,
});
type Statement = {
  commission_percent: number; gross: number; commission: number; earned: number; paid: number; due: number;
  lines: { product_id: string; name: string; units: number; gross: number }[];
  payouts: { id: string; amount: number; note: string | null; paid_on: string }[];
};
const submission = (over: Record<string, unknown> = {}) => ({
  id: 'sub1',
  kind: 'NEW',
  status: 'PENDING',
  product_id: null,
  payload: { name: 'Chilli flakes', category_id: 'c1', unit: 'pack', pack_size: '100g', description: 'Sun dried', image_url: null },
  seller_price: 80,
  approved_selling_price: null,
  reject_reason: null,
  created_at: '2026-10-21T04:00:00.000Z',
  reviewed_at: null,
  seller: { id: 's1', shop_name: 'Jaffna Spice House', phone: '+94771234567', status: 'APPROVED' },
  product: null,
  category_name: 'Spices',
  ...over,
});
const CATEGORIES = [
  { id: 'c1', name: 'Spices', slug: 'spices', display_order: 1, is_active: true, parent_id: null },
  { id: 'c2', name: 'Pantry', slug: 'pantry', display_order: 2, is_active: true, parent_id: null },
];

function renderAt(route: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.path === '/auth/me') return ok(ADMIN);
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    return handler(c);
  });
  render(
    <MemoryRouter initialEntries={[route]}>
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
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Sellers list', () => {
  const rows = [
    seller(),
    seller({ id: 's2', shop_name: 'Galle Sweets', status: 'APPROVED', products_live: 4, submissions_pending: 0, commission_percent: 7.5, due: 1250, phone: '+94779990000' }),
    seller({ id: 's3', shop_name: 'Old Shop', status: 'SUSPENDED', submissions_pending: 0 }),
  ];

  it('lists sellers with status counts, waiting items and what is due, and filters by status', async () => {
    const user = userEvent.setup();
    renderAt('/sellers', (c) => (c.method === 'GET' && c.path === '/admin/sellers' ? ok({ sellers: rows }) : undefined));
    const table = await screen.findByRole('table', { name: 'Sellers' });
    expect(within(table).getByText('Jaffna Spice House')).toBeInTheDocument();
    expect(within(table).getByText('Galle Sweets')).toBeInTheDocument();
    expect(within(table).getByText('LKR 1,250.00')).toBeInTheDocument();
    expect(within(table).getByText('7.5%')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: '2 waiting for Jaffna Spice House' })).toHaveAttribute('href', '/seller-products?seller=s1');

    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approved (1)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approved (1)' }));
    expect(within(screen.getByRole('table', { name: 'Sellers' })).queryByText('Jaffna Spice House')).toBeNull();
    expect(screen.getByText('Galle Sweets')).toBeInTheDocument();
  });

  it('searches on the server by shop or phone', async () => {
    const user = userEvent.setup();
    const api = renderAt('/sellers', (c) => (c.method === 'GET' && c.path === '/admin/sellers' ? ok({ sellers: rows }) : undefined));
    await screen.findByRole('table', { name: 'Sellers' });
    await user.type(screen.getByLabelText('Search sellers'), 'galle');
    await waitFor(() => expect(api.find('GET', '/admin/sellers').some((c) => c.query.get('search') === 'galle')).toBe(true));
  });

  it('marks sellers with no approved shop location, and a location waiting for review', async () => {
    renderAt('/sellers', (c) =>
      c.method === 'GET' && c.path === '/admin/sellers'
        ? ok({
            sellers: [
              seller(),
              seller({ id: 's2', shop_name: 'Galle Sweets', latitude: 6.03, longitude: 80.21, location_status: 'APPROVED' }),
              seller({ id: 's3', shop_name: 'Kandy Tea', location_status: 'PENDING', pending_latitude: 7.29, pending_longitude: 80.63 }),
            ],
          })
        : undefined
    );
    const table = await screen.findByRole('table', { name: 'Sellers' });
    const rowOf = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;
    expect(within(rowOf('Jaffna Spice House')).getByText('No location')).toBeInTheDocument();
    expect(within(rowOf('Galle Sweets')).queryByText('No location')).toBeNull();
    expect(within(rowOf('Galle Sweets')).queryByText('Location waiting')).toBeNull();
    expect(within(rowOf('Kandy Tea')).getByText('Location waiting')).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    renderAt('/sellers', (c) => (c.method === 'GET' && c.path === '/admin/sellers' ? ok({ sellers: [] }) : undefined));
    expect(await screen.findByText('No sellers yet')).toBeInTheDocument();
  });
});

describe('Seller detail', () => {
  function open(s = seller(), st = statement()) {
    let current = s;
    let stmt = st;
    return renderAt('/sellers/s1', (c) => {
      if (c.method === 'GET' && c.path === '/admin/sellers/s1') return ok({ seller: current, statement: stmt });
      if (c.method === 'PATCH' && c.path === '/admin/sellers/s1') {
        const b = c.body as { status?: string; rejection_reason?: string; commission_percent?: number };
        current = {
          ...current,
          ...(b.status ? { status: b.status } : {}),
          ...(b.rejection_reason ? { rejection_reason: b.rejection_reason } : {}),
          ...(b.commission_percent != null ? { commission_percent: b.commission_percent } : {}),
        };
        return ok({ seller: current });
      }
      if (c.method === 'POST' && c.path === '/admin/sellers/s1/payouts') {
        const b = c.body as { amount: number; note?: string; paid_on?: string };
        const payout = { id: 'po2', amount: b.amount, note: b.note ?? null, paid_on: b.paid_on ?? '2026-10-24' };
        stmt = { ...stmt, paid: stmt.paid + b.amount, due: stmt.due - b.amount, payouts: [payout, ...stmt.payouts] };
        return ok({ payout, statement: stmt });
      }
      if (c.method === 'DELETE' && c.path === '/admin/sellers/s1/payouts/po1') {
        stmt = { ...stmt, paid: 0, due: 900, payouts: [] };
        return ok({ statement: stmt });
      }
      if (c.method === 'POST' && c.path === '/admin/sellers/s1/location/approve') {
        current = {
          ...current,
          latitude: current.pending_latitude,
          longitude: current.pending_longitude,
          location_note: current.pending_location_note,
          distance_km_from_store: current.pending_distance_km_from_store,
          pending_latitude: null,
          pending_longitude: null,
          pending_location_note: null,
          pending_distance_km_from_store: null,
          location_status: 'APPROVED',
        };
        return ok({ seller: current });
      }
      if (c.method === 'POST' && c.path === '/admin/sellers/s1/location/reject') {
        current = { ...current, location_status: 'REJECTED', location_reject_reason: (c.body as { reason: string }).reason };
        return ok({ seller: current });
      }
      return undefined;
    });
  }

  const waitingLocation = {
    latitude: null,
    longitude: null,
    location_note: null,
    distance_km_from_store: null,
    pending_latitude: 9.661498,
    pending_longitude: 80.025543,
    pending_location_note: 'Opposite the Nallur temple car park',
    pending_distance_km_from_store: 312.4,
    location_status: 'PENDING',
    location_reject_reason: null,
  };

  it('says "No location set yet" and the Approve dialog warns (but still approves)', async () => {
    const user = userEvent.setup();
    const api = open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    expect(within(screen.getByRole('region', { name: 'Shop location' })).getByText('No location set yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/no approved shop location yet/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
  });

  it('shows the waiting pin with its map, distance and Google Maps link, and approves it', async () => {
    const user = userEvent.setup();
    const api = open(seller(waitingLocation));
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    const panel = screen.getByRole('region', { name: 'Shop location' });
    expect(within(within(panel).getByRole('group', { name: 'Approved location' })).getByText('No approved location yet')).toBeInTheDocument();
    const waiting = within(panel).getByRole('group', { name: 'Waiting location' });
    expect(within(waiting).getByText('9.661498, 80.025543')).toBeInTheDocument();
    expect(within(waiting).getByText('Opposite the Nallur temple car park')).toBeInTheDocument();
    expect(within(waiting).getByText('312.4 km from the Blynk store')).toBeInTheDocument();
    expect(within(waiting).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=9.661498,80.025543');
    expect(within(waiting).getByTitle('Map: waiting location').getAttribute('src')).toContain('marker=9.661498,80.025543');

    // approving the seller warns that the location still waits
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(within(screen.getByRole('dialog')).getByText(/still waiting for your approval/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await user.click(within(waiting).getByRole('button', { name: 'Approve location' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/location/approve')).toHaveLength(1));
    expect(await screen.findByText("Jaffna Spice House's shop location is approved.")).toBeInTheDocument();
    const approved = within(screen.getByRole('region', { name: 'Shop location' })).getByRole('group', { name: 'Approved location' });
    expect(within(approved).getByText('9.661498, 80.025543')).toBeInTheDocument();
    expect(within(approved).getByText('312.4 km from the Blynk store')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Waiting location' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve location' })).toBeNull();
  });

  it('rejects a waiting pin only with a reason, and shows it as rejected', async () => {
    const user = userEvent.setup();
    const api = open(seller({ ...waitingLocation, latitude: 9.66, longitude: 80.02, distance_km_from_store: 311.9, location_note: 'Old shop' }));
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    const panel = screen.getByRole('region', { name: 'Shop location' });
    expect(within(within(panel).getByRole('group', { name: 'Approved location' })).getByText('311.9 km from the Blynk store')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Reject location' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject shop location' });
    expect(within(dialog).getByText(/approved location stays in use/)).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox'), 'ab');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers/s1/location/reject')).toHaveLength(0);
    await user.type(within(dialog).getByRole('textbox'), 'c - the pin is in the lagoon');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/location/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/sellers/s1/location/reject')[0]!.body).toEqual({ reason: 'abc - the pin is in the lagoon' });
    const rejected = await screen.findByRole('group', { name: 'Rejected location' });
    expect(within(rejected).getByText('Rejected because: abc - the pin is in the lagoon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve location' })).toBeNull();
  });

  it('shows the profile and the statement with its per-product lines', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Jaffna Spice House' })).toBeInTheDocument();
    const profile = screen.getByRole('region', { name: 'Profile' });
    expect(within(profile).getByText('12 Temple Rd, Jaffna')).toBeInTheDocument();
    expect(within(profile).getByText('Home-ground spices')).toBeInTheDocument();
    expect(within(profile).getAllByText('077 123 4567').length).toBeGreaterThan(0);

    const stmt = screen.getByRole('region', { name: 'Statement' });
    expect(within(stmt).getAllByText('LKR 1,000.00').length).toBeGreaterThan(0);
    expect(within(stmt).getByText('Commission (10%)')).toBeInTheDocument();
    expect(within(stmt).getByText('LKR 900.00')).toBeInTheDocument();
    expect(within(stmt).getByText('LKR 600.00')).toBeInTheDocument();
    const lines = within(stmt).getByRole('table', { name: 'Sold products' });
    expect(within(lines).getByText('Curry powder 250g')).toBeInTheDocument();
    expect(within(lines).getByText('10')).toBeInTheDocument();
  });

  it('approves after a confirm', async () => {
    const user = userEvent.setup();
    const api = open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ status: 'APPROVED' });
    expect(await screen.findByText('Jaffna Spice House is approved and gets an SMS.')).toBeInTheDocument();
    // An approved seller can be suspended, not approved again.
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  });

  it('rejecting needs a reason', async () => {
    const user = userEvent.setup();
    const api = open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject seller' });
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'ab');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(0);
    await user.type(within(dialog).getByRole('textbox'), 'c - no shop found at this address');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ status: 'REJECTED', rejection_reason: 'abc - no shop found at this address' });
    expect(await screen.findByText('Rejected because')).toBeInTheDocument();
  });

  it('suspending asks first and warns that products go off', async () => {
    const user = userEvent.setup();
    const api = open(seller({ status: 'APPROVED', products_live: 3 }));
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/switched off in the customer app/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ status: 'SUSPENDED' });
    expect(await screen.findByRole('button', { name: 'Approve again' })).toBeInTheDocument();
  });

  it('saves the commission and reads the statement again', async () => {
    const user = userEvent.setup();
    const api = open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    const save = screen.getByRole('button', { name: 'Save commission' });
    expect(save).toBeDisabled();
    const field = screen.getByLabelText('Commission percent');
    await user.clear(field);
    await user.type(field, '150');
    await user.click(save);
    expect(await screen.findByText('The commission cannot be more than 100%.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(0);
    await user.clear(field);
    await user.type(field, '7.5');
    await user.click(save);
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ commission_percent: 7.5 });
    await waitFor(() => expect(api.find('GET', '/admin/sellers/s1').length).toBeGreaterThan(1));
  });

  it('records a payment and the statement updates', async () => {
    const user = userEvent.setup();
    const api = open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    const payouts = screen.getByRole('region', { name: 'Payouts' });
    await user.click(within(payouts).getByRole('button', { name: 'Record payment' }));
    expect(await within(payouts).findByText('Enter the amount paid.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers/s1/payouts')).toHaveLength(0);

    await user.type(within(payouts).getByLabelText('Amount paid'), '200');
    await user.type(within(payouts).getByLabelText('Payment note'), 'Cash at the store');
    await user.click(within(payouts).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/payouts')).toHaveLength(1));
    const body = api.find('POST', '/admin/sellers/s1/payouts')[0]!.body;
    expect(body).toMatchObject({ amount: 200, note: 'Cash at the store' });
    expect(body.paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText('Payment of LKR 200.00 recorded.')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Payments' })).getByText('Cash at the store')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Statement' })).getByText('LKR 400.00')).toBeInTheDocument();
    expect(within(payouts).getByLabelText('Amount paid')).toHaveValue('');
  });

  it('deletes a mistaken payment only after a confirm', async () => {
    const user = userEvent.setup();
    const api = open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Delete payment of LKR 300.00' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.find('DELETE', '/admin/sellers/s1/payouts/po1')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Delete payment of LKR 300.00' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete payment' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/sellers/s1/payouts/po1')).toHaveLength(1));
    expect(await screen.findByText('No payments recorded yet')).toBeInTheDocument();
    // Earned and Due are both 900 now that the 300 payment is gone.
    expect(within(screen.getByRole('region', { name: 'Statement' })).getAllByText('LKR 900.00')).toHaveLength(2);
  });
});

describe('Seller products approval queue', () => {
  const edit = submission({
    id: 'sub2',
    kind: 'EDIT',
    product_id: 'p9',
    payload: { name: 'Chilli flakes 100g', category_id: 'c1', unit: 'pack' },
    seller_price: 90,
    product: { id: 'p9', name: 'Chilli flakes', selling_price: 110, purchase_cost: 80 },
  });
  const liveProduct = { id: 'p9', name: 'Chilli flakes', category_id: 'c1', unit: 'pack', pack_size: null, description: null, image_url: null, barcode: null, purchase_cost: 80, selling_price: 110 };

  function queue(rows: unknown[]) {
    return renderAt('/seller-products', (c) => {
      if (c.method === 'GET' && c.path === '/admin/seller-submissions') return ok({ submissions: rows });
      if (c.method === 'GET' && c.path === '/admin/products/p9') return ok({ product: liveProduct });
      if (c.method === 'POST' && /^\/admin\/seller-submissions\/[^/]+\/approve$/.test(c.path)) return ok({ submission: {}, product: {} });
      if (c.method === 'POST' && /^\/admin\/seller-submissions\/[^/]+\/reject$/.test(c.path)) return ok({ submission: {} });
      return undefined;
    });
  }

  it('shows each waiting submission with seller, proposal and the seller price, asking for the waiting ones', async () => {
    const api = queue([submission(), edit]);
    const card = await screen.findByRole('region', { name: 'New product Chilli flakes' });
    expect(within(card).getByText('New product')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Jaffna Spice House' })).toHaveAttribute('href', '/sellers/s1');
    expect(within(card).getByText('Spices', { selector: 'dd' })).toBeInTheDocument();
    expect(within(card).getByText('pack · 100g')).toBeInTheDocument();
    expect(within(card).getByText('Sun dried')).toBeInTheDocument();
    expect(within(card).getByText('LKR 80.00', { selector: 'strong' })).toBeInTheDocument();
    expect(api.find('GET', '/admin/seller-submissions')[0]!.query.get('status')).toBe('PENDING');
  });

  it('a new product needs a selling price, shows the margin and warns below cost, then approves with the price', async () => {
    const user = userEvent.setup();
    const api = queue([submission()]);
    const card = await screen.findByRole('region', { name: 'New product Chilli flakes' });
    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await within(card).findByText('Enter the selling price.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/seller-submissions/sub1/approve')).toHaveLength(0);

    const price = within(card).getByLabelText('Selling price for Chilli flakes');
    await user.type(price, '70');
    expect(within(card).getByText(/Below cost/)).toBeInTheDocument();
    await user.clear(price);
    await user.type(price, '100');
    expect(within(card).queryByText(/Below cost/)).toBeNull();
    expect(within(card).getByLabelText('Margin')).toHaveTextContent("Margin: LKR 20.00 per unit (25% over the seller's price).");

    await user.selectOptions(within(card).getByLabelText('Category for Chilli flakes'), 'c2');
    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-submissions/sub1/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-submissions/sub1/approve')[0]!.body).toEqual({ selling_price: 100, category_id: 'c2' });
    expect(await screen.findByText('Chilli flakes is approved and live. The seller gets an SMS.')).toBeInTheDocument();
    expect(await screen.findByText('Nothing waiting for approval')).toBeInTheDocument();
  });

  it('an edit shows live versus proposed and needs a price because the seller price changed', async () => {
    const user = userEvent.setup();
    const api = queue([edit]);
    const card = await screen.findByRole('region', { name: 'Change to Chilli flakes 100g' });
    const changes = await within(card).findByRole('table', { name: 'Live versus proposed' });
    expect(within(changes).getByText('Chilli flakes')).toBeInTheDocument();
    expect(within(changes).getByText('Chilli flakes 100g')).toBeInTheDocument();
    expect(within(changes).getByText('LKR 80.00')).toBeInTheDocument();
    expect(within(changes).getByText('LKR 90.00')).toBeInTheDocument();
    expect(within(card).getByText('Customers pay LKR 110.00 for it now.')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    expect(await within(card).findByText(/seller changed their price/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/seller-submissions/sub2/approve')).toHaveLength(0);
    await user.type(within(card).getByLabelText('Selling price for Chilli flakes 100g'), '115');
    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-submissions/sub2/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-submissions/sub2/approve')[0]!.body).toEqual({ selling_price: 115 });
  });

  it('an edit that keeps the seller price can be approved without typing a price', async () => {
    const user = userEvent.setup();
    const keep = { ...edit, seller_price: 80, payload: { name: 'Chilli flakes (new look)' } };
    const api = queue([keep]);
    const card = await screen.findByRole('region', { name: 'Change to Chilli flakes (new look)' });
    expect(within(card).getByLabelText('Selling price for Chilli flakes (new look)')).toHaveAttribute('placeholder', 'Keep LKR 110.00');
    await user.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-submissions/sub2/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-submissions/sub2/approve')[0]!.body).toEqual({});
  });

  it('rejecting needs a reason', async () => {
    const user = userEvent.setup();
    const api = queue([submission()]);
    const card = await screen.findByRole('region', { name: 'New product Chilli flakes' });
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject Chilli flakes' });
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/seller-submissions/sub1/reject')).toHaveLength(0);
    await user.type(within(dialog).getByRole('textbox'), 'yz - photo is blurry');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-submissions/sub1/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-submissions/sub1/reject')[0]!.body).toEqual({ reason: 'xyz - photo is blurry' });
    expect(await screen.findByText('Nothing waiting for approval')).toBeInTheDocument();
  });

  it('filters to one seller from the Sellers page link', async () => {
    const api = renderAt('/seller-products?seller=s1', (c) => (c.method === 'GET' && c.path === '/admin/seller-submissions' ? ok({ submissions: [] }) : undefined));
    await screen.findByText('Nothing waiting for approval');
    expect(api.find('GET', '/admin/seller-submissions')[0]!.query.get('seller_id')).toBe('s1');
    expect(screen.getByRole('button', { name: 'Show every seller' })).toBeInTheDocument();
  });
});

describe('nav badge', () => {
  it('shows how many seller products wait', async () => {
    renderAt('/orders', (c) => {
      if (c.method === 'GET' && c.path === '/admin/seller-submissions') return ok({ submissions: [submission(), submission({ id: 'x' })] });
      if (c.method === 'GET' && c.path === '/admin/orders') return ok({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } });
      return undefined;
    });
    expect(await screen.findByLabelText('2 waiting')).toBeInTheDocument();
  });
});
