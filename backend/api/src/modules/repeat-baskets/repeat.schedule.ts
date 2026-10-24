import { DateTime } from 'luxon';
import { DAY_KEYS, STORE_TIMEZONE, toMinutes, type DayKey, type WeeklyHours } from '../../utils/store-hours.js';
import type { RepeatFrequency } from '../../database/types.js';

/**
 * When a repeat basket is placed (migration 054). Pure rules, every time is
 * Asia/Colombo:
 *  - place_at 'HH:MM' is the Colombo time the order is placed;
 *  - weekday 0 = Sunday ... 6 = Saturday (WEEKLY / BIWEEKLY only);
 *  - the first run is the first matching day/time strictly after "now" and on
 *    or after start_date (so "today" when today's time is still ahead, else
 *    the next matching day);
 *  - after a run: DAILY +1 day, WEEKLY +7, BIWEEKLY +14 at place_at, counted
 *    from the day that was due; occurrences already in the past (the worker
 *    was down) are skipped, never placed late in a burst.
 */
export interface ScheduleSpec {
  frequency: RepeatFrequency;
  weekday: number | null;
  place_at: string;
  /** 'YYYY-MM-DD' (Colombo) or null. */
  start_date: string | null;
}

export const STEP_DAYS: Record<RepeatFrequency, number> = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 14 };

/** 0 = Sunday ... 6 = Saturday for a Colombo day (luxon: 1 = Monday ... 7 = Sunday). */
export const weekdayOf = (day: DateTime): number => day.weekday % 7;

/** The store-hours key ('sun', 'mon', ...) of weekday 0-6. */
export const dayKeyOfWeekday = (weekday: number): DayKey => DAY_KEYS[(weekday + 6) % 7];

const local = (at: Date) => DateTime.fromJSDate(at).setZone(STORE_TIMEZONE);

function atPlace(day: DateTime, placeAt: string): DateTime {
  const minutes = toMinutes(placeAt) ?? 0;
  return day.startOf('day').plus({ minutes });
}

/** Today's date in Colombo, 'YYYY-MM-DD'. */
export const colomboDate = (at: Date): string => local(at).toISODate()!;

/** The first time the basket is placed: strictly after `from`, on/after start_date. */
export function firstRunAt(spec: ScheduleSpec, from: Date): Date {
  let day = local(from).startOf('day');
  if (spec.start_date) {
    const start = DateTime.fromISO(spec.start_date, { zone: STORE_TIMEZONE }).startOf('day');
    if (start.isValid && start > day) day = start;
  }
  for (let i = 0; i < 16; i++) {
    const d = day.plus({ days: i });
    if (spec.frequency !== 'DAILY' && weekdayOf(d) !== spec.weekday) continue;
    const t = atPlace(d, spec.place_at);
    if (t.toMillis() > from.getTime()) return t.toJSDate();
  }
  throw new Error('No run time found for the repeat basket schedule');
}

/**
 * The run after the one due at `runAt`: +1 / +7 / +14 days at place_at,
 * stepping again while that is not after `now`.
 */
export function nextRunAfter(spec: ScheduleSpec, runAt: Date, now: Date): Date {
  const step = STEP_DAYS[spec.frequency];
  let day = local(runAt).startOf('day');
  for (let i = 0; i < 1000; i++) {
    day = day.plus({ days: step });
    const t = atPlace(day, spec.place_at);
    if (t.toMillis() > now.getTime()) return t.toJSDate();
  }
  // Far in the past (or a clock problem): start again from now.
  return firstRunAt({ ...spec, start_date: null }, now);
}

/**
 * Whether place_at is inside the store's opening hours on the days it runs
 * (open <= place_at < close, as order placement decides "open"):
 *  - WEEKLY / BIWEEKLY: that weekday must be open and contain it;
 *  - DAILY: every weekday the store opens must contain it (closed weekdays
 *    and holidays are simply skipped at run time as "Store closed"), and the
 *    store must open on at least one day.
 */
export function placeAtInsideHours(spec: Pick<ScheduleSpec, 'frequency' | 'weekday' | 'place_at'>, hours: WeeklyHours): boolean {
  const at = toMinutes(spec.place_at);
  if (at === null) return false;
  if (spec.frequency !== 'DAILY' && (spec.weekday === null || spec.weekday < 0 || spec.weekday > 6)) return false;
  const keys: DayKey[] =
    spec.frequency === 'DAILY' ? DAY_KEYS.filter((k) => !hours.days[k].closed) : [dayKeyOfWeekday(spec.weekday!)];
  if (keys.length === 0) return false;
  return keys.every((k) => {
    const d = hours.days[k];
    if (!d || d.closed) return false;
    const open = toMinutes(d.open);
    const close = toMinutes(d.close);
    return open !== null && close !== null && at >= open && at < close;
  });
}
