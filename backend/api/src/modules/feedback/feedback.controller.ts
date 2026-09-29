import { Request, Response, NextFunction } from 'express';
import { feedbackService } from './feedback.service.js';
import type {
  AdminFeedbackQueryInput,
  CreateFeedbackInput,
  UpdateFeedbackStatusInput,
} from './feedback.schema.js';

// Bodies, queries and params are parsed by validate() on each route
// (see index.ts), so handlers read them already typed and trimmed.
export class FeedbackController {
  // --------------------------------------------------------------------------
  // CUSTOMER
  // --------------------------------------------------------------------------

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const feedback = await feedbackService.create(req.user!.id, req.body as CreateFeedbackInput);
      res.status(201).json({ success: true, data: { feedback } });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // ADMIN
  // --------------------------------------------------------------------------

  async listAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await feedbackService.listAdmin(req.query as unknown as AdminFeedbackQueryInput);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const feedback = await feedbackService.updateStatus(
        req.params.id as string,
        req.body as UpdateFeedbackStatusInput
      );
      res.status(200).json({ success: true, data: { feedback } });
    } catch (err) {
      next(err);
    }
  }
}

export const feedbackController = new FeedbackController();
