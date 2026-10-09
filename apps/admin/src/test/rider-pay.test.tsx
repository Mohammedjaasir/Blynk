import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { RiderEarnings, earningsTypeLabel } from '../pages/RiderEarnings';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import type { RiderEarningsReport, RiderEarningsRow, RiderOption } from '../api/types';
import { formatPercent, parsePercent, payLabel } from '../lib/riderPay';
import { colomboDate } from '../lib/coupons';
import { fail, mockApi, ok } from './mockApi';

/**
 * Rider pay (owner, 2026-10-09): company vs commission riders, the default
 * commission % in Settings, the Rider earnings report and "Change pay". The
 * money rules are tested against PostgreSQL in the backend; here, what the
 * pages ask for and show.
 */

const renderPage = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

const figures = {
  deliveries: 0,
  delivery_charges: 0,
  customer_delivery_fees: 0,
  rider_share: 0,
  blynk_delivery_share: 0,
  cash_collected: 0,
  cash_kept: 0,
  cash_to_hand_in: 0,
  product_sales: 0,
  product_cost: 0,
  product_margin: 0,
  coupon_discount: 0,
};

function earningsRow(overrides: Partial<RiderEarningsRow> = {}): RiderEarningsRow {
  return {
    ...figures,
    rider_id: 'r1',
    rider_name: 'Kamal',
    rider_phone: '+94779876543',
    pay_type: 'COMMISSION',
    commission_percent: null,
    effective_percent: 80,
    deliveries: 4,
    delivery_charges: 400,
    customer_delivery_fees: 200,
    rider_share: 320,
    blynk_delivery_share: 80,
    cash_collected: 2600,
    cash_kept: 320,
    cash_to_hand_in: 2280,
    product_margin: 510,
    ...overrides,
  };
}

function earnings(overrides: Partial<RiderEarningsReport> = {}): RiderEarningsReport {
  return {
    range: { from: '2026-10-09', to: '2026-10-09', timezone: 'Asia/Colombo' },
    default_percent: 80,
    riders: [
      earningsRow(),
      earningsRow({
        rider_id: 'r2',
        rider_name: 'Nimal',
        rider_phone: '+94779876544',
        pay_type: 'COMPANY',
        effective_percent: null,
        deliveries: 2,
        delivery_charges: 200,
        customer_delivery_fees: 200,
        rider_share: 0,
        blynk_delivery_share: 200,
        cash_collected: 900,
        cash_kept: 0,
        cash_to_hand_in: 900,
        product_margin: 150,
      }),
    ],
    totals: {
      ...figures,
      deliveries: 6,
      delivery_charges: 600,
      customer_delivery_fees: 400,
      rider_share: 320,
      blynk_delivery_share: 280,
      cash_collected: 3500,
      cash_kept: 320,
      cash_to_hand_in: 3180,
      product_margin: 660,
    },
    ...overrides,
  };
}

const rider = (overrides: Partial<RiderOption> = {}): RiderOption => ({
  id: 'r1',
  full_name: 'Kamal',
  phone: '+94779876543',
  vehicle_type: 'MOTORCYCLE',
  vehicle_registration_number: 'WP BAA-1234',
  open_deliveries: 0,
  is_active: true,
  pay_type: 'COMPANY',
  commission_percent: null,
  ...overrides,
});

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('rider pay helpers', () => {
  it('parses a commission %', () => {
    expect(parsePercent('80')).toEqual({ percent: 80 });
    expect(parsePercent(' 72.5% ')).toEqual({ percent: 72.5 });
    expect(parsePercent('0')).toEqual({ percent: 0 });
    expect(parsePercent('100')).toEqual({ percent: 100 });
    expect(parsePercent('', true)).toEqual({ percent: null });
    expect(parsePercent('')).toHaveProperty('error');
    expect(parsePercent('100.01')).toHaveProperty('error');
    expect(parsePercent('12.345')).toEqual({ error: 'Use at most 2 decimal places.' });
    expect(parsePercent('abc')).toHaveProperty('error');
  });

  it('words a rider type', () => {
    expect(payLabel('COMPANY', null, 80)).toBe('Company');
    expect(payLabel(undefined, null)).toBe('Company');
    expect(payLabel('COMMISSION', 75, 80)).toBe('Commission · 75%');
    expect(payLabel('COMMISSION', null, 80)).toBe('Commission · 80% (default)');
    expect(payLabel('COMMISSION', null, null)).toBe('Commission · default %');
    expect(formatPercent(66.666)).toBe('66.67');
    expect(earningsTypeLabel({ pay_type: 'COMMISSION', effective_percent: 80, commission_percent: null })).toBe('Commission · 80%');
    expect(earningsTypeLabel({ pay_type: 'COMPANY', effective_percent: null, commission_percent: null })).toBe('Company');
  });
});

describe('Settings - rider commission (owner, 2026-10-09)', () => {
  it('shows the default % and saves a new one', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/rider-commission') return ok({ default_percent: 80, updated_at: null });
      if (c.method === 'PATCH' && c.path === '/admin/settings/rider-commission') {
        return ok({ default_percent: c.body.default_percent, updated_at: '2026-10-09T05:00:00.000Z' });
      }
      return undefined;
    });
    renderPage(<Settings />);

    const panel = await screen.findByRole('region', { name: 'Rider commission' });
    const input = await within(panel).findByLabelText(/Default commission \(%\)/);
    expect(input).toHaveValue('80');
    expect(panel).toHaveTextContent('Commission riders currently earn 80% of the standard delivery fee');

    await user.clear(input);
    await user.type(input, '150');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('Enter a percentage from 0 to 100.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-commission')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '72.5');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-commission')[0]?.body).toEqual({ default_percent: 72.5 }));
    expect(await within(panel).findByText(/currently earn 72\.5%/)).toBeInTheDocument();
  });

  it('shows a server validation message', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/settings/rider-commission') return ok({ default_percent: 80, updated_at: null });
      if (c.method === 'PATCH') return fail(400, 'VALIDATION_ERROR', 'Invalid', [{ message: 'default_percent must be at most 100' }]);
      return undefined;
    });
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Rider commission' });
    await within(panel).findByLabelText(/Default commission/);
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('default_percent must be at most 100')).toBeInTheDocument();
  });
});

describe('Rider earnings page (owner, 2026-10-09)', () => {
  function api(report = earnings(), riders: RiderOption[] = [rider()]) {
    return mockApi((c) => {
      if (c.path === '/admin/reports/rider-earnings') return ok(report);
      if (c.path === '/admin/riders') return ok({ riders });
      if (c.path === '/admin/settings/rider-commission') return ok({ default_percent: 80, updated_at: null });
      return undefined;
    });
  }

  it('shows totals and a row per rider with type, shares and cash', async () => {
    const mock = api();
    renderPage(<RiderEarnings />);

    const totals = await screen.findByLabelText('Rider earnings totals');
    expect(totals).toHaveTextContent('6Deliveries');
    expect(totals).toHaveTextContent('LKR 320Rider share');
    expect(totals).toHaveTextContent('LKR 280Blynk delivery share');
    expect(totals).toHaveTextContent('LKR 660Product margin');

    const table = screen.getByRole('table', { name: 'Earnings by rider' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Kamal');
    expect(rows[1]).toHaveTextContent('Commission · 80%');
    expect(rows[1]).toHaveTextContent('LKR 400');
    expect(rows[1]).toHaveTextContent('customers paid LKR 200');
    expect(rows[1]).toHaveTextContent('LKR 2,280');
    expect(rows[2]).toHaveTextContent('Nimal');
    expect(rows[2]).toHaveTextContent('Company');
    expect(rows[2]).not.toHaveTextContent('customers paid');
    expect(rows[3]).toHaveTextContent('All riders');
    expect(rows[3]).toHaveTextContent('LKR 3,180');

    expect(mock.find('GET', '/admin/reports/rider-earnings')[0].query.get('range')).toBe('today');
  });

  it('switches range, and asks for custom days with from/to', async () => {
    const user = userEvent.setup();
    const mock = api();
    renderPage(<RiderEarnings />);
    await screen.findByRole('table', { name: 'Earnings by rider' });

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(mock.find('GET', '/admin/reports/rider-earnings').map((c) => c.query.get('range'))).toEqual(['today', 'this_week'])
    );
    expect(screen.queryByLabelText('From')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Custom' }));
    const from = screen.getByLabelText('From') as HTMLInputElement;
    const to = screen.getByLabelText('To') as HTMLInputElement;
    const today = colomboDate();
    expect(from.value).toBe(today);
    expect(to.value).toBe(today);
    await waitFor(() => {
      const custom = mock.find('GET', '/admin/reports/rider-earnings').filter((c) => c.query.get('range') === 'custom');
      expect(custom).toHaveLength(1);
      expect(custom[0].query.get('from')).toBe(today);
      expect(custom[0].query.get('to')).toBe(today);
    });

    // A backwards range is refused without asking the API.
    const before = mock.find('GET', '/admin/reports/rider-earnings').length;
    fireEvent.change(from, { target: { value: '2099-01-01' } });
    expect(await screen.findByText(/on or before the last day/)).toBeInTheDocument();
    expect(mock.find('GET', '/admin/reports/rider-earnings').length).toBe(before);
  });

  it('says so when nobody delivered', async () => {
    api(earnings({ riders: [], totals: figures }));
    renderPage(<RiderEarnings />);
    expect(await screen.findByText('No deliveries in this period')).toBeInTheDocument();
  });

  it("changes a rider's pay type and own %, then reloads the report", async () => {
    const user = userEvent.setup();
    const mock = mockApi((c) => {
      if (c.path === '/admin/reports/rider-earnings') return ok(earnings());
      if (c.path === '/admin/riders') return ok({ riders: [rider(), rider({ id: 'r2', full_name: 'Nimal', pay_type: 'COMMISSION', commission_percent: 70, is_active: false })] });
      if (c.path === '/admin/settings/rider-commission') return ok({ default_percent: 80, updated_at: null });
      if (c.method === 'PATCH' && c.path === '/admin/riders/r1/pay') {
        return ok({ pay: { rider_id: 'r1', pay_type: c.body.pay_type, commission_percent: c.body.commission_percent ?? null, effective_percent: c.body.commission_percent ?? 80, default_percent: 80 } });
      }
      return undefined;
    });
    renderPage(<RiderEarnings />);

    const table = await screen.findByRole('table', { name: 'Rider pay' });
    expect(mock.find('GET', '/admin/riders')[0].query.get('include_inactive')).toBe('true');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Company');
    expect(rows[2]).toHaveTextContent('Commission · 70%');
    expect(rows[2]).toHaveTextContent('Inactive');

    await user.click(within(table).getByRole('button', { name: 'Change pay for Kamal' }));
    const dialog = screen.getByRole('dialog', { name: 'Change rider pay' });
    expect(within(dialog).getByRole('button', { name: 'Company' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Commission' }));
    await user.type(within(dialog).getByLabelText(/Own commission/), '75');
    const reportsBefore = mock.find('GET', '/admin/reports/rider-earnings').length;
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.find('PATCH', '/admin/riders/r1/pay')[0]?.body).toEqual({ pay_type: 'COMMISSION', commission_percent: 75 }));
    expect(await screen.findByText('Kamal is now Commission · 75%.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Change rider pay' })).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Rider pay' })).getAllByRole('row')[1]).toHaveTextContent('Commission · 75%');
    await waitFor(() => expect(mock.find('GET', '/admin/reports/rider-earnings').length).toBeGreaterThan(reportsBefore));
  });

  it('turning a commission rider into a company rider sends no %, and shows API errors', async () => {
    const user = userEvent.setup();
    const mock = mockApi((c) => {
      if (c.path === '/admin/reports/rider-earnings') return ok(earnings());
      if (c.path === '/admin/riders') return ok({ riders: [rider({ pay_type: 'COMMISSION', commission_percent: 70 })] });
      if (c.method === 'PATCH') return fail(404, 'RIDER_NOT_FOUND', 'Rider not found');
      return undefined;
    });
    renderPage(<RiderEarnings />);
    await user.click(await screen.findByRole('button', { name: 'Change pay for Kamal' }));
    const dialog = screen.getByRole('dialog', { name: 'Change rider pay' });
    expect(within(dialog).getByLabelText(/Own commission/)).toHaveValue('70');
    await user.click(within(dialog).getByRole('button', { name: 'Company' }));
    expect(within(dialog).queryByLabelText(/Own commission/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mock.find('PATCH', '/admin/riders/r1/pay')[0]?.body).toEqual({ pay_type: 'COMPANY', commission_percent: null }));
    expect(await within(dialog).findByText(/Rider not found|Could not change the rider pay/)).toBeInTheDocument();
  });
});
