import { z } from 'zod';

/**
 * Home promotions. Only what the product actually needs today:
 * scheduling windows are deliberately absent (promotions are switched on
 * and off by hand), and a destination is optional so a promotion can stay
 * informational instead of pointing at a screen that doesn't exist.
 */
export const promotionDestinationTypes = ['CATEGORY', 'PRODUCT', 'CATALOG'] as const;

/**
 * How the carousel card is filled behind the content. The customer app
 * renders exactly what is stored here - it no longer picks its own tint.
 */
export const promotionBackgroundTypes = ['SOLID', 'GRADIENT', 'IMAGE'] as const;

/** #RGB, #RRGGBB or #RRGGBBAA. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex colour, e.g. #FFE141');

export const createPromotionSchema = z
  .object({
    title: z.string().trim().min(2, 'Title must be at least 2 characters').max(120),
    subtitle: z.string().trim().max(240).nullable().optional(),
    image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
    background_type: z.enum(promotionBackgroundTypes).default('SOLID').optional(),
    background_color: hexColor.nullable().optional(),
    background_color_end: hexColor.nullable().optional(),
    background_image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
    cta_label: z.string().trim().max(40).nullable().optional(),
    cta_destination_type: z.enum(promotionDestinationTypes).nullable().optional(),
    // A category slug or a product id; ignored for CATALOG.
    cta_destination_value: z.string().trim().max(255).nullable().optional(),
    display_order: z.number().int().min(0).max(1000).default(0).optional(),
    is_active: z.boolean().default(true).optional(),
  })
  .superRefine((data, ctx) => {
    // A background has to carry what its type needs, or the customer app
    // would fall back to a blank card.
    if (data.background_type === 'GRADIENT' && !(data.background_color && data.background_color_end)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A gradient background needs both colours',
        path: ['background_color_end'],
      });
    }
    if (data.background_type === 'IMAGE' && !data.background_image_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An image background needs background_image_url',
        path: ['background_image_url'],
      });
    }

    const type = data.cta_destination_type;
    const value = data.cta_destination_value;
    if ((type === 'CATEGORY' || type === 'PRODUCT') && !value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cta_destination_value is required when cta_destination_type is ${type}`,
        path: ['cta_destination_value'],
      });
    }
    if (type && !data.cta_label) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cta_label is required when the promotion has a destination',
        path: ['cta_label'],
      });
    }
  });

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;

// .partial() can't be called on an effects schema, so the update shape is
// declared explicitly and the same cross-field rule is applied on the
// merged row in the service.
export const updatePromotionSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  subtitle: z.string().trim().max(240).nullable().optional(),
  image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
  background_type: z.enum(promotionBackgroundTypes).optional(),
  background_color: hexColor.nullable().optional(),
  background_color_end: hexColor.nullable().optional(),
  background_image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
  cta_label: z.string().trim().max(40).nullable().optional(),
  cta_destination_type: z.enum(promotionDestinationTypes).nullable().optional(),
  cta_destination_value: z.string().trim().max(255).nullable().optional(),
  display_order: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
});

export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

/** Admin list filter. Customers always get active-only, so this is admin-side. */
export const promotionQuerySchema = z.object({
  is_active: z
    .string()
    .optional()
    .transform((val) => (val === undefined ? undefined : val === 'true')),
});

export type PromotionQueryInput = z.infer<typeof promotionQuerySchema>;

/** Bulk reorder: [{ id, display_order }]. */
export const reorderPromotionsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid('Invalid promotion id'),
        display_order: z.number().int().min(0).max(1000),
      })
    )
    .min(1, 'At least one promotion is required')
    .max(100),
});

export type ReorderPromotionsInput = z.infer<typeof reorderPromotionsSchema>;
