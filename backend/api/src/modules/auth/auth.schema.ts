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
