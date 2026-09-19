import { z } from 'zod';

export const orderItemInputSchema = z.object({
  product_id: z.string().uuid('Invalid product_id UUID'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(100, 'Quantity cannot exceed 100'),
});

export const createOrderSchema = z.object({
  address_id: z.string().uuid('Invalid address_id UUID'),
  items: z
    .array(orderItemInputSchema)
    .min(1, 'At least one order item is required')
    .max(50, 'Cannot exceed 50 distinct items per order'),
  customer_notes: z.string().trim().max(500).nullable().optional(),
  idempotency_key: z.string().trim().max(128).optional(),
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
});

export type AdminUpdateOrderStatusInput = z.infer<typeof adminUpdateOrderStatusSchema>;

/**
 * Admin: validates rider assignment request.
 */
export const adminAssignRiderSchema = z.object({
  rider_id: z.string().uuid('rider_id must be a valid UUID'),
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
          z.enum(['PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE', 'ITEM_UNAVAILABLE'])
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
