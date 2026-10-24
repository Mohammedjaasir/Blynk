import { z } from 'zod';
import { MAX_COVER_DAYS, MAX_LEAD_DAYS } from './reorder.rules.js';

/** Request validation for the purchasing routes. The rules live in purchase-orders.service.ts. */
export const MAX_LINES = 200;
export const MAX_QTY = 100_000;
const MAX_MONEY = 99_999_999.99;

const day = z
  .string({ invalid_type_error: 'Use a date like 2026-10-27' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-27')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real date');

const text = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const qty = (label: string) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(1, `${label} must be at least 1`)
    .max(MAX_QTY, `${label} must be at most ${MAX_QTY.toLocaleString('en-US')}`);

const money = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .min(0, `${label} cannot be negative`)
    .max(MAX_MONEY, `${label} is too large`)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, `${label} can have at most 2 decimals`);

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id') });

export const suggestionsQuerySchema = z.object({
  days: z.coerce.number().int().refine((v) => v === 14 || v === 28, 'days must be 14 or 28').default(14),
  cover_days: z.coerce.number().int().min(1).max(MAX_COVER_DAYS).default(7),
  lead_days: z.coerce.number().int().min(0).max(MAX_LEAD_DAYS).default(1),
});
export type SuggestionsQuery = z.infer<typeof suggestionsQuerySchema>;

const lineSchema = z.object({
  product_id: z.string().uuid('Invalid product'),
  variant_id: z.string().uuid('Invalid variant').nullable().optional(),
  ordered_qty: qty('Quantity'),
  /** Expected cost per unit; omitted = the product's (variant's) purchase cost. */
  unit_cost: money('Unit cost').optional(),
  note: text('Line note', 300),
});
export type PoLineInput = z.infer<typeof lineSchema>;

const linesSchema = z.array(lineSchema).min(1, 'Add at least one product').max(MAX_LINES, `At most ${MAX_LINES} products per order`);

export const createPurchaseOrderSchema = z.object({
  supplier_id: z.string().uuid('Invalid supplier').nullable().optional(),
  expected_on: day.nullable().optional(),
  notes: text('Notes', 500),
  lines: linesSchema,
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

export const patchPurchaseOrderSchema = z
  .object({
    supplier_id: z.string().uuid('Invalid supplier').nullable().optional(),
    expected_on: day.nullable().optional(),
    notes: text('Notes', 500),
    lines: linesSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type PatchPurchaseOrderInput = z.infer<typeof patchPurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  status: z.enum(['ALL', 'OPEN', 'DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED']).default('ALL'),
  supplier_id: z.string().uuid().optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

export const receivePurchaseOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        item_id: z.string().uuid('Invalid line'),
        /** What arrived in this delivery (0 = nothing of this line today). */
        received_qty: z
          .number({ required_error: 'Received quantity is required', invalid_type_error: 'Received quantity must be a number' })
          .int('Received quantity must be a whole number')
          .min(0, 'Received quantity cannot be negative')
          .max(MAX_QTY, `Received quantity must be at most ${MAX_QTY.toLocaleString('en-US')}`),
        /** The cost actually paid per unit; it replaces the line's cost. */
        unit_cost: money('Unit cost').optional(),
        /** Also make unit_cost the product's (variant's) purchase cost. */
        update_product_cost: z.boolean().optional(),
      })
    )
    .min(1, 'Nothing to receive')
    .max(MAX_LINES),
  /** The supplier will not send the rest: close the order as RECEIVED even though some lines are short. */
  close_short: z.boolean().optional(),
});
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;

export const cancelPurchaseOrderSchema = z.object({
  reason: z
    .string({ required_error: 'Say why it is cancelled' })
    .trim()
    .min(1, 'Say why it is cancelled')
    .max(300, 'The reason must be at most 300 characters'),
});
