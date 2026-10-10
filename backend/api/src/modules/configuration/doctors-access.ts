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
export const DEFAULT_DOCTORS_ACCESS = { require_sign_in: true } as const;
export const SIGN_IN_REQUIRED_CODE = 'SIGN_IN_REQUIRED';
export const SIGN_IN_REQUIRED_MESSAGE = 'Sign in with your phone number to see doctors.';

export interface DoctorsAccessSetting {
  require_sign_in: boolean;
}

export const updateDoctorsAccessSchema = z
  .object({
    require_sign_in: z.boolean({
      required_error: 'require_sign_in is required',
      invalid_type_error: 'require_sign_in must be true or false',
    }),
  })
  .strict();
export type UpdateDoctorsAccessInput = z.infer<typeof updateDoctorsAccessSchema>;

function doctorsAccessFrom(value: unknown): DoctorsAccessSetting {
  if (value && typeof value === 'object') {
    const v = (value as { require_sign_in?: unknown }).require_sign_in;
    if (typeof v === 'boolean') return { require_sign_in: v };
  }
  return { ...DEFAULT_DOCTORS_ACCESS };
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
      const next: DoctorsAccessSetting = { require_sign_in: input.require_sign_in };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: DOCTORS_ACCESS_KEY, value, description: 'Whether customers must sign in with their phone number to see doctors' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'DOCTORS_ACCESS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: DOCTORS_ACCESS_KEY, ...(before ? previous : {}) },
        newValues: { key: DOCTORS_ACCESS_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Doctors sign-in setting changed');
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
  const { require_sign_in } = await doctorsAccessService.get();
  return { require_sign_in };
};
export const doctorsAccess = {
  read: realRead,
  realRead,
};

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
      const { require_sign_in } = await doctorsAccess.read();
      if (!require_sign_in) return next();
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
