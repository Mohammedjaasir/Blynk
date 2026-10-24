import crypto from 'crypto';
import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, SmsLanguage } from '../../database/types.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../middleware/error.middleware.js';
import { authRepository } from './auth.repository.js';
import { authRateLimiter } from './auth.rate-limiter.js';
import { generateOtp, hashOtp, compareOtp } from './otp.service.js';
import { SmsProvider } from '../notifications/providers/sms.provider.js';
import { localizedTexts } from '../notifications/sms-i18n.js';
import { smsLanguageForPhone } from '../notifications/sms-language.js';
import { generateAccessToken, generateRefreshToken, hashToken } from './token.service.js';
import { generatePlaceholderPhone, isEmailOnlyRole, publicPhone } from '../../utils/phone.js';


const otpSms = new SmsProvider();


/**
 * Whether POST /auth/otp/request returns the code as dev_otp (and logs it).
 * Fails closed (security audit 2026-10): always under NODE_ENV=test (the
 * automated suites), in development only with EXPOSE_DEV_OTP=true, and never
 * in production. A server started without NODE_ENV is "development", so the
 * code is not exposed by accident.
 */
export function shouldExposeDevOtp(e: { NODE_ENV: string; EXPOSE_DEV_OTP: boolean }): boolean {
  if (e.NODE_ENV === 'test') return true;
  return e.NODE_ENV === 'development' && e.EXPOSE_DEV_OTP === true;
}

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
    /** null for an account without a phone (Admin / Inventory, migration 028). */
    phone: string | null;
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
 * from 014). Riders could from 2026-10-01 to 2026-10-07; since then they sign
 * in with phone + SMS code only (403 PHONE_SIGN_IN_REQUIRED).
 */
export const STAFF_PASSWORD_ROLES: string[] = ['ADMIN', 'PACKING_STAFF', 'OPERATIONS'];

/**
 * The one refusal for a staff account an admin has disabled (migration 014),
 * identical on both sign-in paths (email + password and SMS code) and on
 * refresh. It never says "disabled": it reads like any other failed sign-in.
 */
export const staffSignInRefused = () =>
  new AppError('Sign-in failed. Check your details or ask your store admin.', 401, 'INVALID_CREDENTIALS');
/**
 * Admin and Inventory accounts sign in with email + password only (owner,
 * 2026-10-07). Since migration 028 they have placeholder phones no OTP can
 * reach, so this is defence in depth: a real number on such an account is
 * still never sent a code nor signed in with one.
 */
export const emailSignInRequired = () =>
  new AppError('This account signs in with email and password.', 403, 'EMAIL_SIGN_IN_REQUIRED');

async function refuseEmailOnlyAccount(phone: string): Promise<void> {
  const user = await db.selectFrom('users').select('role').where('phone', '=', phone).executeTakeFirst();
  if (user && isEmailOnlyRole(user.role)) throw emailSignInRequired();
}

/**
 * Rider applications (migration 029). A rider whose request is still waiting
 * cannot sign in; a rejected one is told why (only after a correct code, in
 * verifyOtp). Riders made before applications existed are APPROVED.
 */
export const riderPendingApproval = () =>
  new AppError('Your application is waiting for approval.', 403, 'RIDER_PENDING_APPROVAL');
export const riderApplicationRejected = (reason: string | null) =>
  new AppError("Your application wasn't approved.", 403, 'RIDER_APPLICATION_REJECTED', { reason: reason ?? null });
/** Riders sign in with phone + SMS code only (owner, 2026-10-07). */
export const phoneSignInRequired = () =>
  new AppError('Riders sign in with their phone number.', 403, 'PHONE_SIGN_IN_REQUIRED');

/**
 * Asked for a code by a rider whose application is still PENDING: refused
 * before any code is made or sent (no SMS is wasted - there is nothing a code
 * could do for them yet). A REJECTED rider still gets a code: it is how they
 * apply again (POST /riders/applications); signing in with it is refused.
 */
async function refusePendingRider(phone: string): Promise<void> {
  const row = await db
    .selectFrom('users')
    .innerJoin('riders', 'riders.user_id', 'users.id')
    .select('riders.approval_status')
    .where('users.phone', '=', phone)
    .where('users.role', '=', 'RIDER')
    .executeTakeFirst();
  if (row?.approval_status === 'PENDING') throw riderPendingApproval();
}

/** Inside the sign-in transaction: a RIDER account must be APPROVED. */
async function refuseUnapprovedRider(trx: Transaction<Database>, userId: string): Promise<void> {
  const rider = await trx
    .selectFrom('riders')
    .select(['approval_status', 'rejection_reason'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!rider || rider.approval_status === 'APPROVED') return;
  if (rider.approval_status === 'PENDING') throw riderPendingApproval();
  throw riderApplicationRejected(rider.rejection_reason);
}

/**
 * A CUSTOMER signing in to the Rider app (app: 'rider'): waiting or rejected
 * applications get their own answer; a customer who never applied gets
 * ACCOUNT_NOT_FOUND, which the Rider app turns into "Apply to deliver".
 */
async function refuseCustomerInRiderApp(trx: Transaction<Database>, userId: string): Promise<void> {
  const rider = await trx
    .selectFrom('riders')
    .select(['approval_status', 'rejection_reason'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (rider?.approval_status === 'PENDING') throw riderPendingApproval();
  if (rider?.approval_status === 'REJECTED') throw riderApplicationRejected(rider.rejection_reason);
  throw new AppError("This number hasn't applied to deliver with Blynk yet.", 404, 'ACCOUNT_NOT_FOUND');
}

/**
 * Sellers (migration 051) sign in to the Seller portal only (app: 'seller'); the
 * customer, rider and staff sign-ins refuse a SELLER number. In the other
 * direction a number that already belongs to a customer, rider or staff
 * account cannot become a seller (one number = one account).
 */
export const sellerSignInRequired = () =>
  new AppError('This number is a Blynk seller account. Sign in on the seller site.', 403, 'SELLER_SIGN_IN_REQUIRED');
export const phoneInUse = () =>
  new AppError('This number is already used for a Blynk account.', 403, 'PHONE_IN_USE');

/** The sign-in code SMS: "123456 is your Blynk code. Valid 2 min. Do not share it." */
export const otpSmsText = (otp: string, minutes: number, lang: SmsLanguage = 'en') =>
  // Sinhala / Tamil (owner, 2026-10-12; "Customer SMS language"): still only
  // the code, the brand and how long it is valid (sms-i18n.ts).
  localizedTexts(lang)?.otp(otp, minutes) ?? `${otp} is your Blynk code. Valid ${minutes} min. Do not share it.`;

/** The sign-in code's language; a lookup failure never blocks the code (English). */
async function otpSmsLanguage(phone: string): Promise<SmsLanguage> {
  try {
    return await smsLanguageForPhone(phone);
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'OTP SMS language unavailable; sending English');
    return 'en';
  }
}

/** POST /auth/otp/verify edge limits, per 15 minutes. */
export const OTP_VERIFY_PHONE_MAX = 10;
export const OTP_VERIFY_IP_MAX = 30;

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;

export class AuthService {
  /**
   * Generates and stores a new OTP for a normalized mobile number.
   * Enforces rate limiting and invalidates prior unconsumed challenges.
   */
  async requestOtp(phone: string, clientIp: string): Promise<RequestOtpResult> {
    // Admin / Inventory: refused before any code is made, stored or sent.
    await refuseEmailOnlyAccount(phone);
    // A rider still waiting for approval (migration 029): same.
    await refusePendingRider(phone);

    // Rate limits: max 3 requests per phone per hour, max 15 per IP per 15
    // minutes. Both are checked before either is recorded, so a request the
    // IP limit refuses never uses up the phone's quota (security audit 2026-10).
    authRateLimiter.checkLimits([
      {
        key: `otp_phone:${phone}`,
        max: 3,
        windowMs: 60 * 60 * 1000,
        message: 'Maximum OTP requests reached for this phone number. Please try again in 1 hour.',
      },
      {
        key: `otp_ip:${clientIp}`,
        max: 15,
        windowMs: 15 * 60 * 1000,
        message: 'Too many OTP requests from this IP address. Please wait before retrying.',
      },
    ]);

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
      // Unique per send: it is also the gateway's Idempotency-Key, and two
      // codes requested in the same millisecond must both go out.
      notificationId: `otp_${crypto.randomUUID()}`,
      recipient: phone,
      // Short on purpose (owner, 2026-10-07: SMS cost): plain GSM text,
      // well inside one 160-character part. The sender name already says Blynk.
      // English unless staff picked another "Customer SMS language".
      message: otpSmsText(otp, env.OTP_EXPIRY_MINUTES, await otpSmsLanguage(phone)),
    });
    if (!sms.success) {
      logger.error(
        { provider: sms.providerName, errorType: sms.errorType, error: sms.errorMessage },
        'OTP SMS delivery failed'
      );
      // A code nobody receives is a dead end: say so - unless dev_otp below
      // hands it back (test, or development with EXPOSE_DEV_OTP=true).
      if (!shouldExposeDevOtp(env)) {
        throw new AppError(
          'We could not send the verification code. Please try again shortly.',
          502,
          'OTP_DELIVERY_FAILED'
        );
      }
    }

    // Fails closed (security audit 2026-10): only NODE_ENV=test, or
    // development with EXPOSE_DEV_OTP=true, ever sees the code.
    const isDevOrTest = shouldExposeDevOtp(env);
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
   * Steps 1-4 of an SMS-code check: the latest unconsumed code for this phone
   * exists, is not locked or expired, and matches. A wrong code is counted
   * (committed at once). Returns the challenge id for consumeOtp(). Shared by
   * sign-in (verifyOtp) and rider applications, so both answer identically
   * (INVALID_OTP, OTP_EXPIRED, OTP_MAX_ATTEMPTS_EXCEEDED).
   */
  async checkOtp(phone: string, submittedOtp: string): Promise<string> {
    // Steps 1-4 run in one transaction holding a row lock on the challenge,
    // so concurrent checks of one code are serialised and each sees the
    // counter the previous one committed: at most max_attempts wrong codes
    // are ever compared (security audit 2026-10; before, the counter was read
    // unlocked and every concurrent guess passed the gate). The outcome is
    // returned and the error thrown only AFTER the commit - throwing inside
    // the transaction would roll the wrong-code increment back and remove the
    // cap entirely (same pattern as loginWithPassword).
    const outcome = await db.transaction().execute(async (trx) => {
      // 1. Lock the active OTP challenge
      const activeOtp = await authRepository.findActiveOtpForUpdate(trx, phone);
      if (!activeOtp) return { kind: 'missing' as const };

      // 2. Check attempt limit
      if (activeOtp.attempts_count >= activeOtp.max_attempts) return { kind: 'locked' as const };

      // 3. Check expiration
      if (new Date() > activeOtp.expires_at) return { kind: 'expired' as const };

      // 4. Cryptographic constant-time compare
      const isValid = await compareOtp(submittedOtp, activeOtp.otp_hash);
      if (isValid) return { kind: 'ok' as const, id: activeOtp.id };

      // A wrong code is counted, committed with this transaction.
      const updated = await authRepository.incrementOtpAttempts(trx, activeOtp.id);
      return { kind: 'wrong' as const, remaining: activeOtp.max_attempts - updated.attempts_count };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.id;
      case 'missing':
        throw new AppError(
          'Invalid or expired OTP challenge. Please request a new OTP.',
          401,
          'INVALID_OTP'
        );
      case 'locked':
        throw new AppError(
          'Too many failed verification attempts. This OTP has been locked. Please request a new one.',
          429,
          'OTP_MAX_ATTEMPTS_EXCEEDED'
        );
      case 'expired':
        throw new AppError('OTP has expired. Please request a new one.', 410, 'OTP_EXPIRED');
      case 'wrong':
        if (outcome.remaining <= 0) {
          throw new AppError(
            'Too many failed verification attempts. Please request a new OTP.',
            429,
            'OTP_MAX_ATTEMPTS_EXCEEDED'
          );
        }
        throw new AppError(
          `Invalid OTP code. ${outcome.remaining} attempt(s) remaining.`,
          401,
          'INVALID_OTP',
          { remaining_attempts: outcome.remaining }
        );
    }
  }

  /**
   * Step 5: consumes the checked challenge under a row lock (no replay, no
   * double use). Call inside the transaction that acts on it: if that
   * transaction throws, the code stays usable.
   */
  async consumeOtp(trx: Transaction<Database>, phone: string, activeOtpId: string): Promise<void> {
    const lockedOtp = await authRepository.findActiveOtpForUpdate(trx, phone);

    if (!lockedOtp || lockedOtp.id !== activeOtpId || lockedOtp.consumed_at !== null) {
      throw new AppError(
        'Invalid or expired OTP challenge. Please request a new OTP.',
        401,
        'INVALID_OTP'
      );
    }

    await authRepository.markOtpConsumed(trx, lockedOtp.id);
  }

  /**
   * Verifies an OTP challenge, auto-registers customer if new, and returns access/refresh tokens.
   */
  async verifyOtp(
    phone: string,
    submittedOtp: string,
    meta: { ipAddress?: string; deviceInfo?: string; createAccount?: boolean; app?: 'rider' | 'seller'; shopName?: string }
  ): Promise<AuthTokensResult> {
    // Edge limit on code guessing (security audit 2026-10): max 10 verifies
    // per phone and 30 per IP per 15 minutes, on top of the per-code attempt
    // cap. Both checked before either is recorded.
    authRateLimiter.checkLimits([
      {
        key: `otp_verify_phone:${phone}`,
        max: OTP_VERIFY_PHONE_MAX,
        windowMs: 15 * 60 * 1000,
        message: 'Too many verification attempts for this phone number. Please wait before retrying.',
      },
      {
        key: `otp_verify_ip:${meta.ipAddress ?? 'unknown'}`,
        max: OTP_VERIFY_IP_MAX,
        windowMs: 15 * 60 * 1000,
        message: 'Too many verification attempts from this IP address. Please wait before retrying.',
      },
    ]);

    // Admin / Inventory never sign in with a code (also checked again below,
    // under the row lock, before anything is consumed).
    await refuseEmailOnlyAccount(phone);

    const activeOtpId = await this.checkOtp(phone, submittedOtp);

    // 5. If valid, open transaction with FOR UPDATE row lock to consume challenge safely and prevent concurrency/replay
    const result = await db.transaction().execute(async (trx) => {
      await this.consumeOtp(trx, phone, activeOtpId);

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
        // Seller portal (migration 051): sellers only sign in there, and only
        // sellers do. Thrown inside the transaction, so nothing is consumed.
        if (meta.app === 'seller' && existingUser.role !== 'SELLER') throw phoneInUse();
        if (meta.app !== 'seller' && existingUser.role === 'SELLER') throw sellerSignInRequired();
        // A disabled staff account (migration 014) cannot fall back to an SMS
        // code either. Thrown inside the transaction, so nothing is consumed.
        if (existingUser.staff_disabled_at) throw staffSignInRefused();
        if (isEmailOnlyRole(existingUser.role)) throw emailSignInRequired();
        // Rider applications (migration 029): only an APPROVED rider signs in.
        if (existingUser.role === 'RIDER') await refuseUnapprovedRider(trx, existingUser.id);
        // In the Rider app a customer account is only let in once its rider
        // application is approved (which makes it RIDER); in the customer
        // app the same account just shops.
        if (meta.app === 'rider' && existingUser.role === 'CUSTOMER') await refuseCustomerInRiderApp(trx, existingUser.id);
        user = await authRepository.updateLastLogin(trx, existingUser.id, existingUser.phone);
      } else if (meta.createAccount === false) {
        // Staff apps sign in with create_account:false - an unknown number is
        // refused instead of becoming a customer. Thrown inside the
        // transaction, so the code is not consumed and nothing is written.
        throw new AppError('No Blynk account uses this number.', 404, 'ACCOUNT_NOT_FOUND');
      } else if (meta.app === 'seller') {
        // First sign-in on the Seller portal: a SELLER user and a PENDING shop
        // profile that Admin approves before anything can be listed.
        user = await authRepository.createSeller(trx, phone, meta.shopName?.trim() || phone);
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
        phone: publicPhone(user.phone),
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
    // SELLER is not in STAFF_PASSWORD_ROLES: a seller's email + password is
    // refused here exactly like an unknown email (they use /auth/seller/login-email).
    return this.passwordSignIn(email, password, meta, { roles: STAFF_PASSWORD_ROLES, kind: 'staff' });
  }

  /**
   * Seller portal email + password sign-in (owner, 2026-10-24). The same
   * checks, lockout (LOGIN_MAX_ATTEMPTS / LOGIN_LOCK_MINUTES, users columns)
   * and hashing as staff sign-in, for SELLER accounts only: any other account,
   * an unknown email and a wrong password all get the same 401
   * INVALID_CREDENTIALS. A seller in any status signs in (like the SMS code
   * sign-in); the seller routes decide what a PENDING seller may do.
   */
  async loginSellerWithEmail(
    email: string,
    password: string,
    meta: { ipAddress?: string; deviceInfo?: string }
  ): Promise<AuthTokensResult> {
    return this.passwordSignIn(email, password, meta, { roles: ['SELLER'], kind: 'seller' });
  }

  /**
   * Seller portal sign-up with email + password (owner, 2026-10-24; no email
   * provider, so nothing is sent and the address is not verified). Creates a
   * SELLER user - no phone, so users.phone holds a 'nophone:' placeholder like
   * Admin / Inventory accounts (never texted, shown as null) - with the
   * password hashed like staff passwords (pgcrypto bcrypt), plus a PENDING
   * sellers row, and signs it in. An email any account already uses (any
   * role, ignoring case) is 409 EMAIL_IN_USE.
   */
  async registerSellerWithEmail(
    email: string,
    password: string,
    shopName: string,
    meta: { ipAddress?: string; deviceInfo?: string }
  ): Promise<AuthTokensResult> {
    authRateLimiter.checkLimit(
      `seller_register_ip:${meta.ipAddress ?? 'unknown'}`,
      10,
      60 * 60 * 1000,
      'Too many sign-ups from this device. Please wait before retrying.'
    );
    const emailInUse = () =>
      new AppError('This email is already used for a Blynk account.', 409, 'EMAIL_IN_USE');
    const address = email.trim().toLowerCase();

    try {
      return await db.transaction().execute(async (trx) => {
        const clash = await trx
          .selectFrom('users')
          .select('id')
          .where(sql`lower(email)`, '=', address)
          .executeTakeFirst();
        if (clash) throw emailInUse();

        const now = new Date();
        const user = await trx
          .insertInto('users')
          .values({
            phone: generatePlaceholderPhone(),
            email: address,
            role: 'SELLER',
            is_active: true,
            last_login_at: now,
            staff_password_hash: sql<string>`crypt(${password}, gen_salt('bf', 10))`,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.insertInto('sellers').values({ user_id: user.id, shop_name: shopName.trim() }).execute();
        logger.info({ userId: user.id }, 'Seller signed up with email and password');
        return this.issueTokens(trx, user, meta);
      });
    } catch (err) {
      // Two sign-ups with one email at once meet at users_email_lower_key.
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === '23505' && pg.constraint?.includes('email')) throw emailInUse();
      throw err;
    }
  }

  /** Email + password sign-in shared by staff and sellers (see loginWithPassword). */
  private async passwordSignIn(
    email: string,
    password: string,
    meta: { ipAddress?: string; deviceInfo?: string },
    opts: { roles: string[]; kind: 'staff' | 'seller' }
  ): Promise<AuthTokensResult> {
    authRateLimiter.checkLimit(
      `${opts.kind}_login_ip:${meta.ipAddress ?? 'unknown'}`,
      30,
      15 * 60 * 1000,
      'Too many sign-in attempts from this device. Please wait before retrying.'
    );

    const wrong = () => new AppError('Wrong email or password.', 401, 'INVALID_CREDENTIALS');
    // Admin / Inventory have no SMS code to fall back to (migration 028), nor
    // does a seller who signed up with an email (no phone).
    const lockedFor = (minutes: number, role: string, phone: string | null) =>
      new AppError(
        role === 'SELLER'
          ? publicPhone(phone)
            ? `Too many wrong passwords. Try again in ${minutes} minute(s), or sign in with an SMS code.`
            : `Too many wrong passwords. Try again in ${minutes} minute(s).`
          : !isEmailOnlyRole(role)
            ? `Too many wrong passwords. Try again in ${minutes} minute(s), or sign in with an SMS code.`
            : `Too many wrong passwords. Try again in ${minutes} minute(s), or ask an admin to reset your password.`,
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

      // Riders sign in with phone + SMS code only (owner, 2026-10-07). Staff
      // sign-in only: the seller sign-in never says which other accounts exist.
      if (opts.kind === 'staff' && row?.role === 'RIDER') throw phoneSignInRequired();
      if (!row || !row.has_password || !opts.roles.includes(row.role as string)) throw wrong();
      if (!row.is_active) {
        throw new AppError('Your account has been deactivated. Please contact support.', 403, 'ACCOUNT_DEACTIVATED');
      }
      if (row.login_locked_until && row.login_locked_until > new Date()) {
        const minutes = Math.max(1, Math.ceil((row.login_locked_until.getTime() - Date.now()) / 60000));
        throw lockedFor(minutes, row.role, row.phone);
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
        logger.warn({ userId: row.id, attempts, locked: lock }, `Wrong ${opts.kind} password`);
        return { failed: true as const, locked: lock, role: row.role as string, phone: row.phone };
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
      logger.info({ userId: row.id }, `${opts.kind === 'seller' ? 'Seller' : 'Staff'} signed in with email and password`);
      return { failed: false as const, tokens: await this.issueTokens(trx, user, meta) };
    });

    if (outcome.failed) throw outcome.locked ? lockedFor(LOGIN_LOCK_MINUTES, outcome.role, outcome.phone) : wrong();
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
      // Never the 'nophone:' placeholder of an Admin / Inventory account.
      phone: publicPhone(user.phone),
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
