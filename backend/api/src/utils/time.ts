import {
  DEFAULT_SCHEDULE,
  DEFAULT_WEEKLY_HOURS,
  STORE_TIMEZONE,
  nextOpenFrom,
  withinWeeklyHours,
  type WeeklyHours,
} from './store-hours.js';

export interface OperatingHours {
  startHour: number; // e.g. 8 (8:00 AM)
  endHour: number;   // e.g. 21 (9:00 PM)
  timezone: string;  // 'Asia/Colombo'
}

/**
 * The hours the store had before staff could set them, and still the default
 * when no 'store_hours' row is stored. The live hours are read through
 * modules/configuration/store-schedule.ts storeSchedule.read() (owner,
 * 2026-10-10); this constant is only the fallback.
 */
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  startHour: 8,
  endHour: 21,
  timezone: STORE_TIMEZONE,
};

/**
 * The clock checkout reads to decide whether ordering is open. Production
 * uses the real time; tests pin it (tests/setup/ordering-clock.ts) so order
 * tests pass at any hour of the day.
 */
export const orderingClock = { now: (): Date => new Date() };

/**
 * Whether `at` falls inside the weekly opening hours (owner, 2026-10-06: orders
 * only inside the window; owner, 2026-10-10: the window is set by Ops and
 * Admin). Callers pass the stored hours (storeSchedule.read()); without them
 * the default 08:00 - 21:00 applies. Holidays and "close now" are decided by
 * storeStatusAt (utils/store-hours.ts).
 */
export function isWithinOrderingHours(
  at: Date = orderingClock.now(),
  hours: WeeklyHours = DEFAULT_WEEKLY_HOURS
): boolean {
  return withinWeeklyHours(hours, at);
}

/**
 * When an order placed at `placedAtUtc` could first be dispatched: null inside
 * the opening hours (immediate), else the next opening time. Order placement
 * now uses the customer's chosen delivery slot instead (owner, 2026-10-10);
 * this stays for callers that only need the next opening.
 */
export function calculateScheduledDeliveryTime(
  placedAtUtc: Date = new Date(),
  hours: WeeklyHours = DEFAULT_WEEKLY_HOURS
): Date | null {
  if (withinWeeklyHours(hours, placedAtUtc)) return null;
  return nextOpenFrom({ ...DEFAULT_SCHEDULE, hours }, placedAtUtc);
}
