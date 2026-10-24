import type { StoreInfo } from '@/blynk/api/types';
import type { BasketStatus, Frequency } from './models';
import { SCHEDULE_WORDS as W } from './words';

/*
 * Repeat basket schedules in words, and the times a customer may pick. Everything is Sri Lanka
 * time (Asia/Colombo, UTC+05:30 all year: no daylight saving), so the arithmetic is a fixed
 * offset and the same on every phone. The opening hours always come from the store settings
 * Admin / Ops keep (GET /store `hours`, else `delivery_hours`) - never typed in here. Pure.
 */

const OFFSET_MIN = 330;
const DAY_MS = 86_400_000;
const STEP = 15;

/** 0 = Sunday ... 6 = Saturday, in the customer's language (read while rendering). */
export const weekdayName = (wd: number): string => W.weekdays[wd];
export const weekdayShort = (wd: number): string => W.weekdaysShort[wd];
/** GET /store `hours.days` keys by weekday (0 = Sunday, as the API's `weekday`). */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** The Colombo calendar day and clock of an instant. */
export function colombo(d: Date): { y: number; m: number; day: number; weekday: number; minutes: number; ymd: string } {
  const s = new Date(d.getTime() + OFFSET_MIN * 60_000);
  const y = s.getUTCFullYear(), m = s.getUTCMonth() + 1, day = s.getUTCDate();
  return {
    y, m, day,
    weekday: s.getUTCDay(),
    minutes: s.getUTCHours() * 60 + s.getUTCMinutes(),
    ymd: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/** The instant of a Colombo date ('YYYY-MM-DD') and clock ('HH:MM'). */
export function colomboInstant(ymd: string, hhmm: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const mins = toMinutes(hhmm) ?? 0;
  return new Date(Date.UTC(y, m - 1, d, 0, mins) - OFFSET_MIN * 60_000);
}

export function toMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h > 24 || min > 59 || h * 60 + min > 1440 ? null : h * 60 + min;
}

export const fromMinutes = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** '08:00' -> '8:00 am', '13:45' -> '1:45 pm' (the app's lower-case clock, with minutes). */
export function timeLabel(hhmm: string): string {
  const n = toMinutes(hhmm);
  if (n === null) return hhmm;
  const h = Math.floor(n / 60) % 24, m = n % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? W.am : W.pm}`;
}

/** '8 am' for an hour chip. */
export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h % 24 < 12 ? W.am : W.pm}`;

/** "Every day at 8:00 am", "Every Monday at 8:00 am", "Every 2 weeks on Monday at 8:00 am". */
export function scheduleText(frequency: Frequency, weekday: number | null, placeAt: string): string {
  const at = timeLabel(placeAt);
  const day = weekday !== null && weekday >= 0 && weekday <= 6 ? weekdayName(weekday) : null;
  if (frequency === 'DAILY' || !day) return W.everyDay(at);
  return frequency === 'WEEKLY' ? W.everyWeekday(day, at) : W.everyTwoWeeks(day, at);
}

/** "Today 8:00 am", "Tomorrow 8:00 am", "Mon 8:00 am" (this week), "Mon 3 Nov, 8:00 am" (later). */
export function whenText(at: Date, now: Date = new Date()): string {
  const a = colombo(at), n = colombo(now);
  const clock = timeLabel(fromMinutes(a.minutes));
  const days = Math.round((Date.UTC(a.y, a.m - 1, a.day) - Date.UTC(n.y, n.m - 1, n.day)) / DAY_MS);
  if (days === 0) return W.today(clock);
  if (days === 1) return W.tomorrow(clock);
  if (days > 1 && days < 7) return W.weekdayClock(weekdayShort(a.weekday), clock);
  return W.later(weekdayShort(a.weekday), a.day, W.months[a.m - 1], clock);
}

/** "Next: Mon 8:00 am"; null when there is no next run. */
export function nextRunText(iso: string | null | undefined, now: Date = new Date()): string | null {
  const at = iso ? new Date(iso) : null;
  return at && !Number.isNaN(at.getTime()) ? W.next(whenText(at, now)) : null;
}

/** "in 25 min", "in 5 h", "in 3 days"; null once the time has come. */
export function countdownText(iso: string | null | undefined, now: Date = new Date()): string | null {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return null;
  const min = Math.ceil((at - now.getTime()) / 60_000);
  if (min <= 0) return null;
  if (min < 60) return W.inMinutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) return W.inHours(h);
  const d = Math.round(h / 24);
  return d === 1 ? W.inOneDay : W.inDays(d);
}

const PERIOD_DAYS: Record<Frequency, number> = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 14 };

/** The run after `iso` (what follows a skipped one). */
export function runAfter(iso: string, frequency: Frequency): Date {
  return new Date(new Date(iso).getTime() + PERIOD_DAYS[frequency] * DAY_MS);
}

/**
 * The headline of a basket card: when the next order goes, the countdown, and what a pause or a
 * skipped run means. `tone` picks the colour.
 */
export function nextLine(
  b: { status: BasketStatus; skipNext: boolean; nextRunAt: string | null; frequency: Frequency },
  now: Date = new Date(),
): { title: string; sub: string | null; tone: 'active' | 'paused' | 'skip' } {
  if (b.status === 'PAUSED') return { title: W.paused, sub: W.pausedSub, tone: 'paused' };
  if (!b.nextRunAt) return { title: W.scheduling, sub: null, tone: 'active' };
  if (b.skipNext) {
    const after = runAfter(b.nextRunAt, b.frequency);
    return { title: W.next(whenText(after, now)), sub: W.skipping(whenText(new Date(b.nextRunAt), now)), tone: 'skip' };
  }
  return { title: nextRunText(b.nextRunAt, now) ?? W.nextSoon, sub: countdownText(b.nextRunAt, now), tone: 'active' };
}

/* ---------------------------------------------------------------- times from the opening hours */

export type DayHours = { open: number; close: number } | null;

/** One weekday's opening hours in minutes (null = closed that day), from the store settings. */
export function dayHours(store: Pick<StoreInfo, 'hours' | 'delivery_hours'> | null, weekday: number): DayHours {
  const days = store?.hours?.days;
  if (days) {
    const d = days[DAY_KEYS[weekday]];
    if (!d || d.closed) return null;
    const open = toMinutes(d.open), close = toMinutes(d.close);
    return open === null || close === null ? null : { open, close: close <= open ? 1440 : close };
  }
  const open = toMinutes(store?.delivery_hours?.start), close = toMinutes(store?.delivery_hours?.end);
  return open === null || close === null ? null : { open, close: close <= open ? 1440 : close };
}

const quarters = (h: { open: number; close: number }): number[] => {
  const out: number[] = [];
  for (let t = Math.ceil(h.open / STEP) * STEP; t < h.close && t < 1440; t += STEP) out.push(t);
  return out;
};

/**
 * The quarter hours a basket may be ordered at: inside the opening hours of its weekday, or for
 * every day, inside the hours of every open day (a closed day is skipped by the server). [] when
 * the store is closed that day or the hours are not known yet.
 */
export function timeOptions(store: Pick<StoreInfo, 'hours' | 'delivery_hours'> | null, frequency: Frequency, weekday: number | null): string[] {
  if (frequency !== 'DAILY') {
    const h = weekday === null ? null : dayHours(store, weekday);
    return h ? quarters(h).map(fromMinutes) : [];
  }
  const open = [0, 1, 2, 3, 4, 5, 6].map((wd) => dayHours(store, wd)).filter((h): h is { open: number; close: number } => !!h);
  if (!open.length) return [];
  const sets = open.map((h) => new Set(quarters(h)));
  return [...sets[0]].filter((t) => sets.every((s) => s.has(t))).sort((a, b) => a - b).map(fromMinutes);
}

/** The times grouped by hour for the hour chips + minute chips. */
export function hourGroups(options: string[]): { hour: number; minutes: string[] }[] {
  const out: { hour: number; minutes: string[] }[] = [];
  for (const t of options) {
    const h = Number(t.slice(0, 2));
    const last = out[out.length - 1];
    if (last && last.hour === h) last.minutes.push(t.slice(3, 5));
    else out.push({ hour: h, minutes: [t.slice(3, 5)] });
  }
  return out;
}

/** The time a new basket starts on: the one chosen before when still allowed, else 8:00 am, else the first after it, else the first. */
export function defaultTime(options: string[], preferred?: string | null): string | null {
  if (!options.length) return null;
  if (preferred && options.includes(preferred)) return preferred;
  if (options.includes('08:00')) return '08:00';
  return options.find((t) => t >= '08:00') ?? options[0];
}

/** Start date chips: today and the next days ("Today", "Tomorrow", "Wed 29"). */
export function startDates(now: Date = new Date(), count = 7): { ymd: string; label: string }[] {
  return Array.from({ length: count }, (_, i) => {
    const c = colombo(new Date(now.getTime() + i * DAY_MS));
    return { ymd: c.ymd, label: i === 0 ? W.startToday : i === 1 ? W.startTomorrow : W.startDay(weekdayShort(c.weekday), c.day) };
  });
}

/**
 * When the first order of a new basket goes (the summary's preview; the server decides): on or
 * after the start date, on the basket's weekday, and not in the past.
 */
export function firstRun(args: { frequency: Frequency; weekday: number | null; placeAt: string; startDate: string; now?: Date }): Date {
  const now = args.now ?? new Date();
  let at = colomboInstant(args.startDate, args.placeAt);
  if (args.frequency !== 'DAILY' && args.weekday !== null) {
    const wd = colombo(at).weekday;
    at = new Date(at.getTime() + ((args.weekday - wd + 7) % 7) * DAY_MS);
  }
  const step = args.frequency === 'DAILY' ? DAY_MS : 7 * DAY_MS;
  while (at.getTime() <= now.getTime()) at = new Date(at.getTime() + step);
  return at;
}

/** A short name for a new basket so the cards tell them apart ("Daily basket", "Monday basket"). */
export function suggestName(frequency: Frequency, weekday: number | null): string {
  if (frequency === 'DAILY' || weekday === null) return W.dailyBasket;
  return frequency === 'WEEKLY' ? W.weeklyBasket(weekdayName(weekday)) : W.everyOther(weekdayName(weekday));
}
