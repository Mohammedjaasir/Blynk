import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { RiderEarnings, earningsTypeLabel } from '../pages/RiderEarnings';
import { Settings } from '../pages/Settings';
import { Cash, owesText, payExtrasText } from '../pages/Cash';
import { tokenStore } from '../api/client';
import type {
  CashReconciliation,
  RiderAdjustment,
  RiderEarningsReport,
  RiderEarningsRow,
  RiderOption,
  RiderPaySettings,
} from '../api/types';
import { longDay } from '../components/DatePicker';
import { colomboDate } from '../lib/coupons';
import { describePay, modelDraftToInput, parseClock, payDraftToInput, payLabel, signedAdjustment, windowText } from '../lib/riderPay';
import { mockApi, ok } from './mockApi';

/**
 * Rider pay controls (owner, 2026-10-10: "give the option in ops and admin to
 * control the rider app charges"): Settings -> Rider pay (default model,
 * bonus rules, rain boost), a rider's own model, Adjust pay, the new
 * earnings figures and the cash page's day extras. The money rules are tested
 * against PostgreSQL in the backend; here, what the pages send and show.
 */

const renderPage = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function paySettings(overrides: Partial<RiderPaySettings> = {}): RiderPaySettings {
  return {
    default_model: { model: 'PERCENT', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: null },
    bonus_rules: {
      company_riders: false,
      peak: { enabled: false, mode: 'FIXED', amount: 30, windows: [] },
      daily_target: { enabled: false, tiers: [] },
      long_distance: { enabled: false, over_km: 5, amount_lkr: 50 },
    },
    rain_boost: { on: false, mode: 'FIXED', amount: 30, auto_off_at: null, turned_on_at: null, active: false },
    ...overrides,
  };
}

/** A stateful fake of the rider-pay settings endpoints. */
function settingsApi(initial = paySettings()) {
  let state = initial;
  return mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/settings/rider-pay') return ok(state);
    if (c.method === 'PATCH' && c.path === '/admin/settings/rider-pay/model') {
      const { model, ...rest } = c.body;
      state = { ...state, default_model: { ...state.default_model, model, ...rest } };
      return ok(state);
    }
    if (c.method === 'PATCH' && c.path === '/admin/settings/rider-pay/bonuses') {
      state = { ...state, bonus_rules: { ...state.bonus_rules, ...c.body } };
      return ok(state);
    }
    if (c.method === 'PATCH' && c.path === '/admin/settings/rider-pay/rain-boost') {
      const b = c.body;
      state = {
        ...state,
        rain_boost: {
          on: b.on,
          mode: b.mode ?? state.rain_boost.mode,
          amount: b.amount ?? state.rain_boost.amount,
          auto_off_at: b.on ? (b.auto_off_at === undefined ? state.rain_boost.auto_off_at : b.auto_off_at) : null,
          turned_on_at: b.on ? '2026-10-10T10:00:00.000Z' : null,
          active: b.on,
        },
      };
      return ok(state);
    }
    return undefined;
  });
}

describe('rider pay control helpers', () => {
  it('builds the pay bodies for each model', () => {
    const base = { payType: 'COMMISSION' as const, percent: '80', fixed: '90', base: '50', perKm: '20', min: '' };
    expect(payDraftToInput({ ...base, model: 'DEFAULT' })).toEqual({ input: { pay_type: 'COMMISSION', pay_model: null, commission_percent: null } });
    expect(payDraftToInput({ ...base, model: 'FIXED', min: '100' })).toEqual({
      input: { pay_type: 'COMMISSION', pay_model: 'FIXED', fixed_lkr: 90, min_lkr: 100 },
    });
    expect(payDraftToInput({ ...base, model: 'DISTANCE' })).toEqual({
      input: { pay_type: 'COMMISSION', pay_model: 'DISTANCE', base_lkr: 50, per_km_lkr: 20, min_lkr: null },
    });
    expect(payDraftToInput({ ...base, model: 'DISTANCE', perKm: '1500' })).toHaveProperty('errors.perKm');
    expect(payDraftToInput({ ...base, payType: 'COMPANY', model: 'FIXED' })).toEqual({ input: { pay_type: 'COMPANY', commission_percent: null } });
    expect(modelDraftToInput({ model: 'FIXED', percent: '80', fixed: '95', base: '', perKm: '', min: '' })).toEqual({
      input: { model: 'FIXED', fixed_lkr: 95, min_lkr: null },
    });
  });

  it('words pay models, windows and signed adjustments', () => {
    expect(describePay({ model: 'DISTANCE', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: 120 })).toBe(
      'LKR 50 + LKR 20/km · min LKR 120'
    );
    expect(payLabel('COMMISSION', null, 80, 'FIXED')).toBe('Commission · Fixed');
    expect(earningsTypeLabel({ pay_type: 'COMMISSION', effective_percent: 80, commission_percent: null, pay_model: 'DISTANCE' })).toBe(
      'Commission · Distance'
    );
    expect(parseClock('7:30')).toBe('07:30');
    expect(parseClock('24:00')).toBe('24:00');
    expect(parseClock('25:00')).toBeNull();
    expect(windowText({ days: [1, 2, 3, 4, 5], start: '17:00', end: '20:00' })).toBe('Mon–Fri 17:00–20:00');
    expect(signedAdjustment('DEDUCTION', '200')).toEqual({ value: -200 });
    expect(signedAdjustment('EXTRA', '150.5')).toEqual({ value: 150.5 });
    expect(signedAdjustment('EXTRA', '0')).toHaveProperty('error');
  });
});

describe('Settings - Rider pay (owner, 2026-10-10)', () => {
  it('loads the store default pay and saves the model with its own PATCH', async () => {
    const user = userEvent.setup();
    const api = settingsApi();
    renderPage(<Settings />);

    const panel = await screen.findByRole('region', { name: 'Rider pay' });
    // One % control: the old Rider commission card is not shown with the new API.
    expect(screen.queryByRole('region', { name: 'Rider commission' })).toBeNull();
    expect(panel).toHaveTextContent('Each daily target pays once');
    expect(panel).toHaveTextContent("Bonuses and adjustments are kept from that day's cash");
    const form = within(panel).getByRole('form', { name: 'Store default pay' });
    expect(form).toHaveTextContent('Now 80% of delivery fee');
    expect(within(form).getByLabelText(/Default commission \(%\)/)).toHaveValue('80');

    await user.click(within(form).getByRole('button', { name: 'Fixed per delivery' }));
    const fixed = within(form).getByLabelText(/LKR per delivery/);
    expect(fixed).toHaveValue('80');
    await user.clear(fixed);
    await user.type(fixed, '95');
    await user.type(within(form).getByLabelText(/Minimum per delivery/), '120');
    await user.click(within(form).getByRole('button', { name: 'Save default pay' }));

    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/rider-pay/model')[0]?.body).toEqual({ model: 'FIXED', fixed_lkr: 95, min_lkr: 120 })
    );
    expect(await within(form).findByText('Now LKR 95 per delivery · min LKR 120')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')).toHaveLength(0);

    // A % default sends only the % (and the floor).
    await user.click(within(form).getByRole('button', { name: '% of delivery fee' }));
    const pct = within(form).getByLabelText(/Default commission/);
    await user.clear(pct);
    await user.type(pct, '72.5');
    await user.clear(within(form).getByLabelText(/Minimum per delivery/));
    await user.click(within(form).getByRole('button', { name: 'Save default pay' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/rider-pay/model')[1]?.body).toEqual({ model: 'PERCENT', percent: 72.5, min_lkr: null })
    );
  });

  it('saves each bonus section on its own (company riders, peak, daily target, long distance)', async () => {
    const user = userEvent.setup();
    const api = settingsApi();
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Rider pay' });
    const bodies = () => api.find('PATCH', '/admin/settings/rider-pay/bonuses').map((c) => c.body);

    // Company riders switch saves at once.
    await user.click(within(panel).getByRole('switch', { name: 'Company riders get bonuses too' }));
    await waitFor(() => expect(bodies()).toEqual([{ company_riders: true }]));
    expect(within(panel).getByRole('switch', { name: 'Company riders get bonuses too' })).toHaveAttribute('aria-checked', 'true');

    // Peak boost: a window with weekday chips and start/end.
    const peak = within(panel).getByRole('form', { name: 'Peak boost' });
    await user.click(within(peak).getByRole('switch', { name: 'Peak boost on' }));
    await user.click(within(peak).getByRole('button', { name: 'Save peak boost' }));
    expect(within(peak).getByText('Add at least one time window.')).toBeInTheDocument();
    await user.click(within(peak).getByRole('button', { name: '+ Add time window' }));
    const win = within(peak).getByRole('group', { name: 'Peak window 1' });
    expect(within(win).getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(win).getByRole('button', { name: 'Saturday' }));
    const ends = within(win).getByLabelText('Ends');
    await user.clear(ends);
    await user.type(ends, '16:00');
    await user.click(within(peak).getByRole('button', { name: 'Save peak boost' }));
    expect(within(win).getByText('The window must end after it starts.')).toBeInTheDocument();
    expect(bodies()).toHaveLength(1);
    await user.clear(ends);
    await user.type(ends, '21:30');
    await user.click(within(peak).getByRole('button', { name: '+% of base pay' }));
    const peakAmount = within(peak).getByLabelText('Peak boost (%)');
    await user.clear(peakAmount);
    await user.type(peakAmount, '15');
    await user.click(within(peak).getByRole('button', { name: 'Save peak boost' }));
    await waitFor(() =>
      expect(bodies()[1]).toEqual({
        peak: { enabled: true, mode: 'PERCENT', amount: 15, windows: [{ days: [1, 2, 3, 4, 5, 6], start: '17:00', end: '21:30' }] },
      })
    );

    // Daily target: tiers go out sorted by deliveries.
    const daily = within(panel).getByRole('form', { name: 'Daily target' });
    await user.click(within(daily).getByRole('switch', { name: 'Daily target on' }));
    await user.click(within(daily).getByRole('button', { name: '+ Add target' }));
    await user.click(within(daily).getByRole('button', { name: '+ Add target' }));
    const t1 = within(daily).getByRole('group', { name: 'Target 1' });
    const t2 = within(daily).getByRole('group', { name: 'Target 2' });
    await user.type(within(t1).getByLabelText('Deliveries'), '10');
    await user.type(within(t1).getByLabelText('Bonus (LKR)'), '200');
    await user.type(within(t2).getByLabelText('Deliveries'), '10');
    await user.type(within(t2).getByLabelText('Bonus (LKR)'), '100');
    await user.click(within(daily).getByRole('button', { name: 'Save daily target' }));
    expect(within(daily).getByText('Two targets have the same number of deliveries.')).toBeInTheDocument();
    await user.clear(within(t2).getByLabelText('Deliveries'));
    await user.type(within(t2).getByLabelText('Deliveries'), '5');
    await user.click(within(daily).getByRole('button', { name: 'Save daily target' }));
    await waitFor(() =>
      expect(bodies()[2]).toEqual({
        daily_target: {
          enabled: true,
          tiers: [
            { deliveries: 5, amount_lkr: 100 },
            { deliveries: 10, amount_lkr: 200 },
          ],
        },
      })
    );

    // Long distance.
    const long = within(panel).getByRole('form', { name: 'Long distance' });
    await user.click(within(long).getByRole('switch', { name: 'Long distance bonus on' }));
    const km = within(long).getByLabelText(/Over \(km\)/);
    await user.clear(km);
    await user.type(km, '7.5');
    const bonus = within(long).getByLabelText(/Bonus \(LKR\)/);
    await user.clear(bonus);
    await user.type(bonus, '60');
    await user.click(within(long).getByRole('button', { name: 'Save long distance' }));
    await waitFor(() => expect(bodies()[3]).toEqual({ long_distance: { enabled: true, over_km: 7.5, amount_lkr: 60 } }));
    expect(bodies()).toHaveLength(4);
    expect(api.find('PATCH', '/admin/settings/rider-pay/model')).toHaveLength(0);
  });

  it('turns the rain boost on with an auto-off, updates it, and turns it off', async () => {
    const user = userEvent.setup();
    const api = settingsApi();
    renderPage(<Settings />);
    const panel = await screen.findByRole('region', { name: 'Rider pay' });
    const rain = within(panel).getByRole('group', { name: 'Rain boost' });
    const sw = within(rain).getByRole('switch', { name: 'Rain boost' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(within(rain).getByTestId('rain-status')).toHaveTextContent('Off');
    expect(within(rain).getByRole('button', { name: 'After 2 h' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(rain).getByRole('button', { name: 'After 1 h' }));
    const before = Date.now();
    await user.click(sw);
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')).toHaveLength(1));
    const on = api.find('PATCH', '/admin/settings/rider-pay/rain-boost')[0].body;
    expect(on).toMatchObject({ on: true, mode: 'FIXED', amount: 30 });
    const offAt = Date.parse(on.auto_off_at);
    expect(offAt - before).toBeGreaterThanOrEqual(3_600_000 - 1000);
    expect(offAt - Date.now()).toBeLessThanOrEqual(3_600_000 + 1000);
    await waitFor(() => expect(within(rain).getByRole('switch', { name: 'Rain boost' })).toHaveAttribute('aria-checked', 'true'));
    expect(within(rain).getByTestId('rain-status')).toHaveTextContent(/On: \+LKR 30 per delivery, until/);

    // Change to +10% until turned off.
    await user.click(within(rain).getByRole('button', { name: '+% of base pay' }));
    const amount = within(rain).getByLabelText('Rain boost (%)');
    await user.clear(amount);
    await user.type(amount, '10');
    await user.click(within(rain).getByRole('button', { name: 'Until turned off' }));
    await user.click(within(rain).getByRole('button', { name: 'Update rain boost' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')[1]?.body).toEqual({ on: true, mode: 'PERCENT', amount: 10, auto_off_at: null })
    );
    expect(await within(rain).findByText('On: +10% per delivery, until turned off')).toBeInTheDocument();

    await user.click(within(rain).getByRole('switch', { name: 'Rain boost' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')[2]?.body).toEqual({ on: false }));
    await waitFor(() => expect(within(rain).getByTestId('rain-status')).toHaveTextContent('Off'));
  });
});

// ------------------------------------------------------------- earnings

const zero = {
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

function row(overrides: Partial<RiderEarningsRow> = {}): RiderEarningsRow {
  return {
    ...zero,
    rider_id: 'r1',
    rider_name: 'Kamal',
    rider_phone: '+94779876543',
    pay_type: 'COMMISSION',
    commission_percent: null,
    effective_percent: 80,
    pay_model: 'FIXED',
    deliveries: 4,
    delivery_charges: 400,
    customer_delivery_fees: 400,
    rider_share: 380,
    blynk_delivery_share: 20,
    cash_collected: 2600,
    cash_kept: 480,
    cash_to_hand_in: 2120,
    product_margin: 510,
    base_earnings: 320,
    delivery_bonuses: 60,
    day_bonuses: 100,
    additions: 50,
    deductions: 200,
    adjustments: -150,
    total_earnings: 330,
    bonus_breakdown: { PEAK_BOOST: 40, RAIN_BOOST: 20, LONG_DISTANCE: 0, DAILY_TARGET: 100 },
    payable_to_rider: 75,
    ...overrides,
  };
}

const today = colomboDate();

function adjustment(overrides: Partial<RiderAdjustment> = {}): RiderAdjustment {
  return {
    id: 'a1',
    rider_id: 'r1',
    rider_name: 'Kamal',
    amount_lkr: -200,
    reason: 'LATE',
    note: 'Late twice',
    adjustment_date: today,
    created_by_user_id: 'u1',
    created_by_name: 'Admin Silva',
    created_at: `${today}T05:00:00.000Z`,
    updated_at: `${today}T05:00:00.000Z`,
    ...overrides,
  };
}

function report(overrides: Partial<RiderEarningsReport> = {}): RiderEarningsReport {
  const r = row();
  const { rider_id: _id, rider_name: _n, rider_phone: _p, pay_type: _t, commission_percent: _c, effective_percent: _e, pay_model: _m, ...figures } = r;
  return {
    range: { from: today, to: today, timezone: 'Asia/Colombo' },
    default_percent: 80,
    default_model: { model: 'PERCENT', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: null },
    riders: [r],
    totals: figures,
    adjustments: [adjustment()],
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
  pay_type: 'COMMISSION',
  commission_percent: null,
  pay_model: 'FIXED',
  ...overrides,
});

function earningsApi(extra: (c: { method: string; path: string; body: any }) => ReturnType<typeof ok> | undefined = () => undefined) {
  return mockApi((c) => {
    const more = extra(c);
    if (more) return more;
    if (c.path === '/admin/reports/rider-earnings') return ok(report());
    if (c.path === '/admin/riders') return ok({ riders: [rider()] });
    if (c.path === '/admin/settings/rider-pay') return ok(paySettings());
    return undefined;
  });
}

describe('Rider earnings - pay controls (owner, 2026-10-10)', () => {
  it('shows base, bonuses with their breakdown, adjustments, total earnings and payable to rider', async () => {
    earningsApi();
    renderPage(<RiderEarnings />);

    const totals = await screen.findByLabelText('Rider earnings totals');
    expect(totals).toHaveTextContent('LKR 320Base pay');
    expect(totals).toHaveTextContent('LKR 160Bonuses');
    expect(totals).toHaveTextContent('−LKR 150Adjustments');
    expect(totals).toHaveTextContent('LKR 330Total earnings');
    expect(totals).toHaveTextContent('LKR 75Payable to riders');
    expect(screen.getByTestId('bonus-breakdown')).toHaveTextContent('Peak boost LKR 40 · Rain boost LKR 20 · Daily target LKR 100');

    const table = screen.getByRole('table', { name: 'Earnings by rider' });
    const r1 = within(table).getAllByRole('row')[1];
    expect(r1).toHaveTextContent('Commission · Fixed');
    expect(r1).toHaveTextContent('LKR 160');
    expect(r1).toHaveTextContent('Peak boost LKR 40');
    expect(r1).toHaveTextContent('−LKR 150');
    expect(r1).toHaveTextContent('+LKR 50 extra, −LKR 200 deducted');
    expect(r1).toHaveTextContent('LKR 330');
    expect(r1).toHaveTextContent('LKR 75');

    const list = screen.getByRole('region', { name: 'Pay adjustments' });
    expect(list).toHaveTextContent('Kamal');
    expect(list).toHaveTextContent('−LKR 200');
    expect(list).toHaveTextContent('Late – Late twice');
    expect(list).toHaveTextContent('by Admin Silva');
  });

  it('Adjust pay posts a negative amount for a deduction, positive for extra pay', async () => {
    const user = userEvent.setup();
    const api = earningsApi((c) =>
      c.method === 'POST' && c.path === '/admin/riders/r1/adjustments'
        ? { status: 201, data: { adjustment: adjustment({ id: 'a2', amount_lkr: c.body.amount_lkr, reason: c.body.reason, note: c.body.note ?? null }) } }
        : undefined
    );
    renderPage(<RiderEarnings />);
    const table = await screen.findByRole('table', { name: 'Earnings by rider' });

    await user.click(within(table).getByRole('button', { name: 'Adjust pay for Kamal' }));
    let dialog = screen.getByRole('dialog', { name: 'Adjust pay' });
    expect(within(dialog).getByRole('button', { name: 'Deduction' })).toHaveAttribute('aria-pressed', 'true');
    // The styled date picker, today by default.
    expect(within(dialog).getByRole('button', { name: `Day: ${longDay(today)}` })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Amount \(LKR\)/), '200');
    await user.click(within(dialog).getByRole('button', { name: 'Add deduction' }));
    expect(within(dialog).getByText('Pick a reason.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/riders/r1/adjustments')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cash short' }));
    await user.type(within(dialog).getByLabelText(/Note/), 'Short at drop-off');
    const reportsBefore = api.find('GET', '/admin/reports/rider-earnings').length;
    await user.click(within(dialog).getByRole('button', { name: 'Add deduction' }));

    await waitFor(() =>
      expect(api.find('POST', '/admin/riders/r1/adjustments')[0]?.body).toEqual({
        amount_lkr: -200,
        reason: 'CASH_SHORT',
        note: 'Short at drop-off',
        adjustment_date: today,
      })
    );
    expect(await screen.findByText(/Deduction of LKR 200 for Kamal/)).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/admin/reports/rider-earnings').length).toBeGreaterThan(reportsBefore));

    // Extra pay from the Rider pay table.
    const payTable = await screen.findByRole('table', { name: 'Rider pay' });
    await user.click(within(payTable).getByRole('button', { name: 'Adjust pay for Kamal' }));
    dialog = screen.getByRole('dialog', { name: 'Adjust pay' });
    await user.click(within(dialog).getByRole('button', { name: 'Extra pay' }));
    await user.type(within(dialog).getByLabelText(/Amount \(LKR\)/), '150');
    await user.click(within(dialog).getByRole('button', { name: 'Bonus' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add extra pay' }));
    await waitFor(() =>
      expect(api.find('POST', '/admin/riders/r1/adjustments')[1]?.body).toEqual({ amount_lkr: 150, reason: 'BONUS', adjustment_date: today })
    );
  });

  it('edits and deletes (after confirming) an adjustment in the list', async () => {
    const user = userEvent.setup();
    const api = earningsApi((c) => {
      if (c.method === 'PATCH' && c.path === '/admin/rider-adjustments/a1') return ok({ adjustment: adjustment({ amount_lkr: c.body.amount_lkr }) });
      if (c.method === 'DELETE' && c.path === '/admin/rider-adjustments/a1') return ok({ deleted: true });
      return undefined;
    });
    renderPage(<RiderEarnings />);
    const list = await screen.findByRole('region', { name: 'Pay adjustments' });

    await user.click(within(list).getByRole('button', { name: 'Edit Late −LKR 200 for Kamal' }));
    const dialog = screen.getByRole('dialog', { name: 'Adjust pay' });
    expect(within(dialog).getByRole('heading', { name: 'Edit adjustment for Kamal' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Late' })).toHaveAttribute('aria-pressed', 'true');
    const amount = within(dialog).getByLabelText(/Amount \(LKR\)/);
    expect(amount).toHaveValue('200');
    await user.clear(amount);
    await user.type(amount, '250');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/rider-adjustments/a1')[0]?.body).toEqual({
        amount_lkr: -250,
        reason: 'LATE',
        note: 'Late twice',
        adjustment_date: today,
      })
    );

    const again = await screen.findByRole('region', { name: 'Pay adjustments' });
    await user.click(within(again).getByRole('button', { name: 'Delete Late −LKR 200 for Kamal' }));
    expect(api.find('DELETE', '/admin/rider-adjustments/a1')).toHaveLength(0);
    const confirm = screen.getByRole('dialog', { name: 'Delete this adjustment?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/rider-adjustments/a1')).toHaveLength(1));
  });

  it("changes a rider's own pay to fixed, then to distance, with the minimum", async () => {
    const user = userEvent.setup();
    const pay = {
      rider_id: 'r1',
      pay_type: 'COMMISSION',
      commission_percent: null,
      effective_percent: 80,
      default_percent: 80,
      pay_model: 'FIXED',
      own: { fixed_lkr: 120, base_lkr: null, per_km_lkr: null, min_lkr: 100 },
      effective: { model: 'FIXED', percent: 80, fixed_lkr: 120, base_lkr: 50, per_km_lkr: 20, min_lkr: 100 },
      default_model: paySettings().default_model,
    };
    const api = earningsApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/riders/r1/pay') return ok({ pay });
      if (c.method === 'PATCH' && c.path === '/admin/riders/r1/pay') {
        return ok({ pay: { ...pay, pay_model: c.body.pay_model, commission_percent: c.body.commission_percent ?? null } });
      }
      return undefined;
    });
    renderPage(<RiderEarnings />);
    const payTable = await screen.findByRole('table', { name: 'Rider pay' });
    expect(within(payTable).getAllByRole('row')[1]).toHaveTextContent('Commission · Fixed');

    await user.click(within(payTable).getByRole('button', { name: 'Change pay for Kamal' }));
    let dialog = screen.getByRole('dialog', { name: 'Change rider pay' });
    expect(within(dialog).getByRole('button', { name: 'Fixed' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(within(dialog).getByLabelText(/LKR per delivery/)).toHaveValue('120'));
    expect(within(dialog).getByLabelText(/Minimum per delivery/)).toHaveValue('100');
    const fixed = within(dialog).getByLabelText(/LKR per delivery/);
    await user.clear(fixed);
    await user.type(fixed, '130');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/riders/r1/pay')[0]?.body).toEqual({ pay_type: 'COMMISSION', pay_model: 'FIXED', fixed_lkr: 130, min_lkr: 100 })
    );
    expect(await screen.findByText('Kamal is now Commission · Fixed.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('table', { name: 'Rider pay' })).getByRole('button', { name: 'Change pay for Kamal' }));
    dialog = screen.getByRole('dialog', { name: 'Change rider pay' });
    await waitFor(() => expect(within(dialog).getByLabelText(/LKR per delivery/)).toHaveValue('120'));
    await user.click(within(dialog).getByRole('button', { name: 'Distance' }));
    expect(within(dialog).getByLabelText(/Base LKR per delivery/)).toHaveValue('50');
    const perKm = within(dialog).getByLabelText(/LKR per km/);
    await user.clear(perKm);
    await user.type(perKm, '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/riders/r1/pay')[1]?.body).toEqual({
        pay_type: 'COMMISSION',
        pay_model: 'DISTANCE',
        base_lkr: 50,
        per_km_lkr: 30,
        min_lkr: 100,
      })
    );
  });
});

describe('Rider cash - day bonuses, adjustments and what Blynk owes (owner, 2026-10-10)', () => {
  it('words the extras', () => {
    expect(payExtrasText({ day_bonuses: 100, adjustments: -200 })).toBe('Day bonus LKR 100 · Deduction LKR 200');
    expect(payExtrasText({ adjustments: 50 })).toBe('Extra pay LKR 50');
    expect(payExtrasText({})).toBeNull();
    expect(owesText({ payable_to_rider: 300 })).toBe('Blynk owes rider LKR 300');
    expect(owesText({ payable_to_rider: 0 })).toBeNull();
  });

  it('shows day bonuses, adjustments and "Blynk owes rider" where non-zero', async () => {
    const recon: CashReconciliation = {
      date: today,
      timezone: 'Asia/Colombo',
      riders: [
        {
          rider_id: 'r1', rider_name: 'Kamal', rider_phone: null, deliveries: 2, handins: 0, collected: 300, handed_in: 0,
          difference: 0, status: 'BALANCED', pay_type: 'COMMISSION', kept_share: 160, expected_handin: 0,
          day_bonuses: 200, adjustments: 40, payable_to_rider: 100,
        },
        {
          rider_id: 'r2', rider_name: 'Nimal', rider_phone: null, deliveries: 1, handins: 0, collected: 900, handed_in: 0,
          difference: -1100, status: 'SHORT', pay_type: 'COMPANY', kept_share: 0, expected_handin: 1100,
          day_bonuses: 0, adjustments: -200, payable_to_rider: 0,
        },
        {
          rider_id: 'r3', rider_name: 'Sunil', rider_phone: null, deliveries: 1, handins: 0, collected: 500, handed_in: 500,
          difference: 0, status: 'BALANCED', pay_type: 'COMPANY', kept_share: 0, expected_handin: 500,
          day_bonuses: 0, adjustments: 0, payable_to_rider: 0,
        },
      ],
      totals: { collected: 1700, handed_in: 500, difference: -1100, status: 'SHORT', kept_share: 160, expected_handin: 1600, day_bonuses: 200, adjustments: -160, payable_to_rider: 100 },
    };
    mockApi((c) => {
      if (c.path === '/admin/cash/reconciliation') return ok(recon);
      if (c.path === '/admin/cash/handins') return ok({ handins: [] });
      return undefined;
    });
    renderPage(<Cash />);
    const table = await screen.findByRole('table', { name: 'Cash by rider' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Day bonus LKR 200 · Extra pay LKR 40');
    expect(within(rows[1]).getByText('Blynk owes rider LKR 100')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Hand in LKR 1,100');
    expect(rows[2]).toHaveTextContent('Deduction LKR 200');
    expect(rows[2]).not.toHaveTextContent('owes');
    expect(rows[3]).not.toHaveTextContent('Day bonus');
    expect(rows[3]).not.toHaveTextContent('Hand in');
    expect(rows[4]).toHaveTextContent('Blynk owes rider LKR 100');
  });
});
