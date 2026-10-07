import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database, UserRole } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { findOpenDeliveriesForRiders } from './batching.js';

/**
 * Staff riders (owner, 2026-10-01: "for the early days my lead is going to be
 * the rider"). An ADMIN or OPERATIONS user may also deliver: they get an
 * ordinary riders row linked by riders.user_id, so assignment, trips, cash
 * and "My day" treat them exactly like any rider. Two ways in:
 *
 *   - the staff member sets up their own profile from the Operations app
 *     (POST /riders/me/profile) - active at once;
 *   - an admin flips "Can deliver" on the Staff accounts page
 *     (PUT /admin/staff/:id/rider), which also turns it off again.
 *
 * Turning it off only deactivates the row (deliveries keep their rider_id),
 * and is refused while the rider still holds an open delivery, so no order
 * is ever left with a rider who can no longer act on it.
 */

export const vehicleTypes = ['MOTORCYCLE', 'SCOOTER', 'BICYCLE', 'THREE_WHEELER', 'CAR'] as const;

/** Who may hold a staff rider profile (RIDER accounts get theirs from the store). */
const STAFF_RIDER_ROLES: UserRole[] = ['ADMIN', 'OPERATIONS'];

export const vehicleTypeSchema = z.enum(vehicleTypes, {
  errorMap: () => ({ message: `Vehicle type must be one of ${vehicleTypes.join(', ')}` }),
});

export const registrationSchema = z
  .string({ required_error: 'Vehicle registration number is required' })
  .trim()
  .min(2, 'Vehicle registration number is required')
  .max(32, 'Vehicle registration number must be at most 32 characters')
  .transform((v) => v.toUpperCase());

export const emergencyPhoneSchema = z
  .string()
  .trim()
  .max(20, 'Emergency contact phone must be at most 20 characters')
  .regex(/^\+?[0-9 ()-]*$/, 'Emergency contact phone may contain digits only')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/**
 * A bicycle has no registration number (migration 029 made the column
 * NULLable); every other vehicle type needs one.
 */
export const registrationRequiredFor = (vehicleType: string | null | undefined) => vehicleType !== 'BICYCLE';
export const REGISTRATION_REQUIRED_MESSAGE = 'Vehicle registration number is required';

/** Zod refinement: the registration number unless the vehicle is a bicycle. */
export function refineRegistration(
  d: { vehicle_type?: string | null; vehicle_registration_number?: string | null },
  ctx: z.RefinementCtx
) {
  if (registrationRequiredFor(d.vehicle_type) && !d.vehicle_registration_number) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicle_registration_number'], message: REGISTRATION_REQUIRED_MESSAGE });
  }
}

/** '' or null (no registration) becomes null; otherwise the usual checks. */
export const optionalRegistrationSchema = z
  .union([z.literal(''), z.null(), registrationSchema])
  .optional()
  .transform((v) => (v ? v : null));

/** POST /riders/me/profile */
export const ownRiderProfileSchema = z
  .object({
    vehicle_type: vehicleTypeSchema,
    vehicle_registration_number: optionalRegistrationSchema,
    emergency_contact_phone: emergencyPhoneSchema,
  })
  .strict()
  .superRefine(refineRegistration);

export type OwnRiderProfileInput = z.infer<typeof ownRiderProfileSchema>;

/** PUT /admin/staff/:id/rider */
export const staffRiderSchema = z
  .object({
    can_deliver: z.boolean({ required_error: 'can_deliver is required', invalid_type_error: 'can_deliver must be true or false' }),
    vehicle_type: vehicleTypeSchema.optional(),
    vehicle_registration_number: registrationSchema.optional(),
  })
  .strict();

export type StaffRiderInput = z.infer<typeof staffRiderSchema>;

export interface RiderProfile {
  id: string;
  vehicle_type: string;
  /** null only for a bicycle. */
  vehicle_registration_number: string | null;
  emergency_contact_phone: string | null;
  is_active: boolean;
}

type Trx = Transaction<Database>;

const PROFILE_COLUMNS = ['id', 'vehicle_type', 'vehicle_registration_number', 'emergency_contact_phone', 'is_active'] as const;

async function lockProfile(trx: Trx, userId: string): Promise<RiderProfile | undefined> {
  return await trx.selectFrom('riders').select(PROFILE_COLUMNS).where('user_id', '=', userId).forUpdate().executeTakeFirst();
}

export async function storeId(trx: Trx): Promise<string> {
  const store = await trx.selectFrom('dark_stores').select('id').where('is_active', '=', true).limit(1).executeTakeFirst();
  if (!store) throw new AppError('There is no active store to deliver from.', 409, 'NO_ACTIVE_STORE');
  return store.id;
}

async function audit(
  trx: Trx,
  actorId: string,
  action: string,
  entityId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown>
) {
  await trx
    .insertInto('audit_logs')
    .values({
      actor_user_id: actorId,
      action,
      entity_type: 'RIDER',
      entity_id: entityId,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: JSON.stringify(newValues),
    })
    .execute();
}

/** A rider with an open delivery must stay active until it is closed. */
async function refuseIfHoldingDeliveries(trx: Trx, riderId: string) {
  const open = await findOpenDeliveriesForRiders([riderId], trx);
  if (open.length > 0) {
    throw new AppError(
      `This rider still has ${open.length} open ${open.length === 1 ? 'delivery' : 'deliveries'}. Finish or reassign ${open.length === 1 ? 'it' : 'them'} first.`,
      409,
      'RIDER_HAS_OPEN_DELIVERIES',
      { open_deliveries: open.map((d) => d.order_number) }
    );
  }
}

export class RiderProfileService {
  /** The caller's own riders row, active or not; null when there is none. */
  async getOwn(userId: string): Promise<RiderProfile | null> {
    const row = await db.selectFrom('riders').select(PROFILE_COLUMNS).where('user_id', '=', userId).executeTakeFirst();
    return row ?? null;
  }

  /**
   * Creates (or updates the vehicle on) the calling staff member's own rider
   * profile, active immediately. A profile an admin switched off stays off:
   * only an admin can turn "Can deliver" back on.
   */
  async setUpOwn(userId: string, role: UserRole, input: OwnRiderProfileInput): Promise<RiderProfile> {
    if (!STAFF_RIDER_ROLES.includes(role)) {
      throw new AppError('Only Operations and Admin accounts can set up their own rider profile.', 403, 'FORBIDDEN');
    }
    return await db.transaction().execute(async (trx) => {
      // The user row lock serialises two set-ups racing for the same user.
      await trx.selectFrom('users').select('id').where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      const current = await lockProfile(trx, userId);
      if (current && !current.is_active) {
        throw new AppError(
          'Delivering was switched off for this account. Ask an admin to turn "Can deliver" back on.',
          403,
          'RIDER_PROFILE_DISABLED'
        );
      }
      const values = {
        vehicle_type: input.vehicle_type,
        vehicle_registration_number: input.vehicle_registration_number,
        emergency_contact_phone: input.emergency_contact_phone ?? null,
      };
      let profile: RiderProfile;
      if (current) {
        profile = await trx
          .updateTable('riders')
          .set({ ...values, updated_at: sql`now()` })
          .where('id', '=', current.id)
          .returning(PROFILE_COLUMNS)
          .executeTakeFirstOrThrow();
        await audit(trx, userId, 'RIDER_PROFILE_UPDATED', profile.id, pick(current), values);
      } else {
        profile = await trx
          .insertInto('riders')
          .values({ user_id: userId, dark_store_id: await storeId(trx), ...values, is_active: true, is_available: true })
          .returning(PROFILE_COLUMNS)
          .executeTakeFirstOrThrow();
        await audit(trx, userId, 'RIDER_PROFILE_CREATED', profile.id, null, { ...values, user_id: userId });
      }
      logger.info({ userId, riderId: profile.id }, 'Staff rider profile set up');
      return profile;
    });
  }

  /**
   * Admin "Can deliver" toggle for an OPERATIONS or ADMIN account. On:
   * reactivates the existing row (taking a new vehicle if given) or creates
   * one, which needs a registration number. Off: deactivates the row.
   */
  async setForStaff(staffId: string, input: StaffRiderInput, actorId: string): Promise<RiderProfile | null> {
    return await db.transaction().execute(async (trx) => {
      const user = await trx
        .selectFrom('users')
        .select(['id', 'role'])
        .where('id', '=', staffId)
        .forUpdate()
        .executeTakeFirst();
      if (!user || !['ADMIN', 'OPERATIONS', 'PACKING_STAFF'].includes(user.role)) {
        throw new AppError('Staff account not found.', 404, 'STAFF_NOT_FOUND');
      }
      if (!STAFF_RIDER_ROLES.includes(user.role)) {
        throw new AppError('Only Operations and Admin accounts can deliver.', 422, 'ROLE_CANNOT_DELIVER');
      }
      const current = await lockProfile(trx, staffId);

      if (!input.can_deliver) {
        if (!current || !current.is_active) return current ?? null;
        await refuseIfHoldingDeliveries(trx, current.id);
        const profile = await trx
          .updateTable('riders')
          .set({ is_active: false, is_available: false, updated_at: sql`now()` })
          .where('id', '=', current.id)
          .returning(PROFILE_COLUMNS)
          .executeTakeFirstOrThrow();
        await audit(trx, actorId, 'RIDER_PROFILE_DISABLED', current.id, { is_active: true }, { is_active: false });
        logger.info({ staffId, riderId: current.id, by: actorId }, 'Staff rider switched off');
        return profile;
      }

      const vehicle = {
        ...(input.vehicle_type ? { vehicle_type: input.vehicle_type } : {}),
        ...(input.vehicle_registration_number ? { vehicle_registration_number: input.vehicle_registration_number } : {}),
      };
      if (current) {
        const profile = await trx
          .updateTable('riders')
          .set({ ...vehicle, is_active: true, is_available: true, updated_at: sql`now()` })
          .where('id', '=', current.id)
          .returning(PROFILE_COLUMNS)
          .executeTakeFirstOrThrow();
        await audit(trx, actorId, 'RIDER_PROFILE_ENABLED', current.id, pick(current), { ...vehicle, is_active: true });
        logger.info({ staffId, riderId: current.id, by: actorId }, 'Staff rider switched on');
        return profile;
      }
      if (!input.vehicle_registration_number && registrationRequiredFor(input.vehicle_type ?? 'MOTORCYCLE')) {
        throw new AppError('Enter the vehicle registration number to let this account deliver.', 400, 'VALIDATION_ERROR', [
          { field: 'vehicle_registration_number', message: 'Vehicle registration number is required', rule: 'custom' },
        ]);
      }
      const values = {
        vehicle_type: input.vehicle_type ?? 'MOTORCYCLE',
        vehicle_registration_number: input.vehicle_registration_number ?? null,
      };
      const profile = await trx
        .insertInto('riders')
        .values({ user_id: staffId, dark_store_id: await storeId(trx), ...values, is_active: true, is_available: true })
        .returning(PROFILE_COLUMNS)
        .executeTakeFirstOrThrow();
      await audit(trx, actorId, 'RIDER_PROFILE_CREATED', profile.id, null, { ...values, user_id: staffId });
      logger.info({ staffId, riderId: profile.id, by: actorId }, 'Staff rider created by admin');
      return profile;
    });
  }
}

function pick(p: RiderProfile) {
  return {
    vehicle_type: p.vehicle_type,
    vehicle_registration_number: p.vehicle_registration_number,
    emergency_contact_phone: p.emergency_contact_phone,
    is_active: p.is_active,
  };
}

export const riderProfileService = new RiderProfileService();
