import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { MyEarnings, RiderEarningsReport } from '../api/types';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { formatPercent, parseCommissionPercent, parseOwnPercent, payLabel } from '../lib/riderPay';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Rider pay (owner, 2026-10-09): company riders are salaried, commission
 * riders earn a % of the standard delivery fee. Covers the default % setting
 * on More, the Rider earnings report and the operator's own "My day" pay.
 * The money rules themselves are tested in the backend.
 */

beforeEach(() => {
  __resetTrackerSessionForTests();
});

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('rider pay helpers', () => {
  it('labels and parses percentages', () => {
    expect(formatPercent(80)).toBe('80%');
    expect(formatPercent(72.5)).toBe('72.5%');
    expect(payLabel('COMPANY', 90, 80)).toBe('Company');
    expect(payLabel(undefined, null, 80)).toBe('Company');
    expect(payLabel('COMMISSION', 75, 80)).toBe('Commission · 75%');
    expect(payLabel('COMMISSION', null, 80)).toBe('Commission · 80% (default)');
    expect(parseOwnPercent('  ')).toEqual({ value: null });
    expect(parseOwnPercent('66.67')).toEqual({ value: 66.67 });
    expect(parseOwnPercent('66.667')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseCommissionPercent('')).toEqual({ error: 'Enter a percentage from 0 to 100.' });
    expect(parseCommissionPercent('101')).toEqual({ error: 'The percentage can be at most 100.' });
    expect(parseCommissionPercent('abc')).toEqual({ error: 'Enter a number, like 80 or 72.5.' });
  });
});

describe('Rider commission setting (More)', () => {
  it('shows the default % and saves a new one', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 250, updated_at: null }),
      'GET /admin/settings/rider-commission': () => ok({ default_percent: 80, updated_at: null }),
      'PATCH /admin/settings/rider-commission': (call) =>
        ok({ default_percent: call.body.default_percent, updated_at: '2026-10-09T04:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Rider commission' })).closest('section') as HTMLElement;
    expect(await within(card).findByText('80%')).toBeInTheDocument();
    const input = within(card).getByLabelText('Default commission (%)');
    expect(input).toHaveValue('80');

    await user.clear(input);
    await user.type(input, '101');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('The percentage can be at most 100.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-commission')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '75.5');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/rider-commission')[0]?.body).toEqual({ default_percent: 75.5 })
    );
    expect(await within(card).findByText('Rider commission saved: 75.5%.')).toBeInTheDocument();
    expect(within(card).getByText('75.5%')).toBeInTheDocument();
  });

  it('links to the earnings report', async () => {
    renderAs(OPERATIONS_STAFF, '/more', {});
    expect(await screen.findByRole('link', { name: 'Rider earnings' })).toHaveAttribute('href', '/more/earnings');
  });
});

const zero = {
  cash_collected: 0,
  cash_kept: 0,
  cash_to_hand_in: 0,
  product_sales: 0,
  product_cost: 0,
  coupon_discount: 0,
  customer_delivery_fees: 0,
};

function report(range: { from: string; to: string }, deliveriesScale = 1): RiderEarningsReport {
  return {
    range: { ...range, timezone: 'Asia/Colombo' },
    default_percent: 80,
    riders: [
      {
        ...zero,
        rider_id: 'r1',
        rider_name: 'Farhan Mohamed',
        rider_phone: '+94779876543',
        pay_type: 'COMMISSION',
        commission_percent: null,
        effective_percent: 80,
        deliveries: 4 * deliveriesScale,
        delivery_charges: 1000 * deliveriesScale,
        rider_share: 800 * deliveriesScale,
        blynk_delivery_share: 200 * deliveriesScale,
        product_margin: 1500 * deliveriesScale,
        cash_collected: 6000,
        cash_kept: 800,
        cash_to_hand_in: 5200,
      },
      {
        ...zero,
        rider_id: 'r2',
        rider_name: 'Imran',
        rider_phone: '+94779876500',
        pay_type: 'COMPANY',
        commission_percent: null,
        effective_percent: null,
        deliveries: 2,
        delivery_charges: 500,
        rider_share: 0,
        blynk_delivery_share: 500,
        product_margin: 700,
      },
    ],
    totals: {
      ...zero,
      deliveries: 4 * deliveriesScale + 2,
      delivery_charges: 1000 * deliveriesScale + 500,
      rider_share: 800 * deliveriesScale,
      blynk_delivery_share: 200 * deliveriesScale + 500,
      product_margin: 1500 * deliveriesScale + 700,
      customer_delivery_fees: 750,
    },
  };
}

describe('Rider earnings report', () => {
  it('is reachable from More and shows totals and a card per rider', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/reports/rider-earnings': () => ok(report({ from: '2026-10-09', to: '2026-10-09' })),
    });
    await user.click(await screen.findByRole('link', { name: 'Rider earnings' }));
    expect(await screen.findByRole('heading', { name: 'Rider earnings' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Earnings by rider' });
    expect(api.find('GET', '/admin/reports/rider-earnings')[0].query).toEqual({ range: 'today' });

    const totals = screen.getByRole('region', { name: 'All riders' });
    expect(within(totals).getByText('Deliveries').nextSibling).toHaveTextContent('6');
    expect(within(totals).getByText('Delivery charges').nextSibling).toHaveTextContent('LKR 1,500');
    expect(within(totals).getByText('Rider share').nextSibling).toHaveTextContent('LKR 800');
    expect(within(totals).getByText('Blynk delivery share').nextSibling).toHaveTextContent('LKR 700');
    expect(within(totals).getByText('Product margin').nextSibling).toHaveTextContent('LKR 2,200');

    const farhan = within(list).getByRole('listitem', { name: 'Farhan Mohamed' });
    expect(farhan).toHaveTextContent('Commission · 80%');
    expect(farhan).toHaveTextContent('Rider shareLKR 800');
    expect(farhan).toHaveTextContent('Blynk delivery shareLKR 200');
    expect(farhan).toHaveTextContent('Product marginLKR 1,500');
    expect(farhan).toHaveTextContent('keeps LKR 800, hands in LKR 5,200');

    const imran = within(list).getByRole('listitem', { name: 'Imran' });
    expect(imran).toHaveTextContent('Company rider');
    expect(imran).toHaveTextContent('Deliveries2');
    expect(imran).toHaveTextContent('Delivery chargesLKR 500');
    expect(imran).toHaveTextContent('Rider shareLKR 0');
    expect(screen.getByText(/9 Oct 2026 · Store default commission 80%/)).toBeInTheDocument();
  });

  it('switches to this week and to a custom range', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/earnings', {
      'GET /admin/reports/rider-earnings': (call) =>
        call.query.range === 'today'
          ? ok(report({ from: '2026-10-09', to: '2026-10-09' }))
          : call.query.range === 'this_week'
            ? ok(report({ from: '2026-10-05', to: '2026-10-09' }, 3))
            : ok(report({ from: call.query.from, to: call.query.to }, 5)),
    });
    await screen.findByRole('list', { name: 'Earnings by rider' });
    const range = screen.getByRole('group', { name: 'Range' });
    expect(within(range).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(range).getByRole('button', { name: 'This week' }));
    expect(within(range).getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(/5 Oct 2026 – 9 Oct 2026/)).toBeInTheDocument();
    expect(api.find('GET', '/admin/reports/rider-earnings').at(-1)!.query).toEqual({ range: 'this_week' });
    expect(within(screen.getByRole('region', { name: 'All riders' })).getByText('Deliveries').nextSibling).toHaveTextContent('14');

    await user.click(within(range).getByRole('button', { name: 'Custom' }));
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    expect(from).toHaveAttribute('type', 'date');
    // A From after To asks for a fix and loads nothing.
    const before = api.find('GET', '/admin/reports/rider-earnings').length;
    fireEvent.change(from, { target: { value: '2026-10-05' } });
    fireEvent.change(to, { target: { value: '2026-10-03' } });
    expect(await screen.findByText('Choose a From day on or before the To day.')).toBeInTheDocument();
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    await waitFor(() =>
      expect(api.find('GET', '/admin/reports/rider-earnings').at(-1)!.query).toEqual({
        range: 'custom',
        from: '2026-10-01',
        to: '2026-10-03',
      })
    );
    expect(await screen.findByText(/1 Oct 2026 – 3 Oct 2026/)).toBeInTheDocument();
    // Only valid ranges were sent after switching to Custom.
    for (const call of api.find('GET', '/admin/reports/rider-earnings').slice(before)) {
      expect(call.query.from <= call.query.to).toBe(true);
    }
  });
});

describe('My day pay (staff rider)', () => {
  const DAY = {
    timezone: 'Asia/Colombo' as const,
    today: { date: '2026-10-09', completed: 3, failed: 0, customer_unavailable: 0, cash_collected: 1830 },
    week: { starts_on: '2026-10-05', completed: 9, failed: 1, customer_unavailable: 0, cash_collected: 5400 },
    deliveries_today: [],
  };

  const earnings = (payType: 'COMPANY' | 'COMMISSION'): MyEarnings => ({
    timezone: 'Asia/Colombo',
    pay_type: payType,
    commission_percent: payType === 'COMMISSION' ? 80 : null,
    today: { date: '2026-10-09', deliveries: 3, delivery_charges: 750, earnings: 600, cash_collected: 1830, cash_to_keep: 600, cash_to_hand_in: 1230 },
    week: { starts_on: '2026-10-05', deliveries: 9, delivery_charges: 2250, earnings: 1800, cash_collected: 5400, cash_to_keep: 1800, cash_to_hand_in: 3600 },
  });

  it('a commission rider sees earnings and what to keep and hand in', async () => {
    renderAs(OPERATIONS_STAFF, '/delivery/day', {
      'GET /riders/me/day': () => ok(DAY),
      'GET /riders/me/earnings': () => ok(earnings('COMMISSION')),
    });
    const section = await screen.findByRole('region', { name: /Your earnings/ });
    expect(section).toHaveTextContent('80% of the delivery fee');
    expect(within(section).getByLabelText('Earnings today')).toHaveTextContent('TodayLKR 600');
    expect(within(section).getByLabelText('Earnings today')).toHaveTextContent('3 deliveries · Keep LKR 600, hand in LKR 1,230');
    expect(within(section).getByLabelText('Earnings this week')).toHaveTextContent('Keep LKR 1,800, hand in LKR 3,600');
  });

  it('a company rider sees no pay section', async () => {
    const { api } = renderAs(OPERATIONS_STAFF, '/delivery/day', {
      'GET /riders/me/day': () => ok(DAY),
      'GET /riders/me/earnings': () => ok(earnings('COMPANY')),
    });
    await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(api.find('GET', '/riders/me/earnings')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: /Your earnings/ })).toBeNull();
  });
});
