import { z } from 'zod';
import { DateTime } from 'luxon';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';

/**
 * Expiry dates (owner, 2026-10-25; migration 059). Pure rules, tested without a
 * database. Every date is an Asia/Colombo calendar day ('YYYY-MM-DD').
 *
 * "Today" is the Colombo day. A batch whose expires_on is today is still
 * sellable today ("expires today", days_left 0); it is EXPIRED from tomorrow.
 *   expired  expires_on <  today                (days_left < 0)
 *   week     today <= expires_on <= today + 7   (shown red; includes "today")
 *   month    today + 8 <= expires_on <= today + 30
 *   later    after that
 * The daily staff push (8 am) fires when something is expired or expires within
 * PUSH_WITHIN_DAYS days.
 */
export const WEEK_DAYS = 7;
export const MONTH_DAYS = 30;
export const PUSH_WITHIN_DAYS = 3;
/** Earliest / latest expires_on accepted, in days from today (a past date registers stock found out of date). */
export const MIN_DAYS_PAST = 365;
export const MAX_DAYS_AHEAD = 3650;
export const MAX_BATCH_QUANTITY = 1_000_000;

export type ExpirySeverity = 'expired' | 'red' | 'amber' | 'ok';
export type ExpiryBucket = 'expired' | 'week' | 'month' | 'later';

/** The Colombo calendar day of `at`, 'YYYY-MM-DD'. */
export const colomboToday = (at: Date = new Date()): string => DateTime.fromJSDate(at).setZone(STORE_TIMEZONE).toISODate()!;

/** `date` ('YYYY-MM-DD') moved by `days` calendar days. */
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = DateTime.fromISO(from, { zone: 'utc' }).startOf('day');
  const b = DateTime.fromISO(to, { zone: 'utc' }).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

/** Days until the batch expires (0 = today, negative = already expired). */
export const daysLeft = (expiresOn: string, today: string): number => daysBetween(today, expiresOn);

export function bucketOf(expiresOn: string, today: string): ExpiryBucket {
  const d = daysLeft(expiresOn, today);
  if (d < 0) return 'expired';
  if (d <= WEEK_DAYS) return 'week';
  if (d <= MONTH_DAYS) return 'month';
  return 'later';
}

/** Colour the staff screens use: expired and <= 7 days are red, <= 30 days amber. */
export function severityOf(expiresOn: string, today: string): ExpirySeverity {
  const b = bucketOf(expiresOn, today);
  return b === 'expired' ? 'expired' : b === 'week' ? 'red' : b === 'month' ? 'amber' : 'ok';
}

/** "Expired 3 days ago", "Expires today", "Expires tomorrow", "Expires in 12 days". */
export function expiryLabel(expiresOn: string, today: string): string {
  const d = daysLeft(expiresOn, today);
  if (d < 0) return d === -1 ? 'Expired yesterday' : `Expired ${-d} days ago`;
  if (d === 0) return 'Expires today';
  if (d === 1) return 'Expires tomorrow';
  return `Expires in ${d} days`;
}

/** The inclusive date range [from, to] ('YYYY-MM-DD', either may be null = open) of a list bucket. */
export function bucketRange(bucket: 'expired' | 'week' | 'month' | 'all', today: string): { from: string | null; to: string | null } {
  switch (bucket) {
    case 'expired':
      return { from: null, to: addDays(today, -1) };
    case 'week':
      return { from: today, to: addDays(today, WEEK_DAYS) };
    case 'month':
      return { from: addDays(today, WEEK_DAYS + 1), to: addDays(today, MONTH_DAYS) };
    default:
      return { from: null, to: null };
  }
}

/** Whether a batch dated `expiresOn` is inside the accepted range for a new / edited date. */
export function expiryDateInRange(expiresOn: string, today: string): boolean {
  const d = daysLeft(expiresOn, today);
  return d >= -MIN_DAYS_PAST && d <= MAX_DAYS_AHEAD;
}

// ----------------------------------------------------------------------------
// Request schemas
// ----------------------------------------------------------------------------
const uuid = (what: string) => z.string().uuid(`Invalid ${what}`);

export const dateString = z
  .string({ required_error: 'The expiry date is required', invalid_type_error: 'The expiry date must be a date' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'The expiry date must look like 2026-12-31')
  .refine((s) => DateTime.fromISO(s, { zone: 'utc' }).isValid, 'That is not a real date')
  .refine((s) => expiryDateInRange(s, colomboToday()), 'The expiry date is too far in the past or future');

const batchCode = z
  .string()
  .trim()
  .max(60, 'The batch code cannot exceed 60 characters')
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const note = z
  .string()
  .trim()
  .max(300, 'The note cannot exceed 300 characters')
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const quantity = z
  .number({ required_error: 'The quantity is required', invalid_type_error: 'The quantity must be a number' })
  .int('The quantity must be a whole number')
  .min(1, 'The quantity must be at least 1')
  .max(MAX_BATCH_QUANTITY, 'The quantity is too large');

export const createBatchSchema = z.object({
  product_id: uuid('product ID'),
  variant_id: uuid('variant ID').nullable().optional(),
  batch_code: batchCode,
  quantity,
  expires_on: dateString,
  note,
});
export type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const updateBatchSchema = z
  .object({
    batch_code: batchCode,
    quantity: quantity.optional(),
    expires_on: dateString.optional(),
    note,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to change' });
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;

export const discardBatchSchema = z.object({
  /** EXPIRED (default) or WASTE (damaged / spoiled before its date). */
  reason: z.enum(['EXPIRED', 'WASTE'], { errorMap: () => ({ message: 'The reason must be EXPIRED or WASTE' }) }).default('EXPIRED'),
  /** false = the stock count was already corrected by hand: only the batch is closed. */
  reduce_stock: z.boolean().default(true),
  note,
});
export type DiscardBatchInput = z.infer<typeof discardBatchSchema>;

export const listBatchesQuerySchema = z.object({
  bucket: z.enum(['expired', 'week', 'month', 'all']).default('all'),
  product_id: uuid('product ID').optional(),
  /** ACTIVE (default) = the register of what is on the shelf; the others are history. */
  status: z.enum(['ACTIVE', 'SOLD_OUT', 'DISCARDED']).default('ACTIVE'),
  page: z.preprocess((v) => (v ? parseInt(v as string, 10) : 1), z.number().int().min(1).default(1)),
  limit: z.preprocess((v) => (v ? parseInt(v as string, 10) : 50), z.number().int().min(1).max(200).default(50)),
});
export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;

export const batchIdParamsSchema = z.object({ id: uuid('batch ID') });
export const productIdParamsSchema = z.object({ productId: uuid('product ID') });

export const trackingSchema = z.object({
  enabled: z.boolean({ required_error: 'Say whether expiry dates are tracked', invalid_type_error: 'enabled must be true or false' }),
});

/** The optional `expires_on` / `batch_code` the restock call may carry (additive). */
export const restockBatchFields = z.object({
  expires_on: dateString.optional(),
  batch_code: batchCode,
});

// ----------------------------------------------------------------------------
// The daily push
// ----------------------------------------------------------------------------
/** The staff push text; null when there is nothing to say. */
export function expiryPushText(counts: { expired: number; soon: number; names: string[] }): { title: string; body: string } | null {
  if (counts.expired <= 0 && counts.soon <= 0) return null;
  const parts: string[] = [];
  if (counts.expired > 0) parts.push(`${counts.expired} batch${counts.expired === 1 ? '' : 'es'} expired`);
  if (counts.soon > 0) parts.push(`${counts.soon} expire${counts.soon === 1 ? 's' : ''} within ${PUSH_WITHIN_DAYS} days`);
  const names = counts.names.slice(0, 3).join(', ');
  return {
    title: counts.expired > 0 ? 'Stock has expired' : 'Stock expiring soon',
    body: `${parts.join(', ')}${names ? `: ${names}` : ''}. Open Expiry to check them.`,
  };
}
