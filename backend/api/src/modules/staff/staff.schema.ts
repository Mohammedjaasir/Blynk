import { z } from 'zod';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { emergencyPhoneSchema, registrationSchema, vehicleTypeSchema } from '../riders/rider.profile.js';

/**
 * Staff accounts (migration 014), created and managed from Blynk Admin ->
 * Staff accounts and from the Operations app -> More -> Staff accounts.
 *   ADMIN         - "Admin": the Admin website;
 *   OPERATIONS    - "Operations": the Operations app;
 *   PACKING_STAFF - "Inventory": the Inventory website;
 *   RIDER         - "Rider": the Rider app (with its riders row) - listed and
 *                   managed here, but never created here: riders apply in the
 *                   Rider app and are approved under Rider requests
 *                   (migration 029; 400 RIDERS_JOIN_BY_APPLICATION).
 * Who may create and manage which role is enforced in staff.service.ts
 * (owner, 2026-10-01): ADMIN creates Admin, Operations and Inventory;
 * OPERATIONS creates only PACKING_STAFF and manages PACKING_STAFF and RIDER.
 * An existing ADMIN account is never changed here - except that another
 * ADMIN may reset its password - and nobody changes their own account here.
 */
export const creatableRoles = ['ADMIN', 'OPERATIONS', 'PACKING_STAFF'] as const;
export type CreatableRole = (typeof creatableRoles)[number];

/** Roles an existing account can be moved between (role changes are ADMIN-only). */
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
 * Operations and Rider accounts need a phone number (they can sign in with an
 * SMS code); Admin and Inventory accounts have none (owner, 2026-10-07,
 * migration 028) - users.phone then holds a 'nophone:' placeholder. A phone
 * is normalised with the same Sri Lankan normaliser SMS sign-in uses, so the
 * stored value is the one an SMS code would be sent to.
 */
export const PHONE_ROLES: readonly string[] = ['OPERATIONS', 'RIDER'];
const PHONE_MESSAGE = 'Phone must be a Sri Lankan mobile number, e.g. 077 123 4567';

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
        message: PHONE_MESSAGE,
      });
      return z.NEVER;
    }
  });

const createRoleSchema = z.enum(creatableRoles, {
  errorMap: () => ({ message: 'Role must be ADMIN, OPERATIONS or PACKING_STAFF (Inventory)' }),
});

export const createStaffSchema = z
  .object({
    full_name: fullNameSchema,
    email: z
      .string({ required_error: 'Email is required' })
      .trim()
      .toLowerCase()
      .min(1, 'Email is required')
      .max(255, 'Email must be at most 255 characters')
      .email('Email must be a valid email address'),
    password: passwordSchema,
    role: createRoleSchema,
    // Required for OPERATIONS; ignored for ADMIN and PACKING_STAFF (they are
    // stored with a placeholder - see superRefine / transform).
    phone: z.string({ invalid_type_error: 'Phone number must be text' }).trim().optional(),
  })
  .superRefine((d, ctx) => {
    if (PHONE_ROLES.includes(d.role)) {
      if (!d.phone) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'Phone number is required' });
      } else {
        try {
          normalizeSriLankanPhone(d.phone);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: PHONE_MESSAGE });
        }
      }
    }
  })
  .transform((d) => ({
    ...d,
    // Normalised for OPERATIONS; dropped for ADMIN / PACKING_STAFF.
    phone: PHONE_ROLES.includes(d.role) && d.phone ? normalizeSriLankanPhone(d.phone) : undefined,
  }));

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    full_name: fullNameSchema.optional(),
    role: roleSchema.optional(),
    password: passwordSchema.optional(),
    // Operations / Rider accounts only: required when moving an account to
    // OPERATIONS that has no number yet (400 PHONE_REQUIRED); ignored when
    // the account is or becomes PACKING_STAFF.
    phone: phoneSchema.optional(),
    disabled: z.boolean({ invalid_type_error: 'disabled must be true or false' }).optional(),
    // Rider accounts only: their riders row.
    vehicle_type: vehicleTypeSchema.optional(),
    // null / '' clears it - allowed only for a bicycle (checked in staff.service.ts).
    vehicle_registration_number: z.union([z.literal(''), z.null(), registrationSchema]).optional().transform((v) => (v === '' ? null : v)),
    emergency_contact_phone: emergencyPhoneSchema,
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Nothing to change',
  });

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const staffIdParamsSchema = z.object({
  id: z.string().uuid('Staff id must be a valid UUID'),
});
