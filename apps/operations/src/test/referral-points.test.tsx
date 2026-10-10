import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { PointsSetting, ReferralPage, ReferralSetting } from '../api/referralPoints';
import { parseAdjustPoints, parseNumber, parseReason, pointsEarned, pointsExample, readReferralForm } from '../lib/referralPoints';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

/** More -> Refer a friend and More -> Blynk Points (owner, 2026-10-10). */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
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

const reward = (over: Partial<NonNullable<ReferralPage['referrals'][0]['friend_reward']>> = {}) => ({
  mode: 'LKR_OFF' as const,
  amount_lkr: 200,
  discount_amount: 200,
  used: true,
  order_number: 'BL-20261010-0042',
  created_at: '2026-10-10T05:00:00Z',
  ...over,
});

const PAGE: ReferralPage = {
  referrals: [
    {
      id: 'r1',
      code: 'NIMA7K',
      status: 'REWARDED',
      created_at: '2026-10-09T05:00:00Z',
      completed_at: '2026-10-10T06:00:00Z',
      inviter: { id: 'c1', name: 'Nimali Perera', phone: '+94771234567' },
      friend: { id: 'c2', name: 'Kasun Silva', phone: '+94770000001' },
      qualifying_order_number: 'BL-20261010-0042',
      friend_reward: reward(),
      inviter_reward: reward({ used: false, order_number: null }),
    },
    {
      id: 'r2',
      code: 'NIMA7K',
      status: 'PENDING',
      created_at: '2026-10-10T05:00:00Z',
      completed_at: null,
      inviter: { id: 'c1', name: 'Nimali Perera', phone: '+94771234567' },
      friend: { id: 'c3', name: null, phone: '+94770000002' },
      qualifying_order_number: null,
      friend_reward: null,
      inviter_reward: null,
    },
  ],
  summary: { PENDING: 1, REWARDED: 1, CAPPED: 0, NO_REWARD: 0 },
  pagination: { page: 1, limit: 50, total: 2, total_pages: 1 },
};

describe('Referral and points helpers', () => {
  it('validates like the backend', () => {
    expect(parseNumber('12.5', 'x', 0, 100)).toEqual({ value: 12.5 });
    expect(parseNumber('1.234', 'x', 0, 100)).toEqual({ error: 'X can have at most 2 decimals.' });
    expect(parseNumber('2.5', 'x', 0, 100, 0)).toEqual({ error: 'X must be a whole number.' });
    expect(parseNumber('101', 'x', 0, 100)).toEqual({ error: 'X can be at most 100.' });
    expect(parseAdjustPoints('-50')).toEqual({ value: -50 });
    expect(parseAdjustPoints('+25')).toEqual({ value: 25 });
    expect(parseAdjustPoints('0')).toEqual({ error: 'Points cannot be 0.' });
    expect(parseAdjustPoints('1.5')).toHaveProperty('error');
    expect(parseReason('ok')).toHaveProperty('error');
    expect(parseReason('  Goodwill  ')).toEqual({ value: 'Goodwill' });
    expect(readReferralForm({ enabled: true, mode: 'FREE_DELIVERY', friend: 'x', inviter: '', cap: '5', friendUnusedToCredit: false })).toEqual({
      value: { enabled: true, mode: 'FREE_DELIVERY', friend_amount_lkr: 0, inviter_amount_lkr: 0, monthly_cap: 5, friend_unused_to_credit: false },
    });
  });

  it('works out the live example', () => {
    expect(pointsEarned(1000, { earn_points: 1, earn_per_lkr: 100 })).toBe(10);
    expect(pointsEarned(999, { earn_points: 2, earn_per_lkr: 100 })).toBe(18);
    expect(pointsExample(POINTS)).toBe('A LKR 1,000 order earns 10 points; 100 points = LKR 100');
  });
});

describe('Refer a friend screen', () => {
  function open(handlers: Parameters<typeof renderAs>[2] = {}) {
    return renderAs(ADMIN_WITH_RIDER, '/more/refer-a-friend', {
      'GET /admin/settings/referrals': () => ok(REFERRAL),
      'GET /admin/referrals': () => ok(PAGE),
      ...handlers,
    });
  }

  it('is linked from More, with Blynk Points', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more');
    expect(await screen.findByRole('link', { name: 'Refer a friend' })).toHaveAttribute('href', '/more/refer-a-friend');
    expect(screen.getByRole('link', { name: 'Blynk Points' })).toHaveAttribute('href', '/more/points');
  });

  it('shows the settings and the rules, then saves only what changed', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'PATCH /admin/settings/referrals': (call) => ok({ ...REFERRAL, ...(call.body as object), updated_at: '2026-10-10T04:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Refer a friend', level: 2 })).closest('section') as HTMLElement;
    const on = await within(card).findByRole('checkbox', { name: /^Refer a friend/ });
    expect(on).not.toBeChecked();
    expect(within(card).getByRole('radio', { name: 'LKR off' })).toBeChecked();
    expect(within(card).getByLabelText(/^Friend's reward/)).toHaveValue('200');
    expect(within(card).getByLabelText(/^Monthly cap/)).toHaveValue('10');
    expect(within(card).getByRole('list', { name: 'How refer a friend works' })).toHaveTextContent(/single larger discount wins/);

    await user.click(on);
    const inviter = within(card).getByLabelText(/^Inviter's reward/);
    await user.clear(inviter);
    await user.type(inviter, '150');
    expect(within(card).getByTestId('referral-summary')).toHaveTextContent('Inviter: LKR 150 off their next order');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/referrals')[0]?.body).toEqual({ enabled: true, inviter_amount_lkr: 150 })
    );
    expect(await within(card).findByText('Refer a friend saved.')).toBeInTheDocument();
    expect(within(card).getByText(/Last changed/)).toBeInTheDocument();
  });

  it('"Unused friend reward becomes a credit" (owner, 2026-10-10): on by default, explained, and switching it off sends only that', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'PATCH /admin/settings/referrals': (call) => ok({ ...REFERRAL, ...(call.body as object), updated_at: '2026-10-10T04:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Refer a friend', level: 2 })).closest('section') as HTMLElement;
    const toggle = await within(card).findByRole('checkbox', { name: /^Unused friend reward becomes a credit/ });
    expect(toggle).toBeChecked();
    expect(within(card).getByText(/Off: the unused reward lapses/)).toBeInTheDocument();
    await user.click(toggle);
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/referrals')[0]?.body).toEqual({ friend_unused_to_credit: false }));
    await waitFor(() => expect(within(card).getByRole('checkbox', { name: /^Unused friend reward becomes a credit/ })).not.toBeChecked());
  });

  it('free delivery hides the amounts; a bad cap is refused before sending', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const card = (await screen.findByRole('heading', { name: 'Refer a friend', level: 2 })).closest('section') as HTMLElement;
    await user.click(await within(card).findByRole('radio', { name: 'Free delivery' }));
    expect(within(card).queryByLabelText(/^Friend's reward/)).not.toBeInTheDocument();
    const cap = within(card).getByLabelText(/^Monthly cap/);
    await user.clear(cap);
    await user.type(cap, '0');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('The monthly cap must be at least 1.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/referrals')).toHaveLength(0);
  });

  it('lists referrals with rewards and filters by status', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const list = await screen.findByRole('list', { name: 'Referrals' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Kasun Silva invited by Nimali Perera');
    expect(rows[0]).toHaveTextContent('Rewarded');
    expect(rows[0]).toHaveTextContent('Friend: LKR 200 off on #0042');
    expect(rows[0]).toHaveTextContent('Inviter: LKR 200 off - waiting for their next order');
    expect(rows[1]).toHaveTextContent('New customer invited by Nimali Perera');
    expect(rows[1]).toHaveTextContent('Pending');

    await user.click(screen.getByRole('button', { name: /^Over monthly cap/ }));
    await waitFor(() => expect(api.find('GET', '/admin/referrals').some((c) => c.query.status === 'CAPPED')).toBe(true));
    expect(api.find('GET', '/admin/referrals')[0]?.query).toMatchObject({ page: '1', limit: '50' });
  });

  it('shows the server error on save', async () => {
    const user = userEvent.setup();
    open({ 'PATCH /admin/settings/referrals': () => fail(400, 'VALIDATION_ERROR', 'Send at least one setting to change') });
    const card = (await screen.findByRole('heading', { name: 'Refer a friend', level: 2 })).closest('section') as HTMLElement;
    await user.click(await within(card).findByRole('checkbox', { name: /^Refer a friend/ }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Send at least one setting to change')).toBeInTheDocument();
  });
});

describe('Blynk Points screen', () => {
  it('shows the settings with a live example and saves only what changed', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more/points', {
      'GET /admin/settings/points': () => ok(POINTS),
      'PATCH /admin/settings/points': (call) => ok({ ...POINTS, ...(call.body as object), updated_at: '2026-10-10T04:00:00Z' }),
    });
    const card = (await screen.findByRole('heading', { name: 'Blynk Points', level: 2 })).closest('section') as HTMLElement;
    expect(await within(card).findByTestId('points-example')).toHaveTextContent('A LKR 1,000 order earns 10 points; 100 points = LKR 100');
    expect(card).toHaveTextContent(/combine with a coupon/);

    await user.click(within(card).getByRole('checkbox', { name: /^Blynk Points/ }));
    const value = within(card).getByLabelText(/^Value of one point/);
    await user.clear(value);
    await user.type(value, '0.5');
    expect(within(card).getByTestId('points-example')).toHaveTextContent('100 points = LKR 50');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/points')[0]?.body).toEqual({ enabled: true, lkr_per_point: 0.5 }));
    expect(await within(card).findByText('Blynk Points saved.')).toBeInTheDocument();
  });

  it('refuses an out-of-range value before sending', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more/points', { 'GET /admin/settings/points': () => ok(POINTS) });
    const card = (await screen.findByRole('heading', { name: 'Blynk Points', level: 2 })).closest('section') as HTMLElement;
    const pct = await within(card).findByLabelText(/^Most of an order/);
    await user.clear(pct);
    await user.type(pct, '150');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('The most of an order points can pay can be at most 100.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/points')).toHaveLength(0);
  });
});
