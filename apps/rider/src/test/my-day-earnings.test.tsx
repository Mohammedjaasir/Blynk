import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { RIDER, fail, ok, renderAs } from './helpers';

// The real plugin needs a native bridge that jsdom lacks (as in trip.test.tsx).
vi.mock('../lib/tracking-plugin', () => ({
  capacitorTrackingPlugin: {
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetTrackerSessionForTests();
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const day = {
  timezone: 'Asia/Colombo',
  today: { date: '2026-10-09', completed: 2, failed: 0, customer_unavailable: 0, cash_collected: 1415 },
  week: { starts_on: '2026-10-05', completed: 9, failed: 1, customer_unavailable: 0, cash_collected: 6120.5 },
  deliveries_today: [],
};

// Rider pay (owner, 2026-10-09): 80% of the LKR 120 standard delivery fee is
// LKR 96 per delivery, earned even when the customer's delivery was free.
const commission = {
  timezone: 'Asia/Colombo',
  pay_type: 'COMMISSION',
  commission_percent: 80,
  today: {
    date: '2026-10-09',
    deliveries: 2,
    delivery_charges: 240,
    earnings: 192,
    cash_collected: 1415,
    cash_to_keep: 192,
    cash_to_hand_in: 1223,
  },
  week: {
    starts_on: '2026-10-05',
    deliveries: 9,
    delivery_charges: 1080,
    earnings: 864,
    cash_collected: 6120.5,
    cash_to_keep: 864,
    cash_to_hand_in: 5256.5,
  },
};

const company = {
  ...commission,
  pay_type: 'COMPANY',
  commission_percent: null,
  today: { ...commission.today, earnings: 0, cash_to_keep: 0, cash_to_hand_in: 1415 },
  week: { ...commission.week, earnings: 0, cash_to_keep: 0, cash_to_hand_in: 6120.5 },
};

describe('My day - rider pay', () => {
  it('a commission rider sees today and this week earned, their share, and hand in vs keep', async () => {
    const { api } = renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () => ok(commission),
    });
    const card = await screen.findByRole('region', { name: 'Your earnings' });
    expect(api.find('GET', '/riders/me/earnings')).toHaveLength(1);
    expect(card).toHaveTextContent('TodayLKR 192 earned · 2 deliveries');
    expect(card).toHaveTextContent('This weekLKR 864 · 9 deliveries');
    expect(card).toHaveTextContent('You earn 80% of each delivery charge');

    const today = screen.getByRole('region', { name: 'Today' });
    expect(today).toHaveTextContent('Hand in LKR 1,223, keep LKR 192');
    // The week has no hand-in line: cash is handed in day by day.
    expect(screen.getByRole('region', { name: /This week/ })).not.toHaveTextContent(/Hand in/);
  });

  it('a single delivery reads "1 delivery" and a fractional share is shown as given', async () => {
    renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () =>
        ok({ ...commission, commission_percent: 82.5, today: { ...commission.today, deliveries: 1, earnings: 99 } }),
    });
    const card = await screen.findByRole('region', { name: 'Your earnings' });
    expect(card).toHaveTextContent('LKR 99 earned · 1 delivery');
    expect(card).toHaveTextContent('You earn 82.5% of each delivery charge');
  });

  it('a company rider sees counts and cash collected but no earnings or keep amount', async () => {
    const { api } = renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () => ok(company),
    });
    const today = await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(api.find('GET', '/riders/me/earnings')).toHaveLength(1));
    // Let the earnings answer land before asserting it changed nothing.
    await new Promise((r) => setTimeout(r, 0));
    expect(within(today).getByText('Cash collected').nextElementSibling).toHaveTextContent('LKR 1,415');
    expect(screen.queryByRole('region', { name: 'Your earnings' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/earn|keep|commission|Hand in/i);
  });

  it('a failed earnings request leaves My day working and hides the card', async () => {
    const { api } = renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () => fail(500, 'INTERNAL'),
    });
    const today = await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(api.find('GET', '/riders/me/earnings')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(within(today).getByText('Delivered').nextElementSibling).toHaveTextContent('2');
    expect(screen.queryByRole('region', { name: 'Your earnings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Hand in|keep/i);
  });

  it('refreshing My day asks for the earnings again', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () => ok(commission),
    });
    await screen.findByRole('region', { name: 'Your earnings' });
    await user.click(screen.getByRole('button', { name: 'Refresh my day' }));
    await waitFor(() => expect(api.find('GET', '/riders/me/earnings')).toHaveLength(2));
    expect(api.find('GET', '/riders/me/day')).toHaveLength(2);
  });
});
