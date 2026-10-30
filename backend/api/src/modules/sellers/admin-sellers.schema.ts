import { z } from 'zod';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { mediaStorage } from '../../utils/storage.js';
import { FREE_DAYS_MAX } from './seller.commission.js';
import { LOCATION_NOTE_MAX, SRI_LANKA_BOUNDS } from './seller.location.js';

/**
 * Staff side of the seller portal (docs/superpowers/plans/2026-10-24-seller-portal.md):
 * request validation for /admin/sellers and /admin/seller-submissions.
 */

const MAX_MONEY = 99_999_999.99;
const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

const money = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .positive(`${label} must be above 0`)
    .max(MAX_MONEY, `${label} cannot exceed 99,999,999.99`)
    .refine(twoDecimals, `${label} can have at most 2 decimals`);

const reason = (label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .trim()
    .min(3, `${label} must be at least 3 characters`)
    .max(300, `${label} must be at most 300 characters`);

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-24')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real date');

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });
export const payoutParamSchema = z.object({
  id: z.string().uuid('Invalid id'),
  payoutId: z.string().uuid('Invalid payout id'),
});

export const SELLER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export const SUBMISSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;

/** GET /admin/sellers */
export const listSellersQuerySchema = z.object({
  status: z.enum(SELLER_STATUSES, { errorMap: () => ({ message: 'status must be PENDING, APPROVED, REJECTED or SUSPENDED' }) }).optional(),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type ListSellersQuery = z.infer<typeof listSellersQuerySchema>;

/** GET /admin/sellers/:id - the statement can be limited to a period (delivery date, Colombo). */
export const sellerDetailQuerySchema = z.object({ from: day.optional(), to: day.optional() });

/** A percent 0-100 with at most 2 decimals; null = no own rate (seller.commission.ts). */
const percent = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .min(0, `${label} cannot be negative`)
    .max(100, `${label} cannot be above 100`)
    .refine(twoDecimals, `${label} can have at most 2 decimals`);

/** A Sri Lankan mobile/landline number, normalised to +94... like the OTP schema does. */
const phone = z
  .string({ required_error: 'Phone number is required', invalid_type_error: 'Phone number must be text' })
  .trim()
  .transform((raw, ctx) => {
    try {
      return normalizeSriLankanPhone(raw);
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err instanceof Error ? err.message : 'Invalid Sri Lankan phone number' });
      return z.NEVER;
    }
  });

/** Optional profile text: trimmed, blank = cleared (null). */
const profileText = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

const shopName = z
  .string({ required_error: 'Shop name is required', invalid_type_error: 'Shop name must be text' })
  .trim()
  .min(2, 'Shop name must be at least 2 characters')
  .max(80, 'Shop name must be at most 80 characters');

/**
 * POST /admin/sellers - sellers are invite-only (owner, 2026-10-24): staff add the shop with the
 * phone number the seller signs in with. Approved straight away unless status PENDING is sent.
 */
export const createSellerSchema = z
  .object({
    shop_name: shopName,
    phone,
    contact_name: profileText('Contact name', 80),
    address: profileText('Address', 255),
    note: profileText('Note', 500),
    commission_percent: percent('Commission').nullable().optional(),
    status: z.enum(['APPROVED', 'PENDING'], { errorMap: () => ({ message: 'status must be APPROVED or PENDING' }) }).default('APPROVED'),
  })
  .strict();
export type CreateSellerInput = z.infer<typeof createSellerSchema>;

/** An ISO date-time (with its offset), at most 5 years ahead; null = no free period. */
const freeUntil = z
  .string({ invalid_type_error: 'The date must be text' })
  .datetime({ offset: true, message: 'Use a date and time like 2026-11-30T23:59:59+05:30' })
  .refine((v) => new Date(v).getTime() <= Date.now() + 5 * 365 * 86_400_000, 'The free period cannot run more than 5 years')
  .nullable();

/** PATCH /admin/sellers/:id */
export const patchSellerSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED'], { errorMap: () => ({ message: 'status must be APPROVED, REJECTED or SUSPENDED' }) }).optional(),
    rejection_reason: reason('The reason').nullable().optional(),
    // null = no own rate: the category's rate or the default applies (migration 057)
    commission_percent: percent('Commission').nullable().optional(),
    // invite-only (2026-10-24): staff keep the sign-in phone and the contact details
    phone: phone.optional(),
    shop_name: shopName.optional(),
    contact_name: profileText('Contact name', 80),
    address: profileText('Address', 255),
    note: profileText('Note', 500),
    // migration 065: when the seller's commission-free month ends (null = no free period)
    commission_free_until: freeUntil.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Object.values(v).every((x) => x === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nothing to change' });
    }
    if (v.status === 'REJECTED' && !v.rejection_reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rejection_reason'], message: 'Give the seller a reason' });
    }
  });
export type PatchSellerInput = z.infer<typeof patchSellerSchema>;

/** GET /admin/seller-submissions - PENDING unless asked (ALL = every status). */
export const listSubmissionsQuerySchema = z.object({
  status: z
    .enum([...SUBMISSION_STATUSES, 'ALL'], { errorMap: () => ({ message: 'status must be PENDING, APPROVED, REJECTED, WITHDRAWN or ALL' }) })
    .default('PENDING'),
  seller_id: z.string().uuid('seller_id must be a seller id').optional(),
});
export type ListSubmissionsQuery = z.infer<typeof listSubmissionsQuerySchema>;

/** POST /admin/seller-submissions/:id/approve (selling_price: required for NEW, see the service for EDIT). */
export const approveSubmissionSchema = z
  .object({
    selling_price: money('Selling price').optional(),
    category_id: z.string().uuid('category_id must be a category id').optional(),
  })
  .strict();
export type ApproveSubmissionInput = z.infer<typeof approveSubmissionSchema>;

/** POST /admin/seller-submissions/:id/reject */
export const rejectSubmissionSchema = z.object({ reason: reason('The reason') }).strict();

/** POST /admin/sellers/:id/location/reject (migration 053; the column holds 200). */
export const rejectLocationSchema = z
  .object({
    reason: z
      .string({ required_error: 'The reason is required', invalid_type_error: 'The reason must be text' })
      .trim()
      .min(3, 'The reason must be at least 3 characters')
      .max(200, 'The reason must be at most 200 characters'),
  })
  .strict();

/** POST /admin/sellers/:id/payouts */
export const recordPayoutSchema = z
  .object({
    amount: money('Amount'),
    note: z
      .string()
      .trim()
      .max(200, 'Note must be at most 200 characters')
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    paid_on: day.optional(),
  })
  .strict();
export type RecordPayoutInput = z.infer<typeof recordPayoutSchema>;

/** PUT /admin/settings/seller-commission (seller.commission.ts) - categories left out keep their rate. */
export const commissionSettingsSchema = z
  .object({
    default_percent: percent('Default commission'),
    // the free month for sellers approved from now on, in days (0 = none); left out = unchanged
    free_days: z
      .number({ invalid_type_error: 'Free days must be a number' })
      .int('Free days must be a whole number')
      .min(0, 'Free days cannot be negative')
      .max(FREE_DAYS_MAX, `Free days cannot be above ${FREE_DAYS_MAX}`)
      .optional(),
    categories: z
      .array(
        z
          .object({
            category_id: z.string().uuid('category_id must be a category id'),
            percent: percent('Category commission').nullable(),
          })
          .strict()
      )
      .max(2000)
      .optional(),
  })
  .strict();
export type CommissionSettingsInput = z.infer<typeof commissionSettingsSchema>;

/** POST /admin/sellers/:id/products - the photo is checked by the service (400 IMAGE_REQUIRED). */
export const createSellerProductSchema = z
  .object({
    name: z.string({ required_error: 'Name is required' }).trim().min(2, 'Name must be at least 2 characters').max(120, 'Name must be at most 120 characters'),
    category_id: z.string({ required_error: 'Category is required' }).uuid('Choose one of the listed categories'),
    unit: z.string({ required_error: 'Unit is required' }).trim().min(1, 'Unit is required').max(32, 'Unit must be at most 32 characters'),
    pack_size: profileText('Pack size', 64),
    description: profileText('Description', 2000),
    image_url: z
      .string({ invalid_type_error: 'The photo must be an uploaded image' })
      .trim()
      .max(500)
      .refine((u) => u === '' || mediaStorage.keyFromUrl(u) !== null || /^https?:\/\//i.test(u), 'Upload the photo with the image uploader')
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
    seller_price: money('Seller price').refine((n) => n <= 1_000_000, 'Seller price must be at most 1,000,000'),
    selling_price: money('Selling price'),
    barcode: profileText('Barcode', 64),
    stock_quantity: z
      .number({ invalid_type_error: 'Stock must be a number' })
      .int('Stock must be a whole number')
      .min(0, 'Stock cannot be negative')
      .max(100_000, 'Stock must be at most 100,000')
      .optional(),
  })
  .strict();
export type CreateSellerProductInput = z.infer<typeof createSellerProductSchema>;

/** PUT /admin/sellers/:id/location - the shop pin (inside Sri Lanka, like the seller's own) and how to find it. */
const pinCoordinate = (what: 'Latitude' | 'Longitude', min: number, max: number) =>
  z
    .number({ required_error: `${what} is required`, invalid_type_error: `${what} must be a number` })
    .finite(`${what} must be a number`)
    .min(min, 'Pin a place in Sri Lanka')
    .max(max, 'Pin a place in Sri Lanka');

export const adminSellerLocationSchema = z
  .object({
    latitude: pinCoordinate('Latitude', SRI_LANKA_BOUNDS.minLat, SRI_LANKA_BOUNDS.maxLat),
    longitude: pinCoordinate('Longitude', SRI_LANKA_BOUNDS.minLng, SRI_LANKA_BOUNDS.maxLng),
    how_to_find: profileText('How to find it', LOCATION_NOTE_MAX),
  })
  .strict();
export type AdminSellerLocationInput = z.infer<typeof adminSellerLocationSchema>;

/**
 * What the seller proposed (seller_submissions.payload, written by the seller API). Read leniently:
 * only the keys the seller sent are applied on an EDIT.
 */
export const submissionPayloadSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  category_id: z.string().uuid().optional(),
  unit: z.string().trim().min(1).max(32).optional(),
  pack_size: z.string().trim().max(64).nullable().optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().max(1000).nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
});
export type SubmissionPayload = z.infer<typeof submissionPayloadSchema>;
