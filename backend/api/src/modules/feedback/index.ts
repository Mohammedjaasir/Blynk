import { Router } from 'express';
import { feedbackController } from './feedback.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  adminFeedbackQuerySchema,
  createFeedbackSchema,
  feedbackIdParamsSchema,
  updateFeedbackStatusSchema,
} from './feedback.schema.js';

// ----------------------------------------------------------------------------
// 1. CUSTOMER FEEDBACK ROUTER (/api/v1/feedback)
// ----------------------------------------------------------------------------
// Any signed-in user may send feedback; 5 an hour each (feedback.service.ts).
export const feedbackRouter = Router();
feedbackRouter.post(
  '/',
  requireAuth,
  validate({ body: createFeedbackSchema }),
  feedbackController.create.bind(feedbackController)
);

// ----------------------------------------------------------------------------
// 2. ADMIN FEEDBACK ROUTER (mounted under /api/v1/admin)
// ----------------------------------------------------------------------------
// The list carries customer names and phone numbers, so ADMIN only.
export const adminFeedbackRouter = Router();

adminFeedbackRouter.get(
  '/feedback',
  requireAuth,
  requireRoles('ADMIN'),
  validate({ query: adminFeedbackQuerySchema }),
  feedbackController.listAdmin.bind(feedbackController)
);
adminFeedbackRouter.patch(
  '/feedback/:id',
  requireAuth,
  requireRoles('ADMIN'),
  validate({ params: feedbackIdParamsSchema, body: updateFeedbackStatusSchema }),
  feedbackController.updateStatus.bind(feedbackController)
);

export * from './feedback.schema.js';
export * from './feedback.repository.js';
export * from './feedback.service.js';
export * from './feedback.controller.js';
