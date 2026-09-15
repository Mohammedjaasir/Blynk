import { sql } from 'kysely';
import { db } from '../../database/connection.js';

export interface ProductQueryParams {
  category_id?: string;
  category_slug?: string;
  search?: string;
  is_available?: boolean;
  limit: number;
  offset: number;
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
      .select(['id', 'name', 'slug', 'description', 'image_url', 'display_order', 'is_active'])
      .where('is_active', '=', true)
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
      .selectAll()
      .orderBy('display_order', 'asc')
      .orderBy('name', 'asc');

    if (isActive !== undefined) {
      query = query.where('is_active', '=', isActive);
    }

    return await query.execute();
  }

  /**
   * Finds a category by its primary key UUID.
   */
  async findCategoryById(id: string) {
    return await db
      .selectFrom('categories')
      .selectAll()
      .where('id', '=', id)
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
      .executeTakeFirst();
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
        'calculated_selling_price',
        'is_available',
        'is_active',
      ])
      .where('is_active', '=', true);

    if (params.category_id) {
      query = query.where('category_id', '=', params.category_id);
    }

    if (params.category_slug) {
      query = query.where((eb) =>
        eb('category_id', 'in',
          eb.selectFrom('categories').select('id').where('slug', '=', params.category_slug!)
        )
      );
    }

    if (params.is_available !== undefined) {
      query = query.where('is_available', '=', params.is_available);
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

    return await query
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
      query = query.where('category_id', '=', params.category_id);
    }

    if (params.category_slug) {
      query = query.where((eb) =>
        eb('category_id', 'in',
          eb.selectFrom('categories').select('id').where('slug', '=', params.category_slug!)
        )
      );
    }

    if (params.is_available !== undefined) {
      query = query.where('is_available', '=', params.is_available);
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
        'calculated_selling_price',
        'is_available',
        'is_active',
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
  async findProductByIdAdmin(id: string) {
    return await db
      .selectFrom('v_product_catalog')
      .selectAll()
      .where('id', '=', id)
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
    purchase_cost: number;
    custom_markup_percent?: number | null;
    is_available?: boolean;
    is_active?: boolean;
  }) {
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
        purchase_cost: data.purchase_cost,
        custom_markup_percent: data.custom_markup_percent ?? null,
        is_available: data.is_available ?? true,
        is_active: data.is_active ?? true,
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
      purchase_cost?: number;
      custom_markup_percent?: number | null;
      is_available?: boolean;
      is_active?: boolean;
    }
  ) {
    const [record] = await db
      .updateTable('products')
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .execute();

    return record || null;
  }
}

export const catalogRepository = new CatalogRepository();
