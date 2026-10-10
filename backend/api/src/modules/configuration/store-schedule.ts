import { z } from 'zod';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { db } from '../../database/connection.js';
import type { DBConnection } from '../auth/auth.repository.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../middleware/error.middleware.js';
import { orderingClock } from '../../utils/time.js';
import {
  DAY_KEYS,
  DEFAULT_CLOSURE,
  DEFAULT_SLOT_SETTINGS,
  DEFAULT_WEEKLY_HOURS,
  STORE_TIMEZONE,
  buildSlots,
  isQuarterHour,
  storeStatusAt,
  toMinutes,
  uniformWeek,
  type ClosureState,
  type DayHours,
  type DayKey,
  type Holiday,
  type ScheduleState,
  type SlotSettings,
  type WeeklyHours,
} from '../../utils/store-hours.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Store timing set by Operations and Admin (owner, 2026-10-10): opening hours
 * (same every day or per weekday), "close the store now" with a reason and an
 * optional reopen time, a holiday list, and scheduled delivery slots.
 *
 * system_configurations rows (no migration; a missing or malformed row means
 * the default, so nothing changed until staff edit them):
 *  - store_hours    {"same_every_day": bool, "days": {"mon": {"closed", "open", "close"}, ...}}
 *                   default 08:00-21:00 every day
 *  - store_closure  {"closed": bool, "reason", "reopens_at", "closed_at"}  default open
 *  - store_holidays {"holidays": [{"date": "YYYY-MM-DD", "reason"}]}        default none
 *  - delivery_slots {"enabled", "slot_minutes", "days_ahead", "max_orders_per_slot", "min_lead_minutes"}
 *                   default off
 *
 * Everything that used the hard-coded 8 AM - 9 PM (order placement, the SMS
 * sending windows, GET /store) reads them through storeSchedule.read(), cached
 * in-process for a few seconds and dropped on every change.
 */

export const STORE_HOURS_KEY = 'store_hours';
export const STORE_CLOSURE_KEY = 'store_closure';
export const STORE_HOLIDAYS_KEY = 'store_holidays';
export const DELIVERY_SLOTS_KEY = 'delivery_slots';
const KEYS = [STORE_HOURS_KEY, STORE_CLOSURE_KEY, STORE_HOLIDAYS_KEY, DELIVERY_SLOTS_KEY] as const;

export const MAX_HOLIDAYS = 60;
export const MAX_CLOSURE_DAYS = 60;
export const SLOT_MINUTES = [30, 60, 120] as const;
export const MAX_DAYS_AHEAD = 3;
export const MAX_ORDERS_PER_SLOT = 100;
export const MAX_LEAD_MINUTES = 240;
const CACHE_MS = 15_000;

// ---------------------------------------------------------------------------
// Reading stored rows (lenient: anything malformed falls back to the default)
// ---------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function dayFrom(v: unknown): DayHours | null {
  const d = obj(v);
  if (!d) return null;
  const { closed, open, close } = d;
  if (typeof closed !== 'boolean' || typeof open !== 'string' || typeof close !== 'string') return null;
  const o = toMinutes(open);
  const c = toMinutes(close);
  if (o === null || c === null || o >= c) return null;
  return { closed, open, close };
}

export function hoursFrom(value: unknown): WeeklyHours {
  const v = obj(value);
  const days = obj(v?.days);
  if (!v || !days) return DEFAULT_WEEKLY_HOURS;
  const out = {} as Record<DayKey, DayHours>;
  for (const k of DAY_KEYS) {
    const d = dayFrom(days[k]);
    if (!d) return DEFAULT_WEEKLY_HOURS;
    out[k] = d;
  }
  if (DAY_KEYS.every((k) => out[k].closed)) return DEFAULT_WEEKLY_HOURS;
  return { same_every_day: v.same_every_day === true, days: out };
}

export function closureFrom(value: unknown): ClosureState {
  const v = obj(value);
  if (!v || v.closed !== true) return DEFAULT_CLOSURE;
  const reopens = typeof v.reopens_at === 'string' && Number.isFinite(Date.parse(v.reopens_at)) ? new Date(v.reopens_at).toISOString() : null;
  return {
    closed: true,
    reason: typeof v.reason === 'string' && v.reason.trim() ? v.reason.trim() : null,
    reopens_at: reopens,
    closed_at: typeof v.closed_at === 'string' ? v.closed_at : null,
  };
}

export function holidaysFrom(value: unknown): Holiday[] {
  const list = obj(value)?.holidays;
  if (!Array.isArray(list)) return [];
  const out: Holiday[] = [];
  for (const h of list) {
    const o = obj(h);
    if (!o || typeof o.date !== 'string' || !DateTime.fromISO(o.date).isValid) continue;
    out.push({ date: o.date, reason: typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim() : null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function slotsFrom(value: unknown): SlotSettings {
  const v = obj(value);
  if (!v) return DEFAULT_SLOT_SETTINGS;
  const int = (x: unknown, min: number, max: number, dflt: number) =>
    typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max ? x : dflt;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SLOT_SETTINGS.enabled,
    slot_minutes: (SLOT_MINUTES as readonly number[]).includes(v.slot_minutes as number)
      ? (v.slot_minutes as SlotSettings['slot_minutes'])
      : DEFAULT_SLOT_SETTINGS.slot_minutes,
    days_ahead: int(v.days_ahead, 1, MAX_DAYS_AHEAD, DEFAULT_SLOT_SETTINGS.days_ahead),
    max_orders_per_slot: int(v.max_orders_per_slot, 1, MAX_ORDERS_PER_SLOT, DEFAULT_SLOT_SETTINGS.max_orders_per_slot),
    min_lead_minutes: (() => {
      const m = int(v.min_lead_minutes, 0, MAX_LEAD_MINUTES, DEFAULT_SLOT_SETTINGS.min_lead_minutes);
      return m % 15 === 0 ? m : DEFAULT_SLOT_SETTINGS.min_lead_minutes;
    })(),
  };
}

export interface StoredSchedule extends ScheduleState {
  updated_at: Record<(typeof KEYS)[number], Date | null>;
}

async function loadSchedule(executor: DBConnection = db): Promise<StoredSchedule> {
  const rows = await executor
    .selectFrom('system_configurations')
    .select(['key', 'value', 'updated_at'])
    .where('key', 'in', [...KEYS])
    .execute();
  const row = (k: string) => rows.find((r) => r.key === k);
  return {
    hours: hoursFrom(row(STORE_HOURS_KEY)?.value),
    closure: closureFrom(row(STORE_CLOSURE_KEY)?.value),
    holidays: holidaysFrom(row(STORE_HOLIDAYS_KEY)?.value),
    slots: slotsFrom(row(DELIVERY_SLOTS_KEY)?.value),
    updated_at: {
      store_hours: row(STORE_HOURS_KEY)?.updated_at ?? null,
      store_closure: row(STORE_CLOSURE_KEY)?.updated_at ?? null,
      store_holidays: row(STORE_HOLIDAYS_KEY)?.updated_at ?? null,
      delivery_slots: row(DELIVERY_SLOTS_KEY)?.updated_at ?? null,
    },
  };
}

let cache: { value: StoredSchedule; expires: number } | null = null;

/**
 * The one reader of the store timing. Tests replace `read` (tests/setup/
 * store-schedule.ts pins the defaults); tests/store-schedule.test.ts restores
 * `realRead` to test the stored settings.
 */
export const storeSchedule = {
  realRead: async (): Promise<StoredSchedule> => {
    const now = Date.now();
    if (cache && cache.expires > now) return cache.value;
    const value = await loadSchedule();
    cache = { value, expires: now + CACHE_MS };
    return value;
  },
  read: (): Promise<StoredSchedule> => storeSchedule.realRead(),
  invalidate: () => {
    cache = null;
  },
};

/** The defaults, as a StoredSchedule (nothing stored). */
export const DEFAULT_STORED_SCHEDULE: StoredSchedule = {
  hours: DEFAULT_WEEKLY_HOURS,
  closure: DEFAULT_CLOSURE,
  holidays: [],
  slots: DEFAULT_SLOT_SETTINGS,
  updated_at: { store_hours: null, store_closure: null, store_holidays: null, delivery_slots: null },
};

// ---------------------------------------------------------------------------
// Validation of staff edits
// ---------------------------------------------------------------------------

const hhmm = (label: string) =>
  z
    .string({ required_error: `The ${label} time is required`, invalid_type_error: `The ${label} time must be text like 08:00` })
    .refine((v) => toMinutes(v) !== null, `The ${label} time must look like 08:00`)
    .refine((v) => isQuarterHour(v), `The ${label} time must be on a 15-minute step (:00, :15, :30, :45)`);

const dayHoursSchema = z
  .object({ closed: z.boolean({ invalid_type_error: 'closed must be true or false' }), open: hhmm('opening'), close: hhmm('closing') })
  .strict()
  .refine((d) => toMinutes(d.open)! < toMinutes(d.close)!, 'The closing time must be after the opening time');

export const updateStoreHoursSchema = z.union([
  z
    .object({ same_every_day: z.literal(true), open: hhmm('opening'), close: hhmm('closing') })
    .strict()
    .refine((d) => toMinutes(d.open)! < toMinutes(d.close)!, 'The closing time must be after the opening time'),
  z
    .object({
      same_every_day: z.literal(false),
      days: z
        .object(Object.fromEntries(DAY_KEYS.map((k) => [k, dayHoursSchema])) as Record<DayKey, typeof dayHoursSchema>)
        .strict()
        .refine((days) => DAY_KEYS.some((k) => !days[k].closed), 'At least one day must be open'),
    })
    .strict(),
]);
export type UpdateStoreHoursInput = z.infer<typeof updateStoreHoursSchema>;

export const updateStoreClosureSchema = z.union([
  z
    .object({
      closed: z.literal(true),
      reason: z
        .string({ required_error: 'Write why the store is closed', invalid_type_error: 'The reason must be text' })
        .trim()
        .min(1, 'Write why the store is closed')
        .max(200, 'The reason can be at most 200 characters'),
      reopens_at: z
        .string({ invalid_type_error: 'reopens_at must be a date and time' })
        .datetime({ offset: true, message: 'reopens_at must be a date and time, e.g. 2026-10-11T08:00:00+05:30' })
        .nullable()
        .optional(),
    })
    .strict(),
  z.object({ closed: z.literal(false) }).strict(),
]);
export type UpdateStoreClosureInput = z.infer<typeof updateStoreClosureSchema>;

export const updateStoreHolidaysSchema = z
  .object({
    holidays: z
      .array(
        z
          .object({
            date: z
              .string({ required_error: 'Each holiday needs a date' })
              .regex(/^\d{4}-\d{2}-\d{2}$/, 'A holiday date must look like 2026-12-25')
              .refine((v) => DateTime.fromISO(v).isValid, 'That holiday date does not exist'),
            reason: z.string().trim().max(100, 'A holiday reason can be at most 100 characters').nullable().optional(),
          })
          .strict()
      )
      .max(MAX_HOLIDAYS, `At most ${MAX_HOLIDAYS} holidays`)
      .refine((list) => new Set(list.map((h) => h.date)).size === list.length, 'Each holiday date can be listed once'),
  })
  .strict();
export type UpdateStoreHolidaysInput = z.infer<typeof updateStoreHolidaysSchema>;

export const updateDeliverySlotsSchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    slot_minutes: z
      .number({ invalid_type_error: 'The slot length must be a number' })
      .refine((v) => (SLOT_MINUTES as readonly number[]).includes(v), 'The slot length must be 30, 60 or 120 minutes')
      .optional(),
    days_ahead: z
      .number({ invalid_type_error: 'Days ahead must be a number' })
      .int('Days ahead must be a whole number')
      .min(1, 'Days ahead must be at least 1')
      .max(MAX_DAYS_AHEAD, `Days ahead can be at most ${MAX_DAYS_AHEAD}`)
      .optional(),
    max_orders_per_slot: z
      .number({ invalid_type_error: 'Orders per slot must be a number' })
      .int('Orders per slot must be a whole number')
      .min(1, 'A slot takes at least 1 order')
      .max(MAX_ORDERS_PER_SLOT, `A slot can take at most ${MAX_ORDERS_PER_SLOT} orders`)
      .optional(),
    min_lead_minutes: z
      .number({ invalid_type_error: 'The lead time must be a number' })
      .int('The lead time must be whole minutes')
      .min(0, 'The lead time cannot be negative')
      .max(MAX_LEAD_MINUTES, `The lead time can be at most ${MAX_LEAD_MINUTES} minutes`)
      .refine((v) => v % 15 === 0, 'The lead time must be in 15-minute steps')
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export type UpdateDeliverySlotsInput = z.infer<typeof updateDeliverySlotsSchema>;

// ---------------------------------------------------------------------------
// Presenting and changing
// ---------------------------------------------------------------------------

const todayColombo = (now: Date) => DateTime.fromJSDate(now).setZone(STORE_TIMEZONE).toISODate()!;

export function presentSchedule(s: StoredSchedule, now: Date = orderingClock.now()) {
  const today = todayColombo(now);
  return {
    hours: { ...s.hours, updated_at: s.updated_at.store_hours },
    closure: { ...s.closure, updated_at: s.updated_at.store_closure },
    holidays: s.holidays.filter((h) => h.date >= today),
    delivery_slots: { ...s.slots, updated_at: s.updated_at.delivery_slots },
    status: storeStatusAt(s, now),
  };
}

/** A staff edit the schema cannot judge alone (needs the clock): 400. */
const invalid = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

async function upsert(trx: DBConnection, key: string, value: unknown, description: string) {
  const json = JSON.stringify(value);
  await trx
    .insertInto('system_configurations')
    .values({ key, value: json, description })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_at: new Date() }))
    .execute();
}

/** Locks one settings row (if present) so two staff edits apply in order. */
async function lockRow(trx: DBConnection, key: string) {
  await trx.selectFrom('system_configurations').select('key').where('key', '=', key).forUpdate().executeTakeFirst();
}

async function change<T>(
  key: string,
  actor: AuditActor,
  run: (trx: DBConnection, before: StoredSchedule) => Promise<{ value: unknown; description: string; action: string; oldValues: T; newValues: T }>
) {
  await db.transaction().execute(async (trx) => {
    await lockRow(trx, key);
    const before = await loadSchedule(trx);
    const r = await run(trx, before);
    await upsert(trx, key, r.value, r.description);
    await writeAudit(trx, actor, {
      action: r.action,
      entityType: 'SYSTEM_CONFIGURATION',
      entityId: SETTINGS_ENTITY_ID,
      oldValues: { key, ...(r.oldValues as object) },
      newValues: { key, ...(r.newValues as object) },
    });
    logger.info({ key, action: r.action, actorId: actor.actorId }, 'Store timing changed');
  });
  storeSchedule.invalidate();
  return presentSchedule(await loadSchedule());
}

export const storeScheduleService = {
  async get() {
    return presentSchedule(await loadSchedule());
  },

  async setHours(input: UpdateStoreHoursInput, actor: AuditActor) {
    const next: WeeklyHours = input.same_every_day
      ? { same_every_day: true, days: uniformWeek(input.open, input.close) }
      : { same_every_day: false, days: input.days };
    return change(STORE_HOURS_KEY, actor, async (_trx, before) => ({
      value: next,
      description: 'Opening hours (Asia/Colombo), per weekday',
      action: 'STORE_HOURS_UPDATED',
      oldValues: before.hours,
      newValues: next,
    }));
  },

  async setClosure(input: UpdateStoreClosureInput, actor: AuditActor) {
    const now = orderingClock.now();
    let next: ClosureState;
    if (input.closed) {
      const reopens = input.reopens_at ? new Date(input.reopens_at) : null;
      if (reopens && reopens.getTime() <= now.getTime()) throw invalid('The reopen time must be in the future');
      if (reopens && reopens.getTime() > now.getTime() + MAX_CLOSURE_DAYS * 86_400_000) {
        throw invalid(`The reopen time can be at most ${MAX_CLOSURE_DAYS} days ahead`);
      }
      next = { closed: true, reason: input.reason, reopens_at: reopens ? reopens.toISOString() : null, closed_at: now.toISOString() };
    } else {
      next = DEFAULT_CLOSURE;
    }
    return change(STORE_CLOSURE_KEY, actor, async (_trx, before) => ({
      value: next,
      description: 'Store closed now by staff (reason, optional reopen time)',
      action: next.closed ? 'STORE_CLOSED_NOW' : 'STORE_REOPENED',
      oldValues: before.closure,
      newValues: next,
    }));
  },

  async setHolidays(input: UpdateStoreHolidaysInput, actor: AuditActor) {
    const today = todayColombo(orderingClock.now());
    const past = input.holidays.find((h) => h.date < today);
    if (past) throw invalid(`${past.date} is in the past`);
    const next = input.holidays
      .map((h) => ({ date: h.date, reason: h.reason?.trim() ? h.reason.trim() : null }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return change(STORE_HOLIDAYS_KEY, actor, async (_trx, before) => ({
      value: { holidays: next },
      description: 'Dates the store is closed (Asia/Colombo)',
      action: 'STORE_HOLIDAYS_UPDATED',
      oldValues: { holidays: before.holidays },
      newValues: { holidays: next },
    }));
  },

  async setSlots(input: UpdateDeliverySlotsInput, actor: AuditActor) {
    return change(DELIVERY_SLOTS_KEY, actor, async (_trx, before) => {
      const next: SlotSettings = {
        enabled: input.enabled ?? before.slots.enabled,
        slot_minutes: (input.slot_minutes as SlotSettings['slot_minutes'] | undefined) ?? before.slots.slot_minutes,
        days_ahead: input.days_ahead ?? before.slots.days_ahead,
        max_orders_per_slot: input.max_orders_per_slot ?? before.slots.max_orders_per_slot,
        min_lead_minutes: input.min_lead_minutes ?? before.slots.min_lead_minutes,
      };
      return {
        value: next,
        description: 'Scheduled delivery slots',
        action: 'DELIVERY_SLOTS_UPDATED',
        oldValues: before.slots,
        newValues: next,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// Delivery slots for customers
// ---------------------------------------------------------------------------

/** Non-cancelled orders already booked per slot start (ISO). */
export async function bookedPerSlot(executor: DBConnection, from: Date, to: Date): Promise<Map<string, number>> {
  const rows = await executor
    .selectFrom('orders')
    .select(['scheduled_for', sql<number>`count(*)::int`.as('n')])
    .where('scheduled_for', '>=', from)
    .where('scheduled_for', '<=', to)
    .where('scheduled_until', 'is not', null)
    .where('order_status', '!=', 'CANCELLED')
    .groupBy('scheduled_for')
    .execute();
  return new Map(rows.map((r) => [new Date(r.scheduled_for as Date).toISOString(), Number(r.n)]));
}

/** GET /orders/slots: the slots a customer may pick now, with capacity left. */
export async function availableSlots(now: Date = orderingClock.now()) {
  const schedule = await storeSchedule.read();
  const status = storeStatusAt(schedule, now);
  const draft = buildSlots(schedule, now);
  const booked = draft.length
    ? await bookedPerSlot(db, new Date(draft[0].start), new Date(draft[draft.length - 1].start))
    : new Map<string, number>();
  return {
    enabled: schedule.slots.enabled,
    asap_available: status.is_open_now,
    is_open_now: status.is_open_now,
    closed_kind: status.closed_kind,
    closed_reason: status.closed_reason,
    reopens_at: status.reopens_at,
    next_open_at: status.next_open_at,
    slots: buildSlots(schedule, now, booked),
  };
}
