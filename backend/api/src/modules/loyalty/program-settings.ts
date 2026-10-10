import { db } from '../../database/connection.js';
import { writeAudit, SETTINGS_ENTITY_ID, type AuditActor } from '../audit/audit.writer.js';
import { logger } from '../../utils/logger.js';

/**
 * A program setting stored as one system_configurations row (owner,
 * 2026-10-10: refer a friend and Blynk Points, "admin and ops will decide
 * that"). `parse` turns whatever is stored (or nothing) into a complete
 * setting, so a missing or damaged row reads as the switched-off default.
 *
 * Changes are audited (`auditAction`) and only the fields sent change.
 */
export function programSettings<T extends object>(opts: {
  key: string;
  description: string;
  auditAction: string;
  parse: (value: unknown) => T;
  /** Whole-setting checks after merging (throw an AppError). */
  check?: (next: T) => void;
}) {
  async function view(): Promise<{ setting: T; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', opts.key)
      .executeTakeFirst();
    return { setting: opts.parse(row?.value), updated_at: row?.updated_at ?? null };
  }

  return {
    key: opts.key,
    view,
    /** What checkout and the lifecycle apply. Tests may replace it. */
    read: async (): Promise<T> => (await view()).setting,
    async update(input: Partial<T>, actor: AuditActor): Promise<T & { updated_at: Date | null }> {
      await db.transaction().execute(async (trx) => {
        const before = await trx
          .selectFrom('system_configurations')
          .select('value')
          .where('key', '=', opts.key)
          .forUpdate()
          .executeTakeFirst();
        const previous = opts.parse(before?.value);
        const defined = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
        const next = { ...previous, ...defined } as T;
        opts.check?.(next);
        const value = JSON.stringify(next);
        await trx
          .insertInto('system_configurations')
          .values({ key: opts.key, value, description: opts.description })
          .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
          .execute();
        await writeAudit(trx, actor, {
          action: opts.auditAction,
          entityType: 'SYSTEM_CONFIGURATION',
          entityId: SETTINGS_ENTITY_ID,
          oldValues: { key: opts.key, ...(before ? (previous as Record<string, unknown>) : {}) },
          newValues: { key: opts.key, ...(next as Record<string, unknown>) },
        });
        logger.info({ key: opts.key, previous, next, actorId: actor.actorId }, 'Program setting changed');
      });
      const after = await view();
      return { ...after.setting, updated_at: after.updated_at };
    },
  };
}

/** A finite number from a stored JSON value, else the fallback. */
export function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** At most two decimal places (money). */
export const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
