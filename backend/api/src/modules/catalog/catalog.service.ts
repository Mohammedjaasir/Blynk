import { catalogRepository, ProductQueryParams } from './catalog.repository.js';
import { generateUniqueSlug } from './catalog.slugs.js';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateProductInput,
  UpdateProductInput,
  ProductQueryInput,
} from './catalog.schema.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { releaseStockAlertsNow } from '../notifications/push/push.events.js';
import { db } from '../../database/connection.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { resolveGroupPlacement } from './catalog.groups.js';

export interface CustomerProductDto {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  /**
   * Where the crop anchors when the app draws this photo into a fixed shape
   * (migration 009), as a percentage of the image's own width and height.
   * Always present and always 0-100; 50/50 is the centre, which is what the
   * app cropped at before the field existed.
   */
  image_focal_x: number;
  image_focal_y: number;
  selling_price: number;
  is_available: boolean;
}

/**
 * Normalises a stored focal percentage into the 0-100 the API promises.
 *
 * The column is `SMALLINT NOT NULL DEFAULT 50` with a `BETWEEN 0 AND 100`
 * CHECK, so this can only matter for a row written before migration 009 was
 * applied to a given database - and the answer there is the same 50 the
 * column defaults to, which is the centre crop the app already did.
 */
function clampFocal(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export class CatalogService {
  // --------------------------------------------------------------------------
  // CATEGORIES (CUSTOMER)
  // --------------------------------------------------------------------------

  async listCategories() {
    const categories = await catalogRepository.findActiveCategories();
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      image_url: c.image_url,
      display_order: c.display_order,
      image_focal_x: clampFocal(c.image_focal_x),
      image_focal_y: clampFocal(c.image_focal_y),
      parent_id: c.parent_id ?? null,
    }));
  }

  /**
   * Migration 026: checks a category's new parent. One level only - the
   * parent must be a live top-level category, a category cannot be its own
   * parent, and a category that has sub-categories cannot go inside another.
   */
  private async assertParentAllowed(parentId: string, categoryId?: string) {
    if (categoryId && parentId === categoryId) {
      throw new AppError('A category cannot be inside itself.', 400, 'INVALID_PARENT_CATEGORY');
    }
    const parent = await catalogRepository.findCategoryById(parentId);
    if (!parent) {
      throw new AppError('The chosen parent category does not exist.', 400, 'PARENT_CATEGORY_NOT_FOUND');
    }
    if (parent.parent_id) {
      throw new AppError(
        `'${parent.name}' is already inside another category. Sub-categories go one level deep only.`,
        400,
        'INVALID_PARENT_CATEGORY'
      );
    }
    if (categoryId && (await catalogRepository.countChildCategories(categoryId)) > 0) {
      throw new AppError(
        'This category has its own sub-categories, so it cannot go inside another category.',
        400,
        'INVALID_PARENT_CATEGORY'
      );
    }
  }

  // --------------------------------------------------------------------------
  // CATEGORIES (ADMIN)
  // --------------------------------------------------------------------------

  async listCategoriesAdmin(isActive?: boolean) {
    return await catalogRepository.findAllCategories(isActive);
  }

  async createCategoryAdmin(input: CreateCategoryInput, actor?: AuditActor) {
    // A slug the client chose and is taken stays a 409; a generated one is
    // always made unique (and never empty for Sinhala/Tamil names).
    let slug: string;
    if (input.slug) {
      slug = input.slug.toLowerCase().trim();
      const existing = await catalogRepository.findCategoryBySlug(slug);
      if (existing) {
        throw new AppError(
          `Category with slug '${slug}' already exists.`,
          409,
          'CATEGORY_SLUG_EXISTS'
        );
      }
    } else {
      slug = await generateUniqueSlug(input.name, 'category', async (s) => !!(await catalogRepository.findCategoryBySlug(s)), 128);
    }

    if (input.parent_id) await this.assertParentAllowed(input.parent_id);

    // Migration 025: optional home-screen group, appended at its end unless a
    // position is given.
    const placement =
      input.group_id !== undefined && input.group_id !== null
        ? await resolveGroupPlacement(db, input.group_id, input.group_sort_order)
        : null;

    const created = await catalogRepository.createCategory({
      ...(placement ?? {}),
      name: input.name,
      slug,
      description: input.description,
      image_url: input.image_url,
      display_order: input.display_order ?? 0,
      is_active: input.is_active ?? true,
      image_focal_x: input.image_focal_x,
      image_focal_y: input.image_focal_y,
      parent_id: input.parent_id ?? null,
    });

    if (placement && actor) {
      await writeAudit(db, actor, {
        action: 'CATEGORY_GROUP_ASSIGNED',
        entityType: 'CATEGORY',
        entityId: created.id,
        newValues: { group_id: placement.group_id, group_sort_order: placement.group_sort_order },
      });
    }

    logger.info({ categoryId: created.id, slug: created.slug }, 'Category created by admin');
    return created;
  }

  async updateCategoryAdmin(id: string, input: UpdateCategoryInput, actor?: AuditActor) {
    const existing = await catalogRepository.findCategoryById(id);
    if (!existing) {
      throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    }

    if (input.slug && input.slug !== existing.slug) {
      const slugConflict = await catalogRepository.findCategoryBySlug(input.slug);
      if (slugConflict && slugConflict.id !== id) {
        throw new AppError(
          `Category with slug '${input.slug}' already exists.`,
          409,
          'CATEGORY_SLUG_EXISTS'
        );
      }
    }

    if (input.parent_id && input.parent_id !== existing.parent_id) {
      await this.assertParentAllowed(input.parent_id, id);
    }

    // Migration 025: moving to another group (or out of one) appends at the
    // end unless a position is given; a position alone reorders in place.
    let placement: { group_id: string | null; group_sort_order: number } | null = null;
    if (input.group_id !== undefined) {
      const sameGroup = input.group_id === existing.group_id;
      placement = await resolveGroupPlacement(
        db,
        input.group_id,
        input.group_sort_order ?? (sameGroup && input.group_id !== null ? existing.group_sort_order : undefined),
        id
      );
    } else if (input.group_sort_order !== undefined) {
      placement = { group_id: existing.group_id, group_sort_order: input.group_sort_order };
    }

    const updated = await catalogRepository.updateCategory(id, {
      ...(placement ?? {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug.toLowerCase().trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.image_url !== undefined ? { image_url: input.image_url } : {}),
      ...(input.display_order !== undefined ? { display_order: input.display_order } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
      ...(input.image_focal_x !== undefined ? { image_focal_x: input.image_focal_x } : {}),
      ...(input.image_focal_y !== undefined ? { image_focal_y: input.image_focal_y } : {}),
      ...(input.parent_id !== undefined ? { parent_id: input.parent_id } : {}),
    });

    if (
      placement &&
      actor &&
      (placement.group_id !== existing.group_id || placement.group_sort_order !== existing.group_sort_order)
    ) {
      await writeAudit(db, actor, {
        action: 'CATEGORY_GROUP_ASSIGNED',
        entityType: 'CATEGORY',
        entityId: id,
        oldValues: { group_id: existing.group_id, group_sort_order: existing.group_sort_order },
        newValues: { group_id: placement.group_id, group_sort_order: placement.group_sort_order },
      });
    }

    logger.info({ categoryId: id }, 'Category updated by admin');
    return updated;
  }

  // --------------------------------------------------------------------------
  // PRODUCTS (CUSTOMER)
  // --------------------------------------------------------------------------

  async listProducts(query: ProductQueryInput) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    const queryParams: ProductQueryParams = {
      category_id: query.category_id,
      category_slug: query.category_slug,
      search: query.search,
      is_available: query.is_available,
      limit,
      offset,
    };

    const [rawProducts, totalCount] = await Promise.all([
      catalogRepository.findActiveProducts(queryParams),
      catalogRepository.countActiveProducts(queryParams),
    ]);

    // Format customer-safe payload: strictly omit purchase_cost & markup figures
    const products: CustomerProductDto[] = rawProducts.map((p) => ({
      id: p.id,
      category_id: p.category_id,
      category_name: p.category_name,
      name: p.name,
      slug: p.slug,
      description: p.description,
      sku: p.sku,
      barcode: p.barcode,
      unit: p.unit,
      pack_size: p.pack_size,
      image_url: p.image_url,
      image_focal_x: clampFocal(p.image_focal_x),
      image_focal_y: clampFocal(p.image_focal_y),
      selling_price: Number(Number(p.calculated_selling_price).toFixed(2)),
      is_available: p.is_available,
    }));

    return {
      products,
      pagination: {
        page,
        limit,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limit) || 1,
      },
    };
  }

  async getProductById(idOrSlug: string): Promise<CustomerProductDto> {
    const rawProduct = await catalogRepository.findActiveProductById(idOrSlug);

    if (!rawProduct) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    }

    // Format customer-safe payload: strictly omit purchase_cost & markup figures
    return {
      id: rawProduct.id,
      category_id: rawProduct.category_id,
      category_name: rawProduct.category_name,
      name: rawProduct.name,
      slug: rawProduct.slug,
      description: rawProduct.description,
      sku: rawProduct.sku,
      barcode: rawProduct.barcode,
      unit: rawProduct.unit,
      pack_size: rawProduct.pack_size,
      image_url: rawProduct.image_url,
      image_focal_x: clampFocal(rawProduct.image_focal_x),
      image_focal_y: clampFocal(rawProduct.image_focal_y),
      selling_price: Number(Number(rawProduct.calculated_selling_price).toFixed(2)),
      is_available: rawProduct.is_available,
    };
  }

  // --------------------------------------------------------------------------
  // PRODUCTS (ADMIN)
  // --------------------------------------------------------------------------

  /**
   * Admin product listing. Same numeric normalization as
   * getProductByIdAdmin, and it deliberately includes inactive products so
   * operations can see and re-enable them.
   */
  async listProductsAdmin(params: {
    search?: string;
    category_id?: string;
    is_active?: boolean;
    limit?: number;
    page?: number;
  }) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const page = Math.max(params.page ?? 1, 1);

    const rows = await catalogRepository.findAllProductsAdmin({
      search: params.search,
      category_id: params.category_id,
      is_active: params.is_active,
      limit,
      offset: (page - 1) * limit,
    });

    return {
      products: rows.map((product) => ({
        ...product,
        image_focal_x: clampFocal(product.image_focal_x),
        image_focal_y: clampFocal(product.image_focal_y),
        purchase_cost: Number(Number(product.purchase_cost).toFixed(2)),
        custom_markup_percent:
          product.custom_markup_percent !== null
            ? Number(product.custom_markup_percent)
            : null,
        effective_markup_percent: Number(
          Number(product.effective_markup_percent).toFixed(2)
        ),
        calculated_selling_price: Number(
          Number(product.calculated_selling_price).toFixed(2)
        ),
      })),
      pagination: { page, limit },
    };
  }

  async getProductByIdAdmin(id: string) {
    const product = await catalogRepository.findProductByIdAdmin(id);
    if (!product) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    }

    return {
      ...product,
      image_focal_x: clampFocal(product.image_focal_x),
      image_focal_y: clampFocal(product.image_focal_y),
      purchase_cost: Number(Number(product.purchase_cost).toFixed(2)),
      custom_markup_percent:
        product.custom_markup_percent !== null ? Number(product.custom_markup_percent) : null,
      effective_markup_percent: Number(Number(product.effective_markup_percent).toFixed(2)),
      calculated_selling_price: Number(Number(product.calculated_selling_price).toFixed(2)),
    };
  }

  async createProductAdmin(input: CreateProductInput) {
    // 1. Verify category exists
    const category = await catalogRepository.findCategoryById(input.category_id);
    if (!category) {
      throw new AppError('Specified category does not exist.', 400, 'CATEGORY_NOT_FOUND');
    }

    // 2. Verify SKU uniqueness
    const skuConflict = await catalogRepository.findProductBySku(input.sku);
    if (skuConflict) {
      throw new AppError(
        `Product with SKU '${input.sku}' already exists.`,
        409,
        'PRODUCT_SKU_EXISTS'
      );
    }

    // 3. Resolve slug
    // As for categories: only an explicitly chosen, taken slug is a 409.
    let slug: string;
    if (input.slug) {
      slug = input.slug.toLowerCase().trim();
      const slugConflict = await catalogRepository.findProductBySlug(slug);
      if (slugConflict) {
        throw new AppError(
          `Product with slug '${slug}' already exists.`,
          409,
          'PRODUCT_SLUG_EXISTS'
        );
      }
    } else {
      slug = await generateUniqueSlug(input.name, 'product', async (s) => !!(await catalogRepository.findProductBySlug(s)), 255);
    }

    // 4. Create record
    const created = await catalogRepository.createProduct({
      category_id: input.category_id,
      name: input.name,
      slug,
      sku: input.sku,
      barcode: input.barcode,
      unit: input.unit,
      pack_size: input.pack_size,
      description: input.description,
      image_url: input.image_url,
      // Omitted means centre (50/50) - identical to how every image was
      // cropped before migration 009.
      image_focal_x: input.image_focal_x ?? 50,
      image_focal_y: input.image_focal_y ?? 50,
      purchase_cost: input.purchase_cost,
      custom_markup_percent: input.custom_markup_percent,
      is_available: input.is_available ?? true,
      is_active: input.is_active ?? true,
    });

    logger.info({ productId: created.id, sku: created.sku }, 'Product created by admin');

    // Return complete view with calculated pricing
    return await this.getProductByIdAdmin(created.id);
  }

  async updateProductAdmin(id: string, input: UpdateProductInput) {
    // 1. Verify product exists
    const existing = await catalogRepository.findProductByIdAdmin(id);
    if (!existing) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    }

    // 2. If category_id changed, verify new category exists
    if (input.category_id && input.category_id !== existing.category_id) {
      const category = await catalogRepository.findCategoryById(input.category_id);
      if (!category) {
        throw new AppError('Specified category does not exist.', 400, 'CATEGORY_NOT_FOUND');
      }
    }

    // 3. If SKU changed, verify uniqueness
    if (input.sku && input.sku !== existing.sku) {
      const skuConflict = await catalogRepository.findProductBySku(input.sku);
      if (skuConflict && skuConflict.id !== id) {
        throw new AppError(
          `Product with SKU '${input.sku}' already exists.`,
          409,
          'PRODUCT_SKU_EXISTS'
        );
      }
    }

    // 4. If slug changed, verify uniqueness
    if (input.slug && input.slug !== existing.slug) {
      const slugConflict = await catalogRepository.findProductBySlug(input.slug);
      if (slugConflict && slugConflict.id !== id) {
        throw new AppError(
          `Product with slug '${input.slug}' already exists.`,
          409,
          'PRODUCT_SLUG_EXISTS'
        );
      }
    }

    await catalogRepository.updateProduct(id, {
      ...(input.category_id !== undefined ? { category_id: input.category_id } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug.toLowerCase().trim() } : {}),
      ...(input.sku !== undefined ? { sku: input.sku } : {}),
      ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.pack_size !== undefined ? { pack_size: input.pack_size } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.image_url !== undefined ? { image_url: input.image_url } : {}),
      ...(input.image_focal_x !== undefined ? { image_focal_x: input.image_focal_x } : {}),
      ...(input.image_focal_y !== undefined ? { image_focal_y: input.image_focal_y } : {}),
      ...(input.purchase_cost !== undefined ? { purchase_cost: input.purchase_cost } : {}),
      ...(input.custom_markup_percent !== undefined
        ? { custom_markup_percent: input.custom_markup_percent }
        : {}),
      ...(input.is_available !== undefined ? { is_available: input.is_available } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    });

    logger.info({ productId: id }, 'Product updated by admin');

    // Back in stock (phase 6): switched back on for customers -> tell the
    // customers who asked. After the update commits; never fails the edit.
    const wasAvailable = existing.is_active && existing.is_available;
    const isAvailable = (input.is_active ?? existing.is_active) && (input.is_available ?? existing.is_available);
    if (!wasAvailable && isAvailable) await releaseStockAlertsNow(id);

    // Return complete updated view with recalculated pricing
    return await this.getProductByIdAdmin(id);
  }
}

export const catalogService = new CatalogService();
