import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { vehicleTypes } from './rider.profile.js';

/**
 * Rider documents settings (migration 039; owner, 2026-10-10: "give all the
 * options to control to ops and admin").
 *
 * system_configurations 'rider_documents' {"documents": [...]}. No row (or a
 * malformed one) means the defaults below. Admin and Operations edit it from
 * the "Rider documents" settings card (GET|PUT
 * /admin/settings/rider-documents, audited RIDER_DOCUMENT_SETTINGS_UPDATED).
 *
 * Each document type:
 *   enabled       shown in the Rider app at all (a built-in can be switched
 *                 off; a custom one is removed by leaving it out);
 *   required_for  the vehicle types that must upload it before the
 *                 application can be sent, and must have it verified before
 *                 approval. For every other vehicle type it is optional.
 *   needs_expiry  the document carries an expiry date: the applicant may
 *                 enter it, and Ops/Admin must have one to verify it;
 *   needs_back    front AND back photo (e.g. the driving licence card).
 *
 * Defaults (owner): all four required for every motor vehicle; a BICYCLE
 * needs none of them (only what staff set); Revenue licence, Insurance and
 * Driving licence need an expiry date; the Driving licence needs front+back.
 */

export const RIDER_DOCUMENTS_KEY = 'rider_documents';
export type VehicleType = (typeof vehicleTypes)[number];
export const MOTOR_VEHICLES: VehicleType[] = vehicleTypes.filter((v) => v !== 'BICYCLE');
export const MAX_CUSTOM_DOCUMENTS = 10;

export interface RiderDocumentType {
  key: string;
  label: string;
  builtin: boolean;
  enabled: boolean;
  required_for: VehicleType[];
  needs_expiry: boolean;
  needs_back: boolean;
}
export interface RiderDocumentSettings {
  documents: RiderDocumentType[];
}

export const BUILTIN_DOCUMENTS: ReadonlyArray<Omit<RiderDocumentType, 'enabled' | 'required_for'>> = [
  { key: 'VEHICLE_BOOK', label: 'Vehicle book (CR)', builtin: true, needs_expiry: false, needs_back: false },
  { key: 'REVENUE_LICENCE', label: 'Revenue licence', builtin: true, needs_expiry: true, needs_back: false },
  { key: 'INSURANCE', label: 'Insurance certificate', builtin: true, needs_expiry: true, needs_back: false },
  { key: 'DRIVING_LICENCE', label: 'Driving licence', builtin: true, needs_expiry: true, needs_back: true },
];
export const BUILTIN_KEYS = BUILTIN_DOCUMENTS.map((d) => d.key);
export const INSURANCE_KEY = 'INSURANCE';

export function defaultRiderDocumentSettings(): RiderDocumentSettings {
  return {
    documents: BUILTIN_DOCUMENTS.map((d) => ({ ...d, enabled: true, required_for: [...MOTOR_VEHICLES] })),
  };
}

const CUSTOM_KEY_RE = /^CUSTOM_[A-Z0-9]{8}$/;
const isVehicle = (v: unknown): v is VehicleType => typeof v === 'string' && (vehicleTypes as readonly string[]).includes(v);

/** A stored row, read defensively: anything unreadable falls back to the default. */
export function settingsFrom(value: unknown): RiderDocumentSettings {
  const fallback = defaultRiderDocumentSettings();
  const stored = (value && typeof value === 'object' ? (value as { documents?: unknown }).documents : null) as unknown;
  if (!Array.isArray(stored)) return fallback;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const raw of stored) {
    if (raw && typeof raw === 'object' && typeof (raw as { key?: unknown }).key === 'string') {
      byKey.set((raw as { key: string }).key, raw as Record<string, unknown>);
    }
  }
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const vehicles = (v: unknown, d: VehicleType[]) => (Array.isArray(v) ? [...new Set(v.filter(isVehicle))] : d);
  const documents: RiderDocumentType[] = fallback.documents.map((d) => {
    const s = byKey.get(d.key);
    return s
      ? {
          ...d,
          enabled: bool(s.enabled, d.enabled),
          required_for: vehicles(s.required_for, d.required_for),
          needs_expiry: bool(s.needs_expiry, d.needs_expiry),
          needs_back: bool(s.needs_back, d.needs_back),
        }
      : d;
  });
  for (const [key, s] of byKey) {
    if (!CUSTOM_KEY_RE.test(key) || typeof s.label !== 'string' || !s.label.trim()) continue;
    if (documents.filter((d) => !d.builtin).length >= MAX_CUSTOM_DOCUMENTS) break;
    documents.push({
      key,
      label: s.label.trim().slice(0, 80),
      builtin: false,
      enabled: bool(s.enabled, true),
      required_for: vehicles(s.required_for, []),
      needs_expiry: bool(s.needs_expiry, false),
      needs_back: bool(s.needs_back, false),
    });
  }
  return { documents };
}

/** The documents an applicant with this vehicle sees, each marked required or not. */
export function documentsFor(settings: RiderDocumentSettings, vehicle: string | null | undefined) {
  return settings.documents
    .filter((d) => d.enabled)
    .map((d) => ({ ...d, required: isVehicle(vehicle) && d.required_for.includes(vehicle) }));
}

const documentInputSchema = z
  .object({
    // A built-in key, an existing custom key, or omitted for a new custom document.
    key: z.string().trim().max(40).optional(),
    label: z.string().trim().min(2, 'A document name needs at least 2 letters.').max(80, 'A document name can be at most 80 letters.').optional(),
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).default(true),
    required_for: z.array(z.enum(vehicleTypes, { errorMap: () => ({ message: `Vehicle type must be one of ${vehicleTypes.join(', ')}` }) })).max(vehicleTypes.length),
    needs_expiry: z.boolean({ invalid_type_error: 'needs_expiry must be true or false' }),
    needs_back: z.boolean({ invalid_type_error: 'needs_back must be true or false' }).default(false),
  })
  .strict();

export const updateRiderDocumentSettingsSchema = z
  .object({
    documents: z.array(documentInputSchema).max(BUILTIN_DOCUMENTS.length + MAX_CUSTOM_DOCUMENTS),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.documents.forEach((d, i) => {
      if (d.key && seen.has(d.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documents', i, 'key'], message: 'Each document can appear only once.' });
      }
      if (d.key) seen.add(d.key);
      const builtin = d.key ? BUILTIN_KEYS.includes(d.key) : false;
      if (d.key && !builtin && !CUSTOM_KEY_RE.test(d.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documents', i, 'key'], message: 'Unknown document.' });
      }
      if (!builtin && !d.label) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documents', i, 'label'], message: 'Give the document a name.' });
      }
    });
    const customs = input.documents.filter((d) => !d.key || !BUILTIN_KEYS.includes(d.key));
    if (customs.length > MAX_CUSTOM_DOCUMENTS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['documents'], message: `At most ${MAX_CUSTOM_DOCUMENTS} custom documents.` });
    }
  });
export type UpdateRiderDocumentSettingsInput = z.infer<typeof updateRiderDocumentSettingsSchema>;

const newCustomKey = () => `CUSTOM_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

export class RiderDocumentSettingsService {
  /** The stored setting. */
  async realRead(): Promise<RiderDocumentSettings> {
    const row = await db
      .selectFrom('system_configurations')
      .select('value')
      .where('key', '=', RIDER_DOCUMENTS_KEY)
      .executeTakeFirst();
    return settingsFrom(row?.value);
  }

  /**
   * What every rule reads. Tests written before documents existed pin this
   * (tests/setup/rider-documents.ts); tests/rider-documents.test.ts puts
   * realRead back.
   */
  read: () => Promise<RiderDocumentSettings> = () => this.realRead();

  async get(): Promise<RiderDocumentSettings & { updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', RIDER_DOCUMENTS_KEY)
      .executeTakeFirst();
    return { ...settingsFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  /** Replaces the list (built-ins always stay; they can only be switched off). Audited. */
  async set(input: UpdateRiderDocumentSettingsInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', RIDER_DOCUMENTS_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = settingsFrom(before?.value);
      const sent = new Map(input.documents.filter((d) => d.key).map((d) => [d.key as string, d]));
      const documents: RiderDocumentType[] = BUILTIN_DOCUMENTS.map((b) => {
        const d = sent.get(b.key);
        const prev = previous.documents.find((p) => p.key === b.key)!;
        return d
          ? { ...b, enabled: d.enabled, required_for: [...new Set(d.required_for)], needs_expiry: d.needs_expiry, needs_back: d.needs_back }
          : prev;
      });
      for (const d of input.documents) {
        if (d.key && BUILTIN_KEYS.includes(d.key)) continue;
        documents.push({
          key: d.key ?? newCustomKey(),
          label: d.label as string,
          builtin: false,
          enabled: d.enabled,
          required_for: [...new Set(d.required_for)],
          needs_expiry: d.needs_expiry,
          needs_back: d.needs_back,
        });
      }
      const next: RiderDocumentSettings = { documents };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: RIDER_DOCUMENTS_KEY, value, description: 'Rider documents: which are required per vehicle type, expiry dates, front and back' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'RIDER_DOCUMENT_SETTINGS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: RIDER_DOCUMENTS_KEY, ...previous },
        newValues: { key: RIDER_DOCUMENTS_KEY, ...next },
      });
    });
    logger.info({ by: actor.actorId }, 'Rider document settings updated');
    return this.get();
  }
}

export const riderDocumentSettings = new RiderDocumentSettingsService();

/** Mounted under /admin (ADMIN and OPERATIONS). */
export const adminRiderDocumentSettingsRouter = Router();
const STAFF = requireRoles(['ADMIN', 'OPERATIONS']);

adminRiderDocumentSettingsRouter.get('/settings/rider-documents', requireAuth, STAFF, async (_req, res, next) => {
  try {
    res.status(200).json({ success: true, data: { settings: await riderDocumentSettings.get() } });
  } catch (err) {
    next(err);
  }
});

adminRiderDocumentSettingsRouter.put(
  '/settings/rider-documents',
  requireAuth,
  STAFF,
  validate({ body: updateRiderDocumentSettingsSchema }),
  async (req, res, next) => {
    try {
      const settings = await riderDocumentSettings.set(req.body as UpdateRiderDocumentSettingsInput, {
        actorId: req.user!.id,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.status(200).json({ success: true, data: { settings } });
    } catch (err) {
      next(err);
    }
  }
);
