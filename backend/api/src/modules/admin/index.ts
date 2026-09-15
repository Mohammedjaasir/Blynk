import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { adminCatalogRouter } from '../catalog/index.js';
import { orderController } from '../orders/order.controller.js';

export const adminRouter = Router();

adminRouter.get('/status', (_req, res) => {
  res.json({ module: 'admin', status: 'ready' });
});

adminRouter.get('/dashboard', requireAuth, requireRoles('ADMIN'), (_req, res) => {
  res.json({ success: true, message: 'Welcome Admin' });
});

// Admin Catalog Management (Categories & Products) - Guarded by ADMIN role
adminRouter.use(requireAuth, requireRoles('ADMIN'), adminCatalogRouter);

// Store Operations & Fulfillment Queue (Guarded by ADMIN and PACKING_STAFF)
adminRouter.get(
  '/packing-queue',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  orderController.getPackingQueue.bind(orderController)
);

adminRouter.get(
  '/orders',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  orderController.getAdminOrders.bind(orderController)
);

adminRouter.get(
  '/orders/:id',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  orderController.getAdminOrderById.bind(orderController)
);

adminRouter.patch(
  '/orders/:id/status',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  orderController.updateOrderStatusAdmin.bind(orderController)
);

adminRouter.patch(
  '/orders/:id/items/:itemId',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  orderController.resolveUnavailableItem.bind(orderController)
);

// Manual Rider Assignment (Guarded by ADMIN)
adminRouter.post(
  '/orders/:id/assign-rider',
  requireAuth,
  requireRoles('ADMIN'),
  orderController.assignRiderAdmin.bind(orderController)
);
