import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Settings } from '../pages/Settings';
import { CustomerDetail, Customers } from '../pages/Customers';
import { OrderBill } from '../components/OrderBill';
import { tokenStore } from '../api/client';
import type { BirthdayOfferSetting, CustomerRow } from '../api/types';
import { birthdayWhen, formatDayMonth, formatDayMonthYear, parseBirthdayPercent } from '../lib/birthday';
import { fail, mockApi, ok } from './mockApi';

/**
 * Birthday offer (owner, 2026-10-09): the Settings panel, date of birth and
 * favourites on Customers, the "Birthdays this week" view and the bill's
 * "Birthday gift" line. The gift rules are the backend's; here, what the
 * pages ask for and show.
 */

const renderPage = (ui: React.ReactElement, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const SETTING: BirthdayOfferSetting = {
  enabled: false,
  percent: 10,
  sms_enabled: true,
  sms_text: 'Happy birthday from Blynk! {percent}% off your order this week.',
  sms_preview: 'Happy birthday from Blynk! 10% off your order this week.',
  sms_parts: 1,
  window_days: 3,
  updated_at: null,
};

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 'u1',
    full_name: 'Fathima Rizna',
    phone: '+94771234567',
    email: null,
    is_active: true,
    created_at: '2026-09-01T04:30:00.000Z',
    orders_count: 7,
    delivered_count: 6,
    delivered_spend: 8450.5,
    last_order_at: '2026-09-29T10:00:00.000Z',
    sms_language: 'ta',
    sms_offers: true,
    date_of_birth: '1990-10-12',
    ...overrides,
  };
}

const BIRTHDAYS = {
  today: '2026-10-09',
  customers: [
    {
      id: 'u1',
      full_name: 'Fathima Rizna',
      phone: '+94771234567',
      date_of_birth: '1990-10-09',
      birthday: '2026-10-09',
      days_until: 0,
      turning: 36,
      favourite_categories: [{ id: 'k1', name: 'Bakery' }],
      favourites_note: 'Dark chocolate',
      offer_used: false,
    },
    {
      id: 'u2',
      full_name: 'Kasun Perera',
      phone: '+94770000000',
      date_of_birth: '2000-10-11',
      birthday: '2026-10-11',
      days_until: 2,
      turning: 26,
      favourite_categories: [],
      favourites_note: null,
      offer_used: true,
    },
  ],
};

describe('birthday helpers', () => {
  it('parses the percent and formats calendar days without a timezone shift', () => {
    expect(parseBirthdayPercent('15')).toEqual({ value: 15 });
    expect(parseBirthdayPercent('50.01')).toEqual({ error: 'The percentage can be at most 50.' });
    expect(parseBirthdayPercent('0')).toEqual({ error: 'The percentage must be more than 0.' });
    expect(formatDayMonth('2026-01-01')).toBe('1 Jan');
    expect(formatDayMonthYear('1990-10-12')).toBe('12 Oct 1990');
    expect(birthdayWhen(2)).toBe('In 2 days');
    expect(birthdayWhen(-3)).toBe('3 days ago');
  });
});

describe('Settings - birthday offer (owner, 2026-10-09)', () => {
  it('shows the saved values and server preview, previews while typing, then saves', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path !== '/admin/settings/birthday-offer') return undefined;
      if (c.method === 'GET') return ok(SETTING);
      const next = { ...SETTING, ...c.body, updated_at: '2026-10-09T05:00:00.000Z' };
      return ok({ ...next, sms_preview: next.sms_text.split('{percent}').join(String(next.percent)), sms_parts: 1 });
    });
    renderPage(<Settings />);

    const panel = await screen.findByRole('region', { name: 'Birthday offer' });
    const on = await within(panel).findByRole('checkbox', { name: /^Birthday offer/ });
    const sms = within(panel).getByRole('checkbox', { name: /^Birthday SMS/ });
    const percent = within(panel).getByLabelText(/Birthday discount \(%\)/);
    const text = within(panel).getByLabelText(/Birthday SMS text/);
    expect(on).not.toBeChecked();
    expect(sms).toBeChecked();
    expect(percent).toHaveValue('10');
    expect(within(panel).getByLabelText('Birthday SMS preview')).toHaveTextContent(SETTING.sms_preview);
    expect(within(panel).getByTestId('birthday-sms-count')).toHaveTextContent('1 SMS part');

    await user.click(on);
    await user.clear(percent);
    await user.type(percent, '20');
    expect(within(panel).getByLabelText('Birthday SMS preview')).toHaveTextContent('20% off your order this week.');
    await user.clear(text);
    await user.type(text, 'Happy birthday! {{percent}% off');
    expect(within(panel).getByLabelText('Birthday SMS preview')).toHaveTextContent('Happy birthday! 20% off');

    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/birthday-offer')[0]?.body).toEqual({
        enabled: true,
        percent: 20,
        sms_enabled: true,
        sms_text: 'Happy birthday! {percent}% off',
      })
    );
    expect(await screen.findByText('Birthday offer saved.')).toBeInTheDocument();
    expect(within(panel).getByText(/^Changed /)).toBeInTheDocument();
  });

  it('refuses a bad percent or empty SMS, and shows a server message', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path !== '/admin/settings/birthday-offer') return undefined;
      if (c.method === 'GET') return ok(SETTING);
      return fail(400, 'VALIDATION_ERROR', 'Invalid', [{ message: 'sms_text is too long' }]);
    });
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Birthday offer' });
    const percent = await within(panel).findByLabelText(/Birthday discount/);
    await user.clear(percent);
    await user.type(percent, '75');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The percentage can be at most 50.')).toBeInTheDocument();

    await user.clear(percent);
    await user.type(percent, '10');
    await user.clear(within(panel).getByLabelText(/Birthday SMS text/));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('Write the birthday SMS.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/birthday-offer')).toHaveLength(0);

    await user.type(within(panel).getByLabelText(/Birthday SMS text/), 'Hi');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('sms_text is too long')).toBeInTheDocument();
  });
});

describe('Customers - birthdays (owner, 2026-10-09)', () => {
  it('shows each customer’s date of birth in the list', async () => {
    mockApi((c) =>
      c.path === '/admin/customers'
        ? ok({
            customers: [customer(), customer({ id: 'u2', full_name: 'No Birthday', date_of_birth: null })],
            pagination: { page: 1, limit: 25, total: 2, total_pages: 1 },
          })
        : undefined
    );
    renderPage(<Customers />);
    const table = await screen.findByRole('table', { name: 'Customers' });
    expect(within(table).getByRole('columnheader', { name: 'Birthday' })).toBeInTheDocument();
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('12 Oct 1990');
    expect(second).toHaveTextContent('—');
  });

  it('switches to Birthdays this week: when, age, favourites, note and gift used', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/customers') return ok({ customers: [customer()], pagination: { page: 1, limit: 25, total: 1, total_pages: 1 } });
      if (c.path === '/admin/birthdays') return ok(BIRTHDAYS);
      return undefined;
    });
    renderPage(<Customers />);
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: 'Birthdays this week' }));

    const table = await screen.findByRole('table', { name: 'Birthdays this week' });
    expect(api.find('GET', '/admin/birthdays')[0]?.query.get('days')).toBe('7');
    expect(screen.queryByRole('searchbox', { name: 'Search customers' })).not.toBeInTheDocument();
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Fathima Rizna');
    expect(first).toHaveTextContent('Today · 9 Oct');
    expect(first).toHaveTextContent('36');
    expect(within(first!).getByText('Bakery')).toBeInTheDocument();
    expect(first).toHaveTextContent('Dark chocolate');
    expect(first).toHaveTextContent('Not used yet');
    expect(second).toHaveTextContent('In 2 days · 11 Oct');
    expect(second).toHaveTextContent('Gift used');
    expect(within(first!).getByRole('link', { name: 'Fathima Rizna' })).toHaveAttribute('href', '/customers/u1');

    await user.click(screen.getByRole('button', { name: 'All customers' }));
    expect(await screen.findByRole('table', { name: 'Customers' })).toBeInTheDocument();
  });

  it('says so when nobody has a birthday this week', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.path === '/admin/customers') return ok({ customers: [], pagination: { page: 1, limit: 25, total: 0, total_pages: 1 } });
      if (c.path === '/admin/birthdays') return ok({ today: '2026-10-09', customers: [] });
      return undefined;
    });
    renderPage(<Customers />);
    await user.click(await screen.findByRole('button', { name: 'Birthdays this week' }));
    expect(await screen.findByText('No birthdays this week')).toBeInTheDocument();
  });

  it('customer details show date of birth, favourite categories and the note', async () => {
    mockApi((c) =>
      c.path === '/admin/customers/u1'
        ? ok({
            customer: {
              ...customer(),
              last_login_at: null,
              favourite_categories: [
                { id: 'k1', name: 'Bakery' },
                { id: 'k2', name: 'Fruits' },
              ],
              favourites_note: 'Loves mangoes',
            },
            orders: [
              {
                id: 'o1',
                order_number: 'BLY-0001',
                order_status: 'DELIVERED',
                payment_status: 'PAID',
                subtotal_amount: 2000,
                delivery_fee: 250,
                discount_amount: 200,
                birthday_discount_amount: 200,
                total_amount: 2050,
                coupon_code: null,
                placed_at: '2026-10-09T05:00:00.000Z',
                delivered_at: null,
                cancelled_at: null,
                item_count: 3,
              },
            ],
            pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
          })
        : undefined
    );
    renderPage(
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetail />} />
      </Routes>,
      '/customers/u1'
    );
    const figures = await screen.findByLabelText('Customer figures');
    expect(figures).toHaveTextContent('12 Oct 1990');
    expect(figures).toHaveTextContent('Date of birth');
    const likes = screen.getByRole('region', { name: 'What they love' });
    expect(within(likes).getByText('Bakery')).toBeInTheDocument();
    expect(within(likes).getByText('Fruits')).toBeInTheDocument();
    expect(likes).toHaveTextContent('Loves mangoes');
    expect(screen.getByRole('table', { name: 'Order history' })).toHaveTextContent('birthday gift');
  });

  it('hides the favourites panel when the customer saved none', async () => {
    mockApi((c) =>
      c.path === '/admin/customers/u1'
        ? ok({
            customer: { ...customer({ date_of_birth: null }), last_login_at: null, favourite_categories: [], favourites_note: null },
            orders: [],
            pagination: { page: 1, limit: 20, total: 0, total_pages: 1 },
          })
        : undefined
    );
    renderPage(
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetail />} />
      </Routes>,
      '/customers/u1'
    );
    expect(await screen.findByLabelText('Customer figures')).toHaveTextContent('Not given');
    expect(screen.queryByRole('region', { name: 'What they love' })).not.toBeInTheDocument();
  });
});

describe('Order bill - birthday gift', () => {
  const ORDER = { subtotal_amount: 2000, delivery_fee: 250, discount_amount: 200, coupon_code: null, total_amount: 2050 };

  it('shows "Birthday gift" instead of a coupon discount', () => {
    render(<OrderBill order={{ ...ORDER, birthday_discount_amount: 200 }} />);
    const bill = screen.getByLabelText('Bill');
    expect(within(bill).getByText('Birthday gift')).toBeInTheDocument();
    expect(within(bill).queryByText(/^Discount/)).not.toBeInTheDocument();
  });

  it('keeps the coupon line otherwise', () => {
    render(<OrderBill order={{ ...ORDER, coupon_code: 'SAVE', birthday_discount_amount: 0 }} />);
    expect(screen.getByText('Discount (SAVE)')).toBeInTheDocument();
  });
});
