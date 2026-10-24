import { z } from 'zod';
import { normalizeSriLankanPhone } from '../../utils/phone.js';

export const requestOtpSchema = z
  .object({
    phone: z.string().optional(),
    phone_number: z.string().optional(),
  })
  .refine((data) => Boolean(data.phone || data.phone_number), {
    message: 'Phone number is required.',
    path: ['phone'],
  })
  .transform((data, ctx) => {
    const raw = (data.phone || data.phone_number || '').trim();
    try {
      return {
        phone: normalizeSriLankanPhone(raw),
      };
    } catch (err: unknown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'Invalid Sri Lankan phone number format.',
        path: ['phone'],
      });
      return z.NEVER;
    }
  });

export const verifyOtpSchema = z
  .object({
    phone: z.string().optional(),
    phone_number: z.string().optional(),
    otp: z
      .string({ required_error: 'OTP is required.' })
      .trim()
      .length(6, 'OTP must be exactly 6 digits.')
      .regex(/^[0-9]{6}$/, 'OTP must contain numeric digits only.'),
    // Staff apps send false: a code for a number with no account must not
    // quietly create a customer. Customers omit it (default true).
    create_account: z.boolean().optional().default(true),
    // The Rider app sends 'rider': a customer whose rider application is
    // waiting or was rejected is told so instead of being signed in there.
    // The Seller portal sends 'seller': a number with no account becomes a
    // PENDING seller (seller.service.ts), a number used for any other kind of
    // account is refused (PHONE_IN_USE).
    app: z.enum(['rider', 'seller']).optional(),
    // Seller portal first sign-in: the shop's name (else the phone number).
    shop_name: z.string().trim().min(2, 'Shop name must be at least 2 characters.').max(80, 'Shop name is too long.').optional(),
  })
  .refine((data) => Boolean(data.phone || data.phone_number), {
    message: 'Phone number is required.',
    path: ['phone'],
  })
  .transform((data, ctx) => {
    const raw = (data.phone || data.phone_number || '').trim();
    try {
      return {
        phone: normalizeSriLankanPhone(raw),
        otp: data.otp,
        create_account: data.create_account,
        app: data.app,
        shop_name: data.shop_name,
      };
    } catch (err: unknown) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'Invalid Sri Lankan phone number format.',
        path: ['phone'],
      });
      return z.NEVER;
    }
  });

export const refreshTokenSchema = z.object({
  refresh_token: z
    .string({ required_error: 'Refresh token is required.' })
    .min(32, 'Invalid refresh token format.')
    .max(256, 'Refresh token is too long.'),
});

export const logoutSchema = z.object({
  refresh_token: z.string().min(32).max(256).optional(),
});

/**
 * Staff email + password sign-in (migration 012). Emails are matched
 * case-insensitively, so the address is trimmed and lowercased here; the
 * password is taken exactly as typed.
 */
export const staffLoginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .max(255, 'Email is too long.')
    .email('Enter a valid email address.'),
  password: z
    .string({ required_error: 'Password is required.' })
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must be at most 128 characters.'),
});

/**
 * Seller portal email sign-in (owner, 2026-10-24): a seller may use an email
 * and a password they choose instead of a phone number. There is no email
 * provider, so the address is never verified - it is only a sign-in name.
 * Same email / password rules as staff sign-in.
 */
export const sellerLoginEmailSchema = staffLoginSchema;

export const sellerRegisterEmailSchema = staffLoginSchema.extend({
  shop_name: z
    .string({ required_error: 'Shop name is required.' })
    .trim()
    .min(2, 'Shop name must be at least 2 characters.')
    .max(80, 'Shop name is too long.'),
});
