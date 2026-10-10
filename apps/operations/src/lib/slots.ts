/**
 * Delivery-slot and store-time wording, Asia/Colombo (owner, 2026-10-10).
 * Colombo is UTC+05:30 all year (no daylight saving), so a fixed offset is
 * exact - the same trick lib/catalog.ts and the Orders board already use.
 *
 * Display convention for staff (store-schedule contract): "Scheduled:
 * Tomorrow 8–10 AM" - a day ('Today' | 'Tomorrow' | 'Sat 12 Oct') and an
 * en-dash time range that only repeats AM/PM when the two ends differ
 * ('4–6 PM', '11 AM–1 PM', '8:30–9:30 AM').
 */

const COLOMBO_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Colombo wall clock of an instant, read from a shifted UTC Date. */
function wall(instant: Date): Date {
  return new Date(instant.getTime() + COLOMBO_OFFSET_MS);
}

/** Days since the epoch of the Colombo calendar day an instant falls on. */
function colomboDayNumber(instant: Date): number {
  return Math.floor(wall(instant).getTime() / DAY_MS);
}

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** 'Sat 12 Oct' - a calendar day without the relative words. */
export function formatSlotDate(value: string | Date): string {
  const w = wall(toDate(value));
  return `${WEEKDAYS[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}`;
}

/** 'Today' | 'Tomorrow' | 'Sat 12 Oct' (yesterday and older read as a date). */
export function slotDayLabel(value: string | Date, now: Date = new Date()): string {
  const diff = colomboDayNumber(toDate(value)) - colomboDayNumber(now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return formatSlotDate(value);
}

/** Hour and minute on the 12-hour clock, minutes only when not ':00'. */
function clockParts(hours24: number, minutes: number): { time: string; meridiem: 'AM' | 'PM' } {
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  const h = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return { time: minutes ? `${h}:${String(minutes).padStart(2, '0')}` : String(h), meridiem };
}

function instantClock(value: string | Date) {
  const w = wall(toDate(value));
  return clockParts(w.getUTCHours(), w.getUTCMinutes());
}

/** '8 AM', '5:30 PM' for an instant (Colombo). */
export function formatSlotClock(value: string | Date): string {
  const c = instantClock(value);
  return `${c.time} ${c.meridiem}`;
}

/** '8 AM', '5:30 PM' for a stored 'HH:MM' store time. */
export function formatHhmm(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const c = clockParts(h, m);
  return `${c.time} ${c.meridiem}`;
}

/**
 * '4–6 PM', '11 AM–1 PM', '8:30–9:30 AM' (en dash). With no end (older
 * orders carry only scheduled_for) it is just the start: '4 PM'.
 */
export function formatSlotRange(start: string | Date, end?: string | Date | null): string {
  const a = instantClock(start);
  if (!end) return `${a.time} ${a.meridiem}`;
  const b = instantClock(end);
  return a.meridiem === b.meridiem ? `${a.time}–${b.time} ${b.meridiem}` : `${a.time} ${a.meridiem}–${b.time} ${b.meridiem}`;
}

/** 'Tomorrow 8–10 AM' - the slot as staff read it on the board and order. */
export function formatSlot(start: string | Date, end?: string | Date | null, now: Date = new Date()): string {
  return `${slotDayLabel(start, now)} ${formatSlotRange(start, end)}`;
}

/** 'Sat 12 Oct, 8–10 AM' - no Today/Tomorrow, for paper (the packing slip
 * may be read a day after it is printed). */
export function formatSlotAbsolute(start: string | Date, end?: string | Date | null): string {
  return `${formatSlotDate(start)}, ${formatSlotRange(start, end)}`;
}

/** A moment the store opens/reopens: '3 PM' today, else 'Tomorrow 8 AM' / 'Sat 12 Oct 8 AM'. */
export function formatMoment(value: string | Date, now: Date = new Date()): string {
  const day = slotDayLabel(value, now);
  return day === 'Today' ? formatSlotClock(value) : `${day} ${formatSlotClock(value)}`;
}

// ----------------------------------------------------- Colombo day helpers
/** The Colombo calendar day of an instant, YYYY-MM-DD. */
export function colomboDate(value: string | Date): string {
  return wall(toDate(value)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD `days` after the given YYYY-MM-DD. */
export function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The instant of a Colombo wall time: ('2026-10-11', '08:00') -> ISO. */
export function colomboInstant(ymd: string, hhmm: string): Date {
  return new Date(Date.parse(`${ymd}T${hhmm}:00Z`) - COLOMBO_OFFSET_MS);
}

/** 'mon'..'sun' of a YYYY-MM-DD. */
export function weekdayKey(ymd: string): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  return keys[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
}

/** 'Today' | 'Tomorrow' | 'Sat 12 Oct' for a YYYY-MM-DD calendar day. */
export function dayLabelForDate(ymd: string, now: Date = new Date()): string {
  return slotDayLabel(colomboInstant(ymd, '12:00'), now);
}

// ------------------------------------------------------- orders and slots
type Scheduled = { scheduled_for: string | null; scheduled_until?: string | null };

/** "Scheduled: Tomorrow 8–10 AM", or null for an as-soon-as-possible order. */
export function scheduledLabel(order: Scheduled, now: Date = new Date()): string | null {
  return order.scheduled_for ? `Scheduled: ${formatSlot(order.scheduled_for, order.scheduled_until, now)}` : null;
}

/**
 * Board order within a lane: as-soon-as-possible orders first, in the order
 * the API gave them (oldest first, unchanged); scheduled orders after them,
 * earliest slot first (owner, 2026-10-10). Stable - never reshuffles ties.
 */
export function asapThenBySlot<T extends Scheduled>(orders: readonly T[]): T[] {
  const asap = orders.filter((o) => !o.scheduled_for);
  const scheduled = orders
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.scheduled_for)
    .sort((a, b) => Date.parse(a.o.scheduled_for!) - Date.parse(b.o.scheduled_for!) || a.i - b.i)
    .map(({ o }) => o);
  return [...asap, ...scheduled];
}
