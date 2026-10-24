import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import {
  categoryTree,
  commissionBody,
  newSellerBody,
  normalisePhone,
  openCounts,
  parseQuantity,
  phoneInUseText,
  type CategoryRate,
} from '../lib/sellers';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Seller portal, Admin side, second round (2026-10-24): sellers are invite-only (Add seller, edit the
 * sign-in phone), commission by category (the Seller commission panel, "Use category rates" vs
 * "Own rate"), goods sellers say are coming (receive / cancel) and their payout requests (pay /
 * decline). The API is the fake in mockApi.
 */
vi.setConfig({ testTimeout: 20_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

const seller = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1',
  shop_name: 'Jaffna Spice House',
  contact_name: 'Kumar',
  address: '12 Temple Rd, Jaffna',
  note: null,
  status: 'APPROVED',
  rejection_reason: null,
  commission_percent: null,
  created_at: '2026-10-20T04:00:00.000Z',
  phone: '+94771234567',
  email: null,
  full_name: 'Kumar',
  products_live: 2,
  submissions_pending: 0,
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
const note = (over: Record<string, unknown> = {}) => ({
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

function renderAt(route: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.path === '/auth/me') return ok(ADMIN);
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

// ---------------------------------------------------------------- the rules

describe('seller rules (lib)', () => {
  it('reads Sri Lankan mobile numbers', () => {
    expect(normalisePhone('077 123 4567')).toBe('+94771234567');
    expect(normalisePhone('+94 77-123-4567')).toBe('+94771234567');
    expect(normalisePhone('94771234567')).toBe('+94771234567');
    expect(normalisePhone('0112345678')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
  });

  it('builds the add-seller body: blank commission = category rates, approve on/off', () => {
    const form = { shop_name: ' Kandy Crafts ', phone: '0771234567', contact_name: '', address: ' 5 Main St ', commission: '', approve: true };
    expect(newSellerBody(form)).toEqual({ body: { shop_name: 'Kandy Crafts', phone: '+94771234567', address: '5 Main St', status: 'APPROVED' } });
    expect(newSellerBody({ ...form, commission: '4', approve: false })).toMatchObject({ body: { commission_percent: 4, status: 'PENDING' } });
    expect(newSellerBody({ ...form, shop_name: 'K' })).toMatchObject({ field: 'shop_name' });
    expect(newSellerBody({ ...form, phone: '123' })).toMatchObject({ field: 'phone' });
    expect(newSellerBody({ ...form, commission: '101' })).toMatchObject({ field: 'commission' });
  });

  it('says which kind of account has the number', () => {
    expect(phoneInUseText('CUSTOMER')).toBe('This number already has a Blynk account (customer).');
    expect(phoneInUseText('OPERATIONS')).toBe('This number already has a Blynk account (staff).');
    expect(phoneInUseText(undefined)).toBe('This number already has a Blynk account.');
  });

  it('orders categories main first with their sub-categories, and builds the commission body', () => {
    const rows: CategoryRate[] = [
      { category_id: 'c2', name: 'Toffee', parent_id: 'c1', percent: null },
      { category_id: 'c1', name: 'Sweets', parent_id: null, percent: 3 },
      { category_id: 'c3', name: 'Pickles', parent_id: null, percent: 4 },
      { category_id: 'c4', name: 'Orphan', parent_id: 'gone', percent: null },
    ];
    expect(categoryTree(rows).map((t) => [t.row.name, t.depth])).toEqual([
      ['Sweets', 0],
      ['Toffee', 1],
      ['Pickles', 0],
      ['Orphan', 0],
    ]);
    expect(commissionBody('2', { c1: '3', c2: '' })).toEqual({
      body: { default_percent: 2, categories: [{ category_id: 'c1', percent: 3 }, { category_id: 'c2', percent: null }] },
    });
    expect(commissionBody('', {})).toHaveProperty('error');
    expect(commissionBody('2', { c1: '200' })).toHaveProperty('error');
  });

  it('reads a received quantity and counts open items per seller', () => {
    expect(parseQuantity('18')).toEqual({ value: 18 });
    expect(parseQuantity('0')).toHaveProperty('error');
    expect(parseQuantity('1.5')).toHaveProperty('error');
    expect(parseQuantity('10001')).toHaveProperty('error');
    const counts = openCounts([{ seller: { id: 's1' } }, { seller: { id: 's1' } }], [{ seller: { id: 's2' } }]);
    expect(counts.get('s1')).toEqual({ stock: 2, payout: 0 });
    expect(counts.get('s2')).toEqual({ stock: 0, payout: 1 });
  });
});

// ---------------------------------------------------------------- Sellers page

describe('Sellers page', () => {
  const rows = [seller(), seller({ id: 's2', shop_name: 'Galle Sweets', commission_percent: 4, phone: '+94779990000' })];

  it('shows badges for goods on their way and waiting payout requests, and the rate', async () => {
    renderAt('/sellers', (c) => {
      if (c.method === 'GET' && c.path === '/admin/sellers') return ok({ sellers: rows });
      if (c.method === 'GET' && c.path === '/admin/seller-stock-notes') return ok({ stock_notes: [note(), note({ id: 'n2' })] });
      if (c.method === 'GET' && c.path === '/admin/seller-payout-requests') return ok({ payout_requests: [payoutRequest({ seller: { ...sellerRef, id: 's2' } })] });
      return undefined;
    });
    const table = await screen.findByRole('table', { name: 'Sellers' });
    const first = within(table).getByText('Jaffna Spice House').closest('tr')!;
    const second = within(table).getByText('Galle Sweets').closest('tr')!;
    expect(await within(first).findByText('2 stock notes')).toBeInTheDocument();
    expect(within(first).queryByText('Payout requested')).toBeNull();
    expect(within(second).getByText('Payout requested')).toBeInTheDocument();
    expect(within(first).getByText('Category rates')).toBeInTheDocument();
    expect(within(second).getByText('4%')).toBeInTheDocument();
  });

  it('adds a seller: checks the form, explains a number that has an account, then opens the new seller', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = renderAt('/sellers', (c) => {
      if (c.method === 'GET' && c.path === '/admin/sellers') return ok({ sellers: rows });
      if (c.method === 'POST' && c.path === '/admin/sellers') {
        attempts += 1;
        if (attempts === 1) return fail(409, 'PHONE_IN_USE', 'This number already has a Blynk account (customer).', { role: 'CUSTOMER' });
        return ok({ seller: seller({ id: 's9', shop_name: 'Kandy Crafts', phone: '+94771112222', status: 'APPROVED' }) });
      }
      if (c.method === 'GET' && c.path === '/admin/sellers/s9') return ok({ seller: seller({ id: 's9', shop_name: 'Kandy Crafts', phone: '+94771112222' }), statement: statement({ lines: [], payouts: [], gross: 0, commission: 0, earned: 0, paid: 0, due: 0 }) });
      return undefined;
    });
    await screen.findByRole('table', { name: 'Sellers' });
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
    await user.type(within(dialog).getByLabelText(/^Own commission %/), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    expect(await within(dialog).findByText('This number already has a Blynk account (customer).')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sellers')[0]!.body).toEqual({ shop_name: 'Kandy Crafts', phone: '+94771112222', commission_percent: 4, status: 'APPROVED' });

    await user.click(within(dialog).getByRole('button', { name: 'Add seller' }));
    expect(await screen.findByRole('heading', { name: 'Kandy Crafts' })).toBeInTheDocument();
    expect(screen.getByText('Signs in with 077 111 2222 (SMS code on the seller site).')).toBeInTheDocument();
  });

  it('the Seller commission panel shows main categories with their sub-categories and saves the rates', async () => {
    const user = userEvent.setup();
    const settings = {
      default_percent: 2,
      ready: true,
      categories: [
        { category_id: 'c1', name: 'Sweets', parent_id: null, percent: 3 },
        { category_id: 'c2', name: 'Toffee', parent_id: 'c1', percent: null },
        { category_id: 'c3', name: 'Pickles', parent_id: null, percent: null },
      ],
    };
    const api = renderAt('/sellers', (c) => {
      if (c.method === 'GET' && c.path === '/admin/sellers') return ok({ sellers: rows });
      if (c.method === 'GET' && c.path === '/admin/settings/seller-commission') return ok(settings);
      if (c.method === 'PUT' && c.path === '/admin/settings/seller-commission') return ok({ ...settings, default_percent: c.body.default_percent });
      return undefined;
    });
    await screen.findByRole('table', { name: 'Sellers' });
    await user.click(screen.getByRole('button', { name: 'Seller commission' }));
    const panel = await screen.findByRole('region', { name: 'Seller commission' });
    const table = await within(panel).findByRole('table', { name: 'Category commission' });
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual(['CategoryRate (%)', 'Sweets', 'Toffee', 'Pickles']);
    expect(within(table).getByLabelText('Commission for Sweets')).toHaveValue('3');
    expect(within(table).getByLabelText('Commission for Toffee')).toHaveAttribute('placeholder', 'Main category');

    await user.clear(within(panel).getByLabelText('Default commission percent'));
    await user.type(within(panel).getByLabelText('Default commission percent'), '2.5');
    await user.type(within(table).getByLabelText('Commission for Pickles'), '4');
    await user.type(within(table).getByLabelText('Commission for Toffee'), 'abc');
    await user.click(within(panel).getByRole('button', { name: 'Save commission' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent(/number/);
    expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(0);
    await user.clear(within(table).getByLabelText('Commission for Toffee'));
    await user.click(within(panel).getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/seller-commission')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/seller-commission')[0]!.body).toEqual({
      default_percent: 2.5,
      categories: [
        { category_id: 'c1', percent: 3 },
        { category_id: 'c2', percent: null },
        { category_id: 'c3', percent: 4 },
      ],
    });
    expect(await screen.findByText('Seller commission saved.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- Seller detail

describe('Seller detail: stock, payout requests, commission, details', () => {
  function open(opts: { s?: Record<string, unknown>; notes?: unknown[] | 'not-ready'; requests?: unknown[] | 'not-ready' } = {}) {
    let current = opts.s ?? seller();
    let stmt = statement();
    let notes = opts.notes ?? [note()];
    let requests = opts.requests ?? [payoutRequest()];
    return renderAt('/sellers/s1', (c) => {
      if (c.method === 'GET' && c.path === '/admin/sellers/s1') return ok({ seller: current, statement: stmt });
      if (c.method === 'GET' && c.path === '/admin/seller-stock-notes') {
        return notes === 'not-ready' ? fail(503, 'SELLER_REQUESTS_NOT_READY') : ok({ stock_notes: notes });
      }
      if (c.method === 'GET' && c.path === '/admin/seller-payout-requests') {
        return requests === 'not-ready' ? fail(503, 'SELLER_REQUESTS_NOT_READY') : ok({ payout_requests: requests });
      }
      if (c.method === 'POST' && c.path === '/admin/seller-stock-notes/n1/receive') {
        notes = [];
        return ok({ stock_note: note({ status: 'RECEIVED', received_quantity: c.body.received_quantity }), stock_on_hand: 3 + c.body.received_quantity });
      }
      if (c.method === 'POST' && c.path.startsWith('/admin/seller-stock-notes/') && c.path.endsWith('/cancel')) {
        return ok({ stock_note: note({ status: 'CANCELLED' }) });
      }
      if (c.method === 'POST' && c.path === '/admin/seller-payout-requests/r1/pay') {
        stmt = { ...stmt, paid: 860, due: 100, payouts: [{ id: 'po2', amount: 500, note: c.body.note ?? null, paid_on: c.body.paid_on }, ...stmt.payouts] };
        return ok({ payout_request: payoutRequest({ status: 'PAID' }), payout: stmt.payouts[0], statement: stmt });
      }
      if (c.method === 'POST' && c.path === '/admin/seller-payout-requests/r1/decline') return ok({ payout_request: payoutRequest({ status: 'DECLINED' }) });
      if (c.method === 'PATCH' && c.path === '/admin/sellers/s1') {
        if (c.body.phone === '+94770000001') return fail(409, 'PHONE_IN_USE', 'in use', { role: 'RIDER' });
        current = { ...current, ...c.body };
        return ok({ seller: current });
      }
      return undefined;
    });
  }

  it('says how the seller signs in and shows the per-line commission', async () => {
    open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    expect(screen.getByText('Signs in with 077 123 4567 (SMS code on the seller site).')).toBeInTheDocument();
    const stmt = screen.getByRole('region', { name: 'Statement' });
    expect(within(stmt).getByText('Commission (category rates)')).toBeInTheDocument();
    expect(within(stmt).getByText('LKR 40.00 (4%)')).toBeInTheDocument();
  });

  it('receives goods with the counted quantity, or cancels a note', async () => {
    const user = userEvent.setup();
    const api = open({ notes: [note(), note({ id: 'n2', product_name: 'Chilli flakes', quantity: 5, expected_on: null, note: null })] });
    const section = await screen.findByRole('region', { name: 'Stock coming in' });
    const table = await within(section).findByRole('table', { name: 'Stock notes' });
    expect(within(table).getByText('Tuesday morning')).toBeInTheDocument();
    expect(within(table).getByText('Not said')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Receive Curry powder 250g' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive stock' });
    const qty = within(dialog).getByLabelText('Received quantity');
    expect(qty).toHaveValue('20');
    await user.clear(qty);
    await user.type(qty, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    expect(within(dialog).getByText(/At least 1/)).toBeInTheDocument();
    await user.clear(qty);
    await user.type(qty, '18');
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-stock-notes/n1/receive')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-stock-notes/n1/receive')[0]!.body).toEqual({ received_quantity: 18 });
    expect(await screen.findByText('18 of Curry powder 250g received. Stock now 21.')).toBeInTheDocument();
    expect(within(table).queryByText('Curry powder 250g')).toBeNull();

    await user.click(within(table).getByRole('button', { name: 'Cancel stock note for Chilli flakes' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel note' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-stock-notes/n2/cancel')).toHaveLength(1));
    expect(await screen.findByText('Stock note cancelled.')).toBeInTheDocument();
  });

  it('pays a payout request (the statement updates) or declines it with a reason', async () => {
    const user = userEvent.setup();
    const api = open();
    const section = await screen.findByRole('region', { name: 'Payout requests' });
    const req = await within(section).findByRole('group', { name: 'Payout request of LKR 500.00' });
    expect(within(req).getByText('BOC 1234567, Jaffna')).toBeInTheDocument();
    expect(within(req).getByText('For the new stock')).toBeInTheDocument();

    // decline needs a reason (cancelled here)
    await user.click(within(req).getByRole('button', { name: 'Decline' }));
    const declining = screen.getByRole('dialog', { name: 'Decline payout request' });
    await user.type(within(declining).getByRole('textbox'), 'ab');
    await user.click(within(declining).getByRole('button', { name: 'Decline' }));
    expect(within(declining).getByText(/at least 3 characters/)).toBeInTheDocument();
    await user.click(within(declining).getByRole('button', { name: 'Cancel' }));
    expect(api.find('POST', '/admin/seller-payout-requests/r1/decline')).toHaveLength(0);

    await user.click(within(req).getByRole('button', { name: 'Mark paid' }));
    const paying = screen.getByRole('dialog', { name: 'Pay the seller' });
    await user.type(within(paying).getByLabelText('Payout note'), 'Ref 991');
    await user.click(within(paying).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-payout-requests/r1/pay')).toHaveLength(1));
    const body = api.find('POST', '/admin/seller-payout-requests/r1/pay')[0]!.body;
    expect(body).toMatchObject({ note: 'Ref 991' });
    expect(body.paid_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText('Paid LKR 500.00 and recorded it.')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Payments' })).getByText('Ref 991')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Statement' })).getByText('LKR 100.00')).toBeInTheDocument();
    expect(within(section).getByText('No payout request waiting.')).toBeInTheDocument();
  });

  it('declines with the reason', async () => {
    const user = userEvent.setup();
    const api = open();
    const section = await screen.findByRole('region', { name: 'Payout requests' });
    await user.click(await within(section).findByRole('button', { name: 'Decline' }));
    const declining = screen.getByRole('dialog', { name: 'Decline payout request' });
    await user.type(within(declining).getByRole('textbox'), 'Come to the store on Friday');
    await user.click(within(declining).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(api.find('POST', '/admin/seller-payout-requests/r1/decline')).toHaveLength(1));
    expect(api.find('POST', '/admin/seller-payout-requests/r1/decline')[0]!.body).toEqual({ reason: 'Come to the store on Friday' });
    expect(await screen.findByText('Payout request declined.')).toBeInTheDocument();
  });

  it('before the database update both sections say so', async () => {
    open({ notes: 'not-ready', requests: 'not-ready' });
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    expect(await within(screen.getByRole('region', { name: 'Stock coming in' })).findByText('Available after the next database update.')).toBeInTheDocument();
    expect(await within(screen.getByRole('region', { name: 'Payout requests' })).findByText('Available after the next database update.')).toBeInTheDocument();
  });

  it('commission: "Use category rates" (null) or an own rate', async () => {
    const user = userEvent.setup();
    const api = open({ s: seller({ commission_percent: 5 }) });
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    expect(screen.getByRole('radio', { name: 'Own rate' })).toBeChecked();
    expect(screen.getByLabelText('Commission percent')).toHaveValue('5');
    await user.click(screen.getByRole('radio', { name: 'Use category rates' }));
    expect(screen.queryByLabelText('Commission percent')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save commission' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sellers/s1')[0]!.body).toEqual({ commission_percent: null });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Use category rates' })).toBeChecked());
    expect(screen.getByRole('button', { name: 'Save commission' })).toBeDisabled();
  });

  it('edits the sign-in phone and contact; a number in use is explained', async () => {
    const user = userEvent.setup();
    const api = open();
    await screen.findByRole('heading', { name: 'Jaffna Spice House' });
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit seller details' });
    const phone = within(dialog).getByLabelText('Phone (they sign in with it)');
    expect(phone).toHaveValue('077 123 4567');
    await user.clear(phone);
    await user.type(phone, '0770000001');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await within(dialog).findByText('This number already has a Blynk account (rider).')).toBeInTheDocument();

    await user.clear(phone);
    await user.type(phone, '077 000 0002');
    await user.clear(within(dialog).getByLabelText('Contact name'));
    await user.type(within(dialog).getByLabelText('Contact name'), 'Ravi');
    await user.click(within(dialog).getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sellers/s1')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/sellers/s1')[1]!.body).toEqual({ phone: '+94770000002', contact_name: 'Ravi' });
    expect(await screen.findByText('Seller details saved.')).toBeInTheDocument();
    expect(screen.getByText('Signs in with 077 000 0002 (SMS code on the seller site).')).toBeInTheDocument();
  });
});
