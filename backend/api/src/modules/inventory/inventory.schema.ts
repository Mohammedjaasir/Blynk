import { z } from 'zod';

export const sourceOrderItemSchema = z.object({
  quantity: z.number().int().positive('Quantity must be greater than 0').optional(),
  actual_unit_cost: z
    .number({ required_error: 'Actual unit cost is required' })
    .min(0, 'Actual unit cost must be greater than or equal to 0'),
  supplier_id: z.string().uuid('Invalid supplier ID format').optional(),
  supplier_name: z.string().max(128, 'Supplier name cannot exceed 128 characters').optional(),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
});

/**
 * Adjustment types an operator may record by hand. The ORDER_* types are
 * written by the system (sourcing writes ORDER_FULFILLMENT itself) and are
 * refused here so the ledger can't be made to look like order activity.
 */
export const manualAdjustmentTypes = [
  'PURCHASE_RESTOCK', // stock received: always adds
  'DAMAGE_WRITE_OFF', // stock lost: always removes
  'INVENTORY_AUDIT_ADJUSTMENT', // count correction: either direction
] as const;

export const adjustStockSchema = z
  .object({
    adjustment_type: z.enum(manualAdjustmentTypes, {
      errorMap: () => ({
        message: 'Adjustment type must be PURCHASE_RESTOCK, DAMAGE_WRITE_OFF or INVENTORY_AUDIT_ADJUSTMENT',
      }),
    }),
    quantity_delta: z
      .number({ required_error: 'Quantity delta is required' })
      .int('Quantity delta must be an integer')
      .refine((val) => val !== 0, 'Quantity delta cannot be zero'),
    dark_store_id: z.string().uuid('Invalid dark store ID').optional(),
    notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
  })
  .superRefine((input, ctx) => {
    if (input.adjustment_type === 'PURCHASE_RESTOCK' && input.quantity_delta < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity_delta'],
        message: 'A restock must add stock (positive quantity)',
      });
    }
    if (input.adjustment_type === 'DAMAGE_WRITE_OFF' && input.quantity_delta > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity_delta'],
        message: 'A damage write-off must remove stock (negative quantity)',
      });
    }
  });

/** Route params for …/orders/:id/items/:itemId/source - a malformed id is a 400, not a DB error. */
export const sourceItemParamsSchema = z.object({
  id: z.string().uuid('Invalid order ID'),
  itemId: z.string().uuid('Invalid order item ID'),
});

/** Route params for …/orders/:id/sourcing. */
export const sourcingOrderParamsSchema = z.object({
  id: z.string().uuid('Invalid order ID'),
});

/** Route params for /suppliers/:id. */
export const supplierIdParamsSchema = z.object({
  id: z.string().uuid('Invalid supplier ID'),
});

/** Route params for /inventory/:productId… - a malformed id is a 400, not a DB error. */
export const productIdParamsSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
});

export const productStockQuerySchema = z.object({
  dark_store_id: z.string().uuid('Invalid dark store ID').optional(),
});

export const updateInventoryModeSchema = z.object({
  tracking_mode: z.enum(['UNTRACKED', 'TRACKED'], {
    required_error: 'Tracking mode must be UNTRACKED or TRACKED',
  }),
  dark_store_id: z.string().uuid('Invalid dark store ID').optional(),
});

export const createSupplierSchema = z.object({
  name: z.string().min(2, 'Supplier name must be at least 2 characters').max(128),
  code: z.string().max(64).optional(),
  contact_person: z.string().max(128).optional(),
  contact_phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

export const updateSupplierSchema = z.object({
  name: z.string().min(2).max(128).optional(),
  code: z.string().max(64).optional(),
  contact_person: z.string().max(128).optional(),
  contact_phone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
});

const pageParam = z.preprocess((val) => (val ? parseInt(val as string, 10) : 1), z.number().int().min(1).default(1));
const limitParam = z.preprocess(
  (val) => (val ? parseInt(val as string, 10) : 20),
  z.number().int().min(1).max(100).default(20)
);

export const inventoryQuerySchema = z.object({
  dark_store_id: z.string().uuid().optional(),
  tracking_mode: z.enum(['UNTRACKED', 'TRACKED']).optional(),
  low_stock_only: z.preprocess((val) => val === 'true' || val === true, z.boolean().optional()),
  /** Matches product name or SKU, case-insensitive. */
  search: z.string().trim().max(100).optional(),
  /** Inactive (Admin-disabled) products are hidden unless asked for. */
  include_inactive: z.preprocess((val) => val === 'true' || val === true, z.boolean().optional()),
  page: pageParam,
  limit: limitParam,
});

export const adjustmentsQuerySchema = z
  .object({
    product_id: z.string().uuid('Invalid product ID').optional(),
    type: z
      .enum([
        'PURCHASE_RESTOCK',
        'ORDER_RESERVATION',
        'ORDER_FULFILLMENT',
        'ORDER_CANCELLATION_RESTORE',
        'DAMAGE_WRITE_OFF',
        'INVENTORY_AUDIT_ADJUSTMENT',
      ])
      .optional(),
    from: z.coerce.date({ invalid_type_error: 'Invalid from date' }).optional(),
    to: z.coerce.date({ invalid_type_error: 'Invalid to date' }).optional(),
    page: pageParam,
    limit: limitParam,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must be before to',
    path: ['from'],
  });

export type SourceOrderItemInput = z.infer<typeof sourceOrderItemSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type UpdateInventoryModeInput = z.infer<typeof updateInventoryModeSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type InventoryQueryInput = z.infer<typeof inventoryQuerySchema>;
export type AdjustmentsQueryInput = z.infer<typeof adjustmentsQuerySchema>;
