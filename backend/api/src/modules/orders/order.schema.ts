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
