import { Router } from 'express';
import { promotionController } from './promotion.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';

// ----------------------------------------------------------------------------
// 1. CUSTOMER PROMOTIONS ROUTER (/api/v1/promotions)
// ----------------------------------------------------------------------------
// Public, like the catalog: Home renders this before the customer logs in.
// Returns active promotions only, in display order.
export const promotionsRouter = Router();
promotionsRouter.get('/', promotionController.getActivePromotions.bind(promotionController));

// ----------------------------------------------------------------------------
// 2. ADMIN PROMOTIONS ROUTER (mounted under /api/v1/admin)
// ----------------------------------------------------------------------------
// Every mutation is behind requireAuth + ADMIN, matching adminCatalogRouter.
export const adminPromotionsRouter = Router();

adminPromotionsRouter.get(
  '/promotions',
  requireAuth,
  requireRoles('ADMIN'),
  promotionController.listAdmin.bind(promotionController)
);
adminPromotionsRouter.post(
  '/promotions',
  requireAuth,
  requireRoles('ADMIN'),
  promotionController.create.bind(promotionController)
);
// Declared before /promotions/:id so "reorder" isn't read as an id.
adminPromotionsRouter.patch(
  '/promotions/reorder',
  requireAuth,
  requireRoles('ADMIN'),
  promotionController.reorder.bind(promotionController)
);
adminPromotionsRouter.get(
  '/promotions/:id',
  requireAuth,
  requireRoles('ADMIN'),
  promotionController.getByIdAdmin.bind(promotionController)
);
adminPromotionsRouter.patch(
  '/promotions/:id',
  requireAuth,
  requireRoles('ADMIN'),
  promotionController.update.bind(promotionController)
);
adminPromotionsRouter.delete(
  '/promotions/:id',
  requireAuth,
  requireRoles('ADMIN'),
  promotionController.remove.bind(promotionController)
);

export * from './promotion.schema.js';
export * from './promotion.repository.js';
export * from './promotion.service.js';
export * from './promotion.controller.js';
