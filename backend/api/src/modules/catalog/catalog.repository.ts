import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { activeOfferWhere } from './catalog.offers.js';

export interface ProductQueryParams {
  category_id?: string;
  category_slug?: string;
  search?: string;
  is_available?: boolean;
  /** Migration 031: only products with an active offer. */
  on_offer?: boolean;
  limit: number;
  offset: number;
}

/**
 * Migration 026: a category and its live sub-categories, so a parent's
 * listing includes its children's products. One level only, so one hop.
 */
function categoryIdsForSlug(slug: string) {
  return db
    .selectFrom('categories')
    .select('id')
    .where('deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('slug', '=', slug),
        eb(
          'parent_id',
          'in',
          eb.selectFrom('categories as p').select('p.id').where('p.slug', '=', slug).where('p.deleted_at', 'is', null)
        ),
      ])
    );
}

/**
 * Migration 050: the per-product struck-price switch, read off products (the views don't carry it).
 * Coolify runs migrations by hand, so the column may not exist yet when this code is live: until
 * it does, every product reads as "on" (today's behaviour) and the switch is not written. Checked
 * once a minute until found, then cached - running the migration turns it on without a restart.
 */
let offerCutColumn: { ok: boolean; at: number } | null = null;
export async function hasOfferCutColumn(): Promise<boolean> {
  if (offerCutColumn && (offerCutColumn.ok || Date.now() - offerCutColumn.at < 60_000)) return offerCutColumn.ok;
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'show_offer_cut'`.execute(db);
  offerCutColumn = { ok: (r.rows[0]?.n ?? 0) > 0, at: Date.now() };
  return offerCutColumn.ok;
}
const showOfferCut = (ok: boolean) =>
  ok
    ? sql<boolean>`(SELECT p.show_offer_cut FROM products p WHERE p.id = v_product_catalog.id)`.as('show_offer_cut')
    : sql<boolean>`true`.as('show_offer_cut');
const staffShowOfferCut = (ok: boolean) =>
  ok ? sql<boolean>`products.show_offer_cut`.as('show_offer_cut') : sql<boolean>`true`.as('show_offer_cut');

function categoryIdsForId(id: string) {
  return db
    .selectFrom('categories')
    .select('id')
    .where('deleted_at', 'is', null)
    .where((eb) => eb.or([eb('id', '=', id), eb('parent_id', '=', id)]));
}

export class CatalogRepository {
  // --------------------------------------------------------------------------
  // CATEGORIES
  // --------------------------------------------------------------------------

  /**
   * Retrieves all active categories ordered by display_order ASC, name ASC.
   */
  async findActiveCategories() {
    return await db
      .selectFrom('categories')
      .select([
        'id',
        'name',
        'slug',
        'description',
        'image_url',
        'display_order',
        'is_active',
        'image_focal_x',
        'image_focal_y',
        'parent_id',
        // Migration 033: the category offer (raw; catalog.offers decides if it runs).
        'offer_percent',
        'offer_ends_at',
      ])
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('display_order', 'asc')
      .orderBy('name', 'asc')
      .execute();
  }

  /**
   * Admin: Retrieves all categories with optional active status filter.
   */
  async findAllCategories(isActive?: boolean) {
    let query = db
      .selectFrom('categories')
      .selectAll('categories')
      // Live products in the category, so a delete can say up front how many
      // must move (migration 017). Soft-deleted products are not counted.
      .select((eb) =>
        eb
          .selectFrom('products')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('products.category_id', '=', 'categories.id')
          .where('products.deleted_at', 'is', null)
          .as('product_count')
      )
      .where('categories.deleted_at', 'is', null)
      .orderBy('display_order', 'asc')
      .orderBy('name', 'asc');

    if (isActive !== undefined) {
      query = query.where('categories.is_active', '=', isActive);
    }

    const rows = await query.execute();
    return rows.map((row) => ({ ...row, product_count: Number(row.product_count ?? 0) }));
  }

  /**
   * Finds a category by its primary key UUID.
   */
  async findCategoryById(id: string) {
    return await db
      .selectFrom('categories')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Finds a category by its unique URL slug.
   */
  async findCategoryBySlug(slug: string) {
    return await db
      .selectFrom('categories')
      .selectAll()
      .where('slug', '=', slug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Migration 026: how many live sub-categories sit inside this category. */
  async countChildCategories(id: string): Promise<number> {
    const row = await db
      .selectFrom('categories')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('parent_id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /**
   * Admin: Creates a new category.
   */
  async createCategory(data: {
    name: string;
    slug: string;
    description?: string | null;
    image_url?: string | null;
    display_order?: number;
    is_active?: boolean;
    image_focal_x?: number;
    image_focal_y?: number;
    group_id?: string | null;
    group_sort_order?: number;
    parent_id?: string | null;
    markup_percent?: number | null;
  }) {
    const [record] = await db
      .insertInto('categories')
      .values({
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        image_url: data.image_url ?? null,
        display_order: data.display_order ?? 0,
        is_active: data.is_active ?? true,
        image_focal_x: data.image_focal_x ?? 50,
        image_focal_y: data.image_focal_y ?? 50,
        group_id: data.group_id ?? null,
        group_sort_order: data.group_sort_order ?? 0,
        parent_id: data.parent_id ?? null,
        markup_percent: data.markup_percent ?? null,
      })
      .returningAll()
      .execute();

    return record;
  }

  /**
   * Admin: Updates an existing category.
   */
  async updateCategory(
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string | null;
      image_url?: string | null;
      display_order?: number;
      is_active?: boolean;
      image_focal_x?: number;
      image_focal_y?: number;
      group_id?: string | null;
      group_sort_order?: number;
      parent_id?: string | null;
      /** Migration 033: set only through the category offer endpoints. */
      offer_percent?: number | null;
      offer_ends_at?: string | Date | null;
      /** Migration 044: the category markup (null = parent's, else global). */
      markup_percent?: number | null;
    }
  ) {
    const [record] = await db
      .updateTable('categories')
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .execute();

    return record || null;
  }

  // --------------------------------------------------------------------------
  // PRODUCTS
  // --------------------------------------------------------------------------

  /**
   * Customer: Queries active products from the v_product_catalog view.
   */
  async findActiveProducts(params: ProductQueryParams) {
    const cut = await hasOfferCutColumn();
    let query = db
      .selectFrom('v_product_catalog')
      .select([
        'id',
        'category_id',
        'category_name',
        'name',
        'slug',
        'description',
        'sku',
        'barcode',
        'unit',
        'pack_size',
        'image_url',
        // Migration 009: the crop anchor travels with the image, so a tile
        // that crops it knows which point to keep. 50/50 is the centre.
        'image_focal_x',
        'image_focal_y',
        'calculated_selling_price',
        'is_available',
        'is_active',
        // Migration 031: the offer, raw - catalog.offers decides if it is active.
        'offer_price',
        'offer_ends_at',
        // Migration 033: the running category offer (own category or its parent).
        'category_offer_percent',
        'category_offer_ends_at',
        // Migration 045: variants, sellable (never the count) and lead time.
        'has_variants',
        'is_orderable',
        'delivery_lead_days',
        // Migration 048: the MRP (shown only when above the price paid).
        'mrp',
        // Migration 050: show the struck price / saving for this product.
        showOfferCut(cut),
      ])
      .where('is_active', '=', true);

    if (params.category_id) {
      query = query.where('category_id', 'in', categoryIdsForId(params.category_id));
    }

    if (params.category_slug) {
      query = query.where('category_id', 'in', categoryIdsForSlug(params.category_slug));
    }

    // Migration 045: "available" means orderable now - switched on, and in
    // stock when tracked (or, with variants, at least one variant is).
    if (params.is_available !== undefined) {
      query = query.where('is_orderable', '=', params.is_available);
    }

    if (params.on_offer) {
      query = query.where(activeOfferWhere);
    }

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('name', 'ilike', searchPattern),
          eb('description', 'ilike', searchPattern),
          eb('sku', 'ilike', searchPattern),
          eb('barcode', 'ilike', searchPattern),
        ])
      );
    }

    // Migration 035 (owner, 2026-10-10): the staff-arranged order first
    // (Arrange products), then the rest A-Z.
    return await query
      .orderBy(sql`display_order`, sql`asc nulls last`)
      .orderBy('name', 'asc')
      .limit(params.limit)
      .offset(params.offset)
      .execute();
  }

  /**
   * Customer: Counts total active products matching filters for pagination metadata.
   */
  async countActiveProducts(params: Omit<ProductQueryParams, 'limit' | 'offset'>): Promise<number> {
    let query = db
      .selectFrom('v_product_catalog')
      .select(sql<string>`count(*)`.as('count'))
      .where('is_active', '=', true);

    if (params.category_id) {
      query = query.where('category_id', 'in', categoryIdsForId(params.category_id));
    }

    if (params.category_slug) {
      query = query.where('category_id', 'in', categoryIdsForSlug(params.category_slug));
    }

    // Migration 045: "available" means orderable now - switched on, and in
    // stock when tracked (or, with variants, at least one variant is).
    if (params.is_available !== undefined) {
      query = query.where('is_orderable', '=', params.is_available);
    }

    if (params.on_offer) {
      query = query.where(activeOfferWhere);
    }

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('name', 'ilike', searchPattern),
          eb('description', 'ilike', searchPattern),
          eb('sku', 'ilike', searchPattern),
          eb('barcode', 'ilike', searchPattern),
        ])
      );
    }

    const result = await query.executeTakeFirst();
    return result ? parseInt(result.count, 10) : 0;
  }

  /**
   * Customer: Retrieves a single active product by UUID or slug from the view.
   */
  async findActiveProductById(idOrSlug: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const cut = await hasOfferCutColumn();

    let query = db
      .selectFrom('v_product_catalog')
      .select([
        'id',
        'category_id',
        'category_name',
        'name',
        'slug',
        'description',
        'sku',
        'barcode',
        'unit',
        'pack_size',
        'image_url',
        // Migration 009: the crop anchor travels with the image, so a tile
        // that crops it knows which point to keep. 50/50 is the centre.
        'image_focal_x',
        'image_focal_y',
        'calculated_selling_price',
        'is_available',
        'is_active',
        // Migration 031: the offer, raw - catalog.offers decides if it is active.
        'offer_price',
        'offer_ends_at',
        // Migration 033: the running category offer (own category or its parent).
        'category_offer_percent',
        'category_offer_ends_at',
        // Migration 045: variants, sellable (never the count) and lead time.
        'has_variants',
        'is_orderable',
        'delivery_lead_days',
        // Migration 048: the MRP (shown only when above the price paid).
        'mrp',
        // Migration 050: show the struck price / saving for this product.
        showOfferCut(cut),
      ])
      .where('is_active', '=', true);

    if (isUuid) {
      query = query.where('id', '=', idOrSlug);
    } else {
      query = query.where('slug', '=', idOrSlug);
    }

    return await query.executeTakeFirst();
  }

  /**
   * Admin: Retrieves complete product details including purchase_cost and markups.
   */
  /**
   * Admin: lists products including inactive ones, so operations can find
   * and re-enable a disabled product. The customer listing
   * (findActiveProducts) stays active-only.
   */
  async findAllProductsAdmin(params: {
    search?: string;
    category_id?: string;
    is_active?: boolean;
    limit: number;
    offset: number;
  }) {
    // v_product_catalog has the customer-facing and priced columns;
    // updated_at lives on products itself and operations wants it in the
    // table. (tracking_mode is an inventory concern, not a product one.)
    const cut = await hasOfferCutColumn();
    let query = db
      .selectFrom('v_product_catalog')
      .innerJoin('products', 'products.id', 'v_product_catalog.id')
      .selectAll('v_product_catalog')
      .select(['products.updated_at', staffShowOfferCut(cut)]);

    if (params.category_id) {
      query = query.where('v_product_catalog.category_id', '=', params.category_id);
    }
    if (params.is_active !== undefined) {
      query = query.where('v_product_catalog.is_active', '=', params.is_active);
    }
    if (params.search) {
      const searchPattern = `%${params.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('v_product_catalog.name', 'ilike', searchPattern),
          eb('v_product_catalog.sku', 'ilike', searchPattern),
          eb('v_product_catalog.barcode', 'ilike', searchPattern),
        ])
      );
    }

    return await query
      .orderBy('v_product_catalog.name', 'asc')
      .limit(params.limit)
      .offset(params.offset)
      .execute();
  }

  async findProductByIdAdmin(id: string) {
    const cut = await hasOfferCutColumn();
    return await db
      .selectFrom('v_product_catalog')
      .innerJoin('products', 'products.id', 'v_product_catalog.id')
      .selectAll('v_product_catalog')
      .select(['products.updated_at', staffShowOfferCut(cut)])
      .where('v_product_catalog.id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Finds a product by its unique SKU code.
   */
  async findProductBySku(sku: string) {
    return await db
      .selectFrom('products')
      .selectAll()
      .where('sku', '=', sku)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Migration 045: a live variant using this SKU (product and variant SKUs never collide). */
  async findVariantBySku(sku: string) {
    return await db
      .selectFrom('product_variants')
      .select(['id', 'product_id'])
      .where('sku', '=', sku)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Finds a product by its unique URL slug.
   */
  async findProductBySlug(slug: string) {
    return await db
      .selectFrom('products')
      .selectAll()
      .where('slug', '=', slug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Admin: Creates a new product.
   */
  async createProduct(data: {
    category_id: string;
    name: string;
    slug: string;
    sku: string;
    barcode?: string | null;
    unit: string;
    pack_size?: string | null;
    description?: string | null;
    image_url?: string | null;
    image_focal_x?: number;
    image_focal_y?: number;
    purchase_cost: number;
    custom_markup_percent?: number | null;
    pricing_mode?: 'MARKUP' | 'FIXED';
    fixed_selling_price?: number | null;
    /** Migration 048: the MRP (null = none). */
    mrp?: number | null;
    is_available?: boolean;
    is_active?: boolean;
    delivery_lead_days?: number;
    offer_price?: number | null;
    offer_ends_at?: string | null;
    /** Migration 050: show the struck price / saving (default on). */
    show_offer_cut?: boolean;
  }) {
    const cut = await hasOfferCutColumn();
    const [record] = await db
      .insertInto('products')
      .values({
        category_id: data.category_id,
        name: data.name,
        slug: data.slug,
        sku: data.sku,
        barcode: data.barcode ?? null,
        unit: data.unit,
        pack_size: data.pack_size ?? null,
        description: data.description ?? null,
        image_url: data.image_url ?? null,
        // Omitted means the column default, 50 - the centre, exactly where
        // `cover` cropped from before migration 009.
        image_focal_x: data.image_focal_x ?? 50,
        image_focal_y: data.image_focal_y ?? 50,
        purchase_cost: data.purchase_cost,
        custom_markup_percent: data.custom_markup_percent ?? null,
        pricing_mode: data.pricing_mode ?? 'MARKUP',
        fixed_selling_price: data.fixed_selling_price ?? null,
        mrp: data.mrp ?? null,
        is_available: data.is_available ?? true,
        is_active: data.is_active ?? true,
        delivery_lead_days: data.delivery_lead_days ?? 0,
        offer_price: data.offer_price ?? null,
        offer_ends_at: data.offer_ends_at ?? null,
        ...(cut ? { show_offer_cut: data.show_offer_cut ?? true } : {}),
      })
      .returningAll()
      .execute();

    return record;
  }

  /**
   * Admin: Updates an existing product.
   */
  async updateProduct(
    id: string,
    data: {
      category_id?: string;
      name?: string;
      slug?: string;
      sku?: string;
      barcode?: string | null;
      unit?: string;
      pack_size?: string | null;
      description?: string | null;
      image_url?: string | null;
      image_focal_x?: number;
      image_focal_y?: number;
      purchase_cost?: number;
      custom_markup_percent?: number | null;
      pricing_mode?: 'MARKUP' | 'FIXED';
      fixed_selling_price?: number | null;
      mrp?: number | null;
      is_available?: boolean;
      is_active?: boolean;
      delivery_lead_days?: number;
      offer_price?: number | null;
      offer_ends_at?: string | null;
      show_offer_cut?: boolean;
    }
  ) {
    // before migration 050 has run there is no column to write the switch to
    const { show_offer_cut: showCut, ...rest } = data;
    const cut = showCut !== undefined && (await hasOfferCutColumn());
    const [record] = await db
      .updateTable('products')
      .set({
        ...rest,
        ...(cut ? { show_offer_cut: showCut } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returningAll()
      .execute();

    return record || null;
  }
}

export const catalogRepository = new CatalogRepository();
