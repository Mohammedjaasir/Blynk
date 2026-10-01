import { z } from 'zod';
import { normalizeSriLankanPhone } from '../../utils/phone.js';

/**
 * Staff accounts (migration 014), created and managed from Blynk Admin ->
 * Staff accounts. Only two roles can be created here:
 *   PACKING_STAFF - "Inventory": may use only the Inventory site;
 *   OPERATIONS    - "Operations": may use only the Operations app.
 * ADMIN accounts are listed read-only and are never created or edited here.
 */
export const staffRoles = ['PACKING_STAFF', 'OPERATIONS'] as const;
export type StaffRole = (typeof staffRoles)[number];

export const STAFF_PASSWORD_MIN = 8;
export const STAFF_PASSWORD_MAX = 128;

const roleSchema = z.enum(staffRoles, {
  errorMap: () => ({ message: 'Role must be PACKING_STAFF (Inventory) or OPERATIONS (Operations)' }),
});

const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(STAFF_PASSWORD_MIN, `Password must be at least ${STAFF_PASSWORD_MIN} characters`)
  .max(STAFF_PASSWORD_MAX, `Password must be at most ${STAFF_PASSWORD_MAX} characters`);

const fullNameSchema = z
  .string({ required_error: 'Full name is required' })
  .trim()
  .min(1, 'Full name is required')
  .max(128, 'Full name must be at most 128 characters');

/**
 * users.phone is NOT NULL UNIQUE (migration 001) - every account, staff
 * included, has a phone number - so it is required here. Normalised with the
 * same Sri Lankan normaliser SMS sign-in uses, so the stored value is the one
 * an SMS code would be sent to.
 */
const phoneSchema = z
  .string({ required_error: 'Phone number is required' })
  .trim()
  .min(1, 'Phone number is required')
  .transform((raw, ctx) => {
    try {
      return normalizeSriLankanPhone(raw);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Phone must be a Sri Lankan mobile number, e.g. 077 123 4567',
      });
      return z.NEVER;
    }
  });

export const createStaffSchema = z.object({
  full_name: fullNameSchema,
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .min(1, 'Email is required')
    .max(255, 'Email must be at most 255 characters')
    .email('Email must be a valid email address'),
  password: passwordSchema,
  role: roleSchema,
  phone: phoneSchema,
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    full_name: fullNameSchema.optional(),
    role: roleSchema.optional(),
    password: passwordSchema.optional(),
    disabled: z.boolean({ invalid_type_error: 'disabled must be true or false' }).optional(),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Nothing to change',
  });

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const staffIdParamsSchema = z.object({
  id: z.string().uuid('Staff id must be a valid UUID'),
});
