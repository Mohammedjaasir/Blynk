import { DateTime } from 'luxon';

/**
 * Store timing decided by Operations and Admin (owner, 2026-10-10): "make
 * sure the timing will be decided by ops and admin".
 *
 * Pure rules only - no database. The stored settings (opening hours, the
 * "close the store now" switch, the holiday list and the delivery-slot
 * settings) are read by modules/configuration/store-schedule.ts and handed
 * to these functions. Every time is Asia/Colombo.
 *
 * Defaults (no rows stored) are the hours the store always had: 08:00-21:00
 * every day, open, no holidays, delivery slots off - so nothing changes until
 * staff edit them.
 */

export const STORE_TIMEZONE = 'Asia/Colombo';

/** Monday first, like luxon's weekday (1 = Monday ... 7 = Sunday). */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export interface DayHours {
  closed: boolean;
  open: string; // 'HH:MM', 15-minute steps
  close: string; // 'HH:MM', after open
}

export interface WeeklyHours {
  same_every_day: boolean;
  days: Record<DayKey, DayHours>;
}

export interface ClosureState {
  closed: boolean;
  reason: string | null;
  reopens_at: string | null; // ISO; null = closed until staff reopen
  closed_at: string | null;
}

export interface Holiday {
  date: string; // 'YYYY-MM-DD' in Asia/Colombo
  reason: string | null;
}

export type SlotMinutes = 30 | 60 | 120;

export interface SlotSettings {
  enabled: boolean;
  slot_minutes: SlotMinutes;
  days_ahead: number; // 1..3 days after today
  max_orders_per_slot: number;
  min_lead_minutes: number;
}

export interface ScheduleState {
  hours: WeeklyHours;
  closure: ClosureState;
  holidays: Holiday[];
  slots: SlotSettings;
}

export const DEFAULT_OPEN = '08:00';
export const DEFAULT_CLOSE = '21:00';

export function uniformWeek(open: string, close: string): Record<DayKey, DayHours> {
  return Object.fromEntries(DAY_KEYS.map((k) => [k, { closed: false, open, close }])) as Record<DayKey, DayHours>;
}

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  same_every_day: true,
  days: uniformWeek(DEFAULT_OPEN, DEFAULT_CLOSE),
};

export const DEFAULT_CLOSURE: ClosureState = { closed: false, reason: null, reopens_at: null, closed_at: null };

export const DEFAULT_SLOT_SETTINGS: SlotSettings = {
  enabled: false,
  slot_minutes: 120,
  days_ahead: 1,
  max_orders_per_slot: 10,
  min_lead_minutes: 60,
};

export const DEFAULT_SCHEDULE: ScheduleState = {
  hours: DEFAULT_WEEKLY_HOURS,
  closure: DEFAULT_CLOSURE,
  holidays: [],
  slots: DEFAULT_SLOT_SETTINGS,
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight for 'HH:MM', or null when malformed. */
export function toMinutes(hhmm: string): number | null {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 'HH:MM' on a 15-minute step (00:00 .. 23:45). */
export function isQuarterHour(hhmm: string): boolean {
  const m = toMinutes(hhmm);
  return m !== null && m % 15 === 0;
}

export function dayKeyOf(local: DateTime): DayKey {
  return DAY_KEYS[local.weekday - 1];
}

const local = (at: Date) => DateTime.fromJSDate(at).setZone(STORE_TIMEZONE);
const atMinutes = (day: DateTime, minutes: number) =>
  day.startOf('day').plus({ minutes });

export function closureActive(closure: ClosureState, at: Date): boolean {
  if (!closure.closed) return false;
  if (!closure.reopens_at) return true;
  return at.getTime() < Date.parse(closure.reopens_at);
}

/**
 * The opening window of one calendar day (Colombo), or null when that day is
 * closed by the weekly hours or is a holiday. Ignores "close now".
 */
export function dayWindow(state: Pick<ScheduleState, 'hours' | 'holidays'>, day: DateTime) {
  const date = day.toISODate();
  const holiday = state.holidays.find((h) => h.date === date) ?? null;
  const hours = state.hours.days[dayKeyOf(day)];
  if (holiday || hours.closed) return { open: null, close: null, holiday, hours } as const;
  const open = toMinutes(hours.open) ?? toMinutes(DEFAULT_OPEN)!;
  const close = toMinutes(hours.close) ?? toMinutes(DEFAULT_CLOSE)!;
  return { open: atMinutes(day, open), close: atMinutes(day, close), holiday, hours } as const;
}

/** The next moment (>= from) inside the regular hours, holidays skipped. */
export function nextOpenFrom(state: Pick<ScheduleState, 'hours' | 'holidays'>, from: Date): Date | null {
  const start = local(from);
  for (let i = 0; i < 400; i++) {
    const w = dayWindow(state, start.plus({ days: i }));
    if (!w.open) continue;
    const candidate = w.open < start ? start : w.open;
    if (candidate < w.close) return candidate.toJSDate();
  }
  return null;
}

/** Inside the weekly hours at this moment (holidays and "close now" ignored). */
export function withinWeeklyHours(hours: WeeklyHours, at: Date): boolean {
  const l = local(at);
  const d = hours.days[dayKeyOf(l)];
  if (d.closed) return false;
  const now = l.hour * 60 + l.minute;
  const open = toMinutes(d.open);
  const close = toMinutes(d.close);
  return open !== null && close !== null && now >= open && now < close;
}

/**
 * SMS sending window (offers, test SMS, birthday SMS): the weekday's opening
 * hours; on a weekday staff marked closed, the default 8 AM - 9 PM courtesy
 * window, so an automatic birthday SMS is not lost that day. Holidays and
 * "close now" do not stop messages - they are not orders.
 */
export function withinSmsWindow(hours: WeeklyHours, at: Date): boolean {
  const day = hours.days[dayKeyOf(local(at))];
  return withinWeeklyHours(day.closed ? DEFAULT_WEEKLY_HOURS : hours, at);
}

export type ClosedKind = 'OPEN' | 'OUTSIDE_HOURS' | 'CLOSED_DAY' | 'HOLIDAY' | 'CLOSED_NOW';

export interface StoreStatus {
  is_open_now: boolean;
  closed_kind: ClosedKind;
  closed_reason: string | null;
  reopens_at: string | null;
  next_open_at: string | null;
  today_hours: { open: string; close: string } | null;
}

/** Whether orders are taken now, and if not why and until when. */
export function storeStatusAt(state: ScheduleState, at: Date): StoreStatus {
  const l = local(at);
  const w = dayWindow(state, l);
  const today_hours = w.open ? { open: w.hours.open, close: w.hours.close } : null;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  if (closureActive(state.closure, at)) {
    const reopens = state.closure.reopens_at ? new Date(state.closure.reopens_at) : null;
    return {
      is_open_now: false,
      closed_kind: 'CLOSED_NOW',
      closed_reason: state.closure.reason,
      reopens_at: reopens ? reopens.toISOString() : null,
      next_open_at: reopens ? iso(nextOpenFrom(state, reopens)) : null,
      today_hours,
    };
  }
  const base = { closed_reason: null, reopens_at: null, today_hours };
  if (w.holiday) {
    return { ...base, is_open_now: false, closed_kind: 'HOLIDAY', closed_reason: w.holiday.reason, next_open_at: iso(nextOpenFrom(state, at)) };
  }
  if (!w.open) {
    return { ...base, is_open_now: false, closed_kind: 'CLOSED_DAY', next_open_at: iso(nextOpenFrom(state, at)) };
  }
  if (l >= w.open && l < w.close) {
    return { ...base, is_open_now: true, closed_kind: 'OPEN', next_open_at: null };
  }
  return { ...base, is_open_now: false, closed_kind: 'OUTSIDE_HOURS', next_open_at: iso(nextOpenFrom(state, at)) };
}

/** '8 AM', '8:30 PM', '12 PM' for a Colombo time. */
export function clockLabel(t: DateTime, withMeridiem = true): string {
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const time = t.minute ? `${h12}:${String(t.minute).padStart(2, '0')}` : String(h12);
  return withMeridiem ? `${time} ${t.hour < 12 ? 'AM' : 'PM'}` : time;
}

/** '8 AM' for '08:00'. */
export function hhmmLabel(hhmm: string): string {
  const m = toMinutes(hhmm) ?? 0;
  return clockLabel(DateTime.fromObject({ hour: Math.floor(m / 60), minute: m % 60 }, { zone: STORE_TIMEZONE }));
}

/** '4–6 PM', '11 AM–1 PM', '8:30–9:30 AM' (en dash). */
export function rangeLabel(start: Date, end: Date): string {
  const s = local(start);
  const e = local(end);
  const sameHalf = (s.hour < 12) === (e.hour < 12) && e > s && e.diff(s, 'hours').hours < 12;
  return sameHalf ? `${clockLabel(s, false)}–${clockLabel(e)}` : `${clockLabel(s)}–${clockLabel(e)}`;
}

/** 'Today' / 'Tomorrow' / 'Sat 12 Oct', relative to `now`. */
export function dayLabel(at: Date, now: Date): string {
  const d = local(at).startOf('day');
  const today = local(now).startOf('day');
  const diff = Math.round(d.diff(today, 'days').days);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toFormat('ccc d LLL');
}

/** '8 AM', '8 AM tomorrow', '8 AM on Sat 12 Oct'. */
export function whenLabel(at: Date, now: Date): string {
  const day = dayLabel(at, now);
  const clock = clockLabel(local(at));
  if (day === 'Today') return clock;
  if (day === 'Tomorrow') return `${clock} tomorrow`;
  return `${clock} on ${day}`;
}

/** The STORE_CLOSED message order placement answers with. */
export function storeClosedMessage(status: StoreStatus, now: Date, slotsEnabled: boolean): string {
  const next = status.next_open_at ? new Date(status.next_open_at) : null;
  const slotHint = slotsEnabled ? ' You can pick a delivery slot instead.' : '';
  if (status.closed_kind === 'OUTSIDE_HOURS' && status.today_hours && next) {
    return `Blynk takes orders from ${hhmmLabel(status.today_hours.open)} to ${hhmmLabel(status.today_hours.close)}. Please order again from ${whenLabel(next, now)}.${slotHint}`;
  }
  const reason = status.closed_reason ? ` (${status.closed_reason})` : '';
  const head =
    status.closed_kind === 'CLOSED_NOW' || status.closed_kind === 'OUTSIDE_HOURS'
      ? `Blynk is closed now${status.closed_kind === 'CLOSED_NOW' ? reason : ''}.`
      : `Blynk is closed today${status.closed_kind === 'HOLIDAY' ? reason : ''}.`;
  const tail = next ? ` We open again at ${whenLabel(next, now)}.` : ' Please check back later.';
  return `${head}${tail}${slotHint}`;
}

export interface DeliverySlot {
  start: string;
  end: string;
  day_label: string;
  time_label: string;
  label: string;
  remaining: number;
  available: boolean;
}

/**
 * The delivery slots a customer may pick now: each open day from today up to
 * `days_ahead` days after it, split into `slot_minutes` pieces from opening
 * to closing (the last one ends at closing). A slot starting before now +
 * the minimum lead time, on a holiday or closed day, or while the store is
 * closed by "close now", is not offered. `booked` counts the non-cancelled
 * orders already in each slot (keyed by start ISO).
 */
export function buildSlots(state: ScheduleState, now: Date, booked: Map<string, number> = new Map()): DeliverySlot[] {
  const s = state.slots;
  if (!s.enabled) return [];
  const earliest = now.getTime() + s.min_lead_minutes * 60_000;
  const today = local(now).startOf('day');
  const out: DeliverySlot[] = [];
  for (let i = 0; i <= s.days_ahead; i++) {
    const w = dayWindow(state, today.plus({ days: i }));
    if (!w.open) continue;
    for (let start = w.open; start < w.close; start = start.plus({ minutes: s.slot_minutes })) {
      const end = DateTime.min(start.plus({ minutes: s.slot_minutes }), w.close);
      const startDate = start.toJSDate();
      if (startDate.getTime() < earliest) continue;
      if (closureActive(state.closure, startDate)) continue;
      const startIso = startDate.toISOString();
      const remaining = Math.max(0, s.max_orders_per_slot - (booked.get(startIso) ?? 0));
      const day_label = dayLabel(startDate, now);
      const time_label = rangeLabel(startDate, end.toJSDate());
      out.push({
        start: startIso,
        end: end.toJSDate().toISOString(),
        day_label,
        time_label,
        label: `${day_label} ${time_label}`,
        remaining,
        available: remaining > 0,
      });
    }
  }
  return out;
}

/** The hours label for a day's window: '08:00'/'21:00' pair for GET /store. */
export function displayHours(state: ScheduleState, at: Date): { start: string; end: string } {
  const l = local(at);
  for (let i = 0; i < 400; i++) {
    const w = dayWindow(state, l.plus({ days: i }));
    if (w.open) return { start: w.hours.open, end: w.hours.close };
  }
  return { start: DEFAULT_OPEN, end: DEFAULT_CLOSE };
}
