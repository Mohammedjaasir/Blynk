import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Settings } from '../pages/Settings';
import { Referrals } from '../pages/Referrals';
import { CustomerPointsPanel } from '../components/CustomerPointsPanel';
import { tokenStore } from '../api/client';
import type { CustomerPoints, PointsSetting, ReferralPage, ReferralSetting } from '../api/referralPoints';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Refer a friend and Blynk Points (owner, 2026-10-10): the two Settings
 * cards, the Referrals page and a customer's points panel. The rules are the
 * backend's; here, what the pages send and show.
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

const REFERRAL: ReferralSetting = {
  enabled: false,
  mode: 'LKR_OFF',
  friend_amount_lkr: 200,
  inviter_amount_lkr: 200,
  monthly_cap: 10,
  friend_unused_to_credit: true,
  updated_at: null,
};

const POINTS: PointsSetting = {
  enabled: false,
  earn_points: 1,
  earn_per_lkr: 100,
  lkr_per_point: 1,
  min_redeem_points: 100,
  max_redeem_percent: 20,
  expiry_months: 12,
  updated_at: null,
};

/** Settings reads many panels; only ours are answered, the rest 404 quietly. */
function settingsApi(extra: (call: Call) => Reply | undefined = () => undefined) {
  return mockApi((call) => {
    const r = extra(call);
    if (r) return r;
    if (call.method === 'GET' && call.path === '/admin/settings/referrals') return ok(REFERRAL);
    if (call.method === 'GET' && call.path === '/admin/settings/points') return ok(POINTS);
    return undefined;
  });
}

describe('Settings -> Refer a friend', () => {
  it('shows the saved settings and rules, and saves only what changed', async () => {
    const user = userEvent.setup();
    const api = settingsApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/referrals'
        ? ok({ ...REFERRAL, ...c.body, updated_at: '2026-10-10T04:00:00Z' })
        : undefined
    );
    renderPage(<Settings />, '/settings');
    const panel = await screen.findByRole('region', { name: 'Refer a friend' });
    const on = await within(panel).findByRole('checkbox', { name: /^Refer a friend/ });
    expect(on).not.toBeChecked();
    expect(within(panel).getByRole('radio', { name: 'LKR off' })).toBeChecked();
    expect(within(panel).getByLabelText(/^Monthly cap/)).toHaveValue('10');
    expect(within(panel).getByRole('list', { name: 'How refer a friend works' })).toHaveTextContent(/credited when the friend's first order is delivered/);

    await user.click(on);
    const friend = within(panel).getByLabelText(/^Friend's reward/);
    await user.clear(friend);
    await user.type(friend, '250');
    expect(within(panel).getByTestId('referral-summary')).toHaveTextContent("Friend: LKR 250 off their first order");
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/referrals')[0]?.body).toEqual({ enabled: true, friend_amount_lkr: 250 }));
    expect(await screen.findByText('Refer a friend saved.')).toBeInTheDocument();
  });

  it('"Unused friend reward becomes a credit" (owner, 2026-10-10): on by default, explained, and switching it off sends only that', async () => {
    const user = userEvent.setup();
    const api = settingsApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/referrals' ? ok({ ...REFERRAL, ...c.body }) : undefined
    );
    renderPage(<Settings />, '/settings');
    const panel = await screen.findByRole('region', { name: 'Refer a friend' });
    const toggle = await within(panel).findByRole('checkbox', { name: /^Unused friend reward becomes a credit/ });
    expect(toggle).toBeChecked();
    expect(within(panel).getByText(/Off: the unused reward lapses/)).toBeInTheDocument();
    await user.click(toggle);
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/referrals')[0]?.body).toEqual({ friend_unused_to_credit: false }));
  });

  it('switching to free delivery sends only the mode; a bad amount is refused', async () => {
    const user = userEvent.setup();
    const api = settingsApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/referrals' ? ok({ ...REFERRAL, ...c.body }) : undefined
    );
    renderPage(<Settings />, '/settings');
    const panel = await screen.findByRole('region', { name: 'Refer a friend' });
    const inviter = await within(panel).findByLabelText(/^Inviter's reward/);
    await user.clear(inviter);
    await user.type(inviter, '20000');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText("The inviter's amount can be at most 10000.")).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/referrals')).toHaveLength(0);

    await user.click(within(panel).getByRole('radio', { name: 'Free delivery' }));
    expect(within(panel).queryByLabelText(/^Inviter's reward/)).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/referrals')[0]?.body).toEqual({ mode: 'FREE_DELIVERY' }));
  });
});

describe('Settings -> Blynk Points', () => {
  it('shows a live example and saves only what changed', async () => {
    const user = userEvent.setup();
    const api = settingsApi((c) =>
      c.method === 'PATCH' && c.path === '/admin/settings/points' ? ok({ ...POINTS, ...c.body }) : undefined
    );
    renderPage(<Settings />, '/settings');
    const panel = await screen.findByRole('region', { name: 'Blynk Points' });
    expect(await within(panel).findByTestId('points-example')).toHaveTextContent('A LKR 1,000 order earns 10 points; 100 points = LKR 100');
    expect(panel).toHaveTextContent(/combine with a coupon, birthday gift or referral reward/);
    const earn = within(panel).getByLabelText(/^Points earned/);
    await user.clear(earn);
    await user.type(earn, '2');
    expect(within(panel).getByTestId('points-example')).toHaveTextContent('earns 20 points');
    const expiry = within(panel).getByLabelText(/^Points expire after/);
    await user.clear(expiry);
    await user.type(expiry, '0');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/points')[0]?.body).toEqual({ earn_points: 2, expiry_months: 0 }));
  });

  it('refuses a fractional points value before sending', async () => {
    const user = userEvent.setup();
    const api = settingsApi();
    renderPage(<Settings />, '/settings');
    const panel = await screen.findByRole('region', { name: 'Blynk Points' });
    const min = await within(panel).findByLabelText(/^Minimum points to use/);
    await user.clear(min);
    await user.type(min, '10.5');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('The minimum points to use must be a whole number.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/points')).toHaveLength(0);
  });
});

const PAGE: ReferralPage = {
  referrals: [
    {
      id: 'r1',
      code: 'RIZ7K',
      status: 'REWARDED',
      created_at: '2026-10-09T05:00:00Z',
      completed_at: '2026-10-10T06:00:00Z',
      inviter: { id: 'u1', name: 'Fathima Rizna', phone: '+94771234567' },
      friend: { id: 'u2', name: 'Kasun Silva', phone: '+94770000001' },
      qualifying_order_number: 'BL-20261010-0042',
      friend_reward: { mode: 'LKR_OFF', amount_lkr: 200, discount_amount: 200, used: true, order_number: 'BL-20261010-0042', created_at: '2026-10-09T05:00:00Z' },
      inviter_reward: { mode: 'LKR_OFF', amount_lkr: 200, discount_amount: 0, used: false, order_number: null, created_at: '2026-10-10T06:00:00Z' },
    },
  ],
  summary: { PENDING: 3, REWARDED: 1, CAPPED: 0, NO_REWARD: 0 },
  pagination: { page: 1, limit: 50, total: 120, total_pages: 3 },
};

describe('Referrals page', () => {
  it('lists referrals, filters by status and pages', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => (c.method === 'GET' && c.path === '/admin/referrals' ? ok(PAGE) : undefined));
    renderPage(<Referrals />, '/referrals');
    const table = await screen.findByRole('table', { name: 'Referrals' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('Kasun Silva');
    expect(row).toHaveTextContent('Fathima Rizna');
    expect(row).toHaveTextContent('RIZ7K');
    expect(row).toHaveTextContent('Rewarded');
    expect(row).toHaveTextContent('used on #0042');
    expect(row).toHaveTextContent('waiting for their next order');
    expect(within(row).getByRole('link', { name: 'Kasun Silva' })).toHaveAttribute('href', '/customers/u2');
    expect(screen.getByRole('button', { name: 'Pending (3)' })).toBeInTheDocument();
    expect(api.calls[0]!.query.get('page')).toBe('1');
    expect(api.calls[0]!.query.get('limit')).toBe('50');
    expect(api.calls[0]!.query.get('status')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.calls.some((c) => c.query.get('page') === '2')).toBe(true));
    await user.click(await screen.findByRole('button', { name: /^Pending/ }));
    await waitFor(() => {
      const last = api.calls[api.calls.length - 1]!;
      expect(last.query.get('status')).toBe('PENDING');
      expect(last.query.get('page')).toBe('1');
    });
  });

  it('says so when there are none', async () => {
    mockApi(() => ok({ ...PAGE, referrals: [], pagination: { page: 1, limit: 50, total: 0, total_pages: 1 } }));
    renderPage(<Referrals />, '/referrals');
    expect(await screen.findByText('No referrals yet')).toBeInTheDocument();
  });
});

const POINTS_DATA: CustomerPoints = {
  customer_id: 'u1',
  enabled: true,
  balance: 120,
  value_lkr: 120,
  history: [
    {
      id: 'p2',
      kind: 'ADJUST',
      points: 20,
      remaining: 20,
      expires_at: null,
      reason: 'Late delivery goodwill',
      created_at: '2026-10-10T05:00:00Z',
      order_number: null,
      actor_name: 'Nawaz Mansoor',
    },
    {
      id: 'p1',
      kind: 'EARN',
      points: 100,
      remaining: 100,
      expires_at: '2027-10-09T05:00:00Z',
      reason: null,
      created_at: '2026-10-09T05:00:00Z',
      order_number: 'BL-20261009-0007',
      actor_name: null,
    },
  ],
};

describe('Customer points panel', () => {
  const renderPanel = () =>
    renderPage(
      <Routes>
        <Route path="/customers/:id" element={<CustomerPointsPanel customerId="u1" />} />
      </Routes>,
      '/customers/u1'
    );

  it('shows balance, value and history, and adjusts with a reason', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/customers/u1/points') return ok(POINTS_DATA);
      if (c.method === 'POST' && c.path === '/admin/customers/u1/points/adjust') {
        return ok({ ...POINTS_DATA, balance: 70, value_lkr: 70 });
      }
      return undefined;
    });
    renderPanel();
    expect(await screen.findByTestId('points-balance')).toHaveTextContent('120');
    expect(screen.getByText('LKR 120')).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Points history' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Adjusted');
    expect(rows[1]).toHaveTextContent('+20');
    expect(rows[1]).toHaveTextContent('Late delivery goodwill');
    expect(rows[1]).toHaveTextContent('Nawaz Mansoor');
    expect(rows[2]).toHaveTextContent('Earned');
    expect(rows[2]).toHaveTextContent('#0007');

    // Reason is required.
    await user.type(screen.getByLabelText(/^Adjust points/), '-50');
    await user.click(screen.getByRole('button', { name: 'Adjust points' }));
    expect(await screen.findByText('Write a reason (at least 3 characters).')).toBeInTheDocument();
    expect(api.find('POST', '/admin/customers/u1/points/adjust')).toHaveLength(0);

    await user.type(screen.getByLabelText(/^Reason/), 'Wrong item refund');
    await user.click(screen.getByRole('button', { name: 'Adjust points' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/customers/u1/points/adjust')[0]?.body).toEqual({ points: -50, reason: 'Wrong item refund' })
    );
    await waitFor(() => expect(screen.getByTestId('points-balance')).toHaveTextContent('70'));
  });

  it('explains when an adjustment would go below 0', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.method === 'GET') return ok(POINTS_DATA);
      return fail(422, 'POINTS_INSUFFICIENT', 'Not enough points', { balance: 120 });
    });
    renderPanel();
    await user.type(await screen.findByLabelText(/^Adjust points/), '-500');
    await user.type(screen.getByLabelText(/^Reason/), 'Mistake fix');
    await user.click(screen.getByRole('button', { name: 'Adjust points' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That would take the balance below 0 - they have 120 points.');
  });
});
