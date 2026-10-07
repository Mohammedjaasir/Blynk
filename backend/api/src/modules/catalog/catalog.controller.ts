import { SHOPPER_ROLES } from '../../middleware/role.middleware.js';
import { Request, Response, NextFunction } from 'express';
import { stockAlertRepository } from './catalog.stock-alerts.js';
import { catalogService } from './catalog.service.js';
import {
  productQuerySchema,
  createCategorySchema,
  updateCategorySchema,
  createProductSchema,
  updateProductSchema,
  deleteCategoryQuerySchema,
  idParamSchema,
  adminProductListQuerySchema,
} from './catalog.schema.js';
import { deleteCategory, deleteProduct } from './catalog.delete.js';
import { importProducts, importProductsSchema } from './catalog.import.js';
import type { AuditActor } from '../audit/audit.writer.js';

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export class CatalogController {
  // --------------------------------------------------------------------------
  // CUSTOMER ENDPOINTS
  // --------------------------------------------------------------------------

  async getCategories(_req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await catalogService.listCategories();
      res.status(200).json({
        success: true,
        data: { categories },
      });
    } catch (err) {
      next(err);
    }
  }

  async getProducts(req: Request, res: Response, next: NextFunction) {
    try {
      const query = productQuerySchema.parse(req.query);
      const result = await catalogService.listProducts(query);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getProductById(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await catalogService.getProductById(req.params.id as string);
      // Phase 6: whether this signed-in customer asked to hear when it's back.
      const notify_me_subscribed =
        req.user && SHOPPER_ROLES.includes(req.user.role) ? await stockAlertRepository.isSubscribed(req.user.id, product.id) : false;
      res.status(200).json({
        success: true,
        data: { product: { ...product, notify_me_subscribed } },
      });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // ADMIN ENDPOINTS
  // --------------------------------------------------------------------------

  async getCategoriesAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const isActive =
        req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
      const categories = await catalogService.listCategoriesAdmin(isActive);
      res.status(200).json({
        success: true,
        data: { categories },
      });
    } catch (err) {
      next(err);
    }
  }

  async createCategoryAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createCategorySchema.parse(req.body);
      const category = await catalogService.createCategoryAdmin(input, actorOf(req));
      res.status(201).json({
        success: true,
        data: { category },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateCategoryAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateCategorySchema.parse(req.body);
      const category = await catalogService.updateCategoryAdmin(req.params.id as string, input, actorOf(req));
      res.status(200).json({
        success: true,
        data: { category },
      });
    } catch (err) {
      next(err);
    }
  }

  async listProductsAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const query = adminProductListQuerySchema.parse(req.query);
      const result = await catalogService.listProductsAdmin({
        search: query.search,
        category_id: query.category_id,
        is_active: query.is_active === undefined ? undefined : query.is_active === 'true',
        limit: query.limit,
        page: query.page,
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async getProductByIdAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await catalogService.getProductByIdAdmin(req.params.id as string);
      res.status(200).json({
        success: true,
        data: { product },
      });
    } catch (err) {
      next(err);
    }
  }

  async createProductAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createProductSchema.parse(req.body);
      const product = await catalogService.createProductAdmin(input);
      res.status(201).json({
        success: true,
        data: { product },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProductAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateProductSchema.parse(req.body);
      const product = await catalogService.updateProductAdmin(req.params.id as string, input);
      res.status(200).json({
        success: true,
        data: { product },
      });
    } catch (err) {
      next(err);
    }
  }

  /** DELETE /admin/products/:id - hard delete if never ordered, else soft (migration 017). */
  async deleteProductAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const result = await deleteProduct(id, actorOf(req));
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /admin/categories/:id[?move_to_category_id=…]. The target may also
   * come in a JSON body; the query string wins (some clients drop DELETE bodies).
   */
  async deleteCategoryAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { move_to_category_id } = deleteCategoryQuerySchema.parse({
        move_to_category_id: req.query.move_to_category_id ?? req.body?.move_to_category_id,
      });
      const result = await deleteCategory(id, move_to_category_id, actorOf(req));
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  /** POST /admin/products/import - rows parsed from .xlsx/.csv in the browser. */
  async importProductsAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const input = importProductsSchema.parse(req.body);
      const result = await importProducts(input, req.user!.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const catalogController = new CatalogController();
