import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { cashTipOf, takeNewWalletTip, tipsOf, totalWithTips } from '../lib/tips';
import { RIDER, detail, ok, renderAs, summary } from './helpers';

// The real plugin needs a native bridge that jsdom lacks (as in delivery.test.tsx).
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
  localStorage.removeItem('blynk.rider.tips.seen');
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const atDoor = { assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' } as const;

const day = {
  timezone: 'Asia/Colombo',
  today: { date: '2026-10-25', completed: 2, failed: 0, customer_unavailable: 0, cash_collected: 1415 },
  week: { starts_on: '2026-10-19', completed: 9, failed: 0, customer_unavailable: 0, cash_collected: 6120.5 },
  deliveries_today: [],
};

const earnings = (todayExtra: object = {}, weekExtra: object = {}, payType: 'COMMISSION' | 'COMPANY' = 'COMMISSION') => ({
  timezone: 'Asia/Colombo',
  pay_type: payType,
  commission_percent: payType === 'COMMISSION' ? 80 : null,
  today: {
    date: '2026-10-25',
    deliveries: 2,
    delivery_charges: 240,
    earnings: payType === 'COMMISSION' ? 192 : 0,
    cash_collected: 1415,
    cash_to_keep: 192,
    cash_to_hand_in: 1223,
    ...todayExtra,
  },
  week: {
    starts_on: '2026-10-19',
    deliveries: 9,
    delivery_charges: 1080,
    earnings: payType === 'COMMISSION' ? 864 : 0,
    cash_collected: 6120.5,
    cash_to_keep: 864,
    cash_to_hand_in: 5256.5,
    ...weekExtra,
  },
});

describe('tips - helpers', () => {
  it('cashTipOf ignores missing, zero and junk values and never exceeds the amount to collect', () => {
    expect(cashTipOf({ total_amount: 600 })).toBe(0);
    expect(cashTipOf({ rider_tip: 0, total_amount: 600 })).toBe(0);
    expect(cashTipOf({ rider_tip: Number.NaN, total_amount: 600 })).toBe(0);
    expect(cashTipOf({ rider_tip: 50, total_amount: 600 })).toBe(50);
    expect(cashTipOf({ rider_tip: 100, total_amount: 40 })).toBe(40);
  });

  it('tipsOf hides when there are no tips and falls back to cash + wallet', () => {
    expect(tipsOf(undefined)).toBeNull();
    expect(tipsOf({})).toBeNull();
    expect(tipsOf({ tips: 0, tips_cash: 0, tips_wallet: 0 })).toBeNull();
    expect(tipsOf({ tips_cash: 50, tips_wallet: 30 })).toEqual({ cash: 50, wallet: 30, total: 80 });
    expect(tipsOf({ tips: 80, tips_cash: 50, tips_wallet: 30 })).toEqual({ cash: 50, wallet: 30, total: 80 });
  });

  it('totalWithTips uses total_with_tips when sent, derives it otherwise, null without tips', () => {
    const base = earnings().today;
    expect(totalWithTips(base)).toBeNull();
    expect(totalWithTips({ ...base, tips: 80, tips_cash: 50, tips_wallet: 30 })).toBe(272);
    expect(totalWithTips({ ...base, tips: 80, tips_cash: 50, tips_wallet: 30, total_with_tips: 300 })).toBe(300);
  });

  it('takeNewWalletTip reports only what is new since the last visit, once, per day', () => {
    const at = (date: string, tips_wallet?: number) => ({ today: { ...earnings().today, date, tips_wallet } });
    expect(takeNewWalletTip(at('2026-10-25'))).toBe(0);
    expect(takeNewWalletTip(at('2026-10-25', 80))).toBe(80);
    expect(takeNewWalletTip(at('2026-10-25', 80))).toBe(0);
    expect(takeNewWalletTip(at('2026-10-25', 130))).toBe(50);
    // A new day starts again from nothing.
    expect(takeNewWalletTip(at('2026-10-26', 20))).toBe(20);
    expect(takeNewWalletTip(null)).toBe(0);
  });

  it('takeNewWalletTip survives blocked storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(takeNewWalletTip({ today: { ...earnings().today, tips_wallet: 40 } })).toBe(40);
    } finally {
      spy.mockRestore();
      set.mockRestore();
    }
  });
});

describe('tips - delivery screen', () => {
  it('shows "includes LKR X tip for you" under the cash to collect and in the collect sheet', async () => {
    const user = userEvent.setup();
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ ...atDoor, total_amount: 1690, rider_tip: 100 }) }),
    });
    const cash = await screen.findByRole('region', { name: 'Cash to collect' });
    expect(cash).toHaveTextContent('LKR 1,690');
    expect(screen.getByTestId('cash-tip')).toHaveTextContent('includes LKR 100 tip for you');
    expect(screen.getByTestId('cash-tip')).toHaveTextContent("It's all yours");
    // The amount the API reported is still what is collected - the tip is not added on.
    await user.click(screen.getByRole('button', { name: 'Collect LKR 1,690' }));
    const sheet = screen.getByRole('dialog', { name: 'Collect LKR 1,690 in cash' });
    expect(within(sheet).getByTestId('sheet-tip')).toHaveTextContent('includes LKR 100 tip for you');
  });

  it('shows nothing about tips when there is none or the API sends no field', async () => {
    const { unmount } = renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ ...atDoor, total_amount: 610 }) }),
    });
    await screen.findByRole('region', { name: 'Cash to collect' });
    expect(screen.queryByTestId('cash-tip')).not.toBeInTheDocument();
    unmount();
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ ...atDoor, total_amount: 610, rider_tip: 0 }) }),
    });
    await screen.findByRole('region', { name: 'Cash to collect' });
    expect(screen.queryByTestId('cash-tip')).not.toBeInTheDocument();
  });

  it('does not show a cash tip on an order paid online', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () =>
        ok({ delivery: detail({ ...atDoor, total_amount: 0, rider_tip: 50, payment_method: 'ONLINE', payment_status: 'PAID' }) }),
    });
    await screen.findByRole('region', { name: 'Payment' });
    expect(screen.queryByTestId('cash-tip')).not.toBeInTheDocument();
  });

  it('a delivered order says how much of the cash collected was the rider tip', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () =>
        ok({
          delivery: detail({
            assignment_status: 'DELIVERED',
            order_status: 'DELIVERED',
            payment_status: 'PAID',
            total_amount: 1690,
            cod_collected_amount: 1690,
            rider_tip: 100,
            delivered_at: '2026-09-18T09:30:00.000Z',
          }),
        }),
    });
    expect(await screen.findByText('LKR 1,690 collected')).toBeInTheDocument();
    expect(screen.getByTestId('settled-tip')).toHaveTextContent('includes LKR 100 tip for you');
  });
});

describe('tips - My day', () => {
  it('shows a Tips card with the cash/wallet split, a total with tips, and the hand-in note', async () => {
    renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () =>
        ok(
          earnings(
            { tips: 150, tips_cash: 100, tips_wallet: 50, cash_to_hand_in: 1073 },
            { tips: 400, tips_cash: 300, tips_wallet: 100 }
          )
        ),
    });
    const card = await screen.findByRole('region', { name: 'Tips' });
    expect(card).toHaveTextContent('TodayLKR 150 in tips LKR 100 cash · LKR 50 wallet');
    expect(card).toHaveTextContent('With your delivery pay: LKR 342');
    expect(card).toHaveTextContent('This weekLKR 400 in tips LKR 300 cash · LKR 100 wallet');
    expect(card).toHaveTextContent('With your delivery pay: LKR 1,264');
    expect(card).toHaveTextContent('Tips are 100% yours');
    // The hand-in number is the API's, with a line that explains tips are already in it.
    const today = screen.getByRole('region', { name: 'Today' });
    expect(today).toHaveTextContent('Hand in LKR 1,073');
    expect(screen.getByTestId('handin-tips')).toHaveTextContent('Your tips today (LKR 100 cash · LKR 50 wallet) are already counted here.');
  });

  it('hides the Tips card and the hand-in note when the API sends no tips', async () => {
    renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () => ok(earnings()),
    });
    await screen.findByRole('region', { name: 'Your earnings' });
    expect(screen.queryByRole('region', { name: 'Tips' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('handin-tips')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tip-notice')).not.toBeInTheDocument();
  });

  it('a company rider sees tips and the hand-in line they change, without a pay total', async () => {
    renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': () =>
        ok(earnings({ tips: 60, tips_cash: 60, tips_wallet: 0, cash_to_hand_in: 1355, cash_to_keep: 60 }, { tips: 60, tips_cash: 60 }, 'COMPANY')),
    });
    const card = await screen.findByRole('region', { name: 'Tips' });
    expect(card).toHaveTextContent('LKR 60 in tips LKR 60 cash');
    expect(card).not.toHaveTextContent('With your delivery pay');
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent('Hand in LKR 1,355, keep LKR 60');
  });

  it('announces a new wallet tip once, and not again on the next visit', async () => {
    const user = userEvent.setup();
    const reply = () =>
      ok(earnings({ tips: 80, tips_cash: 0, tips_wallet: 80 }, { tips: 80, tips_cash: 0, tips_wallet: 80 }));
    const first = renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': reply,
    });
    const notice = await screen.findByTestId('tip-notice');
    expect(notice).toHaveTextContent('You received a LKR 80 tip');
    await user.click(within(notice).getByRole('button', { name: 'Dismiss tip notice' }));
    expect(screen.queryByTestId('tip-notice')).not.toBeInTheDocument();
    first.unmount();

    renderAs(RIDER, '/day', {
      'GET /riders/me/day': () => ok(day),
      'GET /riders/me/earnings': reply,
    });
    await screen.findByRole('region', { name: 'Tips' });
    expect(screen.queryByTestId('tip-notice')).not.toBeInTheDocument();
  });

  it('the home screen shows the notice too and a failed earnings request never disturbs the list', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () => ok({ deliveries: [summary()] }),
      'GET /riders/me/earnings': () => ok(earnings({ tips: 40, tips_cash: 0, tips_wallet: 40 })),
    });
    expect(await screen.findByTestId('tip-notice')).toHaveTextContent('You received a LKR 40 tip');
    expect(await screen.findByRole('link', { name: /Open delivery/ })).toBeInTheDocument();
  });

  it('home without an earnings answer (error) still lists deliveries and shows no notice', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () => ok({ deliveries: [summary()] }),
    });
    expect(await screen.findByRole('link', { name: /Open delivery/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('tip-notice')).not.toBeInTheDocument());
  });
});
