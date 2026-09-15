import { db } from '../../database/connection.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../middleware/error.middleware.js';
import { authRepository } from './auth.repository.js';
import { authRateLimiter } from './auth.rate-limiter.js';
import { generateOtp, hashOtp, compareOtp } from './otp.service.js';
import { generateAccessToken, generateRefreshToken, hashToken } from './token.service.js';

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
        user = await authRepository.updateLastLogin(trx, existingUser.id);
      } else {
        // First-time login: auto-register as CUSTOMER strictly
        user = await authRepository.createOrGetCustomer(trx, phone);
      }

      // Issue tokens
      const accessToken = generateAccessToken({
        id: user.id,
        phone: user.phone,
        role: user.role,
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
      };
    });

    return result;
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
