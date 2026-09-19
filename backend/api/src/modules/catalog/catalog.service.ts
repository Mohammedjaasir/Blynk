import { catalogRepository, ProductQueryParams } from './catalog.repository.js';
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateProductInput,
  UpdateProductInput,
  ProductQueryInput,
  slugify,
} from './catalog.schema.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';

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
  selling_price: number;
  is_available: boolean;
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
    }));
  }

  // --------------------------------------------------------------------------
  // CATEGORIES (ADMIN)
  // --------------------------------------------------------------------------

  async listCategoriesAdmin(isActive?: boolean) {
    return await catalogRepository.findAllCategories(isActive);
  }

  async createCategoryAdmin(input: CreateCategoryInput) {
    const slug = input.slug ? input.slug.toLowerCase().trim() : slugify(input.name);

    const existing = await catalogRepository.findCategoryBySlug(slug);
    if (existing) {
      throw new AppError(
        `Category with slug '${slug}' already exists.`,
        409,
        'CATEGORY_SLUG_EXISTS'
      );
    }

    const created = await catalogRepository.createCategory({
      name: input.name,
      slug,
      description: input.description,
      image_url: input.image_url,
      display_order: input.display_order ?? 0,
      is_active: input.is_active ?? true,
    });

    logger.info({ categoryId: created.id, slug: created.slug }, 'Category created by admin');
    return created;
  }

  async updateCategoryAdmin(id: string, input: UpdateCategoryInput) {
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

    const updated = await catalogRepository.updateCategory(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug.toLowerCase().trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.image_url !== undefined ? { image_url: input.image_url } : {}),
      ...(input.display_order !== undefined ? { display_order: input.display_order } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    });

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
    const slug = input.slug ? input.slug.toLowerCase().trim() : slugify(input.name);
    const slugConflict = await catalogRepository.findProductBySlug(slug);
    if (slugConflict) {
      throw new AppError(
        `Product with slug '${slug}' already exists.`,
        409,
        'PRODUCT_SLUG_EXISTS'
      );
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
      ...(input.purchase_cost !== undefined ? { purchase_cost: input.purchase_cost } : {}),
      ...(input.custom_markup_percent !== undefined
        ? { custom_markup_percent: input.custom_markup_percent }
        : {}),
      ...(input.is_available !== undefined ? { is_available: input.is_available } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    });

    logger.info({ productId: id }, 'Product updated by admin');

    // Return complete updated view with recalculated pricing
    return await this.getProductByIdAdmin(id);
  }
}

export const catalogService = new CatalogService();
