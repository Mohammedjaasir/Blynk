import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { DayHours, DayKey, StoreSchedule } from '../api/types';
import { addDays, colomboDate, colomboInstant, formatMoment } from '../lib/slots';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, ok, renderAs, type Call } from './helpers';

/** More -> Opening hours: hours, close now, holidays, delivery slots (owner, 2026-10-10). */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const allDays = (d: DayHours) => Object.fromEntries(KEYS.map((k) => [k, { ...d }])) as Record<DayKey, DayHours>;

function schedule(overrides: Partial<StoreSchedule> = {}): StoreSchedule {
  return {
    hours: { same_every_day: true, days: allDays({ closed: false, open: '08:00', close: '21:00' }), updated_at: null },
    closure: { closed: false, reason: null, reopens_at: null, closed_at: null, updated_at: null },
    holidays: [],
    delivery_slots: { enabled: false, slot_minutes: 120, days_ahead: 1, max_orders_per_slot: 10, min_lead_minutes: 60, updated_at: null },
    status: {
      is_open_now: true,
      closed_kind: 'OPEN',
      closed_reason: null,
      reopens_at: null,
      next_open_at: null,
      today_hours: { open: '08:00', close: '21:00' },
    },
    ...overrides,
  };
}

function open(initial = schedule(), handlers: Parameters<typeof renderAs>[2] = {}) {
  return renderAs(ADMIN_WITH_RIDER, '/more/opening-hours', {
    'GET /admin/settings/store-schedule': () => ok(initial),
    'PATCH /admin/settings/store-hours': () => ok(initial),
    'PATCH /admin/settings/store-closure': () => ok(initial),
    'PATCH /admin/settings/store-holidays': (call: Call) => ok({ ...initial, holidays: call.body.holidays }),
    'PATCH /admin/settings/delivery-slots': (call: Call) =>
      ok({ ...initial, delivery_slots: { ...initial.delivery_slots, ...call.body, updated_at: new Date().toISOString() } }),
    'PATCH /admin/settings/store-sms': (call: Call) =>
      ok({ ...initial, sms: { sms_on_closed_days: call.body.sms_on_closed_days, updated_at: new Date().toISOString() } }),
    ...handlers,
  });
}

const status = () => screen.findByTestId('store-status');
const card = (name: string) => screen.findByRole('region', { name });

describe('Opening hours page', () => {
  it('opens from More and reads the whole schedule once, with the status line on top', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/store-schedule': () => ok(schedule()),
    });
    await user.click(await screen.findByRole('link', { name: 'Opening hours' }));
    expect(await status()).toHaveTextContent('Open now · closes 9 PM');
    expect(api.find('GET', '/admin/settings/store-schedule')).toHaveLength(1);
    // No bare native time inputs anywhere.
    expect(document.querySelector('input[type="time"], input[type="date"], input[type="datetime-local"]')).toBeNull();
  });

  it('same hours: refuses a close before the open, then sends one pair', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const hours = await card('Opening hours');
    await user.selectOptions(within(hours).getByRole('combobox', { name: 'Closes' }), '07:00');
    await user.click(within(hours).getByRole('button', { name: 'Save hours' }));
    expect(within(hours).getByRole('alert')).toHaveTextContent('Closing time must be after opening time.');
    expect(api.find('PATCH', '/admin/settings/store-hours')).toHaveLength(0);

    await user.selectOptions(within(hours).getByRole('combobox', { name: 'Opens' }), '07:30');
    await user.selectOptions(within(hours).getByRole('combobox', { name: 'Closes' }), '22:00');
    expect(within(within(hours).getByRole('combobox', { name: 'Closes' })).getByRole('option', { name: '10 PM', selected: true })).toBeInTheDocument();
    await user.click(within(hours).getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-hours')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-hours')[0].body).toEqual({ same_every_day: true, open: '07:30', close: '22:00' });
    expect(await within(hours).findByText('Opening hours saved.')).toBeInTheDocument();
  });

  it('different per day: needs one open day, then sends all seven days', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const hours = await card('Opening hours');
    await user.click(within(hours).getByRole('button', { name: 'Different per day' }));
    expect(within(hours).getAllByRole('listitem')).toHaveLength(7);
    for (const name of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      await user.click(within(hours).getByRole('button', { name: `${name} closed` }));
    }
    await user.click(within(hours).getByRole('button', { name: 'Save hours' }));
    expect(within(hours).getByRole('alert')).toHaveTextContent('Keep at least one day open.');

    for (const name of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      await user.click(within(hours).getByRole('button', { name: `${name} open` }));
    }
    await user.selectOptions(within(hours).getByRole('combobox', { name: 'Saturday closes' }), '23:00');
    await user.selectOptions(within(hours).getByRole('combobox', { name: 'Friday opens' }), '21:30');
    await user.click(within(hours).getByRole('button', { name: 'Save hours' }));
    expect(within(hours).getByRole('alert')).toHaveTextContent('Friday: Closing time must be after opening time.');
    await user.selectOptions(within(hours).getByRole('combobox', { name: 'Friday opens' }), '14:00');
    await user.click(within(hours).getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-hours')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/settings/store-hours')[0].body;
    expect(body.same_every_day).toBe(false);
    expect(Object.keys(body.days)).toEqual(KEYS);
    expect(body.days.fri).toEqual({ closed: false, open: '14:00', close: '21:00' });
    expect(body.days.sat).toEqual({ closed: false, open: '08:00', close: '23:00' });
    expect(body.days.sun).toEqual({ closed: true, open: '08:00', close: '21:00' });
  });

  it("shows the API's own message when it refuses the hours", async () => {
    const user = userEvent.setup();
    open(schedule(), {
      'PATCH /admin/settings/store-hours': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: [{ field: 'close', message: 'Times must be on 15-minute steps' }] },
      }),
    });
    const hours = await card('Opening hours');
    await user.click(within(hours).getByRole('button', { name: 'Save hours' }));
    expect(await within(hours).findByRole('alert')).toHaveTextContent('Times must be on 15-minute steps');
  });

  it('close now: needs a reason, confirms, then sends reason and reopen time; the status line follows the server', async () => {
    const user = userEvent.setup();
    const reopensAt = colomboInstant(addDays(colomboDate(new Date()), 1), '08:00').toISOString();
    const closed = schedule({
      closure: { closed: true, reason: 'Rain', reopens_at: reopensAt, closed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      status: { is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Rain', reopens_at: reopensAt, next_open_at: reopensAt, today_hours: { open: '08:00', close: '21:00' } },
    });
    const { api } = open(schedule(), { 'PATCH /admin/settings/store-closure': () => ok(closed) });
    const box = await card('Close the store now');
    const toggle = within(box).getByRole('switch', { name: 'Close the store now' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    await user.click(within(box).getByRole('button', { name: 'Close the store' }));
    expect(within(box).getByRole('alert')).toHaveTextContent('Write why the store is closing');

    await user.click(within(box).getByRole('button', { name: 'Rain' }));
    expect(within(box).getByLabelText('Reason (customers see this)')).toHaveValue('Rain');
    await user.click(within(box).getByRole('button', { name: 'In 1 hour' }));
    const before = Date.now();
    await user.click(within(box).getByRole('button', { name: 'Close the store' }));
    expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(0);
    const dialog = await screen.findByRole('dialog', { name: 'Close the store now?' });
    expect(dialog).toHaveTextContent('"Rain"');
    await user.click(within(dialog).getByRole('button', { name: 'Close the store' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/settings/store-closure')[0].body;
    expect(body.closed).toBe(true);
    expect(body.reason).toBe('Rain');
    const sent = Date.parse(body.reopens_at);
    expect(sent - before).toBeGreaterThan(59 * 60_000);
    expect(sent - before).toBeLessThan(61 * 60_000);
    expect(await status()).toHaveTextContent(`Closed — Rain · reopens ${formatMoment(reopensAt)}`);
    expect(within(box).getByRole('switch', { name: 'Close the store now' })).toHaveAttribute('aria-checked', 'true');
  });

  it('close now with a picked day and time, or until staff reopen', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const box = await card('Close the store now');
    await user.click(within(box).getByRole('switch', { name: 'Close the store now' }));
    await user.type(within(box).getByLabelText('Reason (customers see this)'), 'Family event');
    await user.click(within(box).getByRole('button', { name: 'Pick' }));
    const day = addDays(colomboDate(new Date()), 2);
    await user.selectOptions(within(box).getByRole('combobox', { name: 'Reopen day' }), day);
    await user.selectOptions(within(box).getByRole('combobox', { name: 'Reopen time' }), '09:30');
    await user.click(within(box).getByRole('button', { name: 'Close the store' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close the store' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-closure')[0].body).toEqual({
      closed: true,
      reason: 'Family event',
      reopens_at: colomboInstant(day, '09:30').toISOString(),
    });

    await user.click(within(box).getByRole('switch', { name: 'Close the store now' }));
    await user.type(within(box).getByLabelText('Reason (customers see this)'), 'Stock-taking');
    await user.click(within(box).getByRole('button', { name: 'Until I reopen' }));
    await user.click(within(box).getByRole('button', { name: 'Close the store' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('until you reopen it');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close the store' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/store-closure')[1].body).toEqual({ closed: true, reason: 'Stock-taking', reopens_at: null });
  });

  it('a closed store reopens with { closed: false }', async () => {
    const user = userEvent.setup();
    const closed = schedule({
      closure: { closed: true, reason: 'Holiday', reopens_at: null, closed_at: new Date().toISOString(), updated_at: null },
      status: { is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Holiday', reopens_at: null, next_open_at: null, today_hours: { open: '08:00', close: '21:00' } },
    });
    const { api } = open(closed, { 'PATCH /admin/settings/store-closure': () => ok(schedule()) });
    expect(await status()).toHaveTextContent('Closed — Holiday · until staff reopen');
    const box = await card('Close the store now');
    await user.click(within(box).getByRole('button', { name: 'Reopen now' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-closure')[0].body).toEqual({ closed: false });
    await waitFor(async () => expect(await status()).toHaveTextContent('Open now · closes 9 PM'));
  });

  it('holidays: adding sends the full list, sorted, and the day leaves the picker', async () => {
    const user = userEvent.setup();
    const today = colomboDate(new Date());
    const later = addDays(today, 10);
    const { api } = open(schedule({ holidays: [{ date: later, reason: 'Public holiday' }] }));
    const box = await card('Holidays');
    expect(within(box).getByRole('list', { name: 'Holidays' })).toHaveTextContent('Public holiday');
    // A day already on the list is not offered again.
    const options = () => [...(within(box).getByRole('combobox', { name: 'Holiday day' }) as HTMLSelectElement).options].map((o) => o.value);
    expect(options()).not.toContain(later);
    expect(options()[0]).toBe(today);
    const day = addDays(today, 3);
    await user.selectOptions(within(box).getByRole('combobox', { name: 'Holiday day' }), day);
    await user.click(within(box).getByRole('button', { name: 'Staff holiday' }));
    await user.click(within(box).getByRole('button', { name: 'Add holiday' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-holidays')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-holidays')[0].body).toEqual({
      holidays: [
        { date: day, reason: 'Staff holiday' },
        { date: later, reason: 'Public holiday' },
      ],
    });
    await waitFor(() => expect(options()).not.toContain(day));
    expect(within(box).getAllByRole('button', { name: /^Remove holiday/ })).toHaveLength(2);
  });

  it('holidays: remove sends the list without that day', async () => {
    const user = userEvent.setup();
    const today = colomboDate(new Date());
    const a = addDays(today, 4);
    const b = addDays(today, 9);
    const { api } = open(schedule({ holidays: [{ date: a, reason: null }, { date: b, reason: 'Stock-taking' }] }));
    const box = await card('Holidays');
    const removes = within(box).getAllByRole('button', { name: /^Remove holiday/ });
    expect(removes).toHaveLength(2);
    await user.click(removes[0]);
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-holidays')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-holidays')[0].body).toEqual({ holidays: [{ date: b, reason: 'Stock-taking' }] });
  });

  it('delivery slots: off by default; switch, chips and steppers make the PATCH body', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const box = await card('Delivery slots');
    const toggle = within(box).getByRole('switch', { name: 'Delivery slots' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(box).getByRole('button', { name: '2 hours' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    await user.click(within(box).getByRole('button', { name: '1 hour' }));
    await user.click(within(box).getByRole('button', { name: 'Today + 2 days' }));
    await user.click(within(box).getByRole('button', { name: 'More max orders per slot' }));
    await user.click(within(box).getByRole('button', { name: 'More max orders per slot' }));
    await user.click(within(box).getByRole('button', { name: 'Less minimum lead time' }));
    expect(within(box).getByRole('group', { name: 'Minimum lead time' })).toHaveTextContent('45 min');
    await user.click(within(box).getByRole('button', { name: 'Save delivery slots' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-slots')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/delivery-slots')[0].body).toEqual({
      enabled: true,
      slot_minutes: 60,
      days_ahead: 2,
      max_orders_per_slot: 12,
      min_lead_minutes: 45,
    });
    expect(await within(box).findByText('Delivery slots saved. Customers can pick a slot.')).toBeInTheDocument();
  });

  it('lead time stops at 0 and 4 h; orders per slot at 1 and 100', async () => {
    const user = userEvent.setup();
    open(
      schedule({
        delivery_slots: { enabled: true, slot_minutes: 30, days_ahead: 3, max_orders_per_slot: 1, min_lead_minutes: 0, updated_at: null },
      })
    );
    const box = await card('Delivery slots');
    expect(within(box).getByRole('button', { name: 'Less minimum lead time' })).toBeDisabled();
    expect(within(box).getByRole('button', { name: 'Less max orders per slot' })).toBeDisabled();
    expect(within(box).getByRole('group', { name: 'Minimum lead time' })).toHaveTextContent('No minimum');
    await user.click(within(box).getByRole('button', { name: 'More minimum lead time' }));
    expect(within(box).getByRole('group', { name: 'Minimum lead time' })).toHaveTextContent('15 min');
  });

  it('texts on closed days (owner, 2026-10-10): on by default, explained; switching off sends only that', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const box = await card('Send offer/birthday texts on closed days');
    const toggle = within(box).getByRole('switch', { name: 'Send offer/birthday texts on closed days' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(box).toHaveTextContent('still go out on a closed weekday');
    await user.click(toggle);
    expect(box).toHaveTextContent('A birthday text then goes out on the next open day');
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-sms')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-sms')[0].body).toEqual({ sms_on_closed_days: false });
    expect(await within(box).findByText('Saved. No texts on closed days.')).toBeInTheDocument();
    expect(within(box).getByText(/Last changed/)).toBeInTheDocument();
  });

  it('texts on closed days: a saved "off" shows off; Save with no change sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = open(schedule({ sms: { sms_on_closed_days: false, updated_at: null } }));
    const box = await card('Send offer/birthday texts on closed days');
    expect(within(box).getByRole('switch', { name: 'Send offer/birthday texts on closed days' })).toHaveAttribute('aria-checked', 'false');
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    expect(await within(box).findByText('Nothing changed.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/store-sms')).toHaveLength(0);
  });
});
