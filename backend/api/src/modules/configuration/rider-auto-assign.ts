import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Automatic rider assignment (owner, 2026-10-25: "live rider map with automatic assignment").
 *
 * system_configurations 'rider_auto_assign' (no migration):
 *   { enabled: false, wait_seconds: 90, max_distance_km: 5 }
 *
 * OFF by default. When on, the worker (riders/rider.auto-assign.ts, every 20 s) gives an order that
 * has waited `wait_seconds` for a rider, and was never assigned by staff, to the best nearby rider
 * who is within `max_distance_km` of the drop-off (and inside the usual trip rules). Staff can still
 * assign by hand at any time; an automatic assignment never overrides or reassigns.
 *
 * GET|PUT /admin/settings/rider-auto-assign (ADMIN, OPERATIONS; audited RIDER_AUTO_ASSIGN_UPDATED).
 * PUT takes any of the three fields; the others keep their stored value.
 */
export const RIDER_AUTO_ASSIGN_KEY = 'rider_auto_assign';
export const AUTO_ASSIGN_LIMITS = {
  wait_seconds: { min: 30, max: 900 },
  max_distance_km: { min: 0.5, max: 25 },
} as const;

export interface RiderAutoAssignSetting {
  enabled: boolean;
  wait_seconds: number;
  max_distance_km: number;
}

export const DEFAULT_RIDER_AUTO_ASSIGN: RiderAutoAssignSetting = { enabled: false, wait_seconds: 90, max_distance_km: 5 };

export const updateRiderAutoAssignSchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    wait_seconds: z
      .number({ invalid_type_error: 'wait_seconds must be a number' })
      .int('wait_seconds must be a whole number of seconds')
      .min(AUTO_ASSIGN_LIMITS.wait_seconds.min, `wait_seconds must be at least ${AUTO_ASSIGN_LIMITS.wait_seconds.min}`)
      .max(AUTO_ASSIGN_LIMITS.wait_seconds.max, `wait_seconds must be at most ${AUTO_ASSIGN_LIMITS.wait_seconds.max}`)
      .optional(),
    max_distance_km: z
      .number({ invalid_type_error: 'max_distance_km must be a number' })
      .min(AUTO_ASSIGN_LIMITS.max_distance_km.min, `max_distance_km must be at least ${AUTO_ASSIGN_LIMITS.max_distance_km.min}`)
      .max(AUTO_ASSIGN_LIMITS.max_distance_km.max, `max_distance_km must be at most ${AUTO_ASSIGN_LIMITS.max_distance_km.max}`)
      .optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.wait_seconds !== undefined || v.max_distance_km !== undefined, {
    message: 'Send enabled, wait_seconds or max_distance_km',
  });
export type UpdateRiderAutoAssignInput = z.infer<typeof updateRiderAutoAssignSchema>;

const inRange = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

/** The stored row as a setting; anything missing or malformed keeps its default (so: OFF). */
export function riderAutoAssignFrom(value: unknown): RiderAutoAssignSetting {
  const out: RiderAutoAssignSetting = { ...DEFAULT_RIDER_AUTO_ASSIGN };
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
    const w = AUTO_ASSIGN_LIMITS.wait_seconds;
    if (inRange(v.wait_seconds, w.min, w.max)) out.wait_seconds = Math.floor(v.wait_seconds);
    const d = AUTO_ASSIGN_LIMITS.max_distance_km;
    if (inRange(v.max_distance_km, d.min, d.max)) out.max_distance_km = v.max_distance_km;
  }
  return out;
}

export class RiderAutoAssignService {
  async get(): Promise<RiderAutoAssignSetting & { updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', RIDER_AUTO_ASSIGN_KEY)
      .executeTakeFirst();
    return { ...riderAutoAssignFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  /** The setting alone (what the worker reads each tick). */
  async read(): Promise<RiderAutoAssignSetting> {
    const { updated_at: _at, ...setting } = await this.get();
    return setting;
  }

  /** Audited (RIDER_AUTO_ASSIGN_UPDATED); the worker sees it on its next tick. */
  async set(input: UpdateRiderAutoAssignInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', RIDER_AUTO_ASSIGN_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = riderAutoAssignFrom(before?.value);
      const next: RiderAutoAssignSetting = {
        enabled: input.enabled ?? previous.enabled,
        wait_seconds: input.wait_seconds ?? previous.wait_seconds,
        max_distance_km: input.max_distance_km ?? previous.max_distance_km,
      };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: RIDER_AUTO_ASSIGN_KEY, value, description: 'Automatic rider assignment: on/off, how long an order waits, how far a rider may be from the drop-off' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'RIDER_AUTO_ASSIGN_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: RIDER_AUTO_ASSIGN_KEY, ...(before ? previous : {}) },
        newValues: { key: RIDER_AUTO_ASSIGN_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Rider auto-assign setting changed');
    });
    return this.get();
  }
}

export const riderAutoAssignService = new RiderAutoAssignService();
