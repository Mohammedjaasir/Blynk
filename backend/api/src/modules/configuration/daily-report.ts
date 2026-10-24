import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * The daily report (owner, 2026-10-25: "the 9 pm daily report"). Every evening one short English
 * SMS per saved number tells the owner how the day went (orders, sales, cash, top products, low
 * stock, ratings). No migration: it lives in system_configurations 'daily_report':
 *
 *   { enabled, send_at 'HH:MM' (Colombo, default 21:00), phones[] (<= 5 Sri Lankan numbers),
 *     last_sent_date  'YYYY-MM-DD'  the Colombo day the AUTOMATIC report last went out (once a day),
 *     last_sent_at / last_sent_kind  the last send of any kind ('auto' | 'manual') and when,
 *     last_manual_at                 when "Send now" was last pressed (2-minute cooldown) }
 *
 * Staff: GET|PUT /admin/settings/daily-report (ADMIN, OPERATIONS; audited DAILY_REPORT_UPDATED).
 * The last_* fields are written by the sender only, never by PUT. Off by default.
 */
export const DAILY_REPORT_KEY = 'daily_report';
export const DAILY_REPORT_LIMITS = { phones: 5 } as const;
export const DEFAULT_SEND_AT = '21:00';

export interface DailyReportSetting {
  enabled: boolean;
  send_at: string;
  phones: string[];
  last_sent_date: string | null;
  last_sent_at: string | null;
  last_sent_kind: 'auto' | 'manual' | null;
  last_manual_at: string | null;
}

export const DEFAULT_DAILY_REPORT: DailyReportSetting = {
  enabled: false,
  send_at: DEFAULT_SEND_AT,
  phones: [],
  last_sent_date: null,
  last_sent_at: null,
  last_sent_kind: null,
  last_manual_at: null,
};

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const phoneSchema = z
  .string({ invalid_type_error: 'A phone number must be text' })
  .trim()
  .transform((v, ctx) => {
    try {
      return normalizeSriLankanPhone(v);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${v}" is not a valid Sri Lankan mobile number` });
      return z.NEVER;
    }
  });

/** Any of the three; the others keep their stored value. Numbers are saved as +947XXXXXXXX, without repeats. */
export const updateDailyReportSchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    send_at: z.string({ invalid_type_error: 'send_at must be a time like 21:00' }).trim().regex(HH_MM, 'Use a time like 21:00').optional(),
    phones: z
      .array(phoneSchema)
      .max(DAILY_REPORT_LIMITS.phones, `At most ${DAILY_REPORT_LIMITS.phones} numbers`)
      .transform((list) => [...new Set(list)])
      .optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.send_at !== undefined || v.phones !== undefined, {
    message: 'Send enabled, send_at or phones',
  })
  .refine((v) => !(v.enabled === true && v.phones !== undefined && v.phones.length === 0), {
    message: 'Add at least one number before switching the report on',
    path: ['phones'],
  });
export type UpdateDailyReportInput = z.infer<typeof updateDailyReportSchema>;

const asIso = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

/** A stored row as a setting; anything malformed falls back to its default. */
export function dailyReportFrom(value: unknown): DailyReportSetting {
  const out: DailyReportSetting = { ...DEFAULT_DAILY_REPORT, phones: [] };
  if (!value || typeof value !== 'object') return out;
  const v = value as Record<string, unknown>;
  if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
  if (typeof v.send_at === 'string' && HH_MM.test(v.send_at)) out.send_at = v.send_at;
  if (Array.isArray(v.phones)) {
    for (const p of v.phones) {
      if (typeof p !== 'string' || out.phones.length >= DAILY_REPORT_LIMITS.phones) continue;
      try {
        const n = normalizeSriLankanPhone(p);
        if (!out.phones.includes(n)) out.phones.push(n);
      } catch {
        /* a bad number is dropped, the rest are kept */
      }
    }
  }
  if (typeof v.last_sent_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.last_sent_date)) out.last_sent_date = v.last_sent_date;
  out.last_sent_at = asIso(v.last_sent_at);
  if (v.last_sent_kind === 'auto' || v.last_sent_kind === 'manual') out.last_sent_kind = v.last_sent_kind;
  out.last_manual_at = asIso(v.last_manual_at);
  return out;
}

const DESCRIPTION = 'Daily report: the evening SMS to the owner (on/off, time, numbers) and when it last went out';

export class DailyReportService {
  async get(): Promise<DailyReportSetting & { updated_at: Date | null }> {
    const row = await db.selectFrom('system_configurations').select(['value', 'updated_at']).where('key', '=', DAILY_REPORT_KEY).executeTakeFirst();
    return { ...dailyReportFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  /** Audited (DAILY_REPORT_UPDATED); the sender's last_* fields are kept. */
  async set(input: UpdateDailyReportInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('system_configurations').select('value').where('key', '=', DAILY_REPORT_KEY).forUpdate().executeTakeFirst();
      const previous = dailyReportFrom(before?.value);
      const next: DailyReportSetting = {
        ...previous,
        enabled: input.enabled ?? previous.enabled,
        send_at: input.send_at ?? previous.send_at,
        phones: input.phones ?? previous.phones,
      };
      if (next.enabled && next.phones.length === 0) {
        // Switching on with nothing saved (PUT { enabled: true } alone): same rule as the schema.
        throw new AppError('Add at least one number before switching the report on', 400, 'VALIDATION_ERROR', [
          { field: 'phones', message: 'Add at least one number before switching the report on', rule: 'custom' },
        ]);
      }
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: DAILY_REPORT_KEY, value, description: DESCRIPTION })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      const view = (s: DailyReportSetting) => ({ enabled: s.enabled, send_at: s.send_at, phones: s.phones });
      await writeAudit(trx, actor, {
        action: 'DAILY_REPORT_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: DAILY_REPORT_KEY, ...(before ? view(previous) : {}) },
        newValues: { key: DAILY_REPORT_KEY, ...view(next) },
      });
      logger.info({ actorId: actor.actorId, enabled: next.enabled, sendAt: next.send_at, phones: next.phones.length }, 'Daily report setting changed');
    });
    return this.get();
  }
}

export const dailyReportService = new DailyReportService();
