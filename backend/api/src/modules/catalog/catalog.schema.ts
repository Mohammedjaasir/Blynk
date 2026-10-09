import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Helper to slugify a string if slug is not explicitly supplied.
 */
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w-]+/g, '') // Remove all non-word chars
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
}

// ----------------------------------------------------------------------------
// 1. PRODUCT QUERY / FILTER SCHEMA
// ----------------------------------------------------------------------------
export const productQuerySchema = z.object({
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
  category_id: z.string().uuid().optional(),
  category_slug: z.string().min(1).max(128).optional(),
  search: z.string().trim().max(100).optional(),
  is_available: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      return val === true || val === 'true' || val === '1';
    }),
  // Migration 031: only products with an active offer (the app's "Offers" rail).
  on_offer: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      return val === true || val === 'true' || val === '1';
    }),
});

export type ProductQueryInput = z.infer<typeof productQuerySchema>;

// ----------------------------------------------------------------------------
// 2. CATEGORY ADMIN SCHEMAS
// ----------------------------------------------------------------------------
export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(128),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRegex, 'Slug must contain only lowercase alphanumeric characters and hyphens')
    .max(128)
    .optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
  display_order: z.number().int().default(0).optional(),
  is_active: z.boolean().default(true).optional(),
  // Migration 010: the category image's focal point, whole percentages.
  image_focal_x: z.number().int().min(0).max(100).optional(),
  image_focal_y: z.number().int().min(0).max(100).optional(),
  // Migration 025: the home-screen group (null = none, shown under "More")
  // and the position inside it (omitted = appended at the end).
  group_id: z.string().uuid('group_id must be a category group id').nullable().optional(),
  group_sort_order: z.number().int().min(0).max(100000).optional(),
  // Migration 026: the category this one sits inside (null = top level).
  parent_id: z.string().uuid('parent_id must be a category id').nullable().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/**
 * Migration 033 (owner, 2026-10-09): PUT /admin/categories/:id/offer - % off
 * everything in the category and its sub-categories, optionally until a
 * date. More than 0 and less than 100, at most 2 decimals. A new end date in
 * the future is checked by the service (catalog.offers.ts).
 */
export const categoryOfferSchema = z.object({
  offer_percent: z
    .number({ required_error: 'offer_percent is required', invalid_type_error: 'Offer percent must be a number' })
    .gt(0, 'Offer percent must be more than 0')
    .lt(100, 'Offer percent must be less than 100')
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Offer percent can have at most 2 decimals'),
  offer_ends_at: z
    .string()
    .datetime({ offset: true, message: 'Offer end must be a date and time, e.g. 2026-10-31T23:59:59+05:30' })
    .nullable()
    .optional(),
});
export type CategoryOfferInput = z.infer<typeof categoryOfferSchema>;

// ----------------------------------------------------------------------------
// 3. PRODUCT ADMIN SCHEMAS
// ----------------------------------------------------------------------------
/**
 * A crop anchor, as a percentage of the image's own width or height
 * (migration 009). Product tiles draw the photo with `cover`, which crops
 * whatever does not fit; this says which point must survive that crop.
 *
 * 50 is the centre, which is what `cover` anchored at before this existed -
 * so an omitted value leaves the image rendering exactly as it does today.
 */
const focalPercent = z
  .number()
  .int('Focal point must be a whole percentage')
  .min(0, 'Focal point must be between 0 and 100')
  .max(100, 'Focal point must be between 0 and 100');

export const createProductSchema = z.object({
  category_id: z.string().uuid('category_id must be a valid UUID'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(255),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRegex, 'Slug must contain only lowercase alphanumeric characters and hyphens')
    .max(255)
    .optional(),
  sku: z.string().trim().min(3, 'SKU must be at least 3 characters').max(64),
  barcode: z.string().trim().max(64).nullable().optional(),
  unit: z.string().trim().min(1, 'Unit is required').max(32),
  pack_size: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  image_url: z.string().trim().url('Must be a valid URL').nullable().optional(),
  image_focal_x: focalPercent.default(50).optional(),
  image_focal_y: focalPercent.default(50).optional(),
  // products.purchase_cost is NUMERIC(10,2) and custom_markup_percent
  // NUMERIC(5,2): anything larger was a Postgres overflow (a 500).
  purchase_cost: z
    .number()
    .min(0, 'Purchase cost cannot be negative')
    .max(99_999_999.99, 'Purchase cost cannot exceed 99,999,999.99'),
  custom_markup_percent: z
    .number()
    .min(0, 'Markup cannot be negative')
    .max(999.99, 'Markup cannot exceed 999.99%')
    .nullable()
    .optional(),
  is_available: z.boolean().default(true).optional(),
  is_active: z.boolean().default(true).optional(),
  // Migration 031 (owner, 2026-10-09): the product on offer at a reduced
  // price; null removes the offer. That it is below the selling price, and a
  // new end date in the future, is checked by the service (catalog.offers.ts).
  offer_price: z
    .number({ invalid_type_error: 'Offer price must be a number' })
    .positive('Offer price must be above 0')
    .max(99_999_999.99, 'Offer price cannot exceed 99,999,999.99')
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Offer price can have at most 2 decimals')
    .nullable()
    .optional(),
  offer_ends_at: z
    .string()
    .datetime({ offset: true, message: 'Offer end must be a date and time, e.g. 2026-10-31T23:59:59+05:30' })
    .nullable()
    .optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ----------------------------------------------------------------------------
// 4. DELETE (migration 017)
// ----------------------------------------------------------------------------
export const idParamSchema = z.object({
  id: z.string().uuid('Invalid id'),
});

/**
 * GET /admin/products query. A non-numeric page/limit falls back to the
 * default (it used to reach SQL as NaN, a 500); a malformed category_id is 400.
 */
const intOr = (fallback: number) =>
  z.preprocess((val) => {
    const n = typeof val === 'string' ? parseInt(val, 10) : typeof val === 'number' ? val : NaN;
    return Number.isFinite(n) ? n : fallback;
  }, z.number().int());

export const adminProductListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category_id: z.string().uuid('category_id must be a category id').optional(),
  is_active: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '1' ? 'true' : v === '0' ? 'false' : v)),
  limit: intOr(50).optional(),
  page: intOr(1).optional(),
});

export const deleteCategoryQuerySchema = z.object({
  move_to_category_id: z
    .preprocess(
      (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
      z.string().uuid('move_to_category_id must be a category id')
    )
    .optional(),
});
