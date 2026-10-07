import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, UserRole } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { PHONE_ROLES, type CreateStaffInput, type UpdateStaffInput } from './staff.schema.js';
import { generatePlaceholderPhone, isEmailOnlyRole, isPlaceholderPhone, publicPhone } from '../../utils/phone.js';
import { findOpenDeliveriesForRiders } from '../riders/batching.js';
import { REGISTRATION_REQUIRED_MESSAGE, registrationRequiredFor } from '../riders/rider.profile.js';

/**
 * The permission matrix (owner-approved default, 2026-10-01):
 *
 *   caller      | lists                    | creates                  | manages
 *   ------------+--------------------------+--------------------------+-------------------------
 *   ADMIN       | ADMIN, OPERATIONS,       | ADMIN, OPERATIONS,       | OPERATIONS,
 *               | PACKING_STAFF, RIDER     | PACKING_STAFF            | PACKING_STAFF, RIDER
 *   OPERATIONS  | PACKING_STAFF, RIDER     | PACKING_STAFF            | PACKING_STAFF, RIDER
 *
 * Riders are never created here: they apply in the Rider app and are approved
 * under Rider requests (migration 029); a rider still waiting or rejected is
 * not listed here either. An existing ADMIN account is never changed here
 * (CANNOT_EDIT_ADMIN) - except that another ADMIN may reset its password
 * (owner, 2026-10-07) - nobody changes their own account here
 * (CANNOT_EDIT_SELF), and only an ADMIN moves an account between roles.
 * Everything is written to audit_logs.
 */
const LISTED_ROLES: UserRole[] = ['PACKING_STAFF', 'OPERATIONS', 'ADMIN', 'RIDER'];

export type StaffActorRole = 'ADMIN' | 'OPERATIONS';

const CREATABLE_BY: Record<StaffActorRole, UserRole[]> = {
  ADMIN: ['ADMIN', 'OPERATIONS', 'PACKING_STAFF'],
  OPERATIONS: ['PACKING_STAFF'],
};
const MANAGEABLE_BY: Record<StaffActorRole, UserRole[]> = {
  ADMIN: ['OPERATIONS', 'PACKING_STAFF', 'RIDER'],
  OPERATIONS: ['PACKING_STAFF', 'RIDER'],
};
const LISTED_FOR: Record<StaffActorRole, UserRole[]> = {
  ADMIN: LISTED_ROLES,
  OPERATIONS: ['PACKING_STAFF', 'RIDER'],
};

export interface StaffAccount {
  id: string;
  full_name: string | null;
  email: string | null;
  /** null for Admin and Inventory accounts, which have no phone (migration 028). */
  phone: string | null;
  role: UserRole;
  has_password: boolean;
  disabled: boolean;
  /** ADMIN accounts: shown, never changed from this page. */
  read_only: boolean;
  created_at: Date;
  /**
   * The account's rider profile ("Can deliver", staff riders): null when it
   * has none. Only OPERATIONS and ADMIN accounts can have one.
   */
  rider: StaffRiderSummary | null;
}

export interface StaffRiderSummary {
  id: string;
  is_active: boolean;
  vehicle_type: string;
  /** null only for a bicycle. */
  vehicle_registration_number: string | null;
  emergency_contact_phone: string | null;
}

export interface AuditMeta {
  actorId: string;
  actorRole: StaffActorRole;
  ipAddress?: string | null;
  userAgent?: string | null;
}

type Executor = Transaction<Database> | typeof db;

function staffColumns(executor: Executor) {
  return executor
    .selectFrom('users')
    .select([
      'id',
      'full_name',
      'email',
      'phone',
      'role',
      'created_at',
      sql<boolean>`staff_password_hash IS NOT NULL`.as('has_password'),
      sql<boolean>`staff_disabled_at IS NOT NULL`.as('disabled'),
    ]);
}

type StaffRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string;
  role: UserRole;
  created_at: Date;
  has_password: boolean;
  disabled: boolean;
};

type Actor = Pick<AuditMeta, 'actorId' | 'actorRole'>;

/**
 * Rider requests (migration 029): a RIDER account whose application is still
 * waiting or was rejected lives under Rider requests, not here.
 */
const notAnUnapprovedRider = sql<boolean>`NOT EXISTS (
  SELECT 1 FROM riders r WHERE r.user_id = users.id AND users.role = 'RIDER' AND r.approval_status <> 'APPROVED'
)`;

/** Shown read-only: an ADMIN, the caller's own account, or a role the caller does not manage. */
const readOnlyFor = (row: StaffRow, actor?: Actor) =>
  row.role === 'ADMIN' || (actor ? row.id === actor.actorId || !MANAGEABLE_BY[actor.actorRole].includes(row.role) : false);

const toAccount = (row: StaffRow, rider: StaffRiderSummary | null = null, actor?: Actor): StaffAccount => ({
  id: row.id,
  full_name: row.full_name,
  email: row.email,
  phone: publicPhone(row.phone),
  role: row.role,
  has_password: row.has_password,
  disabled: row.disabled,
  read_only: readOnlyFor(row, actor),
  created_at: row.created_at,
  rider,
});

/** Rider profiles for these users, keyed by user id. */
async function ridersFor(executor: Executor, userIds: string[]): Promise<Map<string, StaffRiderSummary>> {
  if (userIds.length === 0) return new Map();
  const rows = await executor
    .selectFrom('riders')
    .select(['id', 'user_id', 'is_active', 'vehicle_type', 'vehicle_registration_number', 'emergency_contact_phone'])
    .where('user_id', 'in', userIds)
    .execute();
  return new Map(rows.map(({ user_id, ...r }) => [user_id, r]));
}

async function withRider(executor: Executor, row: StaffRow, actor?: Actor): Promise<StaffAccount> {
  return toAccount(row, (await ridersFor(executor, [row.id])).get(row.id) ?? null, actor);
}

/** Only a plain IPv4/IPv6 address goes into audit_logs.ip_address (INET). */
function inetOrNull(ip?: string | null): string | null {
  if (!ip) return null;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return /^[0-9.]+$/.test(v) || /^[0-9a-f:]+$/i.test(v) ? v : null;
}

/** audit_logs (migration 001): who changed which staff account, and how. */
async function audit(
  trx: Transaction<Database>,
  meta: AuditMeta,
  action: string,
  entityId: string,
  oldValues: Record<string, unknown> | null,
  newValues: Record<string, unknown> | null
) {
  await trx
    .insertInto('audit_logs')
    .values({
      actor_user_id: meta.actorId,
      action,
      entity_type: 'USER',
      entity_id: entityId,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      ip_address: inetOrNull(meta.ipAddress),
      user_agent: meta.userAgent ?? null,
    })
    .execute();
}

const emailTaken = () =>
  new AppError('Another account already uses this email address.', 409, 'EMAIL_TAKEN', { field: 'email' });
const phoneTaken = () =>
  new AppError('Another account already uses this phone number.', 409, 'PHONE_TAKEN', { field: 'phone' });
const phoneRequired = () =>
  new AppError('Enter a phone number for an Operations account.', 400, 'PHONE_REQUIRED', { field: 'phone' });
const roleForbidden = (message: string) => new AppError(message, 403, 'STAFF_ROLE_FORBIDDEN');
const roleLabel: Record<string, string> = {
  ADMIN: 'Admin',
  OPERATIONS: 'Operations',
  PACKING_STAFF: 'Inventory',
  RIDER: 'Rider',
};

export class StaffService {
  /**
   * The accounts this caller may see, newest first: every staff and rider
   * account for an ADMIN (ADMINs read-only), only Inventory and Rider
   * accounts for OPERATIONS.
   */
  async list(actor: Actor): Promise<StaffAccount[]> {
    const rows = await staffColumns(db)
      .where('role', 'in', LISTED_FOR[actor.actorRole])
      .where(notAnUnapprovedRider)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const riders = await ridersFor(
      db,
      rows.map((r) => r.id)
    );
    return (rows as StaffRow[]).map((r) => toAccount(r, riders.get(r.id) ?? null, actor));
  }

  /**
   * Creates an Admin, Operations or Inventory (PACKING_STAFF) account that
   * signs in with its email + password - only a role the caller may create
   * (riders apply in the Rider app instead). The password is stored only as a bcrypt hash made inside Postgres
   * (pgcrypto), like migration 012's.
   */
  async create(input: CreateStaffInput, meta: AuditMeta): Promise<StaffAccount> {
    if (!CREATABLE_BY[meta.actorRole].includes(input.role)) {
      throw roleForbidden(`${roleLabel[meta.actorRole]} accounts cannot create ${roleLabel[input.role]} accounts.`);
    }
    // Admin / Inventory accounts have no phone (migration 028): a placeholder
    // fills the NOT NULL UNIQUE column, and any number sent is ignored. The
    // schema guarantees a phone for OPERATIONS.
    const realPhone = isEmailOnlyRole(input.role) ? null : (input.phone ?? null);
    if (!realPhone && !isEmailOnlyRole(input.role)) throw phoneRequired();
    const phone = realPhone ?? generatePlaceholderPhone();
    try {
      return await db.transaction().execute(async (trx) => {
        const clash = await trx
          .selectFrom('users')
          .select(['email', 'phone'])
          .where((eb) => eb.or([eb(sql`lower(email)`, '=', input.email), eb('phone', '=', phone)]))
          .execute();
        if (clash.some((r) => r.email?.toLowerCase() === input.email)) throw emailTaken();
        if (clash.some((r) => r.phone === phone)) throw phoneTaken();

        const { id } = await trx
          .insertInto('users')
          .values({
            phone,
            email: input.email,
            full_name: input.full_name,
            role: input.role,
            is_active: true,
            staff_password_hash: sql<string>`crypt(${input.password}, gen_salt('bf', 10))`,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await audit(trx, meta, 'STAFF_CREATED', id, null, {
          full_name: input.full_name,
          email: input.email,
          phone: realPhone,
          role: input.role,
          by_role: meta.actorRole,
        });
        const row = await staffColumns(trx).where('id', '=', id).executeTakeFirstOrThrow();
        logger.info({ staffId: id, role: input.role, by: meta.actorId }, 'Staff account created');
        return withRider(trx, row as StaffRow, meta);
      });
    } catch (err) {
      // Two creates at once can still meet at the unique indexes.
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === '23505') throw pg.constraint?.includes('phone') ? phoneTaken() : emailTaken();
      throw err;
    }
  }

  /**
   * Renames, changes role (ADMIN callers only, between Inventory and
   * Operations), resets the password (which also clears the lockout),
   * disables/enables, or edits a Rider's vehicle - on an account the caller
   * may manage, never an ADMIN account and never the caller's own. A change
   * of role, password or disabled state also ends the account's sessions
   * (its refresh tokens), so the next sign-in carries the new state.
   *
   * Disabling an account that has a rider profile is refused while it still
   * holds an open delivery (409 RIDER_HAS_OPEN_DELIVERIES); once disabled it
   * is neither suggested nor assignable (staff_disabled_at).
   */
  async update(id: string, input: UpdateStaffInput, meta: AuditMeta): Promise<StaffAccount> {
    if (id === meta.actorId) {
      throw new AppError('You cannot change your own account here.', 403, 'CANNOT_EDIT_SELF');
    }
    return db.transaction().execute(async (trx) => {
      const current = (await staffColumns(trx)
        .where('id', '=', id)
        .where(notAnUnapprovedRider)
        .forUpdate()
        .executeTakeFirst()) as StaffRow | undefined;
      if (!current || !LISTED_ROLES.includes(current.role)) {
        throw new AppError('Staff account not found.', 404, 'STAFF_NOT_FOUND');
      }
      if (current.role === 'ADMIN') {
        // The one change allowed on an ADMIN account: another ADMIN resets
        // its password (owner, 2026-10-07) - a body of exactly {password}.
        const onlyPassword =
          input.password !== undefined &&
          Object.entries(input).every(([k, v]) => k === 'password' || v === undefined);
        if (meta.actorRole !== 'ADMIN' || !onlyPassword) {
          throw new AppError('Admin accounts cannot be changed here.', 403, 'CANNOT_EDIT_ADMIN');
        }
        return this.resetAdminPassword(trx, current, input.password!, meta);
      }
      if (!MANAGEABLE_BY[meta.actorRole].includes(current.role)) {
        throw roleForbidden(`${roleLabel[meta.actorRole]} accounts cannot change ${roleLabel[current.role]} accounts.`);
      }
      if (input.role !== undefined && input.role !== current.role) {
        if (meta.actorRole !== 'ADMIN') throw roleForbidden('Only an admin can change the role of an account.');
        if (current.role === 'RIDER') {
          throw new AppError('A Rider account cannot be moved to another role.', 422, 'ROLE_CHANGE_NOT_ALLOWED');
        }
      }
      const vehicleChange =
        input.vehicle_type !== undefined ||
        input.vehicle_registration_number !== undefined ||
        input.emergency_contact_phone !== undefined;
      if (vehicleChange && current.role !== 'RIDER') {
        throw new AppError('Vehicle details are edited here only for Rider accounts.', 422, 'NOT_A_RIDER_ACCOUNT');
      }

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      let endSessions = false;
      let query = trx.updateTable('users').set({ updated_at: sql`now()` });

      if (input.full_name !== undefined && input.full_name !== current.full_name) {
        query = query.set({ full_name: input.full_name });
        oldValues.full_name = current.full_name;
        newValues.full_name = input.full_name;
      }
      // Phone: Operations and Rider accounts keep a real number; Inventory
      // (and Admin) accounts have none (migration 028). Moving an account to
      // Inventory replaces its number with a placeholder; moving it to
      // Operations needs a real one (400 PHONE_REQUIRED if it has none).
      const roleChange = input.role !== undefined && input.role !== current.role;
      const nextRole = input.role ?? current.role;
      let nextPhone: string | null = null;
      if (isEmailOnlyRole(nextRole)) {
        if (roleChange && !isPlaceholderPhone(current.phone)) {
          nextPhone = generatePlaceholderPhone();
          newValues.phone_removed = true; // never the number itself
        }
      } else if (PHONE_ROLES.includes(nextRole)) {
        if (input.phone !== undefined && input.phone !== current.phone) {
          const taken = await trx
            .selectFrom('users')
            .select('id')
            .where('phone', '=', input.phone)
            .where('id', '!=', id)
            .executeTakeFirst();
          if (taken) throw phoneTaken();
          nextPhone = input.phone;
          oldValues.phone = publicPhone(current.phone);
          newValues.phone = input.phone;
        } else if (roleChange && isPlaceholderPhone(current.phone)) {
          throw phoneRequired();
        }
      }
      if (nextPhone) query = query.set({ phone: nextPhone });

      if (roleChange) {
        query = query.set({ role: input.role! });
        oldValues.role = current.role;
        newValues.role = input.role;
        endSessions = true;
        // Inventory accounts cannot deliver: a staff rider profile goes off
        // with the move (refused while it still holds an open delivery).
        if (input.role === 'PACKING_STAFF') {
          const rider = await trx
            .selectFrom('riders')
            .select(['id', 'is_active'])
            .where('user_id', '=', id)
            .forUpdate()
            .executeTakeFirst();
          if (rider?.is_active) {
            if ((await findOpenDeliveriesForRiders([rider.id], trx)).length > 0) {
              throw new AppError(
                'This account still has open deliveries. Finish or reassign them before moving it to Inventory.',
                409,
                'RIDER_HAS_OPEN_DELIVERIES'
              );
            }
            await trx
              .updateTable('riders')
              .set({ is_active: false, is_available: false, updated_at: sql`now()` })
              .where('id', '=', rider.id)
              .execute();
            newValues.can_deliver = false;
          }
        }
      }
      if (input.password !== undefined) {
        query = query.set({
          staff_password_hash: sql<string>`crypt(${input.password}, gen_salt('bf', 10))`,
          login_failed_attempts: 0,
          login_locked_until: null,
        });
        newValues.password_reset = true; // never the password or its hash
        endSessions = true;
      }
      if (input.disabled !== undefined && input.disabled !== current.disabled) {
        if (input.disabled) {
          // A rider who still carries an order must hand it back first.
          const rider = await trx
            .selectFrom('riders')
            .select('id')
            .where('user_id', '=', id)
            .forUpdate()
            .executeTakeFirst();
          const open = rider ? await findOpenDeliveriesForRiders([rider.id], trx) : [];
          if (open.length > 0) {
            throw new AppError(
              `This account still has ${open.length} open ${open.length === 1 ? 'delivery' : 'deliveries'}. Finish or reassign ${open.length === 1 ? 'it' : 'them'} before disabling it.`,
              409,
              'RIDER_HAS_OPEN_DELIVERIES',
              { open_deliveries: open.map((d) => d.order_number) }
            );
          }
        }
        query = query.set({ staff_disabled_at: input.disabled ? sql<Date>`now()` : null });
        oldValues.disabled = current.disabled;
        newValues.disabled = input.disabled;
        endSessions = true;
      }

      if (vehicleChange) {
        const rider = await trx
          .selectFrom('riders')
          .select(['id', 'vehicle_type', 'vehicle_registration_number', 'emergency_contact_phone'])
          .where('user_id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!rider) throw new AppError('This rider has no rider profile.', 404, 'RIDER_PROFILE_NOT_FOUND');
        // A registration number is needed unless the vehicle is a bicycle.
        const nextType = input.vehicle_type ?? rider.vehicle_type;
        const nextReg = input.vehicle_registration_number !== undefined ? input.vehicle_registration_number : rider.vehicle_registration_number;
        if (registrationRequiredFor(nextType) && !nextReg) {
          throw new AppError('Enter the vehicle registration number.', 400, 'VALIDATION_ERROR', [
            { field: 'vehicle_registration_number', message: REGISTRATION_REQUIRED_MESSAGE, rule: 'custom' },
          ]);
        }
        const set: Record<string, string | null> = {};
        for (const key of ['vehicle_type', 'vehicle_registration_number', 'emergency_contact_phone'] as const) {
          const next = input[key];
          if (next !== undefined && next !== rider[key]) {
            set[key] = next;
            oldValues[key] = rider[key];
            newValues[key] = next;
          }
        }
        if (Object.keys(set).length > 0) {
          await trx
            .updateTable('riders')
            .set({ ...set, updated_at: sql`now()` })
            .where('id', '=', rider.id)
            .execute();
        }
      }

      if (Object.keys(newValues).length > 0) {
        await query.where('id', '=', id).execute();
        if (endSessions) {
          await trx
            .updateTable('refresh_tokens')
            .set({ revoked_at: new Date() })
            .where('user_id', '=', id)
            .where('revoked_at', 'is', null)
            .execute();
        }
        await audit(trx, meta, 'STAFF_UPDATED', id, oldValues, { ...newValues, by_role: meta.actorRole });
        logger.info({ staffId: id, by: meta.actorId, changed: Object.keys(newValues) }, 'Staff account updated');
      }

      const row = await staffColumns(trx).where('id', '=', id).executeTakeFirstOrThrow();
      return withRider(trx, row as StaffRow, meta);
    }).catch((err: { code?: string; constraint?: string }) => {
      // Two edits giving the same number at once meet at the unique index.
      if (err?.code === '23505' && err.constraint?.includes('phone')) throw phoneTaken();
      throw err;
    });
  }

  /**
   * An ADMIN resets another ADMIN's password: like any reset it clears the
   * lockout and ends that account's sessions. Audited as STAFF_UPDATED with
   * password_reset (never the password or its hash).
   */
  private async resetAdminPassword(
    trx: Transaction<Database>,
    current: StaffRow,
    password: string,
    meta: AuditMeta
  ): Promise<StaffAccount> {
    await trx
      .updateTable('users')
      .set({
        staff_password_hash: sql<string>`crypt(${password}, gen_salt('bf', 10))`,
        login_failed_attempts: 0,
        login_locked_until: null,
        updated_at: sql`now()`,
      })
      .where('id', '=', current.id)
      .execute();
    await trx
      .updateTable('refresh_tokens')
      .set({ revoked_at: new Date() })
      .where('user_id', '=', current.id)
      .where('revoked_at', 'is', null)
      .execute();
    await audit(trx, meta, 'STAFF_UPDATED', current.id, {}, {
      password_reset: true,
      target_role: 'ADMIN',
      by_role: meta.actorRole,
    });
    logger.info({ staffId: current.id, by: meta.actorId }, 'Admin password reset by another admin');
    const row = await staffColumns(trx).where('id', '=', current.id).executeTakeFirstOrThrow();
    return withRider(trx, row as StaffRow, meta);
  }
}

export const staffService = new StaffService();
