import { Request, Response, NextFunction } from 'express';
import { promotionService } from './promotion.service.js';
import {
  createPromotionSchema,
  promotionQuerySchema,
  reorderPromotionsSchema,
  updatePromotionSchema,
} from './promotion.schema.js';

export class PromotionController {
  // --------------------------------------------------------------------------
  // CUSTOMER
  // --------------------------------------------------------------------------

  /** Active promotions in display order - what the Home carousel renders. */
  async getActivePromotions(_req: Request, res: Response, next: NextFunction) {
    try {
      const promotions = await promotionService.listActive();
      res.status(200).json({ success: true, data: { promotions } });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // ADMIN
  // --------------------------------------------------------------------------

  async listAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const query = promotionQuerySchema.parse(req.query);
      const promotions = await promotionService.listAdmin(query.is_active);
      res.status(200).json({ success: true, data: { promotions } });
    } catch (err) {
      next(err);
    }
  }

  async getByIdAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const promotion = await promotionService.getById(req.params.id as string);
      res.status(200).json({ success: true, data: { promotion } });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createPromotionSchema.parse(req.body);
      const promotion = await promotionService.create(input);
      res.status(201).json({ success: true, data: { promotion } });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updatePromotionSchema.parse(req.body);
      const promotion = await promotionService.update(req.params.id as string, input);
      res.status(200).json({ success: true, data: { promotion } });
    } catch (err) {
      next(err);
    }
  }

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const input = reorderPromotionsSchema.parse(req.body);
      const promotions = await promotionService.reorder(input);
      res.status(200).json({ success: true, data: { promotions } });
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await promotionService.remove(req.params.id as string);
      res.status(200).json({ success: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  }
}

export const promotionController = new PromotionController();
