import { Request, Response, NextFunction } from 'express';
import { catalogService } from './catalog.service.js';
import {
  productQuerySchema,
  createCategorySchema,
  updateCategorySchema,
  createProductSchema,
  updateProductSchema,
} from './catalog.schema.js';

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
      res.status(200).json({
        success: true,
        data: { product },
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
      const category = await catalogService.createCategoryAdmin(input);
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
      const category = await catalogService.updateCategoryAdmin(req.params.id as string, input);
      res.status(200).json({
        success: true,
        data: { category },
      });
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
}

export const catalogController = new CatalogController();
