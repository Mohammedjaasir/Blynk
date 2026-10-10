import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import type { DayHours, DayKey, StoreSchedule, StoreStatus } from '../api/types';
import {
  colomboDateKey,
  colomboToIso,
  dayLabel,
  formatHHMM,
  formatReopen,
  formatSlot,
  formatTimeRange,
  scheduledLabel,
  statusLine,
  upcomingDateKeys,
  validateHours,
} from '../lib/schedule';
import { fail, mockApi, ok } from './mockApi';

/**
 * Store schedule (owner, 2026-10-10): the Settings panels for opening hours,
 * close-now, holidays and delivery slots, and the shared slot formatter. The
 * rules are the backend's; here, what the page checks first and sends.
 */

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const allDays = (h: DayHours) => Object.fromEntries(DAYS.map((d) => [d, { ...h }])) as Record<DayKey, DayHours>;

const OPEN: StoreStatus = {
  is_open_now: true,
  closed_kind: 'OPEN',
  closed_reason: null,
  reopens_at: null,
  next_open_at: null,
  today_hours: { open: '08:00', close: '21:00' },
};

function schedule(overrides: Partial<StoreSchedule> = {}): StoreSchedule {
  return {
    hours: { same_every_day: true, days: allDays({ closed: false, open: '08:00', close: '21:00' }), updated_at: null },
    closure: { closed: false, reason: null, reopens_at: null, closed_at: null, updated_at: null },
    holidays: [],
    delivery_slots: {
      enabled: false,
      slot_minutes: 120,
      days_ahead: 1,
      max_orders_per_slot: 10,
      min_lead_minutes: 60,
      updated_at: null,
    },
    status: OPEN,
    ...overrides,
  };
}

/** A fake schedule API: GET returns `state`, each PATCH merges and returns it. */
function scheduleApi(initial: StoreSchedule, onPatch?: (path: string, body: any) => ReturnType<typeof ok> | undefined) {
  let state = initial;
  return mockApi((c) => {
    if (c.path === '/admin/settings/store-schedule' && c.method === 'GET') return ok(state);
    if (c.method !== 'PATCH' || !c.path.startsWith('/admin/settings/store-') && c.path !== '/admin/settings/delivery-slots') {
      return undefined;
    }
    const custom = onPatch?.(c.path, c.body);
    if (custom) return custom;
    if (c.path === '/admin/settings/store-hours') {
      const days = c.body.same_every_day ? allDays({ closed: false, open: c.body.open, close: c.body.close }) : c.body.days;
      state = { ...state, hours: { same_every_day: c.body.same_every_day, days, updated_at: '2026-10-10T05:00:00.000Z' } };
    } else if (c.path === '/admin/settings/store-closure') {
      state = c.body.closed
        ? {
            ...state,
            closure: { closed: true, reason: c.body.reason, reopens_at: c.body.reopens_at ?? null, closed_at: new Date().toISOString(), updated_at: null },
            status: { ...OPEN, is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: c.body.reason, reopens_at: c.body.reopens_at ?? null, next_open_at: c.body.reopens_at ?? null },
          }
        : { ...state, closure: { closed: false, reason: null, reopens_at: null, closed_at: null, updated_at: null }, status: OPEN };
    } else if (c.path === '/admin/settings/store-holidays') {
      state = { ...state, holidays: c.body.holidays };
    } else if (c.path === '/admin/settings/delivery-slots') {
      state = { ...state, delivery_slots: { ...state.delivery_slots, ...c.body } };
    } else if (c.path === '/admin/settings/store-sms') {
      state = { ...state, sms: { sms_on_closed_days: c.body.sms_on_closed_days, updated_at: '2026-10-10T05:00:00.000Z' } };
    }
    return ok(state);
  });
}

// ------------------------------------------------------------ formatter

describe('slot formatter (Asia/Colombo)', () => {
  // 2026-10-10 10:00 Colombo = 04:30 UTC (a Saturday).
  const now = new Date('2026-10-10T04:30:00.000Z');
  const at = (colomboDateTime: string) => colomboToIso(colomboDateTime.slice(0, 10), colomboDateTime.slice(11));

  it('names the day Today / Tomorrow / "Mon 12 Oct" by the Colombo calendar', () => {
    expect(dayLabel(at('2026-10-10 23:45'), now)).toBe('Today');
    expect(dayLabel(at('2026-10-11 00:00'), now)).toBe('Tomorrow');
    expect(dayLabel(at('2026-10-12 08:00'), now)).toBe('Mon 12 Oct');
    // 19:00 UTC on the 10th is already the 11th in Colombo.
    expect(dayLabel('2026-10-10T19:00:00.000Z', now)).toBe('Tomorrow');
  });

  it('writes en-dash ranges the way the contract does', () => {
    expect(formatTimeRange(at('2026-10-10 16:00'), at('2026-10-10 18:00'))).toBe('4–6 PM');
    expect(formatTimeRange(at('2026-10-10 11:00'), at('2026-10-10 13:00'))).toBe('11 AM–1 PM');
    expect(formatTimeRange(at('2026-10-10 08:30'), at('2026-10-10 09:30'))).toBe('8:30–9:30 AM');
    expect(formatTimeRange(at('2026-10-10 08:00'), at('2026-10-10 10:00'))).toBe('8–10 AM');
  });

  it('labels a slot, and only the start when the order has no slot end', () => {
    expect(scheduledLabel(at('2026-10-11 08:00'), at('2026-10-11 10:00'), now)).toBe('Scheduled: Tomorrow 8–10 AM');
    expect(formatSlot(at('2026-10-10 16:00'), at('2026-10-10 18:00'), now)).toBe('Today 4–6 PM');
    expect(formatSlot(at('2026-10-12 08:30'), null, now)).toBe('Mon 12 Oct 8:30 AM');
  });

  it('formats HH:MM and the status line', () => {
    expect(formatHHMM('21:00')).toBe('9 PM');
    expect(formatHHMM('00:15')).toBe('12:15 AM');
    expect(statusLine(OPEN, now)).toBe('Open now · closes 9 PM');
    const reopen = at('2026-10-13 08:00');
    expect(
      statusLine({ ...OPEN, is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Rain', reopens_at: reopen, next_open_at: reopen }, now)
    ).toBe('Closed — Rain · reopens Tue 8 AM');
    expect(statusLine({ ...OPEN, is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Rain' }, now)).toBe(
      'Closed — Rain · until staff reopen'
    );
    expect(
      statusLine({ ...OPEN, is_open_now: false, closed_kind: 'OUTSIDE_HOURS', today_hours: null, next_open_at: at('2026-10-11 08:00') }, now)
    ).toBe('Closed — Outside opening hours · reopens tomorrow 8 AM');
    expect(formatReopen(at('2026-10-24 08:00'), now)).toBe('Sat 24 Oct 8 AM');
  });

  it('checks hours like the backend: open before close, at least one open day', () => {
    expect(validateHours(true, { open: '21:00', close: '08:00' }, allDays({ closed: false, open: '08:00', close: '21:00' })).same).toBe(
      'Opening time must be before closing time.'
    );
    expect(validateHours(true, { open: '08:00', close: '08:10' }, allDays({ closed: false, open: '08:00', close: '21:00' })).same).toBe(
      'Pick times on the quarter hour.'
    );
    const days = allDays({ closed: true, open: '08:00', close: '21:00' });
    expect(validateHours(false, { open: '08:00', close: '21:00' }, days).form).toBe('Keep at least one day open.');
    days.wed = { closed: false, open: '10:00', close: '10:00' };
    expect(validateHours(false, { open: '08:00', close: '21:00' }, days)).toEqual({
      days: { wed: 'Opening time must be before closing time.' },
    });
    // A closed day's times are ignored.
    days.wed = { closed: false, open: '09:00', close: '17:00' };
    days.thu = { closed: true, open: '22:00', close: '01:00' };
    expect(validateHours(false, { open: '08:00', close: '21:00' }, days)).toEqual({ days: {} });
  });
});

// ------------------------------------------------------- opening hours

describe('Settings - opening hours', () => {
  it('saves the same hours every day from styled selects (no native time input)', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule());
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Opening hours' });
    expect(panel.querySelector('input[type="time"]')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Same hours every day' })).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Opens' }), '07:30');
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Closes' }), '22:00');
    await user.click(within(panel).getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-hours')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-hours')[0]!.body).toEqual({ same_every_day: true, open: '07:30', close: '22:00' });
    expect(await screen.findByText('Opening hours saved.')).toBeInTheDocument();
  });

  it('refuses open after close without calling the API', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule());
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Opening hours' });
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Opens' }), '21:00');
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Closes' }), '09:00');
    await user.click(within(panel).getByRole('button', { name: 'Save hours' }));
    expect(within(panel).getByText('Opening time must be before closing time.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/store-hours')).toHaveLength(0);
  });

  it('per day: seven rows with a Closed switch; sends every day', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule());
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Opening hours' });
    await user.click(within(panel).getByRole('button', { name: 'Different per day' }));
    const rows = within(within(panel).getByRole('list', { name: 'Hours per day' })).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.hours-day__name')?.textContent)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    await user.click(within(panel).getByRole('checkbox', { name: 'Sunday closed' }));
    expect(within(panel).getByRole('combobox', { name: 'Sunday opens' })).toBeDisabled();
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Friday closes' }), '12:00');
    await user.click(within(panel).getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-hours')).toHaveLength(1));
    const body = api.find('PATCH', '/admin/settings/store-hours')[0]!.body;
    expect(body.same_every_day).toBe(false);
    expect(Object.keys(body.days)).toEqual(DAYS);
    expect(body.days.sun).toEqual({ closed: true, open: '08:00', close: '21:00' });
    expect(body.days.fri).toEqual({ closed: false, open: '08:00', close: '12:00' });
    expect(body.days.mon).toEqual({ closed: false, open: '08:00', close: '21:00' });
  });

  it('needs at least one open day, and shows the API refusal in its words', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule(), (path) =>
      path === '/admin/settings/store-hours'
        ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'days.mon.open', message: 'Use 15-minute steps' }])
        : undefined
    );
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Opening hours' });
    await user.click(within(panel).getByRole('button', { name: 'Different per day' }));
    for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      await user.click(within(panel).getByRole('checkbox', { name: `${d} closed` }));
    }
    await user.click(within(panel).getByRole('button', { name: 'Save hours' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Keep at least one day open.');
    expect(api.find('PATCH', '/admin/settings/store-hours')).toHaveLength(0);

    await user.click(within(panel).getByRole('checkbox', { name: 'Monday closed' }));
    await user.click(within(panel).getByRole('button', { name: 'Save hours' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Use 15-minute steps');
  });
});

// ------------------------------------------------------------ close now

describe('Settings - close the store now', () => {
  it('shows the status, needs a reason, confirms, then sends the reason and reopen time', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule());
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Store status' });
    expect(within(panel).getByRole('status')).toHaveTextContent('Open now · closes 9 PM');

    await user.click(within(panel).getByRole('checkbox', { name: /Close the store now/ }));
    await user.click(within(panel).getByRole('button', { name: 'Close the store' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('Say why the store is closed');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'Rain' }));
    expect(within(panel).getByRole('textbox', { name: /Reason customers see/ })).toHaveValue('Rain');
    await user.click(within(panel).getByRole('button', { name: 'At a set time' }));
    const tomorrow = upcomingDateKeys(2)[1]!;
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Reopen day' }), tomorrow);
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Reopen time' }), '09:00');
    await user.click(within(panel).getByRole('button', { name: 'Close the store' }));

    const dialog = await screen.findByRole('dialog', { name: 'Close the store now' });
    expect(dialog).toHaveTextContent('"Rain"');
    expect(dialog).toHaveTextContent('opens again tomorrow 9 AM');
    expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Close the store' }));

    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-closure')[0]!.body).toEqual({
      closed: true,
      reason: 'Rain',
      reopens_at: colomboToIso(tomorrow, '09:00'),
    });
    expect(await within(panel).findByRole('status')).toHaveTextContent('Closed — Rain · reopens tomorrow 9 AM');
  });

  it('closed until staff reopen sends reopens_at null; switching off reopens', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule());
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Store status' });
    await user.click(within(panel).getByRole('checkbox', { name: /Close the store now/ }));
    await user.type(within(panel).getByRole('textbox', { name: /Reason customers see/ }), 'Staff meeting');
    await user.click(within(panel).getByRole('button', { name: 'Close the store' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close the store' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-closure')[0]!.body).toEqual({
      closed: true,
      reason: 'Staff meeting',
      reopens_at: null,
    });
    expect(await within(panel).findByRole('status')).toHaveTextContent('Closed — Staff meeting · until staff reopen');

    const toggle = within(panel).getByRole('checkbox', { name: /Close the store now/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-closure')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/store-closure')[1]!.body).toEqual({ closed: false });
    expect(await within(panel).findByRole('status')).toHaveTextContent('Open now');
  });
});

// -------------------------------------------------------------- holidays

describe('Settings - holidays', () => {
  it('adds a date with a reason and removes one, sending the full list each time', async () => {
    const user = userEvent.setup();
    const [today, , , day3] = upcomingDateKeys(4);
    const existing = { date: day3!, reason: null };
    const api = scheduleApi(schedule({ holidays: [existing] }));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Holidays' });
    expect(today).toBe(colomboDateKey());

    // The day list starts today; pick today (always in this month's list).
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Holiday day' }), today!);
    await user.type(within(panel).getByRole('textbox', { name: /Reason/ }), 'Poya');
    await user.click(within(panel).getByRole('button', { name: 'Add holiday' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-holidays')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-holidays')[0]!.body).toEqual({
      holidays: [{ date: today, reason: 'Poya' }, existing],
    });

    // Adding the same day again is refused before the API.
    await user.selectOptions(within(panel).getByRole('combobox', { name: 'Holiday day' }), today!);
    await user.click(within(panel).getByRole('button', { name: 'Add holiday' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('is already a holiday');
    expect(api.find('PATCH', '/admin/settings/store-holidays')).toHaveLength(1);

    const list = within(panel).getByRole('list', { name: 'Upcoming holidays' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    await user.click(within(rows[0]!).getByRole('button', { name: /^Remove/ }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-holidays')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/settings/store-holidays')[1]!.body).toEqual({ holidays: [existing] });
  });
});

// -------------------------------------------------------- delivery slots

describe('Settings - delivery slots', () => {
  it('is off by default; switching on and choosing values sends them all', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule());
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery slots' });
    const on = within(panel).getByRole('checkbox', { name: /Let customers pick a delivery slot/ });
    expect(on).not.toBeChecked();
    expect(within(panel).getByRole('button', { name: '1 hour' })).toBeDisabled();

    await user.click(on);
    await user.click(within(panel).getByRole('button', { name: '1 hour' }));
    await user.click(within(panel).getByRole('button', { name: '2 days' }));
    await user.click(within(panel).getByRole('button', { name: 'More orders per slot' }));
    await user.click(within(panel).getByRole('button', { name: 'More orders per slot' }));
    expect(within(panel).getByRole('textbox', { name: 'Orders per slot' })).toHaveValue('12');
    await user.selectOptions(within(panel).getByRole('combobox', { name: /Earliest slot from now/ }), '45');
    await user.click(within(panel).getByRole('button', { name: 'Save slots' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/delivery-slots')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/delivery-slots')[0]!.body).toEqual({
      enabled: true,
      slot_minutes: 60,
      days_ahead: 2,
      max_orders_per_slot: 12,
      min_lead_minutes: 45,
    });
  });

  it('refuses orders per slot outside 1..100', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule({ delivery_slots: { ...schedule().delivery_slots, enabled: true } }));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Delivery slots' });
    const max = within(panel).getByRole('textbox', { name: 'Orders per slot' });
    await user.clear(max);
    await user.type(max, '150');
    await user.click(within(panel).getByRole('button', { name: 'Save slots' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('from 1 to 100');
    expect(api.find('PATCH', '/admin/settings/delivery-slots')).toHaveLength(0);
  });
});

describe('Settings - texts on closed days (owner, 2026-10-10)', () => {
  it('is on by default (also from a server that does not send it), explained, and switching it off sends only that', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule());
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Texts on closed days' });
    const toggle = within(panel).getByRole('checkbox', { name: /^Send offer\/birthday texts on closed days/ });
    expect(toggle).toBeChecked();
    expect(panel).toHaveTextContent('still go out on a closed weekday');
    await user.click(toggle);
    expect(panel).toHaveTextContent("A birthday text then goes out on the next open day, if it is still the customer's birthday week.");
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/store-sms')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/store-sms')[0]!.body).toEqual({ sms_on_closed_days: false });
    expect(await within(panel).findByText(/^Changed /)).toBeInTheDocument();
    expect(within(panel).getByRole('checkbox', { name: /^Send offer\/birthday texts on closed days/ })).not.toBeChecked();
  });

  it('shows a saved "off" and sends nothing when unchanged', async () => {
    const user = userEvent.setup();
    const api = scheduleApi(schedule({ sms: { sms_on_closed_days: false, updated_at: null } }));
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Texts on closed days' });
    expect(within(panel).getByRole('checkbox', { name: /^Send offer\/birthday texts on closed days/ })).not.toBeChecked();
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Nothing changed.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/store-sms')).toHaveLength(0);
  });
});
