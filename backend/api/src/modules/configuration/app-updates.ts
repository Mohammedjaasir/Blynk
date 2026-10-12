import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { downloadHandler, manifestHandler, shareDownloadHandler } from './app-downloads.js';

/**
 * In-app updates for the staff Android apps (owner, 2026-10-12): Admin and
 * Operations can push Blynk Ops and Blynk Rider users onto a new APK.
 *
 * system_configurations 'app_updates' {"ops": Policy, "rider": Policy}, where
 * Policy = {min_version_code, mode, notes}. No row (or a malformed entry)
 * means {min_version_code: 0, mode: 'optional', notes: ''}: the apps only
 * offer an update when the published manifest (GET
 * /app-updates/manifest?app=<app>, signed in; app-downloads.ts) is newer
 * than what is installed.
 *
 * - mode 'optional': a dismissible "Update available" reminder.
 * - mode 'required': an installed versionCode below min_version_code blocks
 *   the app with only an Update button until it is updated.
 *
 * GET /app-updates/policy?app=ops|rider is public (the apps ask on the login
 * screen too) and returns only the policy. GET|PATCH
 * /admin/settings/app-updates is Admin + Operations, audited
 * APP_UPDATES_UPDATED.
 */
export const APP_UPDATES_KEY = 'app_updates';
export const STAFF_APPS = ['ops', 'rider'] as const;
export type StaffApp = (typeof STAFF_APPS)[number];
export const UPDATE_MODES = ['optional', 'required'] as const;
export type UpdateMode = (typeof UPDATE_MODES)[number];
/** Android's own ceiling for versionCode. */
export const MAX_VERSION_CODE = 2_100_000_000;
export const MAX_NOTES_LENGTH = 500;

export interface AppUpdatePolicy {
  min_version_code: number;
  mode: UpdateMode;
  notes: string;
}
export type AppUpdatesSetting = Record<StaffApp, AppUpdatePolicy>;

export const DEFAULT_APP_UPDATE_POLICY: AppUpdatePolicy = { min_version_code: 0, mode: 'optional', notes: '' };

const policyInputSchema = z
  .object({
    min_version_code: z
      .number({ invalid_type_error: 'min_version_code must be a whole number' })
      .int('min_version_code must be a whole number')
      .min(0, 'min_version_code cannot be negative')
      .max(MAX_VERSION_CODE, `min_version_code cannot be above ${MAX_VERSION_CODE}`)
      .optional(),
    mode: z.enum(UPDATE_MODES, { errorMap: () => ({ message: "mode must be 'optional' or 'required'" }) }).optional(),
    notes: z
      .string({ invalid_type_error: 'notes must be text' })
      .trim()
      .max(MAX_NOTES_LENGTH, `notes can be at most ${MAX_NOTES_LENGTH} characters`)
      .optional(),
  })
  .strict();

export const updateAppUpdatesSchema = z
  .object({ ops: policyInputSchema.optional(), rider: policyInputSchema.optional() })
  .strict()
  .refine((v) => v.ops !== undefined || v.rider !== undefined, { message: 'Send ops and/or rider' });
export type UpdateAppUpdatesInput = z.infer<typeof updateAppUpdatesSchema>;

export const policyQuerySchema = z.object({
  app: z.enum(STAFF_APPS, { errorMap: () => ({ message: "app must be 'ops' or 'rider'" }) }),
});

function policyFrom(value: unknown): AppUpdatePolicy {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const code = v.min_version_code;
  return {
    min_version_code:
      typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= MAX_VERSION_CODE ? code : 0,
    mode: v.mode === 'required' ? 'required' : 'optional',
    notes: typeof v.notes === 'string' ? v.notes.slice(0, MAX_NOTES_LENGTH) : '',
  };
}

function settingFrom(value: unknown): AppUpdatesSetting {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { ops: policyFrom(v.ops), rider: policyFrom(v.rider) };
}

export class AppUpdatesService {
  async get(): Promise<AppUpdatesSetting & { updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', APP_UPDATES_KEY)
      .executeTakeFirst();
    return { ...settingFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  async getPolicy(app: StaffApp): Promise<AppUpdatePolicy> {
    return (await this.get())[app];
  }

  /** Audited (APP_UPDATES_UPDATED). Fields left out keep their stored value. */
  async set(input: UpdateAppUpdatesInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', APP_UPDATES_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = settingFrom(before?.value);
      const next: AppUpdatesSetting = {
        ops: { ...previous.ops, ...stripUndefined(input.ops) },
        rider: { ...previous.rider, ...stripUndefined(input.rider) },
      };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: APP_UPDATES_KEY, value, description: 'Staff app updates: minimum version and optional/required per app' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'APP_UPDATES_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: APP_UPDATES_KEY, ...(before ? previous : {}) },
        newValues: { key: APP_UPDATES_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Staff app update policy changed');
    });
    return this.get();
  }
}

function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const appUpdatesService = new AppUpdatesService();

/**
 * /api/v1/app-updates:
 * - GET /policy?app=ops|rider        public - only the policy.
 * - GET /manifest?app=ops|rider      signed in (per-app roles; app-downloads.ts).
 * - GET|HEAD /download?app=ops|rider signed in - the APK.
 * - GET|HEAD /share/:token/:file     public only while a share link is on.
 */
export const appUpdatesRouter = Router();
appUpdatesRouter.get('/manifest', requireAuth, manifestHandler);
// Express answers HEAD with the GET handler; sendApk sends headers only.
appUpdatesRouter.get('/download', requireAuth, downloadHandler);
appUpdatesRouter.get('/share/:token/:file', shareDownloadHandler);
appUpdatesRouter.get('/policy', async (req, res, next) => {
  try {
    const { app } = policyQuerySchema.parse(req.query);
    const policy = await appUpdatesService.getPolicy(app);
    res.set('Cache-Control', 'no-cache');
    res.json({ success: true, data: { app, ...policy } });
  } catch (err) {
    next(err);
  }
});
