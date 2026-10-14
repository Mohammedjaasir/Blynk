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
 *
 * IMAGE and ARTWORK both carry `background_image_url`; what differs is what
 * the app draws on top of it:
 *
 *   IMAGE   - the operator's photograph under a flat ink scrim, with the
 *             app's own headline and subtitle over it.
 *   ARTWORK - a finished banner, full-bleed: no scrim, no headline, no
 *             subtitle. The uploaded file already carries its own wording.
 *
 * NOTE: `title` is REQUIRED for ARTWORK too, exactly as for every other
 * type. It is never painted on an ARTWORK card, so it looks redundant - it
 * is not. It is the slide's accessibility label in the customer app (with
 * the words baked into a picture, a screen-reader user would otherwise get
 * nothing at all) and it is the row label in the Blynk Ops promotion list.
 * Do not make it optional for ARTWORK.
 */
export const promotionBackgroundTypes = ['SOLID', 'GRADIENT', 'IMAGE', 'ARTWORK'] as const;

/** #RGB, #RRGGBB or #RRGGBBAA. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex colour, e.g. #FFE141');

/**
 * A crop anchor for the card's background image, as a percentage of that
 * image's own width or height (migration 009).
 *
 * The carousel card is a fixed shape and the background fills it with
 * `cover`, so whatever does not fit is cropped away - from the centre, until
 * now. A banner whose headline runs along the top lost exactly that headline.
 * This says which point must survive the crop, and it applies to IMAGE and
 * ARTWORK alike because both draw `background_image_url`.
 *
 * 50 is the centre, which is where `cover` anchored before this existed - so
 * omitting it leaves every stored banner rendering exactly as it does today.
 */
const focalPercent = z
  .number()
  .int('Focal point must be a whole percentage')
  .min(0, 'Focal point must be between 0 and 100')
  .max(100, 'Focal point must be between 0 and 100');

export const createPromotionSchema = z
  .object({
    title: z.string().trim().min(2, 'Title must be at least 2 characters').max(120),
    subtitle: z.string().trim().max(240).nullable().optional(),
    image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
    background_type: z.enum(promotionBackgroundTypes).default('SOLID').optional(),
    background_color: hexColor.nullable().optional(),
    background_color_end: hexColor.nullable().optional(),
    background_image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
    background_focal_x: focalPercent.default(50).optional(),
    background_focal_y: focalPercent.default(50).optional(),
    cta_label: z.string().trim().max(40).nullable().optional(),
    cta_destination_type: z.enum(promotionDestinationTypes).nullable().optional(),
    // CATEGORY: a category or sub-category (slug or id; stored as the slug).
    // PRODUCT: a product (id or slug; stored as the id). CATALOG: blank for
    // the whole catalog, or a category group id for one Main section (owner,
    // 2026-10-14; promotion.targets.ts). The target must exist.
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
    // ARTWORK is validated exactly as IMAGE: both are nothing without the
    // file they are meant to render.
    if (
      (data.background_type === 'IMAGE' || data.background_type === 'ARTWORK') &&
      !data.background_image_url
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          data.background_type === 'ARTWORK'
            ? 'A full-artwork background needs background_image_url'
            : 'An image background needs background_image_url',
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
    // ARTWORK is the one type that may carry a destination with no button
    // label: the uploaded banner already draws its own call to action, so the
    // customer app makes the whole card tappable instead of stamping a pill
    // over the artwork. Every other type still needs the label - without one
    // there would be nothing on the card to press.
    if (type && !data.cta_label && data.background_type !== 'ARTWORK') {
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
  background_focal_x: focalPercent.optional(),
  background_focal_y: focalPercent.optional(),
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
