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
