import { describe, expect, it } from 'vitest';
import type { StoreHours, StoreStatus } from '../api/types';
import {
  asapThenBySlot,
  colomboInstant,
  formatHhmm,
  formatSlot,
  formatSlotAbsolute,
  formatSlotRange,
  scheduledLabel,
  slotDayLabel,
} from '../lib/slots';
import { buildHoursBody, leadLabel, nextOpeningAfterToday, reopenError, statusLine, TIME_OPTIONS } from '../lib/storeSchedule';

/** Slot and store-time wording, Asia/Colombo (owner, 2026-10-10). */

// Sat 10 Oct 2026, 15:00 in Colombo (09:30Z).
const NOW = new Date('2026-10-10T09:30:00Z');
const at = (ymd: string, hhmm: string) => colomboInstant(ymd, hhmm).toISOString();

describe('slot formatter', () => {
  it('writes en-dash ranges, repeating AM/PM only when the ends differ', () => {
    expect(formatSlotRange(at('2026-10-10', '16:00'), at('2026-10-10', '18:00'))).toBe('4–6 PM');
    expect(formatSlotRange(at('2026-10-10', '11:00'), at('2026-10-10', '13:00'))).toBe('11 AM–1 PM');
    expect(formatSlotRange(at('2026-10-10', '08:30'), at('2026-10-10', '09:30'))).toBe('8:30–9:30 AM');
    expect(formatSlotRange(at('2026-10-10', '08:00'), at('2026-10-10', '10:00'))).toBe('8–10 AM');
    expect(formatSlotRange(at('2026-10-10', '12:00'), at('2026-10-10', '12:30'))).toBe('12–12:30 PM');
    expect(formatSlotRange(at('2026-10-10', '23:00'), at('2026-10-11', '00:00'))).toBe('11 PM–12 AM');
  });

  it('shows just the start when an older order has no slot end', () => {
    expect(formatSlotRange(at('2026-10-10', '16:00'), null)).toBe('4 PM');
    expect(formatSlotRange(at('2026-10-10', '17:45'))).toBe('5:45 PM');
  });

  it('says Today / Tomorrow / "Sat 12 Oct" by the Colombo calendar day', () => {
    expect(slotDayLabel(at('2026-10-10', '23:45'), NOW)).toBe('Today');
    expect(slotDayLabel(at('2026-10-11', '00:15'), NOW)).toBe('Tomorrow');
    expect(slotDayLabel(at('2026-10-12', '08:00'), NOW)).toBe('Mon 12 Oct');
    // 19:00Z on the 10th is already 00:30 on the 11th in Colombo.
    expect(slotDayLabel('2026-10-10T19:00:00Z', NOW)).toBe('Tomorrow');
  });

  it('puts the day and range together, and the staff label on an order', () => {
    expect(formatSlot(at('2026-10-11', '08:00'), at('2026-10-11', '10:00'), NOW)).toBe('Tomorrow 8–10 AM');
    expect(scheduledLabel({ scheduled_for: at('2026-10-10', '16:00'), scheduled_until: at('2026-10-10', '18:00') }, NOW)).toBe(
      'Scheduled: Today 4–6 PM'
    );
    expect(scheduledLabel({ scheduled_for: null, scheduled_until: null }, NOW)).toBeNull();
    expect(formatSlotAbsolute(at('2026-10-17', '11:00'), at('2026-10-17', '13:00'))).toBe('Sat 17 Oct, 11 AM–1 PM');
  });

  it('formats stored HH:MM store times', () => {
    expect(formatHhmm('08:00')).toBe('8 AM');
    expect(formatHhmm('21:00')).toBe('9 PM');
    expect(formatHhmm('17:30')).toBe('5:30 PM');
    expect(formatHhmm('00:00')).toBe('12 AM');
    expect(TIME_OPTIONS).toHaveLength(96);
    expect(TIME_OPTIONS[0]).toBe('00:00');
    expect(TIME_OPTIONS.at(-1)).toBe('23:45');
  });

  it('sorts ASAP orders first (as given), then scheduled by slot start', () => {
    const rows = [
      { id: 'a', scheduled_for: at('2026-10-11', '10:00') },
      { id: 'b', scheduled_for: null },
      { id: 'c', scheduled_for: at('2026-10-10', '16:00') },
      { id: 'd', scheduled_for: null },
    ];
    expect(asapThenBySlot(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });
});

const day = (closed = false, open = '08:00', close = '21:00') => ({ closed, open, close });
const HOURS: StoreHours = {
  same_every_day: false,
  days: { mon: day(), tue: day(), wed: day(), thu: day(), fri: day(), sat: day(false, '09:00', '20:00'), sun: day(true) },
  updated_at: null,
};

describe('store schedule rules', () => {
  it('builds the PATCH body and mirrors the backend checks', () => {
    expect(buildHoursBody(true, { open: '08:00', close: '21:00' }, HOURS.days)).toEqual({
      body: { same_every_day: true, open: '08:00', close: '21:00' },
    });
    expect(buildHoursBody(true, { open: '21:00', close: '21:00' }, HOURS.days)).toEqual({
      error: 'Closing time must be after opening time.',
    });
    const allClosed = Object.fromEntries(Object.keys(HOURS.days).map((k) => [k, day(true)])) as StoreHours['days'];
    expect(buildHoursBody(false, { open: '08:00', close: '21:00' }, allClosed)).toEqual({ error: 'Keep at least one day open.' });
    expect(buildHoursBody(false, { open: '08:00', close: '21:00' }, { ...HOURS.days, tue: day(false, '18:00', '09:00') })).toEqual({
      error: 'Tuesday: Closing time must be after opening time.',
    });
    // A closed day's (ignored) times are not checked.
    expect(buildHoursBody(false, { open: '08:00', close: '21:00' }, { ...HOURS.days, sun: day(true, '22:00', '01:00') })).toHaveProperty(
      'body.same_every_day',
      false
    );
  });

  it('finds the next regular opening after today, skipping closed days and holidays', () => {
    // Today Sat 10 Oct; Sun closed; Mon 12 a holiday -> Tue 13 Oct 8 AM.
    const next = nextOpeningAfterToday(HOURS, [{ date: '2026-10-12', reason: null }], NOW);
    expect(next?.toISOString()).toBe(at('2026-10-13', '08:00'));
  });

  it('checks a reopen time is in the future and within 60 days', () => {
    expect(reopenError(null, NOW)).toBeNull();
    expect(reopenError(new Date(NOW.getTime() - 1000), NOW)).toBe('The reopen time must be in the future.');
    expect(reopenError(new Date(NOW.getTime() + 61 * 86_400_000), NOW)).toBe('Reopen within 60 days.');
    expect(reopenError(new Date(NOW.getTime() + 3_600_000), NOW)).toBeNull();
  });

  it('writes the status line', () => {
    const base: StoreStatus = {
      is_open_now: true,
      closed_kind: 'OPEN',
      closed_reason: null,
      reopens_at: null,
      next_open_at: null,
      today_hours: { open: '08:00', close: '21:00' },
    };
    expect(statusLine(base, NOW)).toBe('Open now · closes 9 PM');
    expect(
      statusLine({ ...base, is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Rain', reopens_at: at('2026-10-17', '08:00') }, NOW)
    ).toBe('Closed — Rain · reopens Sat 17 Oct 8 AM');
    expect(statusLine({ ...base, is_open_now: false, closed_kind: 'CLOSED_NOW', closed_reason: 'Rain' }, NOW)).toBe(
      'Closed — Rain · until staff reopen'
    );
    expect(
      statusLine({ ...base, is_open_now: false, closed_kind: 'OUTSIDE_HOURS', next_open_at: at('2026-10-11', '08:00') }, NOW)
    ).toBe('Closed now · opens Tomorrow 8 AM');
    expect(
      statusLine({ ...base, is_open_now: false, closed_kind: 'HOLIDAY', closed_reason: 'Public holiday', next_open_at: at('2026-10-11', '08:00') }, NOW)
    ).toBe('Closed today — Public holiday · opens Tomorrow 8 AM');
  });

  it('labels lead times', () => {
    expect(leadLabel(0)).toBe('No minimum');
    expect(leadLabel(45)).toBe('45 min');
    expect(leadLabel(60)).toBe('1 h');
    expect(leadLabel(90)).toBe('1 h 30 min');
  });
});
