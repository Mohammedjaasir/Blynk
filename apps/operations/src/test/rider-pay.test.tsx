import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { MyEarnings, RiderAdjustment, RiderEarningsReport, RiderPaySettings } from '../api/types';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { colomboToday } from '../pages/Cash';
import { ADMIN_NO_RIDER, OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Rider pay controls (owner, 2026-10-10: "give the option in ops and admin to
 * control the rider app charges"): the More -> Rider pay page (store default
 * model, bonuses, rain boost), pay models in Change pay / Approve, "Adjust
 * pay" and the new figures on Rider earnings, Cash and My day. The money
 * rules themselves are tested in the backend.
 */

beforeEach(() => {
  __resetTrackerSessionForTests();
});

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function baseSettings(): RiderPaySettings {
  return {
    default_model: { model: 'PERCENT', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: null },
    bonus_rules: {
      company_riders: false,
      peak: { enabled: false, mode: 'FIXED', amount: 30, windows: [] },
      daily_target: { enabled: false, tiers: [] },
      long_distance: { enabled: false, over_km: 5, amount_lkr: 50 },
    },
    rain_boost: { on: false, mode: 'FIXED', amount: 30, auto_off_at: null, turned_on_at: null, active: false },
  };
}

/** A fake rider-pay settings store: every PATCH merges and returns the whole object, like the API. */
function settingsHandlers(start = baseSettings()) {
  let s = start;
  return {
    'GET /admin/settings/rider-pay': () => ok(s),
    'PATCH /admin/settings/rider-pay/model': (call: { body: any }) => {
      s = { ...s, default_model: { ...s.default_model, ...call.body } };
      return ok(s);
    },
    'PATCH /admin/settings/rider-pay/bonuses': (call: { body: any }) => {
      s = { ...s, bonus_rules: { ...s.bonus_rules, ...call.body } };
      return ok(s);
    },
    'PATCH /admin/settings/rider-pay/rain-boost': (call: { body: any }) => {
      const b = call.body;
      s = {
        ...s,
        rain_boost: b.on
          ? {
              on: true,
              mode: b.mode ?? s.rain_boost.mode,
              amount: b.amount ?? s.rain_boost.amount,
              auto_off_at: b.auto_off_at ?? null,
              turned_on_at: new Date().toISOString(),
              active: true,
            }
          : { ...s.rain_boost, on: false, auto_off_at: null, active: false },
      };
      return ok(s);
    },
  };
}

const card = async (name: string) => (await screen.findByRole('heading', { name })).closest('section') as HTMLElement;

describe('Rider pay page (More -> Rider pay)', () => {
  it('is reachable from More and saves the store default model (FIXED with a minimum, then DISTANCE)', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', settingsHandlers());
    await user.click(await screen.findByRole('link', { name: 'Rider pay' }));
    expect(await screen.findByRole('heading', { name: 'Rider pay' })).toBeInTheDocument();
    expect(screen.getByText(/Each daily target pays once/)).toBeInTheDocument();
    expect(screen.getByText(/Anything the cash cannot cover is owed to the rider/)).toBeInTheDocument();

    const model = await card('Store default pay');
    expect(within(model).getByText(/Now: 80% of the delivery fee/)).toBeInTheDocument();
    const models = within(model).getByRole('group', { name: 'Pay model' });
    expect(within(models).getByRole('button', { name: '% of delivery fee' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(models).getByRole('button', { name: 'Fixed per delivery' }));
    const fixed = within(model).getByLabelText('LKR per delivery');
    expect(fixed).toHaveValue('80');
    await user.clear(fixed);
    await user.type(fixed, '120');
    await user.type(within(model).getByLabelText(/Minimum per delivery/), '100');
    await user.click(within(model).getByRole('button', { name: 'Save default pay' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/model')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/rider-pay/model')[0].body).toEqual({ model: 'FIXED', fixed_lkr: 120, min_lkr: 100 });
    expect(await within(model).findByText('Store default saved: LKR 120 per delivery · min LKR 100.')).toBeInTheDocument();

    await user.click(within(models).getByRole('button', { name: 'Distance' }));
    await user.clear(within(model).getByLabelText('Base LKR per delivery'));
    await user.type(within(model).getByLabelText('Base LKR per delivery'), '60');
    await user.clear(within(model).getByLabelText('LKR per km'));
    await user.type(within(model).getByLabelText('LKR per km'), '25.5');
    await user.clear(within(model).getByLabelText(/Minimum per delivery/));
    await user.click(within(model).getByRole('button', { name: 'Save default pay' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/model')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/rider-pay/model')[1].body).toEqual({
      model: 'DISTANCE',
      base_lkr: 60,
      per_km_lkr: 25.5,
      min_lkr: null,
    });
  });

  it('refuses a bad % before sending', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-pay', settingsHandlers());
    const model = await card('Store default pay');
    const input = within(model).getByLabelText('% of the delivery fee');
    await user.clear(input);
    await user.type(input, '120');
    await user.click(within(model).getByRole('button', { name: 'Save default pay' }));
    expect(await within(model).findByText('The percentage can be at most 100.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-pay/model')).toHaveLength(0);
  });

  it('rain boost: the switch turns it on with an auto-off, and off again', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-pay', settingsHandlers());
    const rain = await card('Rain boost');
    expect(within(rain).getByTestId('rain-status')).toHaveTextContent(/^Off/);
    // 2 hours is the starting auto-off choice.
    const offs = within(rain).getByRole('group', { name: 'Turns off by itself' });
    expect(within(offs).getByRole('button', { name: 'After 2 h' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(offs).getByRole('button', { name: 'After 1 h' }));
    const amount = within(rain).getByLabelText('Boost (LKR per delivery)');
    await user.clear(amount);
    await user.type(amount, '40');

    const before = Date.now();
    await user.click(within(rain).getByRole('switch', { name: 'Rain boost' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/settings/rider-pay/rain-boost')[0].body;
    expect(body).toMatchObject({ on: true, mode: 'FIXED', amount: 40 });
    const offAt = Date.parse(body.auto_off_at);
    expect(offAt).toBeGreaterThanOrEqual(before + 3_600_000 - 1000);
    expect(offAt).toBeLessThanOrEqual(Date.now() + 3_600_000 + 1000);
    expect(await within(rain).findByRole('switch', { name: 'Rain boost' })).toHaveAttribute('aria-checked', 'true');
    expect(within(rain).getByTestId('rain-status')).toHaveTextContent(/On · \+LKR 40 per delivery · turns off at/);

    await user.click(within(rain).getByRole('switch', { name: 'Rain boost' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')[1].body).toEqual({ on: false });
    expect(await within(rain).findByText('Rain boost is off.')).toBeInTheDocument();
  });

  it('rain boost: a % boost until staff turn it off sends auto_off_at null', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-pay', settingsHandlers());
    const rain = await card('Rain boost');
    await user.click(within(within(rain).getByRole('group', { name: 'Rain boost type' })).getByRole('button', { name: '+% of base pay' }));
    const amount = within(rain).getByLabelText('Boost (% of base pay)');
    await user.clear(amount);
    await user.type(amount, '15');
    await user.click(within(rain).getByRole('button', { name: 'Until I turn it off' }));
    await user.click(within(rain).getByRole('switch', { name: 'Rain boost' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/rider-pay/rain-boost')[0].body).toEqual({
      on: true,
      mode: 'PERCENT',
      amount: 15,
      auto_off_at: null,
    });
    expect(await within(rain).findByTestId('rain-status')).toHaveTextContent('On · +15% per delivery · until you turn it off');
  });

  it('company riders switch saves straight away', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-pay', settingsHandlers());
    const c = await card('Bonuses for company riders');
    await user.click(within(c).getByRole('switch', { name: 'Bonuses for company riders' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')[0].body).toEqual({ company_riders: true });
    expect(await within(c).findByText('Company riders now get bonuses too.')).toBeInTheDocument();
  });

  it('peak boost: needs a window, then saves windows with weekday chips and times', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-pay', settingsHandlers());
    const peak = await card('Peak boost');
    await user.click(within(peak).getByRole('switch', { name: 'Peak boost' }));
    await user.click(within(peak).getByRole('button', { name: 'Save peak boost' }));
    expect(await within(peak).findByText('Add at least one time window.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')).toHaveLength(0);

    await user.click(within(peak).getByRole('button', { name: 'Add time window' }));
    const days = within(peak).getByRole('group', { name: 'Window 1 days' });
    await user.click(within(days).getByRole('button', { name: 'Saturday' }));
    await user.click(within(days).getByRole('button', { name: 'Sunday' }));
    expect(within(days).getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'false');
    await user.selectOptions(within(peak).getByLabelText('Window 1 starts'), '17:30');
    await user.selectOptions(within(peak).getByLabelText('Window 1 ends'), '24:00');
    await user.click(within(within(peak).getByRole('group', { name: 'Peak boost type' })).getByRole('button', { name: '+% of base pay' }));
    const amount = within(peak).getByLabelText('Peak boost (% of base pay)');
    await user.clear(amount);
    await user.type(amount, '20');
    await user.click(within(peak).getByRole('button', { name: 'Save peak boost' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')[0].body).toEqual({
      peak: { enabled: true, mode: 'PERCENT', amount: 20, windows: [{ days: [1, 2, 3, 4, 5], start: '17:30', end: '24:00' }] },
    });
    expect(await within(peak).findByText('Peak boost saved.')).toBeInTheDocument();
  });

  it('daily target: up to 5 tiers, sent sorted; duplicates refused', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-pay', settingsHandlers());
    const target = await card('Daily target');
    await user.click(within(target).getByRole('switch', { name: 'Daily target' }));
    await user.click(within(target).getByRole('button', { name: 'Add target' }));
    await user.click(within(target).getByRole('button', { name: 'Add target' }));
    // First defaults to 10, second to 15 deliveries.
    expect(within(target).getByLabelText('Target 1: deliveries')).toHaveValue('10');
    expect(within(target).getByLabelText('Target 2: deliveries')).toHaveValue('15');
    await user.clear(within(target).getByLabelText('Target 1: deliveries'));
    await user.type(within(target).getByLabelText('Target 1: deliveries'), '15');
    await user.type(within(target).getByLabelText('Target 1: bonus (LKR)'), '500');
    await user.type(within(target).getByLabelText('Target 2: bonus (LKR)'), '300');
    await user.click(within(target).getByRole('button', { name: 'Save daily target' }));
    expect(await within(target).findByText('Two targets have the same number of deliveries.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')).toHaveLength(0);

    await user.clear(within(target).getByLabelText('Target 1: deliveries'));
    await user.type(within(target).getByLabelText('Target 1: deliveries'), '25');
    await user.click(within(target).getByRole('button', { name: 'Save daily target' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')[0].body).toEqual({
      daily_target: {
        enabled: true,
        tiers: [
          { deliveries: 15, amount_lkr: 300 },
          { deliveries: 25, amount_lkr: 500 },
        ],
      },
    });
    for (let i = 0; i < 3; i++) await user.click(within(target).getByRole('button', { name: 'Add target' }));
    expect(within(target).getByRole('button', { name: 'Add target' })).toBeDisabled();
  });

  it('long distance saves over km and the bonus', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-pay', settingsHandlers());
    const long = await card('Long distance');
    await user.click(within(long).getByRole('switch', { name: 'Long distance' }));
    await user.clear(within(long).getByLabelText('Over (km)'));
    await user.type(within(long).getByLabelText('Over (km)'), '7.5');
    await user.clear(within(long).getByLabelText('Bonus (LKR)'));
    await user.type(within(long).getByLabelText('Bonus (LKR)'), '100');
    await user.click(within(long).getByRole('button', { name: 'Save long distance' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/rider-pay/bonuses')[0].body).toEqual({
      long_distance: { enabled: true, over_km: 7.5, amount_lkr: 100 },
    });
    expect(await within(long).findByText('Long distance saved: LKR 100 over 7.5 km.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------- a rider's pay model
const RIDER = {
  id: 'r1',
  full_name: 'Farhan Mohamed',
  phone: '+94779876543',
  vehicle_type: 'MOTORCYCLE',
  vehicle_registration_number: 'WP-BCX-8842',
  open_deliveries: 0,
};
const DEFAULT_MODEL = baseSettings().default_model;

function payReply(body: any) {
  const model = body.pay_type === 'COMMISSION' ? (body.pay_model ?? null) : null;
  return ok({
    pay: {
      rider_id: 'r1',
      pay_type: body.pay_type,
      commission_percent: body.commission_percent ?? null,
      effective_percent: body.pay_type === 'COMMISSION' ? (body.commission_percent ?? 80) : null,
      default_percent: 80,
      pay_model: model,
      own: { fixed_lkr: body.fixed_lkr ?? null, base_lkr: body.base_lkr ?? null, per_km_lkr: body.per_km_lkr ?? null, min_lkr: body.min_lkr ?? null },
      effective: null,
      default_model: DEFAULT_MODEL,
    },
  });
}

describe('Change pay with pay models (Riders)', () => {
  it('puts a rider on FIXED pay with a minimum', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: [{ ...RIDER, pay_type: 'COMMISSION', commission_percent: null, pay_model: null }] }),
      ...settingsHandlers(),
      'GET /admin/riders/:id/pay': () => payReply({ pay_type: 'COMMISSION' }),
      'PATCH /admin/riders/:id/pay': (call) => payReply(call.body),
    });
    expect(await screen.findByText('Commission · 80% (default)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change pay for Farhan Mohamed' }));
    const dialog = screen.getByRole('dialog', { name: 'Rider pay' });
    const model = await within(dialog).findByRole('group', { name: 'Pay per delivery' });
    expect(within(model).getByRole('button', { name: 'Store default' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(model).getByRole('button', { name: 'Fixed' }));
    const fixed = within(dialog).getByLabelText('LKR per delivery');
    expect(fixed).toHaveValue('80'); // from the store default
    await user.clear(fixed);
    await user.type(fixed, '150');
    await user.type(within(dialog).getByLabelText(/Minimum per delivery/), '120');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/riders/r1/pay')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/riders/r1/pay')[0].body).toEqual({
      pay_type: 'COMMISSION',
      pay_model: 'FIXED',
      fixed_lkr: 150,
      min_lkr: 120,
    });
    expect(await screen.findByText('Farhan Mohamed is now Commission · Fixed per delivery.')).toBeInTheDocument();
  });

  it('puts a rider on DISTANCE pay, and back to the store default', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: [{ ...RIDER, pay_type: 'COMMISSION', commission_percent: null, pay_model: 'FIXED' }] }),
      ...settingsHandlers(),
      'GET /admin/riders/:id/pay': () => payReply({ pay_type: 'COMMISSION', pay_model: 'FIXED', fixed_lkr: 150 }),
      'PATCH /admin/riders/:id/pay': (call) => payReply(call.body),
    });
    expect(await screen.findByText('Commission · Fixed per delivery')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change pay for Farhan Mohamed' }));
    let dialog = screen.getByRole('dialog', { name: 'Rider pay' });
    let model = await within(dialog).findByRole('group', { name: 'Pay per delivery' });
    expect(within(model).getByRole('button', { name: 'Fixed' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText('LKR per delivery')).toHaveValue('150');
    await user.click(within(model).getByRole('button', { name: 'Distance' }));
    expect(within(dialog).getByLabelText('Base LKR per delivery')).toHaveValue('50');
    await user.clear(within(dialog).getByLabelText('LKR per km'));
    await user.type(within(dialog).getByLabelText('LKR per km'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/riders/r1/pay')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/riders/r1/pay')[0].body).toEqual({
      pay_type: 'COMMISSION',
      pay_model: 'DISTANCE',
      base_lkr: 50,
      per_km_lkr: 30,
      min_lkr: null,
    });

    await user.click(await screen.findByRole('button', { name: 'Change pay for Farhan Mohamed' }));
    dialog = screen.getByRole('dialog', { name: 'Rider pay' });
    model = await within(dialog).findByRole('group', { name: 'Pay per delivery' });
    await user.click(within(model).getByRole('button', { name: 'Store default' }));
    expect(within(dialog).getByTestId('pay-default-note')).toHaveTextContent('Follows the store default: 80% of the delivery fee');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/riders/r1/pay')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/riders/r1/pay')[1].body).toEqual({ pay_type: 'COMMISSION', commission_percent: null });
  });
});

describe('Approve with a pay model (Rider requests)', () => {
  it('approves a commission rider on DISTANCE pay with a minimum', async () => {
    const user = userEvent.setup();
    const application = {
      id: 'a1',
      user_id: 'u1',
      full_name: 'Sunil Silva',
      phone: '+94771234567',
      vehicle_type: 'MOTORCYCLE',
      vehicle_registration_number: 'WP-ABC-1234',
      emergency_contact_phone: null,
      approval_status: 'PENDING',
      applied_at: '2026-10-10T04:00:00Z',
      reviewed_at: null,
      reviewed_by_name: null,
      rejection_reason: null,
      documents_verified: true,
    };
    const { api } = renderAs(OPERATIONS_STAFF, '/more/rider-requests', {
      'GET /admin/rider-applications': () =>
        ok({ applications: [application], pagination: { page: 1, limit: 50, total: 1, total_pages: 1 } }),
      ...settingsHandlers(),
      'POST /admin/rider-applications/:id/approve': () => ok({ application: { ...application, approval_status: 'APPROVED' } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve this rider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Commission' }));
    await user.click(within(within(dialog).getByRole('group', { name: 'Pay per delivery' })).getByRole('button', { name: 'Distance' }));
    await user.clear(within(dialog).getByLabelText('Base LKR per delivery'));
    await user.type(within(dialog).getByLabelText('Base LKR per delivery'), '40');
    await user.clear(within(dialog).getByLabelText('LKR per km'));
    await user.type(within(dialog).getByLabelText('LKR per km'), '22.5');
    await user.type(within(dialog).getByLabelText(/Minimum per delivery/), '90');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.find('POST', '/admin/rider-applications/a1/approve')).toHaveLength(1));
    expect(api.find('POST', '/admin/rider-applications/a1/approve')[0].body).toEqual({
      pay_type: 'COMMISSION',
      pay_model: 'DISTANCE',
      base_lkr: 40,
      per_km_lkr: 22.5,
      min_lkr: 90,
    });
  });
});

// ------------------------------------------------------------- adjust pay
function adjustment(over: Partial<RiderAdjustment> = {}): RiderAdjustment {
  return {
    id: 'adj1',
    rider_id: 'r1',
    rider_name: 'Farhan Mohamed',
    amount_lkr: -200,
    reason: 'CASH_SHORT',
    note: 'Short at drop-off',
    adjustment_date: colomboToday(),
    created_by_user_id: 'u-ops-1',
    created_by_name: 'Ops Person',
    created_at: '2026-10-10T05:00:00Z',
    updated_at: '2026-10-10T05:00:00Z',
    ...over,
  };
}

describe('Adjust pay', () => {
  it('records a deduction as a negative amount with reason, note and date (Riders)', async () => {
    const user = userEvent.setup();
    let list: RiderAdjustment[] = [];
    const { api } = renderAs(OPERATIONS_STAFF, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: [{ ...RIDER, pay_type: 'COMMISSION', commission_percent: null }] }),
      'GET /admin/rider-adjustments': () => ok({ adjustments: list }),
      'POST /admin/riders/:id/adjustments': (call) => {
        const a = adjustment({ id: 'new', amount_lkr: call.body.amount_lkr, reason: call.body.reason, note: call.body.note ?? null });
        list = [a];
        return { status: 201, data: { adjustment: a } };
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Adjust pay for Farhan Mohamed' }));
    const sheet = screen.getByRole('dialog', { name: 'Adjust pay' });
    expect(await within(sheet).findByText('No adjustments yet.')).toBeInTheDocument();
    const listCall = api.find('GET', '/admin/rider-adjustments')[0];
    expect(listCall.query.rider_id).toBe('r1');
    expect(listCall.query.to).toBe(colomboToday());

    // Amount and reason are required.
    await user.click(within(sheet).getByRole('button', { name: 'Deduct' }));
    expect(await within(sheet).findByText('Enter the amount.')).toBeInTheDocument();
    expect(within(sheet).getByText('Pick a reason.')).toBeInTheDocument();

    expect(within(sheet).getByRole('button', { name: 'Deduction' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(within(sheet).getByLabelText('Amount (LKR)'), '200');
    await user.click(within(within(sheet).getByRole('group', { name: 'Reason' })).getByRole('button', { name: 'Cash short' }));
    await user.type(within(sheet).getByLabelText('Note (optional)'), 'Short at drop-off');
    // The date is the app's own picker, today by default.
    expect(within(sheet).getByRole('button', { name: 'Date' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Deduct' }));

    await waitFor(() => expect(api.find('POST', '/admin/riders/r1/adjustments')).toHaveLength(1));
    expect(api.find('POST', '/admin/riders/r1/adjustments')[0].body).toEqual({
      amount_lkr: -200,
      reason: 'CASH_SHORT',
      note: 'Short at drop-off',
      adjustment_date: colomboToday(),
    });
    expect(await within(sheet).findByText("LKR 200 deducted from Farhan Mohamed's pay.")).toBeInTheDocument();
    const recent = await within(sheet).findByRole('list', { name: 'Recent adjustments' });
    expect(recent).toHaveTextContent('−LKR 200');
    expect(recent).toHaveTextContent('Cash short');
  });

  it('extra pay is positive; edits with PATCH and deletes after a confirm', async () => {
    const user = userEvent.setup();
    let list: RiderAdjustment[] = [adjustment()];
    const { api } = renderAs(OPERATIONS_STAFF, '/more/riders', {
      'GET /admin/riders': () => ok({ riders: [{ ...RIDER, pay_type: 'COMPANY', commission_percent: null }] }),
      'GET /admin/rider-adjustments': () => ok({ adjustments: list }),
      'POST /admin/riders/:id/adjustments': (call) => ({ status: 201, data: { adjustment: adjustment({ id: 'x', ...call.body }) } }),
      'PATCH /admin/rider-adjustments/:id': (call) => {
        list = [adjustment({ ...call.body })];
        return ok({ adjustment: list[0] });
      },
      'DELETE /admin/rider-adjustments/:id': () => {
        list = [];
        return ok({ deleted: true });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Adjust pay for Farhan Mohamed' }));
    const sheet = screen.getByRole('dialog', { name: 'Adjust pay' });

    await user.click(within(sheet).getByRole('button', { name: 'Extra pay' }));
    await user.type(within(sheet).getByLabelText('Amount (LKR)'), '500');
    await user.click(within(sheet).getByRole('button', { name: 'Bonus' }));
    await user.click(within(sheet).getByRole('button', { name: 'Add extra pay' }));
    await waitFor(() => expect(api.find('POST', '/admin/riders/r1/adjustments')).toHaveLength(1));
    expect(api.find('POST', '/admin/riders/r1/adjustments')[0].body).toEqual({
      amount_lkr: 500,
      reason: 'BONUS',
      adjustment_date: colomboToday(),
    });

    // Edit the listed deduction: it loads into the form.
    const recent = await within(sheet).findByRole('list', { name: 'Recent adjustments' });
    await user.click(within(recent).getByRole('button', { name: /^Edit −LKR 200/ }));
    expect(within(sheet).getByLabelText('Amount (LKR)')).toHaveValue('200');
    expect(within(sheet).getByRole('button', { name: 'Deduction' })).toHaveAttribute('aria-pressed', 'true');
    await user.clear(within(sheet).getByLabelText('Amount (LKR)'));
    await user.type(within(sheet).getByLabelText('Amount (LKR)'), '150');
    await user.click(within(sheet).getByRole('button', { name: 'Late' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/rider-adjustments/adj1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/rider-adjustments/adj1')[0].body).toEqual({
      amount_lkr: -150,
      reason: 'LATE',
      note: 'Short at drop-off',
      adjustment_date: colomboToday(),
    });
    expect(await within(sheet).findByText('Adjustment updated.')).toBeInTheDocument();

    await user.click(await within(sheet).findByRole('button', { name: /^Delete −LKR 150/ }));
    const confirm = screen.getByRole('dialog', { name: 'Delete adjustment' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/rider-adjustments/adj1')).toHaveLength(1));
    expect(await within(sheet).findByText('No adjustments yet.')).toBeInTheDocument();
  });
});

// ------------------------------------------------------- earnings and cash
const zero = {
  cash_collected: 0,
  cash_kept: 0,
  cash_to_hand_in: 0,
  product_sales: 0,
  product_cost: 0,
  coupon_discount: 0,
  customer_delivery_fees: 0,
  product_margin: 0,
};

function earningsReport(): RiderEarningsReport {
  const row = {
    ...zero,
    rider_id: 'r1',
    rider_name: 'Farhan Mohamed',
    rider_phone: '+94779876543',
    pay_type: 'COMMISSION' as const,
    commission_percent: null,
    effective_percent: 80,
    pay_model: 'FIXED' as const,
    deliveries: 5,
    delivery_charges: 1250,
    rider_share: 760,
    blynk_delivery_share: 490,
    base_earnings: 600,
    delivery_bonuses: 160,
    day_bonuses: 300,
    additions: 100,
    deductions: 250,
    adjustments: -150,
    total_earnings: 910,
    bonus_breakdown: { PEAK_BOOST: 60, RAIN_BOOST: 100, LONG_DISTANCE: 0, DAILY_TARGET: 300 },
    payable_to_rider: 120,
  };
  return {
    range: { from: '2026-10-10', to: '2026-10-10', timezone: 'Asia/Colombo' },
    default_percent: 80,
    default_model: { model: 'PERCENT', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: null },
    riders: [row],
    totals: { ...row },
    adjustments: [
      adjustment({ id: 'a1', amount_lkr: -250, reason: 'DAMAGED_ITEM', note: 'Broken eggs' }),
      adjustment({ id: 'a2', amount_lkr: 100, reason: 'BONUS', note: null }),
    ],
  };
}

describe('Rider earnings with bonuses and adjustments', () => {
  it('shows base pay, bonuses by kind, deductions, total, what Blynk owes and the adjustments', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/earnings', {
      'GET /admin/reports/rider-earnings': () => ok(earningsReport()),
      'GET /admin/rider-adjustments': () => ok({ adjustments: [] }),
    });
    const list = await screen.findByRole('list', { name: 'Earnings by rider' });
    const totals = screen.getByRole('region', { name: 'All riders' });
    expect(within(totals).getByText('Base pay').nextSibling).toHaveTextContent('LKR 600');
    expect(within(totals).getByText('Bonuses').nextSibling).toHaveTextContent('LKR 460');
    expect(within(totals).getByText('Deductions').nextSibling).toHaveTextContent('−LKR 250');
    expect(within(totals).getByText('Extra pay').nextSibling).toHaveTextContent('+LKR 100');
    expect(within(totals).getByText('Total earnings').nextSibling).toHaveTextContent('LKR 910');
    expect(within(totals).getByText('Blynk owes riders').nextSibling).toHaveTextContent('LKR 120');

    const farhan = within(list).getByRole('listitem', { name: 'Farhan Mohamed' });
    expect(farhan).toHaveTextContent('Commission · Fixed per delivery');
    expect(farhan).toHaveTextContent('Base payLKR 600');
    expect(farhan).toHaveTextContent('Bonuses+LKR 460');
    const breakdown = within(farhan).getByRole('list', { name: 'Bonuses for Farhan Mohamed' });
    expect(breakdown).toHaveTextContent('Peak boost LKR 60');
    expect(breakdown).toHaveTextContent('Rain boost LKR 100');
    expect(breakdown).toHaveTextContent('Daily target LKR 300');
    expect(breakdown).not.toHaveTextContent('Long distance');
    expect(farhan).toHaveTextContent('Deductions−LKR 250');
    expect(farhan).toHaveTextContent('Extra pay+LKR 100');
    expect(farhan).toHaveTextContent('Total earningsLKR 910');
    expect(farhan).toHaveTextContent('Blynk owes riderLKR 120');

    const adjustments = screen.getByRole('list', { name: 'Adjustments in this range' });
    expect(adjustments).toHaveTextContent('−LKR 250');
    expect(adjustments).toHaveTextContent('Damaged item');
    expect(adjustments).toHaveTextContent('Broken eggs');
    expect(adjustments).toHaveTextContent('+LKR 100');

    // Adjust pay from the card; the report reloads after a change.
    await user.click(within(farhan).getByRole('button', { name: 'Adjust pay for Farhan Mohamed' }));
    expect(screen.getByRole('dialog', { name: 'Adjust pay' })).toBeInTheDocument();
    expect(api.find('GET', '/admin/reports/rider-earnings')).toHaveLength(1);
  });

  it('Cash shows day bonuses, adjustments and what Blynk owes the rider', async () => {
    renderAs(ADMIN_NO_RIDER, '/more/cash', {
      'GET /admin/cash/reconciliation': () =>
        ok({
          date: '2026-10-10',
          timezone: 'Asia/Colombo',
          riders: [
            {
              rider_id: 'r1',
              rider_name: 'Farhan Mohamed',
              rider_phone: '+94779876543',
              deliveries: 2,
              collected: 500,
              handed_in: 0,
              difference: 0,
              status: 'BALANCED',
              pay_type: 'COMMISSION',
              kept_share: 400,
              expected_handin: 0,
              day_bonuses: 300,
              adjustments: -80,
              payable_to_rider: 120,
            },
          ],
          totals: {
            collected: 500,
            handed_in: 0,
            kept_share: 400,
            expected_handin: 0,
            difference: 0,
            status: 'BALANCED',
            day_bonuses: 300,
            adjustments: -80,
            payable_to_rider: 120,
          },
        }),
      'GET /admin/cash/handins': () => ok({ handins: [] }),
    });
    const rows = await screen.findByRole('list', { name: 'Cash by rider' });
    expect(rows).toHaveTextContent('Day bonuses LKR 300');
    expect(rows).toHaveTextContent('Adjustments −LKR 80');
    expect(rows).toHaveTextContent('Blynk owes rider LKR 120');
    const totals = screen.getByRole('region', { name: 'All riders' });
    expect(totals).toHaveTextContent('Day bonusesLKR 300');
    expect(totals).toHaveTextContent('Adjustments−LKR 80');
    expect(totals).toHaveTextContent('Blynk owes ridersLKR 120');
  });
});

describe('My day with bonuses (staff rider)', () => {
  it('shows the pay model, the rain boost and the day bonuses / deductions', async () => {
    const earnings: MyEarnings = {
      timezone: 'Asia/Colombo',
      pay_type: 'COMMISSION',
      commission_percent: 80,
      pay_model: { model: 'FIXED', percent: 80, fixed_lkr: 100, base_lkr: 50, per_km_lkr: 20, min_lkr: null },
      boosts: {
        applies: true,
        rain: { active: true, mode: 'FIXED', amount: 30, until: null },
        peak: { active_now: false, mode: 'FIXED', amount: 30 },
      },
      today: {
        date: '2026-10-10',
        deliveries: 3,
        delivery_charges: 750,
        earnings: 520,
        cash_collected: 1830,
        cash_to_keep: 520,
        cash_to_hand_in: 1310,
        bonuses: 320,
        deductions: 100,
        additions: 0,
        payable_to_rider: 0,
      },
      week: { starts_on: '2026-10-06', deliveries: 3, delivery_charges: 750, earnings: 520, cash_collected: 1830, cash_to_keep: 520, cash_to_hand_in: 1310 },
    };
    renderAs(OPERATIONS_STAFF, '/delivery/day', {
      'GET /riders/me/day': () =>
        ok({
          timezone: 'Asia/Colombo',
          today: { date: '2026-10-10', completed: 3, failed: 0, customer_unavailable: 0, cash_collected: 1830 },
          week: { starts_on: '2026-10-06', completed: 3, failed: 0, customer_unavailable: 0, cash_collected: 1830 },
          deliveries_today: [],
        }),
      'GET /riders/me/earnings': () => ok(earnings),
    });
    const section = await screen.findByRole('region', { name: /Your earnings/ });
    expect(section).toHaveTextContent('LKR 100 per delivery');
    expect(section).toHaveTextContent('Rain boost +LKR 30 per delivery');
    expect(within(section).getByLabelText('Earnings today')).toHaveTextContent('Bonuses +LKR 320 · Deductions −LKR 100');
  });
});
