import { z } from 'zod';

/**
 * Seller stock notes and payout requests (migration 057) and the seller dashboard (insights):
 * request validation for both the seller routes (/seller/...) and the staff routes (/admin/...).
 * The rules live in seller-requests.service.ts.
 */

export const STOCK_NOTE_MAX_QUANTITY = 10_000;
export const REQUEST_TEXT_MAX = 300;
export const INSIGHTS_MAX_DAYS = 90;
/** How far ahead a seller may announce a delivery. */
export const EXPECTED_MAX_DAYS_AHEAD = 60;

const MAX_MONEY = 99_999_999.99;
const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

/** Optional free text: trimmed, blank = none (null). */
const optionalText = (label: string, max = REQUEST_TEXT_MAX) =>
  z
    .string({ invalid_type_error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const day = z
  .string({ invalid_type_error: 'Use a date like 2026-10-24' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-24')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real date');

const quantity = (label: string) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(1, `${label} must be at least 1`)
    .max(STOCK_NOTE_MAX_QUANTITY, `${label} must be at most ${STOCK_NOTE_MAX_QUANTITY.toLocaleString('en-US')}`);

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });

// ----------------------------------------------------------------------------
// Seller side
// ----------------------------------------------------------------------------

/** POST /seller/stock-notes - "I'm bringing 20 of X on Tuesday". expected_on is checked against today in the service. */
export const createStockNoteSchema = z
  .object({
    product_id: z.string({ required_error: 'Choose a product' }).uuid('Choose one of your products'),
    quantity: quantity('Quantity'),
    expected_on: day.nullable().optional(),
    note: optionalText('Note'),
  })
  .strict();
export type CreateStockNoteInput = z.infer<typeof createStockNoteSchema>;

export const STOCK_NOTE_STATUSES = ['SENT', 'RECEIVED', 'CANCELLED'] as const;
export const PAYOUT_REQUEST_STATUSES = ['REQUESTED', 'PAID', 'DECLINED', 'WITHDRAWN'] as const;

/** GET /seller/stock-notes - every status unless asked. */
export const sellerStockNotesQuerySchema = z.object({
  status: z.enum(STOCK_NOTE_STATUSES, { errorMap: () => ({ message: 'status must be SENT, RECEIVED or CANCELLED' }) }).optional(),
});

/** POST /seller/payout-requests */
export const createPayoutRequestSchema = z
  .object({
    amount: z
      .number({ required_error: 'Amount is required', invalid_type_error: 'Amount must be a number' })
      .positive('Amount must be above 0')
      .max(MAX_MONEY, 'Amount is too large')
      .refine(twoDecimals, 'Amount can have at most 2 decimals'),
    method: z.enum(['BANK', 'CASH'], { errorMap: () => ({ message: 'method must be BANK or CASH' }) }),
    bank_details: optionalText('Bank details'),
    note: optionalText('Note'),
  })
  .strict();
export type CreatePayoutRequestInput = z.infer<typeof createPayoutRequestSchema>;

/** GET /seller/insights?days=7 */
export const insightsQuerySchema = z.object({
  days: z.coerce
    .number({ invalid_type_error: 'days must be a number' })
    .int('days must be a whole number')
    .min(1, 'days must be at least 1')
    .max(INSIGHTS_MAX_DAYS, `days must be at most ${INSIGHTS_MAX_DAYS}`)
    .default(7),
});

// ----------------------------------------------------------------------------
// Staff side
// ----------------------------------------------------------------------------

/** GET /admin/seller-stock-notes - SENT (still coming) unless asked; ALL = every status. */
export const staffStockNotesQuerySchema = z.object({
  status: z
    .enum([...STOCK_NOTE_STATUSES, 'ALL'], { errorMap: () => ({ message: 'status must be SENT, RECEIVED, CANCELLED or ALL' }) })
    .default('SENT'),
  seller_id: z.string().uuid('seller_id must be a seller id').optional(),
});
export type StaffStockNotesQuery = z.infer<typeof staffStockNotesQuerySchema>;

/** POST /admin/seller-stock-notes/:id/receive - what actually arrived (may differ from the note). */
export const receiveStockNoteSchema = z.object({ received_quantity: quantity('Received quantity') }).strict();

/** POST /admin/seller-stock-notes/:id/cancel */
export const cancelStockNoteSchema = z.object({ reason: optionalText('Reason') }).strict();

/** GET /admin/seller-payout-requests - REQUESTED (waiting) unless asked; ALL = every status. */
export const staffPayoutRequestsQuerySchema = z.object({
  status: z
    .enum([...PAYOUT_REQUEST_STATUSES, 'ALL'], {
      errorMap: () => ({ message: 'status must be REQUESTED, PAID, DECLINED, WITHDRAWN or ALL' }),
    })
    .default('REQUESTED'),
  seller_id: z.string().uuid('seller_id must be a seller id').optional(),
});
export type StaffPayoutRequestsQuery = z.infer<typeof staffPayoutRequestsQuerySchema>;

/** POST /admin/seller-payout-requests/:id/pay */
export const payPayoutRequestSchema = z
  .object({
    paid_on: day.optional(),
    note: z
      .string({ invalid_type_error: 'Note must be text' })
      .trim()
      .max(200, 'Note must be at most 200 characters')
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .strict();
export type PayPayoutRequestInput = z.infer<typeof payPayoutRequestSchema>;

/** POST /admin/seller-payout-requests/:id/decline */
export const declinePayoutRequestSchema = z
  .object({
    reason: z
      .string({ required_error: 'The reason is required', invalid_type_error: 'The reason must be text' })
      .trim()
      .min(3, 'The reason must be at least 3 characters')
      .max(REQUEST_TEXT_MAX, `The reason must be at most ${REQUEST_TEXT_MAX} characters`),
  })
  .strict();
