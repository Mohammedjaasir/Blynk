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
import {
  activeCategoryOffer,
  activeOfferPrice,
  assertCategoryOfferAllowed,
  assertOfferAllowed,
  publicOffer,
  sellingPriceFor,
} from './catalog.offers.js';
import type { CategoryOfferInput } from './catalog.schema.js';

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
  /** The regular price; the app strikes it through while an offer is on. */
  selling_price: number;
  /**
   * Migration 031 (owner, 2026-10-09): the price charged while the product
   * is on offer. Both fields are null unless the offer is active right now.
   */
  offer_price: number | null;
  offer_ends_at: string | null;
  /**
   * Migration 033: which offer offer_price is - the product's own price or
   * its category's % (the lower of the two wins); null without an offer.
   */
  offer_kind: 'PRODUCT' | 'CATEGORY' | null;
  is_available: boolean;
}

/** Admin/Operations: the offer as stored, plus whether it applies right now. */
function adminOffer(product: {
  offer_price: unknown;
  offer_ends_at: Date | string | null;
  calculated_selling_price: unknown;
  category_offer_percent?: unknown;
  category_offer_ends_at?: Date | string | null;
}) {
  const selling = Number(Number(product.calculated_selling_price).toFixed(2));
  const offerPrice = product.offer_price === null || product.offer_price === undefined ? null : Number(product.offer_price);
  const categoryPercent =
    product.category_offer_percent === null || product.category_offer_percent === undefined ? null : Number(product.category_offer_percent);
  return {
    offer_price: offerPrice,
    offer_ends_at: product.offer_ends_at ? new Date(product.offer_ends_at).toISOString() : null,
    offer_active: activeOfferPrice({ offer_price: offerPrice, offer_ends_at: product.offer_ends_at }, selling) !== null,
    // Migration 033: the category offer running on this product (own category or parent), if any.
    category_offer_percent: categoryPercent,
    category_offer_ends_at: product.category_offer_ends_at ? new Date(product.category_offer_ends_at).toISOString() : null,
    // What a customer pays right now: the lower of the two offers (catalog.offers bestOffer).
    customer_price: publicOffer(
      { offer_price: offerPrice, offer_ends_at: product.offer_ends_at, category_offer_percent: categoryPercent, category_offer_ends_at: product.category_offer_ends_at ?? null },
      selling
    ).offer_price ?? selling,
  };
}

/** Admin/Operations: a category's offer as stored, plus whether it runs right now (migration 033). */
function adminCategoryOffer<T extends { offer_percent: unknown; offer_ends_at: Date | string | null }>(category: T) {
  const percent = category.offer_percent === null || category.offer_percent === undefined ? null : Number(category.offer_percent);
  return {
    ...category,
    offer_percent: percent,
    offer_ends_at: category.offer_ends_at ? new Date(category.offer_ends_at).toISOString() : null,
    offer_active: activeCategoryOffer({ offer_percent: percent, offer_ends_at: category.offer_ends_at }).offer_percent !== null,
  };
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
    // Migration 033: a category shows the larger running offer of its own and
    // its parent's - the same one its products get (v_product_catalog).
    const own = new Map(categories.map((c) => [c.id, activeCategoryOffer(c)]));
    const offerOf = (c: (typeof categories)[number]) => {
      const mine = own.get(c.id)!;
      const parent = c.parent_id ? own.get(c.parent_id) : undefined;
      if (parent?.offer_percent != null && (mine.offer_percent == null || parent.offer_percent > mine.offer_percent)) return parent;
      return mine;
    };
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
      ...offerOf(c),
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
    return (await catalogRepository.findAllCategories(isActive)).map(adminCategoryOffer);
  }

  /**
   * PUT /admin/categories/:id/offer (migration 033; owner, 2026-10-09): % off
   * everything in the category and its sub-categories, optionally until a
   * date. Replaces any offer already on the category. Audited.
   */
  async setCategoryOffer(id: string, input: CategoryOfferInput, actor?: AuditActor) {
    const existing = await catalogRepository.findCategoryById(id);
    if (!existing) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    const existingEnds = existing.offer_ends_at ? new Date(existing.offer_ends_at).toISOString() : null;
    const endsAt = input.offer_ends_at ?? null;
    assertCategoryOfferAllowed({
      percent: input.offer_percent,
      endsAt,
      endsAtChanged: endsAt === null ? false : new Date(endsAt).toISOString() !== existingEnds,
    });
    await catalogRepository.updateCategory(id, { offer_percent: input.offer_percent, offer_ends_at: endsAt });
    if (actor) {
      await writeAudit(db, actor, {
        action: 'CATEGORY_OFFER_SET',
        entityType: 'CATEGORY',
        entityId: id,
        oldValues: { offer_percent: existing.offer_percent === null ? null : Number(existing.offer_percent), offer_ends_at: existingEnds },
        newValues: { offer_percent: input.offer_percent, offer_ends_at: endsAt ? new Date(endsAt).toISOString() : null },
      });
    }
    logger.info({ categoryId: id, percent: input.offer_percent }, 'Category offer set');
    return adminCategoryOffer((await catalogRepository.findCategoryById(id))!);
  }

  /** DELETE /admin/categories/:id/offer: the category's products go back to their own prices. Audited. */
  async removeCategoryOffer(id: string, actor?: AuditActor) {
    const existing = await catalogRepository.findCategoryById(id);
    if (!existing) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    if (existing.offer_percent !== null) {
      await catalogRepository.updateCategory(id, { offer_percent: null, offer_ends_at: null });
      if (actor) {
        await writeAudit(db, actor, {
          action: 'CATEGORY_OFFER_REMOVED',
          entityType: 'CATEGORY',
          entityId: id,
          oldValues: {
            offer_percent: Number(existing.offer_percent),
            offer_ends_at: existing.offer_ends_at ? new Date(existing.offer_ends_at).toISOString() : null,
          },
        });
      }
    }
    return adminCategoryOffer((await catalogRepository.findCategoryById(id))!);
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
    return adminCategoryOffer(created);
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
    return updated ? adminCategoryOffer(updated) : updated;
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
      on_offer: query.on_offer,
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
      ...publicOffer(p, Number(Number(p.calculated_selling_price).toFixed(2))),
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
      ...publicOffer(rawProduct, Number(Number(rawProduct.calculated_selling_price).toFixed(2))),
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
        ...adminOffer(product),
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
      ...adminOffer(product),
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

    // 3b. Offer (migration 031): below the selling price, ending in the future.
    const offerPrice = input.offer_price ?? null;
    if (offerPrice !== null) {
      assertOfferAllowed({
        offerPrice,
        sellingPrice: await sellingPriceFor(input.purchase_cost, input.custom_markup_percent ?? null),
        endsAt: input.offer_ends_at ?? null,
        endsAtChanged: true,
      });
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
      offer_price: offerPrice,
      // No offer, no end date.
      offer_ends_at: offerPrice === null ? null : input.offer_ends_at ?? null,
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

    // 5. Offer (migration 031; owner, 2026-10-09). Checked whenever the
    // offer, the cost or the markup changes and an offer remains: the offer
    // must stay below the selling price after this edit. Removing the offer
    // (offer_price null) also clears its end date.
    const offerPrice =
      input.offer_price !== undefined
        ? input.offer_price
        : existing.offer_price === null
          ? null
          : Number(existing.offer_price);
    const existingEnds = existing.offer_ends_at ? new Date(existing.offer_ends_at).toISOString() : null;
    const requestedEnds = input.offer_ends_at !== undefined ? input.offer_ends_at : existingEnds;
    const offerEnds = offerPrice === null ? null : requestedEnds;
    const endsAtChanged =
      input.offer_ends_at !== undefined &&
      (input.offer_ends_at === null ? existingEnds !== null : new Date(input.offer_ends_at).toISOString() !== existingEnds);
    const costTouched = input.purchase_cost !== undefined || input.custom_markup_percent !== undefined;
    if (offerPrice !== null && (input.offer_price !== undefined || costTouched || endsAtChanged)) {
      const sellingPrice = costTouched
        ? await sellingPriceFor(
            input.purchase_cost ?? Number(existing.purchase_cost),
            input.custom_markup_percent !== undefined
              ? input.custom_markup_percent
              : existing.custom_markup_percent === null
                ? null
                : Number(existing.custom_markup_percent)
          )
        : Number(Number(existing.calculated_selling_price).toFixed(2));
      assertOfferAllowed({ offerPrice, sellingPrice, endsAt: offerEnds, endsAtChanged });
    }
    const offerChanged = input.offer_price !== undefined || input.offer_ends_at !== undefined;

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
      ...(offerChanged ? { offer_price: offerPrice, offer_ends_at: offerEnds } : {}),
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
