import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../middleware/error.middleware.js';
import { verifyAccessToken } from '../auth/token.service.js';
import { SHOPPER_ROLES } from '../../middleware/role.middleware.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Doctors need sign-in (owner, 2026-10-10): "For the doctor thing, they must
 * add their phone number and get registered. Otherwise it should not show the
 * doctor things."
 *
 * system_configurations 'doctors_access' {"require_sign_in": bool}. No row
 * (or a malformed one) means ON: a guest must log in or create an account
 * with their phone number before the customer app shows clinics, doctors or
 * slots. Admin and Operations can switch it off (GET|PATCH
 * /admin/settings/doctors-access, audited DOCTORS_ACCESS_UPDATED) to let
 * guests browse again. The customer app reads it from GET /store
 * (`doctors_require_sign_in`).
 */
export const DOCTORS_ACCESS_KEY = 'doctors_access';
export const DEFAULT_DOCTORS_ACCESS = { require_sign_in: true, show_to_customers: true } as const;
export const SIGN_IN_REQUIRED_CODE = 'SIGN_IN_REQUIRED';
export const SIGN_IN_REQUIRED_MESSAGE = 'Sign in with your phone number to see doctors.';
export const DOCTORS_DISABLED_CODE = 'DOCTORS_DISABLED';
export const DOCTORS_DISABLED_MESSAGE = 'Doctor channelling is not available right now.';

/**
 * Show doctor channelling to customers (owner, 2026-10-14: "I must be able to
 * hide and unhide that doctor thing in Admin or Ops"). Stored in the same
 * 'doctors_access' row as `show_to_customers`; missing (every row written
 * before it) means ON - the behaviour until now. When OFF:
 *  - the customer discovery routes (/dental/clinics, /dental/doctors) answer
 *    404 DOCTORS_DISABLED, and so do new bookings (POST
 *    /dental/appointments/holds and /:id/confirm);
 *  - a customer's EXISTING appointments stay readable (GET /dental/appointments,
 *    GET /:id), cancellable (POST /:id/cancel) and rateable (POST /:id/rating),
 *    so nobody loses sight of a visit they already booked;
 *  - GET /store says `doctors_enabled: false` so the apps hide the section;
 *  - staff dental admin (/admin/clinics, /admin/doctors, ...) is unaffected.
 */
export interface DoctorsAccessSetting {
  require_sign_in: boolean;
  show_to_customers: boolean;
}

/** Either field (or both); the other keeps its stored value. */
export const updateDoctorsAccessSchema = z
  .object({
    require_sign_in: z
      .boolean({ invalid_type_error: 'require_sign_in must be true or false' })
      .optional(),
    show_to_customers: z
      .boolean({ invalid_type_error: 'show_to_customers must be true or false' })
      .optional(),
  })
  .strict()
  .refine((v) => v.require_sign_in !== undefined || v.show_to_customers !== undefined, {
    message: 'Send require_sign_in or show_to_customers',
  });
export type UpdateDoctorsAccessInput = z.infer<typeof updateDoctorsAccessSchema>;

function doctorsAccessFrom(value: unknown): DoctorsAccessSetting {
  const result: DoctorsAccessSetting = { ...DEFAULT_DOCTORS_ACCESS };
  if (value && typeof value === 'object') {
    const v = value as { require_sign_in?: unknown; show_to_customers?: unknown };
    if (typeof v.require_sign_in === 'boolean') result.require_sign_in = v.require_sign_in;
    if (typeof v.show_to_customers === 'boolean') result.show_to_customers = v.show_to_customers;
  }
  return result;
}

export class DoctorsAccessService {
  async get(): Promise<DoctorsAccessSetting & { updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', DOCTORS_ACCESS_KEY)
      .executeTakeFirst();
    return { ...doctorsAccessFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  /** Audited (DOCTORS_ACCESS_UPDATED); applies to the next request. */
  async set(input: UpdateDoctorsAccessInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', DOCTORS_ACCESS_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = doctorsAccessFrom(before?.value);
      const next: DoctorsAccessSetting = {
        require_sign_in: input.require_sign_in ?? previous.require_sign_in,
        show_to_customers: input.show_to_customers ?? previous.show_to_customers,
      };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: DOCTORS_ACCESS_KEY, value, description: 'Doctor channelling: shown to customers, and whether they must sign in with their phone number to see doctors' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'DOCTORS_ACCESS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: DOCTORS_ACCESS_KEY, ...(before ? previous : {}) },
        newValues: { key: DOCTORS_ACCESS_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Doctors access setting changed');
    });
    return this.get();
  }
}

export const doctorsAccessService = new DoctorsAccessService();

/**
 * The setting as the dental routes and GET /store apply it. Tests may
 * replace `read` (tests/setup/doctors-access.ts pins it off for suites
 * written before it); `realRead` is the stored value.
 */
const realRead = async (): Promise<DoctorsAccessSetting> => {
  const { require_sign_in, show_to_customers } = await doctorsAccessService.get();
  return { require_sign_in, show_to_customers };
};

/** Tests may pin `read` to an older shape without show_to_customers: missing = shown. */
export function doctorsShown(setting: Partial<DoctorsAccessSetting>): boolean {
  return setting.show_to_customers !== false;
}
export const doctorsAccess: {
  read: () => Promise<Partial<DoctorsAccessSetting> & { require_sign_in: boolean }>;
  realRead: () => Promise<DoctorsAccessSetting>;
} = {
  read: realRead,
  realRead,
};

/**
 * 404 DOCTORS_DISABLED while "Show doctor channelling to customers" is off
 * (see DoctorsAccessSetting). Put in front of the customer discovery routes
 * and the new-booking routes; existing-appointment routes stay open.
 */
export function requireDoctorsShown() {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!doctorsShown(await doctorsAccess.read())) {
        return next(new AppError(DOCTORS_DISABLED_MESSAGE, 404, DOCTORS_DISABLED_CODE));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Guards the customer dental discovery routes (owner, 2026-10-10). With the
 * setting on, a request without a sign-in gets 401 SIGN_IN_REQUIRED (the
 * customer app shows its "Sign in to see doctors" prompt); a bad or expired
 * token gets the usual token error (the app refreshes it); a non-shopping
 * account (Admin, Inventory) gets 403 like other shopping routes. With it
 * off, browsing is public as before; a valid token is still read so nothing
 * downstream changes.
 */
export function requireDoctorsSignIn() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const setting = await doctorsAccess.read();
      if (!doctorsShown(setting)) {
        return next(new AppError(DOCTORS_DISABLED_MESSAGE, 404, DOCTORS_DISABLED_CODE));
      }
      if (!setting.require_sign_in) return next();
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) {
        return next(new AppError(SIGN_IN_REQUIRED_MESSAGE, 401, SIGN_IN_REQUIRED_CODE));
      }
      req.user = verifyAccessToken(token);
      if (!SHOPPER_ROLES.includes(req.user.role)) {
        return next(
          new AppError(`Forbidden: Role '${req.user.role}' is not authorized to access this resource`, 403, 'FORBIDDEN')
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
