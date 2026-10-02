import { z } from 'zod';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { emergencyPhoneSchema, registrationSchema, vehicleTypeSchema } from '../riders/rider.profile.js';

/**
 * Staff accounts (migration 014), created and managed from Blynk Admin ->
 * Staff accounts and from the Operations app -> More -> Staff accounts.
 *   ADMIN         - "Admin": the Admin website;
 *   OPERATIONS    - "Operations": the Operations app;
 *   PACKING_STAFF - "Inventory": the Inventory website;
 *   RIDER         - "Rider": the Rider app (with its riders row).
 * Who may create and manage which role is enforced in staff.service.ts
 * (owner, 2026-10-01): ADMIN creates any of the four; OPERATIONS creates and
 * manages only RIDER and PACKING_STAFF. An existing ADMIN account is never
 * changed here, and nobody changes their own account here.
 */
export const creatableRoles = ['ADMIN', 'OPERATIONS', 'PACKING_STAFF', 'RIDER'] as const;
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

const createRoleSchema = z.enum(creatableRoles, {
  errorMap: () => ({ message: 'Role must be ADMIN, OPERATIONS, PACKING_STAFF (Inventory) or RIDER' }),
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
    phone: phoneSchema,
    // Rider accounts only: the riders row made with the user.
    vehicle_type: vehicleTypeSchema.optional(),
    vehicle_registration_number: registrationSchema.optional(),
    emergency_contact_phone: emergencyPhoneSchema,
  })
  .superRefine((d, ctx) => {
    if (d.role === 'RIDER' && !d.vehicle_registration_number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicle_registration_number'],
        message: 'Vehicle registration number is required',
      });
    }
  });

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    full_name: fullNameSchema.optional(),
    role: roleSchema.optional(),
    password: passwordSchema.optional(),
    disabled: z.boolean({ invalid_type_error: 'disabled must be true or false' }).optional(),
    // Rider accounts only: their riders row.
    vehicle_type: vehicleTypeSchema.optional(),
    vehicle_registration_number: registrationSchema.optional(),
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
