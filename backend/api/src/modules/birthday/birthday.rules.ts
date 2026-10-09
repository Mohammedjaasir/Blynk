import { DateTime } from 'luxon';
import { BIRTHDAY_WINDOW_DAYS } from '../configuration/settings.service.js';

/**
 * Birthday rules (owner, 2026-10-09), pure so they are tested without a
 * database. Every date is a calendar day in Asia/Colombo.
 *
 * - The birthday week is the birthday +-3 days (7 days).
 * - A 29 February birthday falls on 28 February in a year with no 29th.
 * - The gift is for one birthday: `offer_year` is the year of the birthday
 *   occurrence, so a 30 December birthday's week running into January still
 *   belongs to the December birthday.
 * - A date of birth is accepted for an age of 5 to 120, never in the future.
 */

export const BIRTHDAY_ZONE = 'Asia/Colombo';
export const MIN_AGE = 5;
export const MAX_AGE = 120;
/**
 * Owner, 2026-10-09: "once used, not again until next year". Besides one gift
 * per birthday, a customer who used one in the last 300 days gets no other,
 * so editing the date of birth across a year boundary cannot earn a second.
 * Two real birthdays' gifts are always at least 358 days apart.
 */
export const MIN_DAYS_BETWEEN_GIFTS = 300;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Colombo (start of day, in that zone). */
export function colomboDay(now: Date): DateTime {
  return DateTime.fromJSDate(now, { zone: BIRTHDAY_ZONE }).startOf('day');
}

/** A strict YYYY-MM-DD as a Colombo day, or null when it is not a real date. */
export function parseIsoDate(value: string): DateTime | null {
  if (!ISO_DATE.test(value)) return null;
  const d = DateTime.fromISO(value, { zone: BIRTHDAY_ZONE });
  return d.isValid && d.toISODate() === value ? d.startOf('day') : null;
}

export const isoDay = (d: DateTime): string => d.toISODate()!;

/** Whole years from `dob` to `today`. */
export function ageOn(dob: DateTime, today: DateTime): number {
  return Math.floor(today.diff(dob, 'years').years + 1e-9);
}

/** Why a date of birth is refused, or null when it is fine. */
export function dateOfBirthProblem(value: string, now: Date): string | null {
  const dob = parseIsoDate(value);
  if (!dob) return 'Enter a real date of birth (YYYY-MM-DD)';
  const today = colomboDay(now);
  if (dob > today) return 'The date of birth cannot be in the future';
  const age = ageOn(dob, today);
  if (age < MIN_AGE) return `You must be at least ${MIN_AGE} years old`;
  if (age > MAX_AGE) return `Enter a real date of birth (age ${MAX_AGE} at most)`;
  return null;
}

/** The birthday in a given year (29 Feb -> 28 Feb when the year has none). */
export function birthdayIn(dob: DateTime, year: number): DateTime {
  if (dob.month === 2 && dob.day === 29 && !DateTime.local(year, 1, 1, { zone: BIRTHDAY_ZONE }).isInLeapYear) {
    return DateTime.local(year, 2, 28, { zone: BIRTHDAY_ZONE });
  }
  return DateTime.local(year, dob.month, dob.day, { zone: BIRTHDAY_ZONE });
}

export interface BirthdayWindow {
  /** The birthday this window is for. */
  birthday: DateTime;
  start: DateTime;
  end: DateTime;
  /** Whether `today` is inside it. */
  in_window: boolean;
  /** The year of that birthday: the gift is once per offer_year. */
  offer_year: number;
}

/**
 * The birthday week `today` is in, or else the next one. Checked across last
 * year, this year and next, so the weeks around New Year resolve correctly.
 */
export function birthdayWindow(dob: DateTime, today: DateTime, windowDays = BIRTHDAY_WINDOW_DAYS): BirthdayWindow {
  let next: BirthdayWindow | null = null;
  for (const year of [today.year - 1, today.year, today.year + 1]) {
    const birthday = birthdayIn(dob, year);
    const start = birthday.minus({ days: windowDays });
    const end = birthday.plus({ days: windowDays });
    if (today >= start && today <= end) {
      return { birthday, start, end, in_window: true, offer_year: year };
    }
    if (!next && start > today) next = { birthday, start, end, in_window: false, offer_year: year };
  }
  return next!;
}

/** Days from `today` to the birthday (negative once it has passed). */
export const daysUntil = (birthday: DateTime, today: DateTime): number =>
  Math.round(birthday.diff(today, 'days').days);

/** The gift on an item subtotal, rounded to cents. */
export function birthdayDiscount(subtotal: number, percent: number): number {
  if (!(subtotal > 0) || !(percent > 0)) return 0;
  return Number(((subtotal * percent) / 100).toFixed(2));
}

/**
 * MMDD codes (e.g. 1012) of the birthdays that fall on the given days: a
 * 28 February in a year with no 29th also covers 29 February birthdays.
 */
export function monthDayCodes(days: DateTime[]): number[] {
  const codes = new Set<number>();
  for (const d of days) {
    codes.add(d.month * 100 + d.day);
    if (d.month === 2 && d.day === 28 && !d.isInLeapYear) codes.add(229);
  }
  return [...codes];
}
