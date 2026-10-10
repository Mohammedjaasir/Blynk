import type { DayHours, DayKey, StoreStatus } from '../api/types';

/**
 * Store schedule helpers (owner, 2026-10-10): opening hours, close-now,
 * holidays and delivery slots are set by staff in Settings, and scheduled
 * orders read "Scheduled: Tomorrow 8–10 AM" on the board. Everything is
 * Asia/Colombo, which is UTC+05:30 all year (no daylight saving), so the
 * wall clock is the UTC clock shifted by 330 minutes.
 */
const COLOMBO_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;

export const DAY_KEYS: ReadonlyArray<DayKey> = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Colombo wall clock of an instant, read through the UTC getters. */
function colombo(at: string | Date): Date {
  const ms = typeof at === 'string' ? Date.parse(at) : at.getTime();
  return new Date(ms + COLOMBO_OFFSET_MIN * 60_000);
}

/** Days since the epoch of the Colombo calendar day an instant falls on. */
function colomboDayNumber(at: string | Date): number {
  return Math.floor(colombo(at).getTime() / DAY_MS);
}

/** "YYYY-MM-DD" of the Colombo calendar day of an instant. */
export function colomboDateKey(at: string | Date = new Date()): string {
  return colombo(at).toISOString().slice(0, 10);
}

/** 'Sat 12 Oct' for a "YYYY-MM-DD" calendar day (no timezone shift). */
export function formatDateKey(key: string): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 'Today' / 'Tomorrow' / 'Sat 12 Oct' for the Colombo day of an instant. */
export function dayLabel(at: string | Date, now: Date = new Date()): string {
  const diff = colomboDayNumber(at) - colomboDayNumber(now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return formatDateKey(colomboDateKey(at));
}

function clockParts(h: number, m: number): { text: string; period: 'AM' | 'PM' } {
  return { text: `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`, period: h < 12 ? 'AM' : 'PM' };
}

/** "21:00" -> "9 PM", "08:30" -> "8:30 AM". */
export function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const p = clockParts(h ?? 0, m ?? 0);
  return `${p.text} ${p.period}`;
}

/** Colombo clock time of an instant: "8 AM", "4:30 PM". */
export function formatInstantTime(at: string | Date): string {
  const c = colombo(at);
  const p = clockParts(c.getUTCHours(), c.getUTCMinutes());
  return `${p.text} ${p.period}`;
}

/** En-dash range in Colombo time: '4–6 PM', '11 AM–1 PM', '8:30–9:30 AM'. */
export function formatTimeRange(start: string | Date, end: string | Date): string {
  const s = colombo(start);
  const e = colombo(end);
  const a = clockParts(s.getUTCHours(), s.getUTCMinutes());
  const b = clockParts(e.getUTCHours(), e.getUTCMinutes());
  return a.period === b.period ? `${a.text}–${b.text} ${b.period}` : `${a.text} ${a.period}–${b.text} ${b.period}`;
}

/**
 * A delivery slot as staff read it: "Tomorrow 8–10 AM". Older orders carry
 * only the start (scheduled_until null), shown as "Tomorrow 8 AM".
 */
export function formatSlot(start: string, end: string | null | undefined, now: Date = new Date()): string {
  const time = end ? formatTimeRange(start, end) : formatInstantTime(start);
  return `${dayLabel(start, now)} ${time}`;
}

/** The board / detail label: "Scheduled: Tomorrow 8–10 AM". */
export function scheduledLabel(start: string, end: string | null | undefined, now: Date = new Date()): string {
  return `Scheduled: ${formatSlot(start, end, now)}`;
}

/** Every 15-minute step of a day, 00:00..23:45, as "HH:MM". */
export const QUARTER_HOURS: ReadonlyArray<string> = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const isQuarter = (hhmm: string) => /^([01]\d|2[0-3]):(00|15|30|45)$/.test(hhmm);

/** One open/close pair: the backend's rule (15-minute steps, open < close). */
export function pairError(open: string, close: string): string | null {
  if (!isQuarter(open) || !isQuarter(close)) return 'Pick times on the quarter hour.';
  if (toMinutes(open) >= toMinutes(close)) return 'Opening time must be before closing time.';
  return null;
}

/**
 * The opening-hours form, checked as the backend checks it: every open day
 * opens before it closes, and at least one day is open. Returns per-day
 * errors (or `same` for the single pair) and one form-level error.
 */
export function validateHours(
  sameEveryDay: boolean,
  same: { open: string; close: string },
  days: Record<DayKey, DayHours>
): { same?: string; days: Partial<Record<DayKey, string>>; form?: string } {
  if (sameEveryDay) {
    const error = pairError(same.open, same.close);
    return error ? { same: error, days: {} } : { days: {} };
  }
  const out: Partial<Record<DayKey, string>> = {};
  for (const key of DAY_KEYS) {
    const day = days[key];
    if (day.closed) continue;
    const error = pairError(day.open, day.close);
    if (error) out[key] = error;
  }
  const anyOpen = DAY_KEYS.some((key) => !days[key].closed);
  return anyOpen ? { days: out } : { days: out, form: 'Keep at least one day open.' };
}

/**
 * When the store opens again, in short words: "today 8 AM", "tomorrow 8 AM",
 * "Sat 8 AM" within the week, "Sat 12 Oct 8 AM" further out.
 */
export function formatReopen(at: string, now: Date = new Date()): string {
  const diff = colomboDayNumber(at) - colomboDayNumber(now);
  const time = formatInstantTime(at);
  if (diff === 0) return `today ${time}`;
  if (diff === 1) return `tomorrow ${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAYS[colombo(at).getUTCDay()]} ${time}`;
  return `${formatDateKey(colomboDateKey(at))} ${time}`;
}

/**
 * The status line over the schedule settings: "Open now · closes 9 PM" or
 * "Closed — Rain · reopens Sat 8 AM".
 */
export function statusLine(status: StoreStatus, now: Date = new Date()): string {
  if (status.is_open_now) {
    return status.today_hours ? `Open now · closes ${formatHHMM(status.today_hours.close)}` : 'Open now';
  }
  const why =
    status.closed_kind === 'CLOSED_NOW'
      ? status.closed_reason || 'Closed by staff'
      : status.closed_kind === 'HOLIDAY'
        ? status.closed_reason
          ? `Holiday (${status.closed_reason})`
          : 'Holiday'
        : status.closed_kind === 'CLOSED_DAY'
          ? 'Closed today'
          : 'Outside opening hours';
  const reopen = status.closed_kind === 'CLOSED_NOW' ? (status.reopens_at ?? null) : null;
  const next = reopen ?? status.next_open_at;
  if (next) return `Closed — ${why} · reopens ${formatReopen(next, now)}`;
  return status.closed_kind === 'CLOSED_NOW' ? `Closed — ${why} · until staff reopen` : `Closed — ${why}`;
}

/** The next `count` Colombo calendar days from today, as "YYYY-MM-DD". */
export function upcomingDateKeys(count: number, now: Date = new Date()): string[] {
  const today = colomboDayNumber(now);
  return Array.from({ length: count }, (_, i) => new Date((today + i) * DAY_MS).toISOString().slice(0, 10));
}

/** 'Today' / 'Tomorrow' / 'Sat 12 Oct' for a "YYYY-MM-DD" key. */
export function dateKeyLabel(key: string, now: Date = new Date()): string {
  const diff = Math.round(Date.parse(`${key}T00:00:00.000Z`) / DAY_MS) - colomboDayNumber(now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return formatDateKey(key);
}

/** A Colombo calendar day + "HH:MM" as an ISO instant. */
export function colomboToIso(dateKey: string, hhmm: string): string {
  return new Date(Date.parse(`${dateKey}T${hhmm}:00.000Z`) - COLOMBO_OFFSET_MIN * 60_000).toISOString();
}

/** The Colombo "HH:MM" of an instant. */
export function colomboHHMM(at: string | Date): string {
  return colombo(at).toISOString().slice(11, 16);
}

/** Lead-time choices (0..240 in 15-minute steps) in words: "None", "45 min", "1 h 30 min". */
export function leadLabel(minutes: number): string {
  if (minutes === 0) return 'None';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const LEAD_CHOICES: ReadonlyArray<number> = Array.from({ length: 17 }, (_, i) => i * 15);
export const SLOT_LENGTHS: ReadonlyArray<30 | 60 | 120> = [30, 60, 120];
export const SLOT_LENGTH_LABEL: Record<30 | 60 | 120, string> = { 30: '30 min', 60: '1 hour', 120: '2 hours' };
export const DAYS_AHEAD: ReadonlyArray<1 | 2 | 3> = [1, 2, 3];
/** days_ahead counts days after today: 1 = today and tomorrow. */
export const DAYS_AHEAD_LABEL: Record<1 | 2 | 3, string> = { 1: '1 day', 2: '2 days', 3: '3 days' };
export const CLOSURE_REASONS: ReadonlyArray<string> = ['Rain', 'Holiday', 'Stock-taking'];
export const MAX_SLOT_ORDERS = 100;
export const MAX_CLOSURE_REASON = 200;
export const MAX_HOLIDAY_REASON = 100;
export const MAX_HOLIDAYS = 60;
/** Close-now reopen times may be at most 60 days out (backend rule). */
export const REOPEN_DAYS = 60;

/**
 * (owner, 2026-10-10) "Send offer/birthday texts on closed days" - the
 * explanation under the switch, for each position.
 */
export const SMS_ON_CLOSED_DAYS_HINT = {
  on: 'On: offers, test texts and birthday texts still go out on a closed weekday (8 AM to 9 PM), on a holiday and while the store is closed now.',
  off: "Off: no offer, test or birthday texts on a closed weekday, a holiday or while the store is closed now. A birthday text then goes out on the next open day, if it is still the customer's birthday week.",
} as const;
