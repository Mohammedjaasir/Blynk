import { DateTime } from 'luxon';

export interface OperatingHours {
  startHour: number; // e.g. 8 (8:00 AM)
  endHour: number;   // e.g. 21 (9:00 PM)
  timezone: string;  // 'Asia/Colombo'
}

export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  startHour: 8,
  endHour: 21,
  timezone: 'Asia/Colombo',
};

/**
 * Evaluates whether an order placed at a given timestamp falls within
 * the delivery dispatch operating window (08:00 - 21:00 in Asia/Colombo).
 *
 * If outside operating hours, returns the exact Date when dispatch should begin
 * (8:00 AM today or 8:00 AM the next morning) to populate orders.scheduled_for.
 *
 * If within operating hours, returns null (immediate processing).
 */
export function calculateScheduledDeliveryTime(
  placedAtUtc: Date = new Date(),
  config: OperatingHours = DEFAULT_OPERATING_HOURS
): Date | null {
  const localTime = DateTime.fromJSDate(placedAtUtc).setZone(config.timezone);

  // If inside the operating window [startHour, endHour), it's immediate
  if (localTime.hour >= config.startHour && localTime.hour < config.endHour) {
    return null;
  }

  // If placed before 8:00 AM on the current day, schedule for 8:00 AM today
  if (localTime.hour < config.startHour) {
    return localTime
      .set({ hour: config.startHour, minute: 0, second: 0, millisecond: 0 })
      .toJSDate();
  }

  // If placed at or after 9:00 PM, schedule for 8:00 AM the next day
  return localTime
    .plus({ days: 1 })
    .set({ hour: config.startHour, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
}
