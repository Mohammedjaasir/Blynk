import { sql, Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { phoneHash } from '../users/phone-identity.js';

export type DBConnection = Transaction<Database> | typeof db;

export interface CreateOtpData {
  phone: string;
  otp_hash: string;
  purpose?: string;
  max_attempts: number;
  expires_at: Date;
}

export interface CreateRefreshTokenData {
  user_id: string;
  token_hash: string;
  device_info?: string | null;
  ip_address?: string | null;
  expires_at: Date;
}

export class AuthRepository {
  /**
   * Invalidates any prior active, unconsumed OTP challenges for this phone.
   */
  async invalidatePriorOtps(executor: DBConnection, phone: string): Promise<void> {
    await executor
      .updateTable('otp_verifications')
      .set({ consumed_at: new Date() })
      .where('phone', '=', phone)
      .where('consumed_at', 'is', null)
      .execute();
  }

  /**
   * Persists a new hashed OTP challenge.
   */
  async createOtpVerification(executor: DBConnection, data: CreateOtpData) {
    const [record] = await executor
      .insertInto('otp_verifications')
      .values({
        phone: data.phone,
        otp_hash: data.otp_hash,
        purpose: data.purpose || 'LOGIN',
        attempts_count: 0,
        max_attempts: data.max_attempts,
        expires_at: data.expires_at,
      })
      .returningAll()
      .execute();

    return record;
  }

  /**
   * Finds the latest active OTP challenge for this phone without row-level locking.
   */
  async findLatestOtp(executor: DBConnection, phone: string) {
    const record = await executor
      .selectFrom('otp_verifications')
      .selectAll()
      .where('phone', '=', phone)
      .where('consumed_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return record || null;
  }

  /**
   * Finds the latest active OTP challenge for this phone with row-level locking (FOR UPDATE).
   */
  async findActiveOtpForUpdate(executor: DBConnection, phone: string) {
    const record = await executor
      .selectFrom('otp_verifications')
      .selectAll()
      .where('phone', '=', phone)
      .where('consumed_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .forUpdate()
      .executeTakeFirst();

    return record || null;
  }

  /**
   * Increments the verification attempt counter on an OTP challenge.
   */
  async incrementOtpAttempts(executor: DBConnection, otpId: string) {
    const [updated] = await executor
      .updateTable('otp_verifications')
      .set({
        attempts_count: sql`attempts_count + 1`,
      })
      .where('id', '=', otpId)
      .returningAll()
      .execute();

    return updated;
  }

  /**
   * Marks an OTP challenge as consumed upon successful verification.
   */
  async markOtpConsumed(executor: DBConnection, otpId: string) {
    const [updated] = await executor
      .updateTable('otp_verifications')
      .set({
        consumed_at: new Date(),
      })
      .where('id', '=', otpId)
      .returningAll()
      .execute();

    return updated;
  }

  /**
   * Finds a user by phone number.
   */
  async findUserByPhone(executor: DBConnection, phone: string, forUpdate = false) {
    let query = executor
      .selectFrom('users')
      .selectAll()
      .where('phone', '=', phone);

    if (forUpdate) {
      query = query.forUpdate();
    }

    return (await query.executeTakeFirst()) || null;
  }

  /**
   * Finds a user by ID.
   */
  async findUserById(executor: DBConnection, id: string) {
    return (
      (await executor
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()) || null
    );
  }

  /**
   * Concurrency-safe customer creation:
   * Inserts a new customer. If concurrent insert happens, updates last_login_at.
   */
  async createOrGetCustomer(executor: DBConnection, phone: string) {
    const now = new Date();

    const [user] = await executor
      .insertInto('users')
      .values({
        phone,
        role: 'CUSTOMER',
        is_active: true,
        phone_verified_at: now,
        last_login_at: now,
        // Migration 041: the number's stable identity (users/phone-identity.ts).
        phone_hash: phoneHash(phone),
      })
      .onConflict((oc) =>
        oc.column('phone').doUpdateSet({
          last_login_at: now,
          phone_verified_at: sql`COALESCE(users.phone_verified_at, ${now})`,
          phone_hash: phoneHash(phone),
        })
      )
      .returningAll()
      .execute();

    return user;
  }

  /**
   * Seller portal first sign-in (migration 051/052): a SELLER user plus its
   * sellers row, status PENDING (the column default). A number that became
   * an account in the meantime is PHONE_IN_USE, never a second row.
   */
  async createSeller(executor: DBConnection, phone: string, shopName: string) {
    const now = new Date();
    const user = await executor
      .insertInto('users')
      .values({
        phone,
        role: 'SELLER',
        is_active: true,
        phone_verified_at: now,
        last_login_at: now,
        phone_hash: phoneHash(phone),
      })
      .onConflict((oc) => oc.column('phone').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!user) throw new AppError('This number is already used for a Blynk account.', 403, 'PHONE_IN_USE');
    await executor.insertInto('sellers').values({ user_id: user.id, shop_name: shopName }).execute();
    return user;
  }

  /**
   * Updates last_login_at and ensures phone_verified_at is set for an existing user.
   */
  async updateLastLogin(executor: DBConnection, userId: string, phone?: string) {
    const now = new Date();
    // Migration 041: rows made before it get their phone_hash at sign-in.
    const hash = phoneHash(phone);
    const [updated] = await executor
      .updateTable('users')
      .set({
        last_login_at: now,
        phone_verified_at: sql`COALESCE(phone_verified_at, ${now})`,
        ...(hash ? { phone_hash: hash } : {}),
      })
      .where('id', '=', userId)
      .returningAll()
      .execute();

    return updated;
  }

  /**
   * Saves a hashed refresh token.
   */
  async saveRefreshToken(executor: DBConnection, data: CreateRefreshTokenData) {
    const [record] = await executor
      .insertInto('refresh_tokens')
      .values({
        user_id: data.user_id,
        token_hash: data.token_hash,
        device_info: data.device_info || null,
        ip_address: data.ip_address || null,
        expires_at: data.expires_at,
      })
      .returningAll()
      .execute();

    return record;
  }

  /**
   * Finds a refresh token by its SHA-256 digest with row-level locking (FOR UPDATE).
   */
  async findRefreshTokenForUpdate(executor: DBConnection, tokenHash: string) {
    return (
      (await executor
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .forUpdate()
        .executeTakeFirst()) || null
    );
  }

  /**
   * Revokes a refresh token session.
   */
  async revokeRefreshToken(executor: DBConnection, id: string) {
    const [revoked] = await executor
      .updateTable('refresh_tokens')
      .set({
        revoked_at: new Date(),
      })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .returningAll()
      .execute();

    return revoked || null;
  }

  /**
   * Revokes all active refresh tokens for a user (security breach / session kill).
   */
  async revokeAllUserRefreshTokens(executor: DBConnection, userId: string) {
    await executor
      .updateTable('refresh_tokens')
      .set({
        revoked_at: new Date(),
      })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}

export const authRepository = new AuthRepository();
