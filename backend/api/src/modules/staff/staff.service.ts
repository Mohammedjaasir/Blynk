import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, UserRole } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import type { CreateStaffInput, UpdateStaffInput } from './staff.schema.js';

/** Roles the Staff accounts page lists. ADMIN rows are shown read-only. */
const LISTED_ROLES: UserRole[] = ['PACKING_STAFF', 'OPERATIONS', 'ADMIN'];
const MANAGED_ROLES: UserRole[] = ['PACKING_STAFF', 'OPERATIONS'];

export interface StaffAccount {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string;
  role: UserRole;
  has_password: boolean;
  disabled: boolean;
  /** ADMIN accounts: shown, never changed from this page. */
  read_only: boolean;
  created_at: Date;
}

export interface AuditMeta {
  actorId: string;
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

const toAccount = (row: StaffRow): StaffAccount => ({
  id: row.id,
  full_name: row.full_name,
  email: row.email,
  phone: row.phone,
  role: row.role,
  has_password: row.has_password,
  disabled: row.disabled,
  read_only: row.role === 'ADMIN',
  created_at: row.created_at,
});

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

export class StaffService {
  /** PACKING_STAFF and OPERATIONS accounts plus read-only ADMINs, newest first. */
  async list(): Promise<StaffAccount[]> {
    const rows = await staffColumns(db)
      .where('role', 'in', LISTED_ROLES)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return (rows as StaffRow[]).map(toAccount);
  }

  /**
   * Creates an Inventory (PACKING_STAFF) or Operations (OPERATIONS) account
   * that signs in with its email + password. The password is stored only as
   * a bcrypt hash made inside Postgres (pgcrypto), like migration 012's.
   */
  async create(input: CreateStaffInput, meta: AuditMeta): Promise<StaffAccount> {
    try {
      return await db.transaction().execute(async (trx) => {
        const clash = await trx
          .selectFrom('users')
          .select(['email', 'phone'])
          .where((eb) => eb.or([eb(sql`lower(email)`, '=', input.email), eb('phone', '=', input.phone)]))
          .execute();
        if (clash.some((r) => r.email?.toLowerCase() === input.email)) throw emailTaken();
        if (clash.some((r) => r.phone === input.phone)) throw phoneTaken();

        const { id } = await trx
          .insertInto('users')
          .values({
            phone: input.phone,
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
          phone: input.phone,
          role: input.role,
        });
        const row = await staffColumns(trx).where('id', '=', id).executeTakeFirstOrThrow();
        logger.info({ staffId: id, role: input.role, by: meta.actorId }, 'Staff account created');
        return toAccount(row as StaffRow);
      });
    } catch (err) {
      // Two creates at once can still meet at the unique indexes.
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === '23505') throw pg.constraint?.includes('phone') ? phoneTaken() : emailTaken();
      throw err;
    }
  }

  /**
   * Renames, changes role, resets the password (which also clears the
   * lockout) or disables/enables one Inventory or Operations account - never
   * an ADMIN account and never the caller's own. A change of role, password
   * or disabled state also ends the account's sessions (its refresh tokens),
   * so the next sign-in carries the new state.
   */
  async update(id: string, input: UpdateStaffInput, meta: AuditMeta): Promise<StaffAccount> {
    if (id === meta.actorId) {
      throw new AppError('You cannot change your own account here.', 403, 'CANNOT_EDIT_SELF');
    }
    return db.transaction().execute(async (trx) => {
      const current = (await staffColumns(trx).where('id', '=', id).forUpdate().executeTakeFirst()) as
        | StaffRow
        | undefined;
      if (!current || !LISTED_ROLES.includes(current.role)) {
        throw new AppError('Staff account not found.', 404, 'STAFF_NOT_FOUND');
      }
      if (!MANAGED_ROLES.includes(current.role)) {
        throw new AppError('Admin accounts cannot be changed here.', 403, 'CANNOT_EDIT_ADMIN');
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
      if (input.role !== undefined && input.role !== current.role) {
        query = query.set({ role: input.role });
        oldValues.role = current.role;
        newValues.role = input.role;
        endSessions = true;
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
        query = query.set({ staff_disabled_at: input.disabled ? sql<Date>`now()` : null });
        oldValues.disabled = current.disabled;
        newValues.disabled = input.disabled;
        endSessions = true;
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
        await audit(trx, meta, 'STAFF_UPDATED', id, oldValues, newValues);
        logger.info({ staffId: id, by: meta.actorId, changed: Object.keys(newValues) }, 'Staff account updated');
      }

      const row = await staffColumns(trx).where('id', '=', id).executeTakeFirstOrThrow();
      return toAccount(row as StaffRow);
    });
  }
}

export const staffService = new StaffService();
