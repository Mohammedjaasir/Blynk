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
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ----------------------------------------------------------------------------
// 3. PRODUCT ADMIN SCHEMAS
// ----------------------------------------------------------------------------
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
  purchase_cost: z.number().min(0, 'Purchase cost cannot be negative'),
  custom_markup_percent: z
    .number()
    .min(0, 'Markup cannot be negative')
    .max(1000, 'Markup cannot exceed 1000%')
    .nullable()
    .optional(),
  is_available: z.boolean().default(true).optional(),
  is_active: z.boolean().default(true).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
