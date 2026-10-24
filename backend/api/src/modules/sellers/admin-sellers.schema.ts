import { z } from 'zod';

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

/** PATCH /admin/sellers/:id */
export const patchSellerSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED'], { errorMap: () => ({ message: 'status must be APPROVED, REJECTED or SUSPENDED' }) }).optional(),
    rejection_reason: reason('The reason').nullable().optional(),
    commission_percent: z
      .number({ invalid_type_error: 'Commission must be a number' })
      .min(0, 'Commission cannot be negative')
      .max(100, 'Commission cannot be above 100')
      .refine(twoDecimals, 'Commission can have at most 2 decimals')
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === undefined && v.commission_percent === undefined && v.rejection_reason === undefined) {
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
