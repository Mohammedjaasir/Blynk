import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * More -> Sellers, Seller products and Seller commission (owner, 2026-10-25: the seller admin inside
 * Ops) against a fake API shaped like the Admin contract (/admin/sellers*, /admin/seller-submissions*,
 * /admin/seller-stock-notes*, /admin/seller-payout-requests*, /admin/settings/seller-commission).
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const seller = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1',
  shop_name: 'Jaffna Spice House',
  contact_name: 'Kumar',
  address: '12 Temple Rd, Jaffna',
  note: 'Home-ground spices',
  status: 'PENDING',
  rejection_reason: null,
  commission_percent: null,
  created_at: '2026-10-20T04:00:00.000Z',
  phone: '+94771234567',
  email: null,
  full_name: 'Kumar',
  products_live: 0,
  submissions_pending: 2,
  due: 600,
  ...over,
});
const statement = (over: Record<string, unknown> = {}) => ({
  commission_percent: null,
  gross: 1000,
  commission: 40,
  earned: 960,
  paid: 360,
  due: 600,
  lines: [{ product_id: 'p1', name: 'Curry powder 250g', units: 10, gross: 1000, commission_percent: 4, commission: 40 }],
  payouts: [{ id: 'po1', amount: 360, note: 'Bank transfer', paid_on: '2026-10-22' }],
  ...over,
});
const sellerRef = { id: 's1', shop_name: 'Jaffna Spice House', phone: '+94771234567', email: null };
const stockNote = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  product_id: 'p1',
  product_name: 'Curry powder 250g',
  image_url: null,
  unit: 'pack',
  pack_size: '250g',
  quantity: 20,
  expected_on: '2026-10-28',
  note: 'Tuesday morning',
  status: 'SENT',
  received_quantity: null,
  received_at: null,
  cancelled_at: null,
  created_at: '2026-10-24T04:00:00.000Z',
  stock_on_hand: 3,
  seller: sellerRef,
  ...over,
});
const payoutRequest = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  amount: 500,
  method: 'BANK',
  bank_details: 'BOC 1234567, Jaffna',
  note: 'For the new stock',
  status: 'REQUESTED',
  decline_reason: null,
  payout_id: null,
  paid_on: null,
  handled_at: null,
  created_at: '2026-10-24T05:00:00.000Z',
  seller: sellerRef,
  due: 600,
  ...over,
});
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
  { id: 'c1', name: 'Spices', slug: 'spices', description: null, image_url: null, display_order: 1, is_active: true, parent_id: null },
  { id: 'c2', name: 'Pantry', slug: 'pantry', description: null, image_url: null, display_order: 2, is_active: true, parent_id: null },
];

const emptyStatement = () => statement({ lines: [], payouts: [], gross: 0, commission: 0, earned: 0, paid: 0, due: 0 });

// ---------------------------------------------------------------- More and the list

describe('More -> Sellers list', () => {
  const rows = [
    seller(),
    seller({ id: 's2', shop_name: 'Galle Sweets', status: 'APPROVED', products_live: 4, submissions_pending: 0, commission_percent: 7.5, due: 1250, phone: '+94779990000', latitude: 6.03, longitude: 80.21, location_status: 'APPROVED' }),
    seller({ id: 's3', shop_name: 'Old Shop', status: 'SUSPENDED', submissions_pending: 0, location_status: 'PENDING', pending_latitude: 7.1, pending_longitude: 80.1 }),
  ];
  const listHandlers = {
    'GET /admin/sellers': (c: Call) => ok({ sellers: c.query.status ? rows.filter((r) => r.status === c.query.status) : rows }),
    'GET /admin/seller-stock-notes': () => ok({ stock_notes: [stockNote(), stockNote({ id: 'n2' })] }),
    'GET /admin/seller-payout-requests': () => ok({ payout_requests: [payoutRequest({ seller: { ...sellerRef, id: 's2', shop_name: 'Galle Sweets' } })] }),
  };

  it('has More cards with waiting badges that lead to the list and the queue', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more', {
      ...listHandlers,
      'GET /admin/seller-submissions': () => ok({ submissions: [submission(), submission({ id: 'sub2' })] }),
    });
    const sellersLink = await screen.findByRole('link', { name: /^Sellers/ });
    expect(sellersLink).toHaveAttribute('href', '/more/sellers');
    expect(await within(sellersLink).findByLabelText('1 sellers waiting')).toBeInTheDocument();
    const products = screen.getByRole('link', { name: /^Seller products/ });
    expect(products).toHaveAttribute('href', '/more/seller-products');
    expect(await within(products).findByLabelText('2 products waiting')).toBeInTheDocument();
    await user.click(sellersLink);
    expect(await screen.findByRole('listitem', { name: 'Seller Galle Sweets' })).toBeInTheDocument();
  });

  it('lists sellers as cards with status, waiting items and what is due; filters by status', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/sellers', listHandlers);
    const first = await screen.findByRole('listitem', { name: 'Seller Jaffna Spice House' });
    expect(within(first).getByText('Waiting')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: '2 waiting for Jaffna Spice House' })).toHaveAttribute('href', '/more/seller-products?seller=s1');
    expect(within(first).getByText('No location')).toBeInTheDocument();
    expect(await within(first).findByText('2 stock notes')).toBeInTheDocument();
    const second = screen.getByRole('listitem', { name: 'Seller Galle Sweets' });
    expect(second).toHaveTextContent('commission 7.5%');
    expect(second).toHaveTextContent('due LKR 1,250.00');
    expect(await within(second).findByText('Payout requested')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'Seller Old Shop' })).getByText('Location waiting')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Jaffna Spice House' })).toHaveAttribute('href', '/more/sellers/s1');

    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approved (1)' }));
    expect(screen.queryByRole('listitem', { name: 'Seller Jaffna Spice House' })).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Seller Galle Sweets' })).toBeInTheDocument();
  });

  it('searches on the server by shop, phone or email', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/sellers', listHandlers);
    await screen.findByRole('listitem', { name: 'Seller Galle Sweets' });
    await user.type(screen.getByLabelText('Search sellers'), 'galle');
    await waitFor(() => expect(api.find('GET', '/admin/sellers').some((c) => c.query.search === 'galle')).toBe(true));
  });

  it('adds a seller: checks the form, explains a number that has an account, then opens the new seller', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { api } = renderAs(OPERATIONS_STAFF, '/more/sellers', {
      ...listHandlers,
      'POST /admin/sellers': () => {
        attempts += 1;
        if (attempts === 1) return { status: 409, error: { code: 'PHONE_IN_USE', message: 'in use', details: { role: 'CUSTOMER' } } };
        return ok({ seller: seller({ id: 's9', shop_name: 'Kandy Crafts', phone: '+94771112222', status: 'APPROVED' }) });
      },
      'GET /admin/sellers/:id': () => ok({ seller: seller({ id: 's9', shop_name: 'Kandy Crafts', phone: '+94771112222', status: 'APPROVED' }), statement: emptyStatement() }),
      'GET /admin/seller-stock-notes': () => ok({ stock_notes: [] }),
      'GET /admin/seller-payout-requests': () => ok({ payout_requests: [] }),
    });
    await screen.findByRole('listitem', { name: 'Seller Galle Sweets' });
    await user.click(screen.getByRole('button', { name: 'Add seller' }));
    const dialog = screen.getByRole('dialog', { name: 'Add seller' });
    expect(within(dialog).getByRole('checkbox')).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    expect(within(dialog).getByText(/Enter the shop name/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Shop name/), 'Kandy Crafts');
    await user.type(within(dialog).getByLabelText(/^Phone/), '12345');
    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    expect(within(dialog).getByText(/Sri Lankan mobile number/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers')).toHaveLength(0);

    await user.clear(within(dialog).getByLabelText(/^Phone/));
    await user.type(within(dialog).getByLabelText(/^Phone/), '077 111 2222');
    await user.type(within(dialog).getByLabelText(/^Contact name/), 'Nimal');
    await user.type(within(dialog).getByLabelText(/^Address/), '5 Main St');
    await user.type(within(dialog).getByLabelText(/^Own commission %/), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    expect(await within(dialog).findByText('This number already has a Blynk account (customer).')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers')[0]!.body).toEqual({
      shop_name: 'Kandy Crafts',
      phone: '+94771112222',
      contact_name: 'Nimal',
      address: '5 Main St',
      commission_percent: 4,
      status: 'APPROVED',
    });

    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    expect(await screen.findByRole('heading', { name: 'Kandy Crafts' })).toBeInTheDocument();
    expect(screen.getByText('Signs in with 077 111 2222 (SMS code on the seller site).')).toBeInTheDocument();
  });

  it('can add a seller as waiting (approve now off) with category rates', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/sellers', {
      ...listHandlers,
      'POST /admin/sellers': () => ok({ seller: seller({ id: 's9', shop_name: 'Kandy Crafts' }) }),
      'GET /admin/sellers/:id': () => ok({ seller: seller({ id: 's9', shop_name: 'Kandy Crafts' }), statement: emptyStatement() }),
    });
    await screen.findByRole('listitem', { name: 'Seller Galle Sweets' });
    await user.click(screen.getByRole('button', { name: 'Add seller' }));
    const dialog = screen.getByRole('dialog', { name: 'Add seller' });
    await user.type(within(dialog).getByLabelText(/^Shop name/), 'Kandy Crafts');
    await user.type(within(dialog).getByLabelText(/^Phone/), '0771112222');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers')).toHaveLength(1));
    expect(api.find('POST', '/admin/sellers')[0]!.body).toEqual({ shop_name: 'Kandy Crafts', phone: '+94771112222', status: 'PENDING' });
  });
});

// ---------------------------------------------------------------- detail

describe('Seller detail', () => {
  const detail = (over: Record<string, unknown> = {}, extra: Record<string, (c: Call) => unknown> = {}) => ({
    'GET /admin/sellers/:id': () => ok({ seller: seller(over), statement: statement() }),
    'GET /admin/seller-stock-notes': () => ok({ stock_notes: [] }),
    'GET /admin/seller-payout-requests': () => ok({ payout_requests: [] }),
    ...extra,
  });

  it('approves a waiting seller after a confirm, warning when no shop location is approved', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail({}, { 'PATCH /admin/sellers/:id': (c) => ok({ seller: seller({ status: c.body.status }) }) })
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve Jaffna Spice House?' });
    expect(within(dialog).getByRole('note')).toHaveTextContent('no approved shop location');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ status: 'APPROVED' });
    expect(await screen.findByText('Jaffna Spice House is approved and gets an SMS.')).toBeInTheDocument();
    // An approved seller can be suspended, not approved again.
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('rejects with a reason (the button waits for one)', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail({}, { 'PATCH /admin/sellers/:id': (c) => ok({ seller: seller({ status: c.body.status, rejection_reason: c.body.rejection_reason }) }) })
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject seller' });
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Shop closed down');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ status: 'REJECTED', rejection_reason: 'Shop closed down' });
    expect(await screen.findByText('Rejected because')).toBeInTheDocument();
  });

  it('suspends an approved seller after a confirm', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail({ status: 'APPROVED' }, { 'PATCH /admin/sellers/:id': (c) => ok({ seller: seller({ status: c.body.status }) }) })
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Suspend Jaffna Spice House?' })).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')[0]?.body).toEqual({ status: 'SUSPENDED' }));
  });

  it('edits the sign-in phone and contact; a number in use is explained, then saved', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(
        {},
        {
          'PATCH /admin/sellers/:id': (c) => {
            attempts += 1;
            if (attempts === 1) return { status: 409, error: { code: 'PHONE_IN_USE', message: 'in use', details: { role: 'RIDER' } } };
            return ok({ seller: seller({ phone: c.body.phone, contact_name: c.body.contact_name }) });
          },
        }
      )
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit seller details' });
    expect(within(dialog).getByLabelText(/^Phone/)).toHaveValue('077 123 4567');
    await user.clear(within(dialog).getByLabelText(/^Phone/));
    await user.type(within(dialog).getByLabelText(/^Phone/), '077 999 8888');
    await user.clear(within(dialog).getByLabelText(/^Contact name/));
    await user.type(within(dialog).getByLabelText(/^Contact name/), 'Anan');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await within(dialog).findByText('This number already has a Blynk account (rider).')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ phone: '+94779998888', contact_name: 'Anan' });
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Seller details saved.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit seller details' })).toBeNull();
  });

  it('commission: "Use category rates" (null) or an own rate', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(
        { status: 'APPROVED', commission_percent: 5 },
        { 'PATCH /admin/sellers/:id': (c) => ok({ seller: seller({ status: 'APPROVED', commission_percent: c.body.commission_percent }) }) }
      )
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    const save = screen.getByRole('button', { name: 'Save commission' });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText('Commission percent')).toHaveValue('5');
    await user.click(screen.getByRole('radio', { name: 'Use category rates' }));
    await user.click(screen.getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ commission_percent: null });
    expect(await screen.findByText('Commission saved.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Own rate' }));
    await user.type(screen.getByLabelText('Commission percent'), '101');
    await user.click(screen.getByRole('button', { name: 'Save commission' }));
    expect(await screen.findByText('The commission cannot be more than 100%.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Commission percent'));
    await user.type(screen.getByLabelText('Commission percent'), '7.5');
    await user.click(screen.getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/sellers/s1')[1]!.body).toEqual({ commission_percent: 7.5 });
  });

  it('shows the pending and approved shop points, approves the waiting one, or rejects it with a reason', async () => {
    const user = userEvent.setup();
    const withPin = {
      status: 'APPROVED',
      latitude: 7.29,
      longitude: 80.63,
      location_note: 'Opposite the temple',
      distance_km_from_store: 3.2,
      location_status: 'PENDING',
      pending_latitude: 7.3,
      pending_longitude: 80.64,
      pending_location_note: 'New shop',
      pending_distance_km_from_store: 4.1,
    };
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(withPin, {
        'POST /admin/sellers/:id/location/approve': () => ok({ seller: seller({ ...withPin, latitude: 7.3, longitude: 80.64, location_status: 'APPROVED', pending_latitude: null, pending_longitude: null }) }),
        'POST /admin/sellers/:id/location/reject': (c) =>
          ok({ seller: seller({ ...withPin, location_status: 'REJECTED', location_reject_reason: c.body.reason }) }),
      })
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    const approved = screen.getByRole('group', { name: 'Approved location' });
    expect(approved).toHaveTextContent('7.290000, 80.630000');
    expect(approved).toHaveTextContent('3.2 km from the Blynk store');
    expect(within(approved).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=7.29,80.63');
    const waiting = screen.getByRole('group', { name: 'Waiting location' });
    expect(waiting).toHaveTextContent('New shop');
    expect(within(waiting).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=7.3,80.64');

    await user.click(within(waiting).getByRole('button', { name: 'Reject location' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject shop location' });
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Pin is in the sea');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/location/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/sellers/s1/location/reject')[0]!.body).toEqual({ reason: 'Pin is in the sea' });
    expect(await screen.findByText('Rejected because: Pin is in the sea')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve location' })).toBeNull();
  });

  it('approves the waiting shop location', async () => {
    const user = userEvent.setup();
    const pinned = { status: 'APPROVED', location_status: 'PENDING', pending_latitude: 7.3, pending_longitude: 80.64 };
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(pinned, {
        'POST /admin/sellers/:id/location/approve': () => ok({ seller: seller({ status: 'APPROVED', latitude: 7.3, longitude: 80.64, location_status: 'APPROVED', pending_latitude: null, pending_longitude: null }) }),
      })
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Approve location' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/location/approve')).toHaveLength(1));
    expect(await screen.findByText("Jaffna Spice House's shop location is approved.")).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Waiting location' })).toBeNull();
  });

  it('shows the statement with the commission Blynk keeps per product', async () => {
    renderAs(OPERATIONS_STAFF, '/more/sellers/s1', detail({ status: 'APPROVED' }));
    const section = await screen.findByRole('region', { name: 'Statement' });
    expect(section).toHaveTextContent('LKR 1,000.00');
    expect(section).toHaveTextContent('Commission (category rates)');
    expect(within(section).getByText('LKR 600.00')).toBeInTheDocument();
    expect(within(section).getByRole('list', { name: 'Sold products' })).toHaveTextContent('Blynk keeps LKR 40.00 (4%)');
  });

  it('records a payout and deletes a mistaken one (the amount due follows)', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(
        { status: 'APPROVED' },
        {
          'POST /admin/sellers/:id/payouts': (c) =>
            ok({
              payout: { id: 'po2', amount: c.body.amount, note: c.body.note ?? null, paid_on: c.body.paid_on },
              statement: statement({ paid: 610, due: 350, payouts: [{ id: 'po2', amount: 250, note: 'Cash', paid_on: c.body.paid_on }, { id: 'po1', amount: 360, note: 'Bank transfer', paid_on: '2026-10-22' }] }),
            }),
          'DELETE /admin/sellers/:id/payouts/:payoutId': () => ok({ statement: statement({ paid: 0, due: 960, payouts: [] }) }),
        }
      )
    );
    const section = await screen.findByRole('region', { name: 'Payouts' });
    await user.click(within(section).getByRole('button', { name: 'Record payment' }));
    expect(within(section).getByRole('alert')).toHaveTextContent('Enter the amount paid.');
    await user.type(within(section).getByLabelText('Amount paid'), '250');
    await user.type(within(section).getByLabelText('Payment note'), 'Cash');
    await user.click(within(section).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers/s1/payouts')).toHaveLength(1));
    const body = api.find('POST', '/admin/sellers/s1/payouts')[0]!.body;
    expect(body).toMatchObject({ amount: 250, note: 'Cash' });
    expect(body.paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText('Payment of LKR 250.00 recorded.')).toBeInTheDocument();
    expect(within(section).getByText(/Due now:/)).toHaveTextContent('LKR 350.00');

    await user.click(within(section).getByRole('button', { name: 'Delete payment of LKR 360.00' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this payment?' })).getByRole('button', { name: 'Delete payment' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/sellers/s1/payouts/po1')).toHaveLength(1));
    expect(await screen.findByText('Payment deleted.')).toBeInTheDocument();
    expect(within(section).getByText(/Due now:/)).toHaveTextContent('LKR 960.00');
  });

  it('receives goods with the counted quantity, or cancels a note', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(
        { status: 'APPROVED' },
        {
          'GET /admin/seller-stock-notes': () => ok({ stock_notes: [stockNote(), stockNote({ id: 'n2', product_name: 'Chilli flakes', quantity: 5 })] }),
          'POST /admin/seller-stock-notes/:id/receive': (c) => ok({ stock_note: stockNote({ status: 'RECEIVED', received_quantity: c.body.received_quantity }), stock_on_hand: 21 }),
          'POST /admin/seller-stock-notes/:id/cancel': () => ok({ stock_note: stockNote({ id: 'n2', status: 'CANCELLED' }) }),
        }
      )
    );
    const section = await screen.findByRole('region', { name: 'Stock coming in' });
    await within(section).findByRole('group', { name: 'Stock note for Curry powder 250g' });
    await user.click(within(section).getByRole('button', { name: 'Receive Curry powder 250g' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive stock' });
    const quantity = within(dialog).getByLabelText(/^Received quantity/);
    expect(quantity).toHaveValue('20');
    await user.clear(quantity);
    await user.type(quantity, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(within(dialog).getByText(/At least 1/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/seller-stock-notes/n1/receive')).toHaveLength(0);
    await user.clear(quantity);
    await user.type(quantity, '18');
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-stock-notes/n1/receive')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-stock-notes/n1/receive')[0]!.body).toEqual({ received_quantity: 18 });
    expect(await screen.findByText('18 of Curry powder 250g received. Stock now 21.')).toBeInTheDocument();
    expect(within(section).queryByRole('group', { name: 'Stock note for Curry powder 250g' })).toBeNull();

    await user.click(within(section).getByRole('button', { name: 'Cancel stock note for Chilli flakes' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Cancel this stock note?' })).getByRole('button', { name: 'Cancel note' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-stock-notes/n2/cancel')).toHaveLength(1));
    expect(await screen.findByText('Stock note cancelled.')).toBeInTheDocument();
  });

  it('pays a payout request (statement updates) or declines another with a reason', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(
        { status: 'APPROVED' },
        {
          'GET /admin/seller-payout-requests': () => ok({ payout_requests: [payoutRequest(), payoutRequest({ id: 'r2', amount: 900, method: 'CASH', bank_details: null, note: null })] }),
          'POST /admin/seller-payout-requests/:id/pay': () =>
            ok({
              payout_request: payoutRequest({ status: 'PAID' }),
              payout: { id: 'po9', amount: 500, note: null, paid_on: '2026-10-25' },
              statement: statement({ paid: 860, due: 100 }),
            }),
          'POST /admin/seller-payout-requests/:id/decline': () => ok({ payout_request: payoutRequest({ id: 'r2', status: 'DECLINED' }) }),
        }
      )
    );
    const section = await screen.findByRole('region', { name: 'Payout requests' });
    const first = await within(section).findByRole('group', { name: 'Payout request of LKR 500.00' });
    expect(first).toHaveTextContent('BOC 1234567, Jaffna');
    const second = within(section).getByRole('group', { name: 'Payout request of LKR 900.00' });
    expect(second).toHaveTextContent('more than is due now');

    await user.click(within(first).getByRole('button', { name: 'Mark paid' }));
    const pay = screen.getByRole('dialog', { name: 'Pay the seller' });
    await user.type(within(pay).getByLabelText('Payout note'), 'Ref 77');
    await user.click(within(pay).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-payout-requests/r1/pay')).toHaveLength(1));
    const payBody = api.find('POST', '/admin/seller-payout-requests/r1/pay')[0]!.body;
    expect(payBody).toMatchObject({ note: 'Ref 77' });
    expect(payBody.paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText('Paid LKR 500.00 and recorded it.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Payouts' })).toHaveTextContent('LKR 100.00');

    await user.click(within(second).getByRole('button', { name: 'Decline' }));
    const decline = screen.getByRole('dialog', { name: 'Decline payout request' });
    expect(within(decline).getByRole('button', { name: 'Decline' })).toBeDisabled();
    await user.type(within(decline).getByLabelText(/^Reason/), 'Ask again after Friday');
    await user.click(within(decline).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-payout-requests/r2/decline')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-payout-requests/r2/decline')[0]!.body).toEqual({ reason: 'Ask again after Friday' });
    expect(await screen.findByText('Payout request declined.')).toBeInTheDocument();
  });

  it('before the database update the stock and payout sections say so (no server error)', async () => {
    renderAs(
      OPERATIONS_STAFF,
      '/more/sellers/s1',
      detail(
        { status: 'APPROVED' },
        {
          'GET /admin/seller-stock-notes': () => fail(503, 'SELLER_REQUESTS_NOT_READY'),
          'GET /admin/seller-payout-requests': () => fail(503, 'SELLER_REQUESTS_NOT_READY'),
        }
      )
    );
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await waitFor(() => expect(screen.getAllByText('Available after the next database update.')).toHaveLength(2));
    expect(screen.queryByText(/Blynk API had a problem/)).toBeNull();
  });
});

// ---------------------------------------------------------------- seller products

describe('More -> Seller products', () => {
  const queue = (rows: unknown[], extra: Record<string, (c: Call) => unknown> = {}) => ({
    'GET /admin/seller-submissions': () => ok({ submissions: rows }),
    'GET /admin/categories': () => ok({ categories: CATEGORIES }),
    ...extra,
  });

  it('approves a new product with a selling price and a category change, warning below cost first', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/seller-products',
      queue([submission()], { 'POST /admin/seller-submissions/:id/approve': () => ok({ submission: submission({ status: 'APPROVED' }), product: { id: 'p5' } }) })
    );
    const card = await screen.findByRole('listitem', { name: 'New product Chilli flakes' });
    expect(card).toHaveTextContent('Jaffna Spice House');
    expect(card).toHaveTextContent('LKR 80.00');

    // A new product always needs a price.
    await user.click(within(card).getByRole('button', { name: 'Approve Chilli flakes' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('Enter the selling price.');
    expect(api.find('POST', '/admin/seller-submissions/sub1/approve')).toHaveLength(0);

    const price = within(card).getByLabelText('Selling price for Chilli flakes');
    await user.type(price, '70');
    expect(within(card).getByRole('alert')).toHaveTextContent('Below cost');
    expect(within(card).getByRole('alert')).toHaveTextContent('Blynk loses LKR 10.00 on every unit');
    await user.clear(price);
    await user.type(price, '120');
    expect(within(card).getByLabelText('Margin')).toHaveTextContent('Margin: LKR 40.00 per unit (50% over the seller');

    await user.selectOptions(within(card).getByLabelText('Category for Chilli flakes'), 'c2');
    await user.click(within(card).getByRole('button', { name: 'Approve Chilli flakes' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-submissions/sub1/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-submissions/sub1/approve')[0]!.body).toEqual({ selling_price: 120, category_id: 'c2' });
    expect(await screen.findByText('Chilli flakes is approved and live. The seller gets an SMS.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: 'New product Chilli flakes' })).toBeNull();
  });

  it('shows live versus proposed for an edit; keeps the live price when the seller price did not change', async () => {
    const user = userEvent.setup();
    const edit = submission({
      id: 'sub2',
      kind: 'EDIT',
      product_id: 'p9',
      payload: { name: 'Curry powder 250g', category_id: 'c2', unit: 'pack' },
      seller_price: 90,
      product: { id: 'p9', name: 'Curry powder 200g', selling_price: 120, purchase_cost: 80 },
    });
    const same = submission({
      id: 'sub3',
      kind: 'EDIT',
      product_id: 'p10',
      payload: { name: 'Pepper', unit: 'pack' },
      seller_price: 80,
      product: { id: 'p10', name: 'Pepper', selling_price: 150, purchase_cost: 80 },
    });
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/seller-products',
      queue([edit, same], {
        'GET /admin/products/:id': (c) =>
          c.path.endsWith('/p9')
            ? ok({ product: { id: 'p9', name: 'Curry powder 200g', category_id: 'c1', unit: 'pack', purchase_cost: 80, selling_price: 120 } })
            : ok({ product: { id: 'p10', name: 'Pepper', category_id: 'c1', unit: 'pack', purchase_cost: 80, selling_price: 150 } }),
        'POST /admin/seller-submissions/:id/approve': () => ok({ submission: edit, product: { id: 'p10' } }),
      })
    );
    const card = await screen.findByRole('listitem', { name: 'Change to Curry powder 250g' });
    const changes = await within(card).findByRole('list', { name: 'Live versus proposed' });
    await waitFor(() => expect(changes).toHaveTextContent('Live now: Spices'));
    expect(changes).toHaveTextContent('Live now: Curry powder 200g');
    expect(changes).toHaveTextContent('Seller wants: Curry powder 250g');
    expect(changes).toHaveTextContent('Seller wants: Pantry');
    expect(changes).toHaveTextContent("Seller's price");
    expect(changes).toHaveTextContent('Seller wants: LKR 90.00');
    expect(within(card).getByText('Customers pay LKR 120.00 for it now.')).toBeInTheDocument();

    // The price changed: a new selling price is required.
    await user.click(within(card).getByRole('button', { name: 'Approve Curry powder 250g' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('changed their price');

    // Price unchanged: approving with an empty price keeps the live one.
    const keep = screen.getByRole('listitem', { name: 'Change to Pepper' });
    expect(within(keep).getByLabelText('Selling price for Pepper')).toHaveAttribute('placeholder', 'Keep LKR 150.00');
    await user.click(within(keep).getByRole('button', { name: 'Approve Pepper' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-submissions/sub3/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-submissions/sub3/approve')[0]!.body).toEqual({});
  });

  it('rejects with a reason and the card leaves the queue; filters by seller from the list link', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(
      OPERATIONS_STAFF,
      '/more/seller-products?seller=s1',
      queue([submission()], { 'POST /admin/seller-submissions/:id/reject': () => ok({ submission: submission({ status: 'REJECTED' }) }) })
    );
    expect(api.find('GET', '/admin/seller-submissions')).toHaveLength(0);
    const card = await screen.findByRole('listitem', { name: 'New product Chilli flakes' });
    expect(api.find('GET', '/admin/seller-submissions')[0]!.query).toEqual({ status: 'PENDING', seller_id: 's1' });
    await user.click(within(card).getByRole('button', { name: 'Reject Chilli flakes' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject Chilli flakes' });
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Blurry photo');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-submissions/sub1/reject')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-submissions/sub1/reject')[0]!.body).toEqual({ reason: 'Blurry photo' });
    expect(await screen.findByText('Nothing waiting for approval')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    renderAs(OPERATIONS_STAFF, '/more/seller-products', queue([]));
    expect(await screen.findByText('Nothing waiting for approval')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- commission settings

describe('More -> Seller commission', () => {
  const settings = {
    default_percent: 2,
    ready: true,
    categories: [
      { category_id: 'c1', name: 'Sweets', parent_id: null, percent: 3 },
      { category_id: 'c2', name: 'Toffee', parent_id: 'c1', percent: null },
      { category_id: 'c3', name: 'Pickles', parent_id: null, percent: null },
    ],
  };

  it('shows main categories with their sub-categories and saves the default and the rates', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/seller-commission', {
      'GET /admin/settings/seller-commission': () => ok(settings),
      'PUT /admin/settings/seller-commission': (c) => ok({ ...settings, default_percent: c.body.default_percent }),
    });
    const form = await screen.findByRole('form', { name: 'Seller commission settings' });
    expect(within(form).getByLabelText('Default commission percent')).toHaveValue('2');
    expect(within(form).getByLabelText('Commission for Sweets')).toHaveValue('3');
    expect(within(form).getByLabelText('Commission for Toffee')).toHaveAttribute('placeholder', 'Main category');
    expect(within(form).getByLabelText('Commission for Pickles')).toHaveAttribute('placeholder', 'Default');

    await user.clear(within(form).getByLabelText('Default commission percent'));
    await user.type(within(form).getByLabelText('Default commission percent'), '2.5');
    await user.type(within(form).getByLabelText('Commission for Toffee'), '1.5');
    await user.clear(within(form).getByLabelText('Commission for Sweets'));
    await user.click(within(form).getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/seller-commission')[0]!.body).toEqual({
      default_percent: 2.5,
      categories: [
        { category_id: 'c1', percent: null },
        { category_id: 'c2', percent: 1.5 },
        { category_id: 'c3', percent: null },
      ],
    });
    expect(await screen.findByText('Seller commission saved.')).toBeInTheDocument();
  });

  it('refuses a bad percent and explains the 503 before the database update', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/seller-commission', {
      'GET /admin/settings/seller-commission': () => ok(settings),
      'PUT /admin/settings/seller-commission': () => fail(503, 'SELLER_REQUESTS_NOT_READY'),
    });
    const form = await screen.findByRole('form', { name: 'Seller commission settings' });
    fireEvent.change(within(form).getByLabelText('Commission for Pickles'), { target: { value: '200' } });
    await user.click(within(form).getByRole('button', { name: 'Save commission' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('cannot be more than 100');
    expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(0);
    fireEvent.change(within(form).getByLabelText('Commission for Pickles'), { target: { value: '' } });
    await user.click(within(form).getByRole('button', { name: 'Save commission' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Category rates can be saved after the next database update.');
  });
});
