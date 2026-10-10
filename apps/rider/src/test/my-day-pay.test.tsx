import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { formatUntil } from '../lib/format';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { RIDER, ok, renderAs } from './helpers';

/*
 * Staff-controlled rider pay on My day (owner, 2026-10-10): base pay, bonuses
 * by kind, staff adjustments with their reason, the pay model, "Blynk owes
 * you", and the rain / peak boost banner. An older API without these fields
 * keeps the 2026-10-09 card.
 */

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
  vi.useRealTimers();
});

const day = {
  timezone: 'Asia/Colombo',
  today: { date: '2026-10-10', completed: 2, failed: 0, customer_unavailable: 0, cash_collected: 1415 },
  week: { starts_on: '2026-10-05', completed: 9, failed: 1, customer_unavailable: 0, cash_collected: 6120.5 },
  deliveries_today: [],
};

/** The 2026-10-09 payload: no bonuses, adjustments, pay model or boosts. */
const oldCommission = {
  timezone: 'Asia/Colombo',
  pay_type: 'COMMISSION',
  commission_percent: 80,
  today: {
    date: '2026-10-10',
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

const noBoosts = {
  applies: true,
  rain: { active: false, mode: 'FIXED', amount: 30, until: null },
  peak: { active_now: false, mode: 'FIXED', amount: 30 },
};

const zeroExtras = {
  delivery_bonuses: 0,
  day_bonuses: 0,
  bonuses: 0,
  additions: 0,
  deductions: 0,
  adjustments: 0,
  payable_to_rider: 0,
};

// Base 192 + peak 60 + daily target 100 - cash short 50 + bonus 40 = 342.
const extended = {
  ...oldCommission,
  pay_model: { model: 'DISTANCE', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: 60 },
  boosts: noBoosts,
  today: {
    ...oldCommission.today,
    earnings: 342,
    base_earnings: 192,
    delivery_bonuses: 60,
    day_bonuses: 100,
    bonuses: 160,
    additions: 40,
    deductions: 50,
    adjustments: -10,
    payable_to_rider: 0,
    cash_to_keep: 342,
    cash_to_hand_in: 1073,
    bonus_lines: [
      { kind: 'PEAK_BOOST', amount_lkr: 60, count: 2 },
      { kind: 'DAILY_TARGET', amount_lkr: 100, count: 1 },
    ],
    adjustment_lines: [
      { id: 'a1', amount_lkr: -50, reason: 'CASH_SHORT', note: 'Short at #1234' },
      { id: 'a2', amount_lkr: 40, reason: 'BONUS', note: null },
    ],
  },
  week: {
    ...oldCommission.week,
    ...zeroExtras,
    earnings: 1094,
    base_earnings: 864,
    delivery_bonuses: 140,
    day_bonuses: 100,
    bonuses: 240,
    additions: 40,
    deductions: 50,
    adjustments: -10,
  },
};

const company = {
  ...oldCommission,
  pay_type: 'COMPANY',
  commission_percent: null,
  pay_model: null,
  boosts: { ...noBoosts, applies: false },
  today: {
    ...oldCommission.today,
    ...zeroExtras,
    earnings: 0,
    base_earnings: 0,
    cash_to_keep: 0,
    cash_to_hand_in: 1415,
    bonus_lines: [],
    adjustment_lines: [],
  },
  week: { ...oldCommission.week, ...zeroExtras, earnings: 0, base_earnings: 0, cash_to_keep: 0, cash_to_hand_in: 6120.5 },
};

function show(earnings: unknown) {
  return renderAs(RIDER, '/day', {
    'GET /riders/me/day': () => ok(day),
    'GET /riders/me/earnings': () => ok(earnings),
  });
}

describe('My day - staff-controlled pay (owner, 2026-10-10)', () => {
  it('breaks today into base pay, bonuses with counts and adjustments with reasons, to the total', async () => {
    show(extended);
    const card = await screen.findByRole('region', { name: 'Your earnings' });
    expect(card).toHaveTextContent('TodayLKR 342 earned · 2 deliveries');

    const lines = within(card).getByLabelText('Today line by line');
    const rows = Array.from(lines.querySelectorAll('.earn__row')).map((r) => r.textContent);
    expect(rows).toEqual([
      'DeliveriesLKR 192',
      'Peak boost ×2+LKR 60',
      'Daily target ×1+LKR 100',
      'Cash short · Short at #1234−LKR 50',
      'Bonus+LKR 40',
      'TotalLKR 342',
    ]);
    expect(lines.querySelector('.earn__row--minus')).toHaveTextContent('Cash short');

    expect(card).toHaveTextContent('This weekLKR 1,094 · 9 deliveriesincl. +LKR 240 bonuses · −LKR 10 adjustments');
    expect(card).toHaveTextContent('You earn LKR 50 + LKR 20/km per delivery · min LKR 60');

    const today = screen.getByRole('region', { name: 'Today' });
    expect(today).toHaveTextContent('Hand in LKR 1,073, keep LKR 342');
    expect(today).not.toHaveTextContent(/Blynk owes you/);
  });

  it('names a fixed or percent pay model and says when Blynk owes the rider', async () => {
    show({
      ...extended,
      pay_model: { ...extended.pay_model, model: 'FIXED', min_lkr: null },
      today: { ...extended.today, cash_collected: 0, cash_to_keep: 0, cash_to_hand_in: 0, payable_to_rider: 342 },
    });
    const card = await screen.findByRole('region', { name: 'Your earnings' });
    expect(card).toHaveTextContent('You earn LKR 80 per delivery');
    expect(card).not.toHaveTextContent(/min LKR/);
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent(
      'Hand in LKR 0, keep LKR 0Blynk owes you LKR 342',
    );
  });

  it('a percent model with a floor reads "80% of each delivery charge · min LKR 70"', async () => {
    show({ ...extended, pay_model: { ...extended.pay_model, model: 'PERCENT', min_lkr: 70 } });
    const card = await screen.findByRole('region', { name: 'Your earnings' });
    expect(card).toHaveTextContent('You earn 80% of each delivery charge · min LKR 70');
  });

  it('shows the rain boost banner with its end time and the peak chip while they run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00+05:30'));
    show({
      ...extended,
      boosts: {
        applies: true,
        rain: { active: true, mode: 'FIXED', amount: 30, until: '2026-10-10T18:30:00+05:30' },
        peak: { active_now: true, mode: 'FIXED', amount: 20 },
      },
    });
    const boosts = await screen.findByRole('region', { name: 'Boosts on now' });
    expect(boosts).toHaveTextContent('Rain boost +LKR 30 per delivery until 6:30 PM');
    expect(boosts).toHaveTextContent('Peak boost now +LKR 20 per delivery');
  });

  it('a percent rain boost without an end time reads "+10% per delivery"', async () => {
    show({
      ...extended,
      boosts: { ...noBoosts, rain: { active: true, mode: 'PERCENT', amount: 10, until: null } },
    });
    const boosts = await screen.findByRole('region', { name: 'Boosts on now' });
    expect(boosts).toHaveTextContent('Rain boost +10% per delivery');
    expect(boosts).not.toHaveTextContent(/until|Peak boost/);
  });

  it('hides the boost banner when no boost runs, or when boosts do not apply to the rider', async () => {
    const { api } = show(extended);
    await screen.findByRole('region', { name: 'Your earnings' });
    expect(screen.queryByRole('region', { name: 'Boosts on now' })).not.toBeInTheDocument();
    expect(api.find('GET', '/riders/me/earnings')).toHaveLength(1);
  });

  it('a rain boost that does not apply to this rider stays hidden', async () => {
    show({
      ...extended,
      boosts: {
        applies: false,
        rain: { active: true, mode: 'FIXED', amount: 30, until: null },
        peak: { active_now: true, mode: 'FIXED', amount: 30 },
      },
    });
    await screen.findByRole('region', { name: 'Your earnings' });
    expect(screen.queryByRole('region', { name: 'Boosts on now' })).not.toBeInTheDocument();
    // (Today's breakdown still lists the peak bonuses already earned.)
    expect(document.body.textContent).not.toMatch(/Rain boost|Peak boost now|\+LKR 30 per delivery/);
  });

  it('a company rider with a deduction sees it with its reason but still no earnings', async () => {
    show({
      ...company,
      today: {
        ...company.today,
        deductions: 200,
        adjustments: -200,
        cash_to_hand_in: 1615,
        adjustment_lines: [{ id: 'd1', amount_lkr: -200, reason: 'DAMAGED_ITEM', note: 'Broken eggs' }],
      },
      week: { ...company.week, deductions: 200, adjustments: -200 },
    });
    const card = await screen.findByRole('region', { name: 'Bonuses and adjustments' });
    expect(card).toHaveTextContent('Today−LKR 200');
    const rows = Array.from(within(card).getByLabelText('Today line by line').querySelectorAll('.earn__row')).map(
      (r) => r.textContent,
    );
    expect(rows).toEqual(['Damaged item · Broken eggs−LKR 200', 'Total−LKR 200']);
    expect(card).toHaveTextContent('This week−LKR 200');
    expect(screen.queryByRole('region', { name: 'Your earnings' })).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent(/earned|Deliveries|You earn/);

    // Today's extras change what they hand in; nothing to keep, so no "keep".
    const today = screen.getByRole('region', { name: 'Today' });
    expect(today).toHaveTextContent('Hand in LKR 1,615');
    expect(today).not.toHaveTextContent(/keep/);
  });

  it('a company rider with nothing extra keeps the deliveries-only view', async () => {
    const { api } = show(company);
    await screen.findByRole('region', { name: 'Today' });
    await waitFor(() => expect(api.find('GET', '/riders/me/earnings')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('region', { name: 'Bonuses and adjustments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your earnings' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/earn|keep|Hand in|boost/i);
  });

  it('an older API without the new fields still renders the 2026-10-09 card', async () => {
    show(oldCommission);
    const card = await screen.findByRole('region', { name: 'Your earnings' });
    expect(card).toHaveTextContent('TodayLKR 192 earned · 2 deliveries');
    expect(card).toHaveTextContent('This weekLKR 864 · 9 deliveries');
    expect(card).toHaveTextContent('You earn 80% of each delivery charge');
    expect(within(card).queryByLabelText('Today line by line')).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent(/incl\./);
    expect(screen.queryByRole('region', { name: 'Boosts on now' })).not.toBeInTheDocument();
    const today = screen.getByRole('region', { name: 'Today' });
    expect(today).toHaveTextContent('Hand in LKR 1,223, keep LKR 192');
    expect(today).not.toHaveTextContent(/Blynk owes you/);
  });
});

describe('formatUntil (owner, 2026-10-10)', () => {
  const now = new Date('2026-10-10T10:00:00+05:30');
  it('is the clock time today, "tomorrow ..." the next day, and null for a bad date', () => {
    expect(formatUntil('2026-10-10T18:30:00+05:30', now)).toBe('6:30 PM');
    expect(formatUntil('2026-10-10T12:00:00+05:30', now)).toBe('12:00 PM');
    expect(formatUntil('2026-10-11T06:05:00+05:30', now)).toBe('tomorrow 6:05 AM');
    expect(formatUntil('not a date', now)).toBeNull();
  });
});
