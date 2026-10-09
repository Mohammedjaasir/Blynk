import { z } from 'zod';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { dateOfBirthProblem } from '../birthday/birthday.rules.js';

export const createAddressSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(64).default('Home'),
  recipient_name: z.string().trim().min(2, 'Recipient name must be at least 2 characters').max(128),
  recipient_phone: z
    .string()
    .trim()
    // normalizeSriLankanPhone throws a plain Error on a bad number; reported
    // as a zod issue so the error handler answers 400 VALIDATION_ERROR (a
    // thrown Error inside a transform escaped zod and became a 500).
    .transform((val, ctx) => {
      try {
        return normalizeSriLankanPhone(val);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Sri Lankan mobile phone number' });
        return z.NEVER;
      }
    }),
  /**
   * Migration 024: an optional second number the rider can call. Same
   * normaliser as recipient_phone; empty or null clears it. It must differ
   * from recipient_phone - AddressService rejects a duplicate with 400.
   */
  alternate_phone: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((val, ctx) => {
      if (val === undefined) return undefined;
      if (val === null || val === '') return null;
      try {
        return normalizeSriLankanPhone(val);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Sri Lankan mobile phone number' });
        return z.NEVER;
      }
    }),
  address_line1: z.string().trim().min(3, 'Address line 1 is required').max(500),
  address_line2: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().min(2, 'City is required').max(64),
  postal_code: z.string().trim().max(16).nullable().optional(),
  latitude: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  delivery_instructions: z.string().trim().max(1000).nullable().optional(),
  is_default: z.boolean().default(false).optional(),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = createAddressSchema.partial();
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const MAX_FAVOURITE_CATEGORIES = 20;
export const MAX_FAVOURITES_NOTE = 200;

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(128).optional(),
  email: z.string().trim().email('Invalid email address').max(255).optional(),
  /** Migration 027: the language offer SMS arrive in. */
  sms_language: z.enum(['si', 'ta', 'en']).optional(),
  /** Migration 027: false turns "Offers by SMS" off. */
  sms_offers: z.boolean().optional(),
  /**
   * Migration 034 (owner, 2026-10-09): the optional profile - "not
   * mandatory, completely optional". null clears a field.
   * date_of_birth: YYYY-MM-DD, an age of 5..120, never in the future.
   */
  date_of_birth: z
    .string({ invalid_type_error: 'The date of birth must be a date (YYYY-MM-DD)' })
    .trim()
    .nullable()
    .optional()
    .superRefine((val, ctx) => {
      if (val === null || val === undefined) return;
      const problem = dateOfBirthProblem(val, new Date());
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),
  /** Blynk categories they love (the app's chips); unknown ones are refused by the service. */
  favourite_category_ids: z
    .array(z.string().uuid('Invalid category'), { invalid_type_error: 'favourite_category_ids must be a list' })
    .max(MAX_FAVOURITE_CATEGORIES, `Pick at most ${MAX_FAVOURITE_CATEGORIES} categories`)
    .transform((ids) => [...new Set(ids)])
    .optional(),
  /** "Anything else you love?" - empty clears it. */
  favourites_note: z
    .string({ invalid_type_error: 'The note must be text' })
    .trim()
    .max(MAX_FAVOURITES_NOTE, `Keep it to ${MAX_FAVOURITES_NOTE} characters`)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
