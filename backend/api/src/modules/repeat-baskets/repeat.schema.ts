import { z } from 'zod';

/**
 * Request shapes of the repeat basket API (migration 054). A zod failure is
 * 400 VALIDATION_ERROR whose details name the field (error.middleware.ts).
 */
export const REPEAT_LIMITS = { baskets: 5, lines: 30, quantity: 20, name: 40, notes: 300 } as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const repeatLineSchema = z
  .object({
    product_id: z.string({ required_error: 'product_id is required' }).uuid('Invalid product_id'),
    variant_id: z.string().uuid('Invalid variant_id').nullable().optional(),
    quantity: z
      .number({ required_error: 'quantity is required', invalid_type_error: 'quantity must be a number' })
      .int('quantity must be a whole number')
      .min(1, 'quantity must be at least 1')
      .max(REPEAT_LIMITS.quantity, `quantity can be at most ${REPEAT_LIMITS.quantity}`),
  })
  .strict()
  .transform((l) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null, quantity: l.quantity }));

const itemsSchema = z
  .array(repeatLineSchema, { invalid_type_error: 'items must be a list' })
  .min(1, 'Add at least one item')
  .max(REPEAT_LIMITS.lines, `A basket can hold at most ${REPEAT_LIMITS.lines} items`)
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((l, i) => {
      const key = `${l.product_id}:${l.variant_id ?? ''}`;
      if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: 'Each product (or size) can be in the basket once' });
      seen.add(key);
    });
  });

const nameSchema = z
  .string({ invalid_type_error: 'name must be text' })
  .trim()
  .min(1, 'name cannot be empty')
  .max(REPEAT_LIMITS.name, `name can be at most ${REPEAT_LIMITS.name} characters`);
const frequencySchema = z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY'], {
  errorMap: () => ({ message: 'frequency must be DAILY, WEEKLY or BIWEEKLY' }),
});
const weekdaySchema = z
  .number({ invalid_type_error: 'weekday must be a number 0 (Sunday) - 6 (Saturday)' })
  .int('weekday must be a whole number')
  .min(0, 'weekday must be 0 (Sunday) - 6 (Saturday)')
  .max(6, 'weekday must be 0 (Sunday) - 6 (Saturday)');
const placeAtSchema = z.string({ required_error: 'place_at is required', invalid_type_error: 'place_at must be HH:MM' }).regex(HHMM, 'place_at must be HH:MM (24-hour)');
const notesSchema = z
  .string({ invalid_type_error: 'notes must be text' })
  .trim()
  .max(REPEAT_LIMITS.notes, `notes can be at most ${REPEAT_LIMITS.notes} characters`)
  .nullable();
const startDateSchema = z
  .string({ invalid_type_error: 'start_date must be YYYY-MM-DD' })
  .regex(ISO_DATE, 'start_date must be YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'start_date must be a real date')
  .nullable();

/** WEEKLY / BIWEEKLY need a weekday. */
function needsWeekday(v: { frequency?: string; weekday?: number | null }, ctx: z.RefinementCtx) {
  if (v.frequency && v.frequency !== 'DAILY' && (v.weekday === undefined || v.weekday === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['weekday'], message: 'Pick the day of the week' });
  }
}

export const createBasketSchema = z
  .object({
    name: nameSchema.optional(),
    items: itemsSchema,
    frequency: frequencySchema,
    weekday: weekdaySchema.nullable().optional(),
    place_at: placeAtSchema,
    address_id: z.string({ required_error: 'address_id is required' }).uuid('Invalid address_id'),
    notes: notesSchema.optional(),
    start_date: startDateSchema.optional(),
  })
  .strict()
  .superRefine(needsWeekday);
export type CreateBasketInput = z.infer<typeof createBasketSchema>;

export const fromOrderSchema = z
  .object({
    name: nameSchema.optional(),
    frequency: frequencySchema,
    weekday: weekdaySchema.nullable().optional(),
    place_at: placeAtSchema,
    address_id: z.string().uuid('Invalid address_id').optional(),
    notes: notesSchema.optional(),
    start_date: startDateSchema.optional(),
  })
  .strict()
  .superRefine(needsWeekday);
export type FromOrderInput = z.infer<typeof fromOrderSchema>;

/** Any field of the basket; next_run_at is worked out again when the schedule or status changes. */
export const patchBasketSchema = z
  .object({
    name: nameSchema.optional(),
    items: itemsSchema.optional(),
    frequency: frequencySchema.optional(),
    weekday: weekdaySchema.nullable().optional(),
    place_at: placeAtSchema.optional(),
    address_id: z.string().uuid('Invalid address_id').optional(),
    notes: notesSchema.optional(),
    start_date: startDateSchema.optional(),
    status: z.enum(['ACTIVE', 'PAUSED'], { errorMap: () => ({ message: 'status must be ACTIVE or PAUSED' }) }).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type PatchBasketInput = z.infer<typeof patchBasketSchema>;

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });
export const orderIdParamSchema = z.object({ orderId: z.string().uuid('Invalid order id') });

export const staffListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const staffPatchSchema = z
  .object({
    status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED'], { errorMap: () => ({ message: 'status must be ACTIVE, PAUSED or CANCELLED' }) }),
  })
  .strict();
