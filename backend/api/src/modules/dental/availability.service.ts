import { DateTime } from 'luxon';
import { Selectable } from 'kysely';
import { db } from '../../database/connection.js';
import { dentalRepository, type DentalExecutor } from './dental.repository.js';
import { DoctorAvailabilityTable } from '../../database/types.js';

/**
 * The clinic-local timezone used to interpret a plain `date` (YYYY-MM-DD)
 * query param into an actual TIMESTAMPTZ range, and to resolve which
 * day-of-week a date falls on. `dental_clinics` has no per-row timezone
 * column (like `dark_stores` before it), so this follows the one existing,
 * established codebase precedent for "local calendar day" business logic:
 * `src/utils/time.ts` (`DEFAULT_OPERATING_HOURS.timezone`) and
 * `rider.repository.ts`'s `startOfTodayColombo` both hardcode
 * 'Asia/Colombo' for the same reason (business-rules doc: Asia/Colombo).
 * Not a new ad-hoc conversion - the same nuance, resolved the same way the
 * rest of the backend already resolves it.
 */
export const CLINIC_TIMEZONE = 'Asia/Colombo';

type AvailabilityTemplateRow = Pick<
  Selectable<DoctorAvailabilityTable>,
  'start_time' | 'end_time' | 'slot_duration_minutes' | 'buffer_minutes'
>;

export interface DaySlotsResult {
  date: string;
  /** ISO 8601 UTC datetimes (TIMESTAMPTZ instants), one per open slot. */
  slots: string[];
  /** Populated only when the entire date is blocked via
   * `doctor_blocked_dates` (plan §9.2 step 2); null for "no template that
   * day" (a different, unblocked reason for an empty list). */
  blockedReason: string | null;
}

export interface DayAvailabilityResult {
  date: string;
  hasAvailability: boolean;
}

/** Why a single requested instant is not bookable (B3's hold flow). */
export type SlotRejectionReason = 'IN_PAST' | 'BLOCKED' | 'NOT_ON_TEMPLATE' | 'OCCUPIED';

export type ResolvedSlot =
  | { ok: true; durationMinutes: number }
  | { ok: false; reason: SlotRejectionReason };

/** Postgres/JS day-of-week convention: 0=Sunday..6=Saturday, evaluated on
 * the clinic-local calendar day (not the UTC date the instant falls on). */
function dayOfWeekFor(date: string): number {
  const weekday = DateTime.fromISO(date, { zone: CLINIC_TIMEZONE }).weekday; // 1=Mon..7=Sun
  return weekday % 7;
}

/** [start, end) of the clinic-local calendar day, converted to UTC - the
 * window `findOccupyingAppointments` filters `appointments.start_at`
 * (TIMESTAMPTZ) against. */
function dayBoundsUtc(date: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(date, { zone: CLINIC_TIMEZONE }).startOf('day');
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() };
}

/** Builds a Set of occupied instants (ms since epoch) from the appointments
 * query result, applying the plan §7.5 "enforced lazily" rule: a HELD row
 * still occupies its slot only while `held_until` is still in the future;
 * once expired it is treated as available again, with no write/cleanup
 * needed here (B2 is read-only). CONFIRMED always occupies. */
function buildOccupiedSet(
  rows: { start_at: Date; status: string; held_until: Date | null }[],
  now: Date
): Set<number> {
  const occupied = new Set<number>();
  for (const row of rows) {
    const stillOccupying =
      row.status === 'CONFIRMED' || (row.status === 'HELD' && row.held_until !== null && row.held_until > now);
    if (stillOccupying) {
      occupied.add(new Date(row.start_at).getTime());
    }
  }
  return occupied;
}

/**
 * A slot that has already started is not a slot. The weekly template is
 * day-of-week based and therefore unbounded in both directions, so without
 * this every past Monday 09:00 reads as "available" forever - and, once a
 * write path existed (B3's hold), became bookable. Review finding I1.
 *
 * This is a structural validity check, not a business window: it invents no
 * lead time, no minimum notice and no cutoff (contrast DENTAL-07/DENTAL-11).
 * `now` is an injected, defaulted parameter, following the codebase's
 * existing pattern for testable time (`utils/time.ts`
 * `calculateScheduledDeliveryTime(placedAtUtc: Date = new Date())`), and is
 * resolved once per call so every candidate in one computation is judged
 * against the same instant.
 */
function isInPast(instantMillis: number, now: Date): boolean {
  return instantMillis <= now.getTime();
}

export class AvailabilityService {
  /**
   * GET /dental/doctors/:id/slots - the actual candidate start times for
   * one clinic-doctor pairing on one date (plan §9.2 steps 1-5).
   */
  async computeDaySlots(
    clinicDoctorId: string,
    date: string,
    now: Date = new Date()
  ): Promise<DaySlotsResult> {
    const blocked = await dentalRepository.findBlockedDate(clinicDoctorId, date);
    if (blocked) {
      return { date, slots: [], blockedReason: blocked.reason };
    }

    const templateRows = await dentalRepository.findAvailabilityTemplate(
      clinicDoctorId,
      dayOfWeekFor(date)
    );
    if (templateRows.length === 0) {
      return { date, slots: [], blockedReason: null };
    }

    const { start, end } = dayBoundsUtc(date);
    const occupyingRows = await dentalRepository.findOccupyingAppointments(clinicDoctorId, start, end);
    const occupied = buildOccupiedSet(occupyingRows, now);

    const slots: string[] = [];
    for (const row of templateRows) {
      for (const candidate of generateCandidatesForRow(date, row)) {
        const millis = candidate.toUTC().toMillis();
        // An elapsed candidate is never offered (I1) - the weekly template
        // itself has no notion of which date it is being applied to.
        if (isInPast(millis, now) || occupied.has(millis)) continue;
        const iso = candidate.toUTC().toISO({ suppressMilliseconds: true });
        if (iso) slots.push(iso);
      }
    }

    return { date, slots, blockedReason: null };
  }

  /**
   * `computeDaySlots` narrowed to ONE requested instant, for B3's hold flow
   * (plan §7.3 step 6 / §7.6: the client's slot listing is never trusted,
   * the server re-derives whether this exact `start_at` is a real, open slot
   * before inserting a hold). Same three rules, same helpers, same
   * `CLINIC_TIMEZONE` as the list version above - deliberately not a second
   * copy of the computation - and it additionally returns the template row's
   * `slot_duration_minutes`, which is what `end_at` is derived from.
   *
   * `executor` MUST be the caller's open transaction when called from inside
   * one (see `DentalExecutor`).
   */
  async resolveOpenSlot(
    clinicDoctorId: string,
    startAt: Date,
    executor: DentalExecutor = db,
    now: Date = new Date(),
    /** The reclaim branch's own locked row: its occupancy does not count. */
    ignoreAppointmentId?: string
  ): Promise<ResolvedSlot> {
    const target = startAt.getTime();
    // Checked first, and before any query: a past instant is not a slot at
    // all, whatever the template says (I1). Same rule the listing above
    // applies, so the read and write sides can never disagree.
    if (isInPast(target, now)) return { ok: false, reason: 'IN_PAST' };

    const date = DateTime.fromJSDate(startAt).setZone(CLINIC_TIMEZONE).toISODate();
    if (!date) return { ok: false, reason: 'NOT_ON_TEMPLATE' };

    const blocked = await dentalRepository.findBlockedDate(clinicDoctorId, date, executor);
    if (blocked) return { ok: false, reason: 'BLOCKED' };

    const templateRows = await dentalRepository.findAvailabilityTemplate(
      clinicDoctorId,
      dayOfWeekFor(date),
      executor
    );

    let durationMinutes: number | null = null;
    for (const row of templateRows) {
      for (const candidate of generateCandidatesForRow(date, row)) {
        const millis = candidate.toUTC().toMillis();
        if (millis === target) {
          durationMinutes = row.slot_duration_minutes;
          break;
        }
        if (millis > target) break; // candidates ascend; this row can't match
      }
      if (durationMinutes !== null) break;
    }
    if (durationMinutes === null) return { ok: false, reason: 'NOT_ON_TEMPLATE' };

    const { start, end } = dayBoundsUtc(date);
    const occupyingRows = await dentalRepository.findOccupyingAppointments(
      clinicDoctorId,
      start,
      end,
      executor,
      ignoreAppointmentId
    );
    if (buildOccupiedSet(occupyingRows, now).has(target)) {
      return { ok: false, reason: 'OCCUPIED' };
    }

    return { ok: true, durationMinutes };
  }

  /**
   * GET /dental/doctors/:id/availability - the calendar-view range: a
   * boolean per date, not full slot lists (plan §9.2's "lightweight
   * has-any-slots boolean per date"). Caller (doctor.service.ts) is
   * responsible for capping `from`..`to` to <=30 days before calling this
   * (enforced by dental.schema.ts's availabilityQuerySchema).
   */
  async computeRangeAvailability(
    clinicDoctorId: string,
    from: string,
    to: string,
    now: Date = new Date()
  ): Promise<DayAvailabilityResult[]> {
    const results: DayAvailabilityResult[] = [];
    // One instant for the whole range, so a day cannot be judged against a
    // later clock than the day before it.
    for (const date of enumerateDates(from, to)) {
      results.push({
        date,
        hasAvailability: await this.dayHasAvailability(clinicDoctorId, date, now),
      });
    }
    return results;
  }

  /** Same rules as computeDaySlots, but short-circuits at the first open
   * candidate instead of building the full slot list - the range endpoint
   * only needs a boolean per day (brief: "don't enumerate the whole day if
   * not needed"). */
  private async dayHasAvailability(
    clinicDoctorId: string,
    date: string,
    now: Date = new Date()
  ): Promise<boolean> {
    const blocked = await dentalRepository.findBlockedDate(clinicDoctorId, date);
    if (blocked) return false;

    const templateRows = await dentalRepository.findAvailabilityTemplate(
      clinicDoctorId,
      dayOfWeekFor(date)
    );
    if (templateRows.length === 0) return false;

    const { start, end } = dayBoundsUtc(date);
    const occupyingRows = await dentalRepository.findOccupyingAppointments(clinicDoctorId, start, end);
    const occupied = buildOccupiedSet(occupyingRows, now);

    for (const row of templateRows) {
      for (const candidate of generateCandidatesForRow(date, row)) {
        const millis = candidate.toUTC().toMillis();
        if (isInPast(millis, now) || occupied.has(millis)) continue;
        return true; // short-circuit: at least one open slot this day
      }
    }
    return false;
  }
}

/** Candidate start times for one template row on one date: start_time,
 * start_time + (duration+buffer), ... while candidate+duration still fits
 * within end_time (plan §9.2 step 3). A generator so the range endpoint's
 * short-circuit above never has to materialize the whole day. */
function* generateCandidatesForRow(
  date: string,
  row: AvailabilityTemplateRow
): Generator<DateTime> {
  const stepMinutes = row.slot_duration_minutes + row.buffer_minutes;
  const windowEnd = DateTime.fromISO(`${date}T${row.end_time}`, { zone: CLINIC_TIMEZONE });
  let cursor = DateTime.fromISO(`${date}T${row.start_time}`, { zone: CLINIC_TIMEZONE });

  while (cursor.plus({ minutes: row.slot_duration_minutes }) <= windowEnd) {
    yield cursor;
    cursor = cursor.plus({ minutes: stepMinutes });
  }
}

/** Inclusive list of YYYY-MM-DD dates from `from` to `to`. */
function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = DateTime.fromISO(from, { zone: CLINIC_TIMEZONE }).startOf('day');
  const last = DateTime.fromISO(to, { zone: CLINIC_TIMEZONE }).startOf('day');
  while (cursor <= last) {
    dates.push(cursor.toISODate() as string);
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

export const availabilityService = new AvailabilityService();
