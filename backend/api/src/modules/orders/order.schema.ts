import { z } from 'zod';
import { orderComboLineSchema } from '../catalog/catalog.combos.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';

/**
 * The receiver of an order placed "For someone else" (owner, 2026-10-12): for
 * this order only - the saved address is not changed. The phone must be a
 * Sri Lankan mobile (it gets the order texts); it is NOT verified, so no
 * customer-written text is ever put in an SMS to it.
 */
export const orderRecipientSchema = z
  .object({
    name: z
      .string({ required_error: "The receiver's name is required", invalid_type_error: "The receiver's name must be text" })
      .trim()
      .min(2, "The receiver's name must be at least 2 characters")
      .max(128, "The receiver's name can be at most 128 characters"),
    phone: z
      .string({ required_error: "The receiver's phone is required", invalid_type_error: "The receiver's phone must be text" })
      .trim()
      // Reported as a zod issue (400 VALIDATION_ERROR), as in address.schema.ts.
      .transform((val, ctx) => {
        try {
          return normalizeSriLankanPhone(val);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The receiver's phone must be a Sri Lankan mobile number" });
          return z.NEVER;
        }
      }),
  })
  .strict();

export const orderItemInputSchema = z.object({
  product_id: z.string().uuid('Invalid product_id UUID'),
  /**
   * Migration 045 (owner, 2026-10-14): the size/pack picked ('100 g'). Required
   * for a product that has variants (400 VARIANT_REQUIRED otherwise); the
   * server prices the variant itself.
   */
  variant_id: z.string().uuid('Invalid variant_id UUID').nullable().optional(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(100, 'Quantity cannot exceed 100'),
});

export const createOrderSchema = z.object({
  address_id: z.string().uuid('Invalid address_id UUID'),
  // Migration 033: may be empty when the cart holds only combo packs; an
  // order still needs at least one item or combo (refine below).
  items: z
    .array(orderItemInputSchema)
    .max(50, 'Cannot exceed 50 distinct items per order')
    .default([]),
  /**
   * Migration 033 (owner, 2026-10-09): combo packs in the cart, each charged
   * the combo price by the server. Optional - older apps never send it.
   */
  combos: z
    .array(orderComboLineSchema)
    .max(20, 'Cannot exceed 20 combo packs per order')
    .optional(),
  customer_notes: z.string().trim().max(500).nullable().optional(),
  idempotency_key: z.string().trim().max(128).optional(),
  /**
   * Migration 037 (owner, 2026-10-10): "Use points" at checkout. The server
   * decides how many (Blynk Points rules); older apps never send it.
   */
  use_points: z.boolean({ invalid_type_error: 'use_points must be true or false' }).optional(),
  // Blynk Wallet (owner, 2026-10-15; migration 049): pay part or all with the wallet balance.
  use_wallet: z.boolean({ invalid_type_error: 'use_wallet must be true or false' }).optional(),
  /** Migration 018: re-validated inside the order transaction; any case, stored upper-case. */
  coupon_code: z
    .string({ invalid_type_error: 'coupon_code must be a string' })
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,20}$/, 'Coupon codes are 4-20 letters or digits'))
    .nullable()
    .optional(),
  /**
   * Scheduled delivery (owner, 2026-10-10): the start of a slot from GET
   * /orders/slots. Omitted = as soon as possible. Re-checked (offered, not
   * full) under the slot lock when the order is created.
   */
  delivery_slot_start: z
    .string({ invalid_type_error: 'delivery_slot_start must be a date and time' })
    .datetime({ offset: true, message: 'delivery_slot_start must be a date and time' })
    .nullable()
    .optional(),
  /**
   * Order for someone else (owner, 2026-10-12): true with `recipient` sends
   * the order to that person (name + phone for this order only). Refused with
   * 422 FOR_SOMEONE_ELSE_DISABLED while staff have it switched off.
   */
  for_someone_else: z.boolean({ invalid_type_error: 'for_someone_else must be true or false' }).optional(),
  recipient: orderRecipientSchema.optional(),
  /**
   * A note for the rider for this order (e.g. "Gate code 12, second floor"),
   * shown instead of the saved address's delivery instructions. Shown to the
   * rider and staff only - never put in an SMS.
   */
  delivery_note: z.string({ invalid_type_error: 'delivery_note must be text' }).trim().max(500).nullable().optional(),
  /** "Elderly / needs help - please knock and wait, carry items inside" (owner, 2026-10-12). */
  needs_help: z.boolean({ invalid_type_error: 'needs_help must be true or false' }).optional(),
  /**
   * PayHere (migration 047; owner, 2026-10-14): ONLINE creates the order
   * AWAITING_PAYMENT; it reaches the store only once paid. Omitted = COD.
   */
  payment_method: z.enum(['COD', 'ONLINE'], { invalid_type_error: 'payment_method must be COD or ONLINE' }).optional(),
}).refine((v) => v.items.length + (v.combos?.length ?? 0) > 0, {
  message: 'At least one order item is required',
  path: ['items'],
}).refine((v) => v.for_someone_else !== true || v.recipient !== undefined, {
  message: "Add the receiver's name and phone",
  path: ['recipient'],
}).refine((v) => v.recipient === undefined || v.for_someone_else === true, {
  message: 'A receiver can only be given for an order for someone else',
  path: ['recipient'],
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Cancellation reason must be at least 3 characters').max(500).optional(),
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const orderQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1).default(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100).default(20)),
  status: z
    .enum([
      'AWAITING_PAYMENT',
      'PLACED',
      'PACKED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'FAILED',
      'CUSTOMER_UNAVAILABLE',
      'ITEM_UNAVAILABLE',
    ])
    .optional(),
});

export type OrderQueryInput = z.infer<typeof orderQuerySchema>;

/**
 * Admin: validates the status transition and optional notes.
 * The allowed statuses represent the canonical operational state machine.
 */
export const adminUpdateOrderStatusSchema = z.object({
  status: z.enum(
    ['PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE', 'ITEM_UNAVAILABLE'],
    { required_error: 'status is required', invalid_type_error: 'Invalid order status value' }
  ),
  notes: z.string().trim().max(1000, 'Notes cannot exceed 1000 characters').optional(),
  /** DELIVERED only: the customer's 4-digit code; without it `notes` is the written override. */
  delivery_code: z
    .string({ invalid_type_error: 'delivery_code must be a string' })
    .trim()
    .regex(/^[0-9]{4}$/, 'delivery_code must be 4 digits')
    .optional(),
});

export type AdminUpdateOrderStatusInput = z.infer<typeof adminUpdateOrderStatusSchema>;

/**
 * Admin: validates rider assignment request.
 */
export const adminAssignRiderSchema = z.object({
  rider_id: z.string().uuid('rider_id must be a valid UUID'),
  /** Rider trips: add this order although its drop-off is far from the rider's other one. */
  confirm_far_batch: z.boolean().optional(),
});

export type AdminAssignRiderInput = z.infer<typeof adminAssignRiderSchema>;

/**
 * Admin: validates pagination parameters for admin order listing.
 * Caps limit at 100 to prevent unbounded queries.
 */
export const adminOrderQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1).default(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .pipe(z.number().int().min(1).max(100).default(50)),
  /** One status or a comma-separated list (the staff Orders board asks for several lanes at once). */
  status: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((v) => v.trim()).filter(Boolean) : undefined))
    .pipe(
      z
        .array(
          z.enum(['AWAITING_PAYMENT', 'PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE', 'ITEM_UNAVAILABLE'])
        )
        .optional()
    ),
  /** Only orders changed at or after this moment (e.g. midnight, for "done today"). */
  since: z.coerce.date({ invalid_type_error: 'since must be a date' }).optional(),
});

export type AdminOrderQueryInput = z.infer<typeof adminOrderQuerySchema>;

/**
 * Admin: validates item resolution for unavailable items.
 * item_id is optional in body — the route can supply it via :itemId param instead.
 */
export const resolveItemSchema = z.object({
  // Only resolutions that exist in item_fulfillment_status_enum. 'FULFILLED'
  // used to be accepted here and then fail in PostgreSQL as a 500.
  item_status: z.enum(
    ['UNAVAILABLE', 'SUBSTITUTED'],
    { required_error: 'item_status is required', invalid_type_error: 'Invalid item fulfillment status' }
  ).default('UNAVAILABLE'),
  item_id: z.string().uuid('item_id must be a valid UUID').optional(),
});

/** Route params for /admin/orders/:id[/items/:itemId] - malformed ids are a 400. */
export const orderItemParamsSchema = z.object({
  id: z.string().uuid('Invalid order ID'),
  itemId: z.string().uuid('Invalid order item ID').optional(),
});

export type ResolveItemInput = z.infer<typeof resolveItemSchema>;
