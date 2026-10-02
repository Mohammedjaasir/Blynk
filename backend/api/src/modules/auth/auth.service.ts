import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../middleware/error.middleware.js';
import { authRepository } from './auth.repository.js';
import { authRateLimiter } from './auth.rate-limiter.js';
import { generateOtp, hashOtp, compareOtp } from './otp.service.js';
import { SmsProvider } from '../notifications/providers/sms.provider.js';
import { generateAccessToken, generateRefreshToken, hashToken } from './token.service.js';


const otpSms = new SmsProvider();

export interface RequestOtpResult {
  message: string;
  expires_in_seconds: number;
  dev_otp?: string;
}

export interface AuthTokensResult {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    phone: string;
    role: string;
    full_name: string | null;
    email: string | null;
  };
}

export interface RefreshTokensResult {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Roles that may sign in with email + password (migration 012; OPERATIONS
 * from 014; RIDER from 2026-10-01, for rider accounts created on the Staff
 * accounts page - same lockout and disabled checks).
 */
export const STAFF_PASSWORD_ROLES: string[] = ['ADMIN', 'PACKING_STAFF', 'OPERATIONS', 'RIDER'];

/**
 * The one refusal for a staff account an admin has disabled (migration 014),
 * identical on both sign-in paths (email + password and SMS code) and on
 * refresh. It never says "disabled": it reads like any other failed sign-in.
 */
export const staffSignInRefused = () =>
  new AppError('Sign-in failed. Check your details or ask your store admin.', 401, 'INVALID_CREDENTIALS');
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;

export class AuthService {
  /**
   * Generates and stores a new OTP for a normalized mobile number.
   * Enforces rate limiting and invalidates prior unconsumed challenges.
   */
  async requestOtp(phone: string, clientIp: string): Promise<RequestOtpResult> {
    // Rate limit per phone: max 3 requests per hour
    authRateLimiter.checkLimit(
      `otp_phone:${phone}`,
      3,
      60 * 60 * 1000,
      'Maximum OTP requests reached for this phone number. Please try again in 1 hour.'
    );

    // Rate limit per IP: max 15 requests per 15 minutes
    authRateLimiter.checkLimit(
      `otp_ip:${clientIp}`,
      15,
      15 * 60 * 1000,
      'Too many OTP requests from this IP address. Please wait before retrying.'
    );

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

    await db.transaction().execute(async (trx) => {
      // Invalidate existing active challenges for this phone
      await authRepository.invalidatePriorOtps(trx, phone);

      // Persist new hashed challenge
      await authRepository.createOtpVerification(trx, {
        phone,
        otp_hash: otpHash,
        purpose: 'LOGIN',
        max_attempts: env.OTP_MAX_ATTEMPTS,
        expires_at: expiresAt,
      });
    });

    logger.info({ phone, expiresAt }, 'OTP challenge issued successfully');

    // Deliver the code by SMS (Notify.lk). Until 2026-09-26 the code was only
    // stored and, outside production, returned as dev_otp - no SMS was ever
    // sent. With dev_ placeholder credentials the provider simulates the
    // send, so local development without a key still works.
    const sms = await otpSms.send({
      notificationId: `otp_${Date.now()}`,
      recipient: phone,
      message: `Your Blynk verification code is ${otp}. It expires in ${env.OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`,
    });
    if (!sms.success) {
      logger.error(
        { provider: sms.providerName, errorType: sms.errorType, error: sms.errorMessage },
        'OTP SMS delivery failed'
      );
      // In production a code nobody receives is a dead end: say so. Outside
      // production the dev_otp below still lets sign-in proceed.
      if (env.NODE_ENV === 'production') {
        throw new AppError(
          'We could not send the verification code. Please try again shortly.',
          502,
          'OTP_DELIVERY_FAILED'
        );
      }
    }

    // In dev / test environments, attach dev_otp to allow automated verification
    const isDevOrTest = env.NODE_ENV !== 'production';
    if (isDevOrTest) {
      logger.debug({ phone, dev_otp: otp }, '[DEV/TEST ONLY] Plaintext OTP generated');
    }

    return {
      message: 'OTP sent successfully',
      expires_in_seconds: env.OTP_EXPIRY_MINUTES * 60,
      ...(isDevOrTest ? { dev_otp: otp } : {}),
    };
  }

  /**
   * Verifies an OTP challenge, auto-registers customer if new, and returns access/refresh tokens.
   */
  async verifyOtp(
    phone: string,
    submittedOtp: string,
    meta: { ipAddress?: string; deviceInfo?: string }
  ): Promise<AuthTokensResult> {
    // 1. Fetch active OTP challenge without transaction
    const activeOtp = await authRepository.findLatestOtp(db, phone);

    if (!activeOtp) {
      throw new AppError(
        'Invalid or expired OTP challenge. Please request a new OTP.',
        401,
        'INVALID_OTP'
      );
    }

    // 2. Check attempt limit
    if (activeOtp.attempts_count >= activeOtp.max_attempts) {
      throw new AppError(
        'Too many failed verification attempts. This OTP has been locked. Please request a new one.',
        429,
        'OTP_MAX_ATTEMPTS_EXCEEDED'
      );
    }

    // 3. Check expiration
    if (new Date() > activeOtp.expires_at) {
      throw new AppError('OTP has expired. Please request a new one.', 410, 'OTP_EXPIRED');
    }

    // 4. Cryptographic constant-time compare
    const isValid = await compareOtp(submittedOtp, activeOtp.otp_hash);

    if (!isValid) {
      const updated = await authRepository.incrementOtpAttempts(db, activeOtp.id);
      const remainingAttempts = activeOtp.max_attempts - updated.attempts_count;

      if (remainingAttempts <= 0) {
        throw new AppError(
          'Too many failed verification attempts. Please request a new OTP.',
          429,
          'OTP_MAX_ATTEMPTS_EXCEEDED'
        );
      }

      throw new AppError(
        `Invalid OTP code. ${remainingAttempts} attempt(s) remaining.`,
        401,
        'INVALID_OTP',
        { remaining_attempts: remainingAttempts }
      );
    }

    // 5. If valid, open transaction with FOR UPDATE row lock to consume challenge safely and prevent concurrency/replay
    const result = await db.transaction().execute(async (trx) => {
      const lockedOtp = await authRepository.findActiveOtpForUpdate(trx, phone);

      if (!lockedOtp || lockedOtp.id !== activeOtp.id || lockedOtp.consumed_at !== null) {
        throw new AppError(
          'Invalid or expired OTP challenge. Please request a new OTP.',
          401,
          'INVALID_OTP'
        );
      }

      // Mark challenge consumed
      await authRepository.markOtpConsumed(trx, lockedOtp.id);

      // Find or auto-register user
      const existingUser = await authRepository.findUserByPhone(trx, phone, true);
      let user;

      if (existingUser) {
        if (!existingUser.is_active) {
          throw new AppError(
            'Your account has been deactivated. Please contact support.',
            403,
            'ACCOUNT_DEACTIVATED'
          );
        }
        // A disabled staff account (migration 014) cannot fall back to an SMS
        // code either. Thrown inside the transaction, so nothing is consumed.
        if (existingUser.staff_disabled_at) throw staffSignInRefused();
        user = await authRepository.updateLastLogin(trx, existingUser.id);
      } else {
        // First-time login: auto-register as CUSTOMER strictly
        user = await authRepository.createOrGetCustomer(trx, phone);
      }

      return this.issueTokens(trx, user, meta);
    });

    return result;
  }

  /**
   * The session every sign-in method ends in: an access token and a
   * single-use refresh token saved for rotation. Shared by SMS codes and
   * staff passwords so both produce exactly the same kind of session.
   */
  private async issueTokens(
    trx: Transaction<Database>,
    user: { id: string; phone: string; role: string; full_name: string | null; email: string | null },
    meta: { ipAddress?: string; deviceInfo?: string }
  ): Promise<AuthTokensResult> {
    const accessToken = generateAccessToken({
      id: user.id,
      phone: user.phone,
      role: user.role as never,
    });

    const { rawToken, tokenHash } = generateRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await authRepository.saveRefreshToken(trx, {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: refreshExpiresAt,
      device_info: meta.deviceInfo,
      ip_address: meta.ipAddress,
    });

    return {
      access_token: accessToken,
      refresh_token: rawToken,
      token_type: 'Bearer',
      expires_in: 900, // 15 minutes in seconds
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        full_name: user.full_name,
        email: user.email,
      },
    } as AuthTokensResult;
  }

  /**
   * Staff email + password sign-in (migration 012). Only ADMIN,
   * PACKING_STAFF and OPERATIONS (migration 014) accounts with a password set may use it; everyone else
   * keeps SMS codes.
   *
   * - Every refusal before the password check reads the same ("Wrong email or
   *   password"), so it never reveals which emails are staff.
   * - LOGIN_MAX_ATTEMPTS wrong passwords lock the account for
   *   LOGIN_LOCK_MINUTES; a per-IP limit stops one device spraying many emails.
   * - The email is matched on lower(email) (unique index, migration 012).
   * - The password is compared inside Postgres with pgcrypto's crypt(), so the
   *   plain password never leaves the request and only a bcrypt hash is stored.
   */
  async loginWithPassword(
    email: string,
    password: string,
    meta: { ipAddress?: string; deviceInfo?: string }
  ): Promise<AuthTokensResult> {
    authRateLimiter.checkLimit(
      `staff_login_ip:${meta.ipAddress ?? 'unknown'}`,
      30,
      15 * 60 * 1000,
      'Too many sign-in attempts from this device. Please wait before retrying.'
    );

    const wrong = () => new AppError('Wrong email or password.', 401, 'INVALID_CREDENTIALS');
    const lockedFor = (minutes: number) =>
      new AppError(
        `Too many wrong passwords. Try again in ${minutes} minute(s), or sign in with an SMS code.`,
        429,
        'LOGIN_LOCKED',
        { retry_after_minutes: minutes }
      );

    // A wrong password must be *counted*, so the transaction commits and
    // reports it; the error is raised after the commit. (Throwing inside it
    // would roll the counter back and the lockout would never trigger.)
    const outcome = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('users')
        .select([
          'id',
          'phone',
          'role',
          'full_name',
          'email',
          'is_active',
          'login_failed_attempts',
          'login_locked_until',
          'staff_disabled_at',
          sql<boolean>`staff_password_hash IS NOT NULL AND staff_password_hash = crypt(${password}, staff_password_hash)`.as(
            'password_ok'
          ),
          sql<boolean>`staff_password_hash IS NOT NULL`.as('has_password'),
        ])
        .where(sql`lower(email)`, '=', email.toLowerCase())
        .forUpdate()
        .executeTakeFirst();

      if (!row || !row.has_password || !STAFF_PASSWORD_ROLES.includes(row.role as string)) throw wrong();
      if (!row.is_active) {
        throw new AppError('Your account has been deactivated. Please contact support.', 403, 'ACCOUNT_DEACTIVATED');
      }
      if (row.login_locked_until && row.login_locked_until > new Date()) {
        const minutes = Math.max(1, Math.ceil((row.login_locked_until.getTime() - Date.now()) / 60000));
        throw lockedFor(minutes);
      }

      if (!row.password_ok) {
        const attempts = (row.login_failed_attempts ?? 0) + 1;
        const lock = attempts >= LOGIN_MAX_ATTEMPTS;
        await trx
          .updateTable('users')
          .set({
            login_failed_attempts: lock ? 0 : attempts,
            login_locked_until: lock ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60000) : null,
          })
          .where('id', '=', row.id)
          .execute();
        logger.warn({ userId: row.id, attempts, locked: lock }, 'Wrong staff password');
        return { failed: true as const, locked: lock };
      }

      // Disabled (migration 014): checked only once the password is right, so
      // it never tells a stranger which emails belong to disabled staff.
      if (row.staff_disabled_at) throw staffSignInRefused();

      await trx
        .updateTable('users')
        .set({ login_failed_attempts: 0, login_locked_until: null })
        .where('id', '=', row.id)
        .execute();
      const user = await authRepository.updateLastLogin(trx, row.id);
      logger.info({ userId: row.id }, 'Staff signed in with email and password');
      return { failed: false as const, tokens: await this.issueTokens(trx, user, meta) };
    });

    if (outcome.failed) throw outcome.locked ? lockedFor(LOGIN_LOCK_MINUTES) : wrong();
    return outcome.tokens;
  }

  /**
   * Refreshes an access token using a valid refresh token.
   * Enforces single-use token rotation and detects token replay.
   */
  async refreshTokens(
    rawRefreshToken: string,
    meta: { ipAddress?: string; deviceInfo?: string }
  ): Promise<RefreshTokensResult> {
    const tokenHash = hashToken(rawRefreshToken);

    return db.transaction().execute(async (trx) => {
      const tokenRecord = await authRepository.findRefreshTokenForUpdate(trx, tokenHash);

      if (!tokenRecord) {
        throw new AppError('Invalid refresh token.', 401, 'INVALID_REFRESH_TOKEN');
      }

      // Replay detection: If token was already revoked, a breach may have occurred
      if (tokenRecord.revoked_at) {
        logger.warn(
          { userId: tokenRecord.user_id, tokenId: tokenRecord.id },
          'Revoked refresh token reuse attempt detected. Invalidating all user sessions.'
        );
        await authRepository.revokeAllUserRefreshTokens(trx, tokenRecord.user_id);
        throw new AppError(
          'Refresh token has already been used or revoked. Please log in again.',
          401,
          'REFRESH_TOKEN_REVOKED'
        );
      }

      // Expiration check
      if (new Date() > tokenRecord.expires_at) {
        throw new AppError('Refresh token has expired. Please log in again.', 401, 'REFRESH_TOKEN_EXPIRED');
      }

      // Verify associated user
      const user = await authRepository.findUserById(trx, tokenRecord.user_id);
      if (!user || !user.is_active) {
        throw new AppError('User account is inactive or does not exist.', 403, 'ACCOUNT_DEACTIVATED');
      }
      if (user.staff_disabled_at) throw staffSignInRefused();

      // Rotate: revoke the current token
      await authRepository.revokeRefreshToken(trx, tokenRecord.id);

      // Issue new tokens
      const newAccessToken = generateAccessToken({
        id: user.id,
        phone: user.phone,
        role: user.role,
      });

      const { rawToken: newRawToken, tokenHash: newTokenHash } = generateRefreshToken();
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await authRepository.saveRefreshToken(trx, {
        user_id: user.id,
        token_hash: newTokenHash,
        expires_at: newExpiresAt,
        device_info: meta.deviceInfo || tokenRecord.device_info,
        ip_address: meta.ipAddress || tokenRecord.ip_address,
      });

      return {
        access_token: newAccessToken,
        refresh_token: newRawToken,
        token_type: 'Bearer',
        expires_in: 900,
      };
    });
  }

  /**
   * Revokes a refresh token session.
   */
  async logout(rawRefreshToken?: string, userId?: string): Promise<{ message: string }> {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await db.transaction().execute(async (trx) => {
        const tokenRecord = await authRepository.findRefreshTokenForUpdate(trx, tokenHash);
        if (tokenRecord && !tokenRecord.revoked_at) {
          await authRepository.revokeRefreshToken(trx, tokenRecord.id);
        }
      });
    } else if (userId) {
      await db.transaction().execute(async (trx) => {
        await authRepository.revokeAllUserRefreshTokens(trx, userId);
      });
    }

    return { message: 'Logged out successfully' };
  }

  /**
   * Fetches current authenticated user profile.
   */
  async getCurrentUser(userId: string) {
    const user = await authRepository.findUserById(db, userId);
    if (!user) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      is_active: user.is_active,
      phone_verified_at: user.phone_verified_at,
      created_at: user.created_at,
    };
  }
}

export const authService = new AuthService();
