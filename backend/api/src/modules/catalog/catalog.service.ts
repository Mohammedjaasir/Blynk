import { catalogRepository, ProductQueryParams } from './catalog.repository.js';
import { generateUniqueSlug } from './catalog.slugs.js';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateProductInput,
  UpdateProductInput,
  ProductQueryInput,
  COST_REQUIRED_FOR_MARKUP,
  markupWithoutCost,
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
} from './catalog.offers.js';
import {
  countProductsFollowingCategory,
  priceForProduct,
  productsFollowingEachCategory,
  staffPricing,
} from './catalog.pricing.js';
import type { CategoryOfferInput } from './catalog.schema.js';
import {
  customerVariantsFor,
  publicMrp,
  staffStockFor,
  staffVariantsFor,
  variantPriceRange,
  variantSummary,
  UNTRACKED_STOCK,
  type CustomerVariantDto,
  type StaffStock,
} from './catalog.variants.js';
import { earliestDeliveryDay } from '../../utils/store-hours.js';
import { orderingClock } from '../../utils/time.js';

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
  /** The regular price (capped at the MRP); the app strikes it through while an offer is on. */
  selling_price: number;
  /**
   * Migration 048 (owner, 2026-10-14): the MRP, sent ONLY when it is above
   * the price the customer pays right now (offer_price ?? selling_price);
   * null otherwise (no MRP, or the price equals it). The app shows it struck
   * through as "MRP LKR 300". With variants: the cheapest size's.
   */
  mrp: number | null;
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
  /**
   * Can be added to the basket now: switched on and, when its stock is
   * tracked, not sold out (migration 045 - never a count). With variants:
   * at least one variant can be.
   */
  is_available: boolean;
  /**
   * Migration 045 (owner, 2026-10-14). has_variants: the customer must pick a
   * variant (size/pack); the order line then names variant_id. price_min /
   * price_max: what one unit costs right now (offers included) - equal for a
   * product without variants; for one with variants the cheapest and dearest
   * available variant ("LKR 50-350"). For a product with variants
   * selling_price / offer_price describe the cheapest variant.
   */
  has_variants: boolean;
  variant_count: number;
  price_min: number;
  price_max: number;
  /** 0 = same day / as soon as possible; N = delivered from today + N days. */
  delivery_lead_days: number;
  /** 'YYYY-MM-DD' (Colombo) of the first delivery day when delivery_lead_days > 0, else null. */
  earliest_delivery_date: string | null;
  /**
   * Migration 050 (owner, 2026-10-18): show the struck "was" price (offer or
   * MRP) and the saving for this product. Display only; prices are the same.
   */
  show_offer_cut: boolean;
  /** Product page only: the active variants, sold-out ones marked is_available false. */
  variants?: CustomerVariantDto[];
}

type CustomerCatalogRow = Awaited<ReturnType<typeof catalogRepository.findActiveProducts>>[number];

/**
 * The customer-safe product (no cost, markup, pricing source or stock
 * figure). `variants` are this product's active variants when it has any.
 */
function toCustomerProduct(p: CustomerCatalogRow, variants: CustomerVariantDto[] | undefined, withVariants: boolean): CustomerProductDto {
  const selling = Number(Number(p.calculated_selling_price).toFixed(2));
  const own = publicOffer(p, selling);
  const range = p.has_variants ? variantPriceRange(variants ?? []) : null;
  const headline = range?.headline;
  const lead = Number(p.delivery_lead_days ?? 0);
  const ownPrice = own.offer_price ?? selling;
  return {
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
    selling_price: headline ? headline.selling_price : selling,
    ...(headline ? { offer_price: headline.offer_price, offer_ends_at: headline.offer_ends_at, offer_kind: headline.offer_kind } : own),
    mrp: headline ? headline.mrp : publicMrp(p.mrp, ownPrice),
    is_available: p.is_orderable === true,
    has_variants: p.has_variants === true,
    variant_count: variants?.length ?? 0,
    price_min: range ? range.price_min : ownPrice,
    price_max: range ? range.price_max : ownPrice,
    delivery_lead_days: lead,
    earliest_delivery_date: lead > 0 ? earliestDeliveryDay(orderingClock.now(), lead).date : null,
    show_offer_cut: p.show_offer_cut !== false,
    ...(withVariants ? { variants: variants ?? [] } : {}),
  };
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

/**
 * Admin/Operations: a category's offer as stored, plus whether it runs right
 * now (migration 033), and its markup (migration 044; null = parent's, else
 * global) with how many products follow it (markupProducts, when known).
 */
function adminCategoryOffer<T extends { offer_percent: unknown; offer_ends_at: Date | string | null; markup_percent?: unknown }>(
  category: T,
  markupProducts?: number
) {
  const percent = category.offer_percent === null || category.offer_percent === undefined ? null : Number(category.offer_percent);
  return {
    ...category,
    markup_percent: category.markup_percent === null || category.markup_percent === undefined ? null : Number(category.markup_percent),
    ...(markupProducts !== undefined ? { markup_product_count: markupProducts } : {}),
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

/**
 * Migration 045 staff fields: lead time, the product-level stock (tracked,
 * on hand, in open orders, sellable, low/out), and variant count + regular
 * price range (price_min/price_max = the product's own price when it has no
 * variants). Admin/Ops only.
 */
function staffExtras(
  product: { delivery_lead_days?: unknown; has_variants?: unknown; calculated_selling_price: unknown; is_orderable?: unknown },
  stock: StaffStock | undefined,
  variants: Parameters<typeof variantSummary>[0]
) {
  const summary = variantSummary(variants);
  const selling = Number(Number(product.calculated_selling_price).toFixed(2));
  const hasVariants = product.has_variants === true;
  return {
    delivery_lead_days: Number(product.delivery_lead_days ?? 0),
    has_variants: hasVariants,
    is_orderable: product.is_orderable === true,
    variant_count: summary.variant_count,
    active_variant_count: summary.active_variant_count,
    price_min: hasVariants && summary.price_min !== null ? summary.price_min : selling,
    price_max: hasVariants && summary.price_max !== null ? summary.price_max : selling,
    stock: stock ?? { ...UNTRACKED_STOCK },
  };
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
    const [categories, following] = await Promise.all([catalogRepository.findAllCategories(isActive), productsFollowingEachCategory()]);
    return categories.map((c) => adminCategoryOffer(c, following.get(c.id) ?? 0));
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
      markup_percent: input.markup_percent ?? null,
    });

    if (actor && input.markup_percent !== undefined && input.markup_percent !== null) {
      await writeAudit(db, actor, {
        action: 'CATEGORY_MARKUP_SET',
        entityType: 'CATEGORY',
        entityId: created.id,
        newValues: { markup_percent: input.markup_percent },
      });
    }

    if (placement && actor) {
      await writeAudit(db, actor, {
        action: 'CATEGORY_GROUP_ASSIGNED',
        entityType: 'CATEGORY',
        entityId: created.id,
        newValues: { group_id: placement.group_id, group_sort_order: placement.group_sort_order },
      });
    }

    logger.info({ categoryId: created.id, slug: created.slug }, 'Category created by admin');
    return adminCategoryOffer(created, await countProductsFollowingCategory(created.id));
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
      ...(input.markup_percent !== undefined ? { markup_percent: input.markup_percent } : {}),
    });

    // Migration 044: a category markup change reprices every MARKUP product
    // that follows it at once (v_product_catalog). Audited.
    const oldMarkup = existing.markup_percent === null || existing.markup_percent === undefined ? null : Number(existing.markup_percent);
    if (actor && input.markup_percent !== undefined && input.markup_percent !== oldMarkup) {
      await writeAudit(db, actor, {
        action: 'CATEGORY_MARKUP_SET',
        entityType: 'CATEGORY',
        entityId: id,
        oldValues: { markup_percent: oldMarkup },
        newValues: { markup_percent: input.markup_percent },
      });
    }

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
    return updated ? adminCategoryOffer(updated, await countProductsFollowingCategory(id)) : updated;
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

    // Format customer-safe payload: strictly omit purchase_cost & markup
    // figures and stock counts. Migration 045: variant products carry their
    // price range (one read for the whole page).
    const variants = await customerVariantsFor(
      db,
      rawProducts.filter((p) => p.has_variants).map((p) => p.id)
    );
    const products: CustomerProductDto[] = rawProducts.map((p) => toCustomerProduct(p, variants.get(p.id), false));

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

    // Format customer-safe payload: strictly omit purchase_cost & markup
    // figures and stock counts. Migration 045: the variants to pick from.
    const variants = rawProduct.has_variants ? (await customerVariantsFor(db, [rawProduct.id])).get(rawProduct.id) ?? [] : [];
    return toCustomerProduct(rawProduct, variants, true);
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

    // Migration 045: variant count + price range, and the product's stock.
    const ids = rows.map((r) => r.id);
    const [variants, stock] = await Promise.all([
      staffVariantsFor(db, rows.filter((r) => r.has_variants).map((r) => r.id)),
      staffStockFor(db, { productIds: ids }),
    ]);
    return {
      products: rows.map((product) => ({
        ...product,
        image_focal_x: clampFocal(product.image_focal_x),
        image_focal_y: clampFocal(product.image_focal_y),
        // Migration 044: cost, mode, markups, pricing_source, selling price, price_warning.
        ...staffPricing(product),
        ...adminOffer(product),
        ...staffExtras(product, stock.get(product.id), variants.get(product.id)),
      })),
      pagination: { page, limit },
    };
  }

  async getProductByIdAdmin(id: string) {
    const product = await catalogRepository.findProductByIdAdmin(id);
    if (!product) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    }

    const [variants, stock] = await Promise.all([staffVariantsFor(db, [id]), staffStockFor(db, { productIds: [id] })]);
    const list = variants.get(id) ?? [];
    return {
      ...product,
      image_focal_x: clampFocal(product.image_focal_x),
      image_focal_y: clampFocal(product.image_focal_y),
      // Migration 044: cost, mode, markups, pricing_source, selling price, price_warning.
      ...staffPricing(product),
      ...adminOffer(product),
      ...staffExtras(product, stock.get(id), list),
      // Migration 045: every live variant (inactive ones too) with cost, pricing and stock.
      variants: list,
    };
  }

  async createProductAdmin(input: CreateProductInput) {
    // 1. Verify category exists
    const category = await catalogRepository.findCategoryById(input.category_id);
    if (!category) {
      throw new AppError('Specified category does not exist.', 400, 'CATEGORY_NOT_FOUND');
    }

    // 2. Verify SKU uniqueness (migration 045: variant SKUs too)
    const skuConflict = (await catalogRepository.findProductBySku(input.sku)) ?? (await catalogRepository.findVariantBySku(input.sku));
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
    // The selling price follows the migration 044 rule (fixed, or cost x
    // custom/category/parent/global markup).
    const pricingMode = input.pricing_mode ?? 'MARKUP';
    const offerPrice = input.offer_price ?? null;
    if (offerPrice !== null) {
      const price = await priceForProduct({
        categoryId: input.category_id,
        purchaseCost: input.purchase_cost ?? 0,
        pricingMode,
        fixedSellingPrice: input.fixed_selling_price ?? null,
        customMarkupPercent: input.custom_markup_percent ?? null,
        mrp: input.mrp ?? null,
      });
      assertOfferAllowed({
        offerPrice,
        sellingPrice: price.sellingPrice,
        endsAt: input.offer_ends_at ?? null,
        endsAtChanged: true,
        mrpCapped: price.mrpCapped,
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
      // Owner, 2026-10-21: no cost price yet = 0 (a FIXED product only).
      purchase_cost: input.purchase_cost ?? 0,
      custom_markup_percent: input.custom_markup_percent,
      pricing_mode: pricingMode,
      fixed_selling_price: input.fixed_selling_price ?? null,
      mrp: input.mrp ?? null,
      is_available: input.is_available ?? true,
      is_active: input.is_active ?? true,
      delivery_lead_days: input.delivery_lead_days ?? 0,
      offer_price: offerPrice,
      // No offer, no end date.
      offer_ends_at: offerPrice === null ? null : input.offer_ends_at ?? null,
      show_offer_cut: input.show_offer_cut ?? true,
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
      const skuConflict = (await catalogRepository.findProductBySku(input.sku)) ?? (await catalogRepository.findVariantBySku(input.sku));
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
    // Migration 044: the pricing after this edit (fixed price, or cost x
    // custom/category/parent/global markup in the product's new category).
    const pricingMode = input.pricing_mode ?? existing.pricing_mode ?? 'MARKUP';
    const fixedSellingPrice =
      input.fixed_selling_price !== undefined
        ? input.fixed_selling_price
        : existing.fixed_selling_price === null || existing.fixed_selling_price === undefined
          ? null
          : Number(existing.fixed_selling_price);
    if (pricingMode === 'FIXED' && fixedSellingPrice === null) {
      throw new AppError('Enter the selling price for a fixed-price product.', 400, 'FIXED_PRICE_REQUIRED', {
        field: 'fixed_selling_price',
      });
    }
    // Owner, 2026-10-21: no cost price yet is fine, but only at a fixed price
    // (cost x markup would be 0). Checked when the pricing is edited, so other
    // edits of an older row (availability, offer, name...) still work.
    if (
      (input.purchase_cost !== undefined || input.pricing_mode !== undefined || input.custom_markup_percent !== undefined) &&
      markupWithoutCost(pricingMode, input.purchase_cost ?? Number(existing.purchase_cost))
    ) {
      throw new AppError(COST_REQUIRED_FOR_MARKUP, 400, 'PURCHASE_COST_REQUIRED', { field: 'purchase_cost' });
    }
    const costTouched =
      input.purchase_cost !== undefined ||
      input.custom_markup_percent !== undefined ||
      input.pricing_mode !== undefined ||
      input.fixed_selling_price !== undefined ||
      // Migration 048: a lower MRP can push the (capped) price under the offer.
      input.mrp !== undefined ||
      (input.category_id !== undefined && input.category_id !== existing.category_id);
    if (offerPrice !== null && (input.offer_price !== undefined || costTouched || endsAtChanged)) {
      const after = costTouched
        ? await priceForProduct({
              categoryId: input.category_id ?? existing.category_id,
              purchaseCost: input.purchase_cost ?? Number(existing.purchase_cost),
              pricingMode,
              fixedSellingPrice,
              customMarkupPercent:
                input.custom_markup_percent !== undefined
                  ? input.custom_markup_percent
                  : existing.custom_markup_percent === null
                    ? null
                    : Number(existing.custom_markup_percent),
              mrp: input.mrp !== undefined ? input.mrp : existing.mrp === null || existing.mrp === undefined ? null : Number(existing.mrp),
            })
        : { sellingPrice: Number(Number(existing.calculated_selling_price).toFixed(2)), mrpCapped: existing.mrp_capped === true };
      assertOfferAllowed({ offerPrice, sellingPrice: after.sellingPrice, endsAt: offerEnds, endsAtChanged, mrpCapped: after.mrpCapped });
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
      ...(input.pricing_mode !== undefined ? { pricing_mode: input.pricing_mode } : {}),
      ...(input.fixed_selling_price !== undefined ? { fixed_selling_price: input.fixed_selling_price } : {}),
      ...(input.mrp !== undefined ? { mrp: input.mrp } : {}),
      ...(input.is_available !== undefined ? { is_available: input.is_available } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
      ...(input.delivery_lead_days !== undefined ? { delivery_lead_days: input.delivery_lead_days } : {}),
      ...(offerChanged ? { offer_price: offerPrice, offer_ends_at: offerEnds } : {}),
      ...(input.show_offer_cut !== undefined ? { show_offer_cut: input.show_offer_cut } : {}),
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
