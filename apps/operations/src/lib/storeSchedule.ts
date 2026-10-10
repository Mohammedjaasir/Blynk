import type { DayHours, DayKey, StoreHoliday, StoreHours, StoreHoursInput, StoreStatus } from '../api/types';
import { addDays, colomboDate, colomboInstant, formatHhmm, formatMoment, weekdayKey } from './slots';

/**
 * Store schedule rules for More -> Opening hours (owner, 2026-10-10). The
 * checks mirror the backend's (store-schedule contract) so staff see the
 * mistake before saving; the API stays the authority and its message is
 * shown when it refuses.
 */

export const DAY_KEYS: readonly DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** 00:00 .. 23:45 in 15-minute steps - the only times the backend accepts. */
export const TIME_OPTIONS: readonly string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

export const DEFAULT_DAY: DayHours = { closed: false, open: '08:00', close: '21:00' };

export const MAX_CLOSURE_REASON = 200;
export const MAX_HOLIDAY_REASON = 100;
export const MAX_HOLIDAYS = 60;
export const MAX_REOPEN_DAYS = 60;

export const SLOT_MINUTE_CHOICES = [30, 60, 120] as const;
export const DAYS_AHEAD_CHOICES = [1, 2, 3] as const;
export const MIN_ORDERS_PER_SLOT = 1;
export const MAX_ORDERS_PER_SLOT = 100;
export const MAX_LEAD_MINUTES = 240;
export const LEAD_STEP = 15;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const onStep = (hhmm: string) => TIME_OPTIONS.includes(hhmm);

/** The problem with one open/close pair, or null. */
export function pairError(open: string, close: string, prefix = ''): string | null {
  if (!onStep(open) || !onStep(close)) return `${prefix}Pick times on the quarter hour.`;
  if (toMinutes(open) >= toMinutes(close)) return `${prefix}Closing time must be after opening time.`;
  return null;
}

/** Same-hours form or per-day form -> the PATCH body, or the first problem. */
export function buildHoursBody(
  sameEveryDay: boolean,
  same: { open: string; close: string },
  days: Record<DayKey, DayHours>
): { body: StoreHoursInput } | { error: string } {
  if (sameEveryDay) {
    const err = pairError(same.open, same.close);
    return err ? { error: err } : { body: { same_every_day: true, open: same.open, close: same.close } };
  }
  if (DAY_KEYS.every((k) => days[k].closed)) return { error: 'Keep at least one day open.' };
  for (const k of DAY_KEYS) {
    if (days[k].closed) continue;
    const err = pairError(days[k].open, days[k].close, `${DAY_NAMES[k]}: `);
    if (err) return { error: err };
  }
  const copy = Object.fromEntries(DAY_KEYS.map((k) => [k, { closed: days[k].closed, open: days[k].open, close: days[k].close }]));
  return { body: { same_every_day: false, days: copy as Record<DayKey, DayHours> } };
}

/** The pair the "same hours" mode starts from: the first open day's. */
export function firstOpenPair(hours: StoreHours): { open: string; close: string } {
  const day = DAY_KEYS.map((k) => hours.days[k]).find((d) => !d.closed) ?? DEFAULT_DAY;
  return { open: day.open, close: day.close };
}

/** The status line at the top of the screen, e.g. "Open now · closes 9 PM"
 * or "Closed — Rain · reopens Sat 8 AM". */
export function statusLine(status: StoreStatus, now: Date = new Date()): string {
  const opens = status.next_open_at ? ` · opens ${formatMoment(status.next_open_at, now)}` : '';
  switch (status.closed_kind) {
    case 'OPEN':
      return status.today_hours ? `Open now · closes ${formatHhmm(status.today_hours.close)}` : 'Open now';
    case 'CLOSED_NOW': {
      const why = status.closed_reason ? `Closed — ${status.closed_reason}` : 'Closed now';
      const until = status.reopens_at ?? status.next_open_at;
      return until ? `${why} · reopens ${formatMoment(until, now)}` : `${why} · until staff reopen`;
    }
    case 'HOLIDAY':
      return `Closed today — ${status.closed_reason ?? 'Holiday'}${opens}`;
    case 'CLOSED_DAY':
      return `Closed today${opens}`;
    case 'OUTSIDE_HOURS':
    default:
      return `Closed now${opens}`;
  }
}

/**
 * The next regular opening after today: the first later day that is open
 * and not a holiday, at its opening time (the "Tomorrow 8 AM" reopen chip).
 * Today is skipped on purpose - closing now for the rest of today is the
 * common case. Null when nothing opens within the reopen limit.
 */
export function nextOpeningAfterToday(hours: StoreHours, holidays: StoreHoliday[], now: Date = new Date()): Date | null {
  const today = colomboDate(now);
  const off = new Set(holidays.map((h) => h.date));
  for (let i = 1; i <= MAX_REOPEN_DAYS; i++) {
    const ymd = addDays(today, i);
    const day = hours.days[weekdayKey(ymd)];
    if (!day.closed && !off.has(ymd)) return colomboInstant(ymd, day.open);
  }
  return null;
}

/** The problem with a staff reopen time, or null (future, within 60 days). */
export function reopenError(at: Date | null, now: Date = new Date()): string | null {
  if (!at) return null;
  if (at.getTime() <= now.getTime()) return 'The reopen time must be in the future.';
  if (at.getTime() > now.getTime() + MAX_REOPEN_DAYS * 24 * 60 * 60_000) return `Reopen within ${MAX_REOPEN_DAYS} days.`;
  return null;
}

/** "1 h", "45 min", "1 h 30 min", "No minimum" for a lead time. */
export function leadLabel(minutes: number): string {
  if (minutes <= 0) return 'No minimum';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function slotLengthLabel(minutes: number): string {
  return minutes === 30 ? '30 min' : minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
}

export function daysAheadLabel(days: number): string {
  return days === 1 ? 'Today + tomorrow' : `Today + ${days} days`;
}

/**
 * (owner, 2026-10-10) "Send offer/birthday texts on closed days" - the
 * explanation under the switch, for each position.
 */
export const SMS_ON_CLOSED_DAYS_HINT = {
  on: 'On: offers, test texts and birthday texts still go out on a closed weekday (8 AM to 9 PM), on a holiday and while the store is closed now.',
  off: "Off: no offer, test or birthday texts on a closed weekday, a holiday or while the store is closed now. A birthday text then goes out on the next open day, if it is still the customer's birthday week.",
} as const;
