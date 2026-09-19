import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { adminCatalogRouter } from '../catalog/index.js';
import { adminPromotionsRouter } from '../promotions/index.js';
import { adminMediaRouter } from '../media/index.js';
import { orderController } from '../orders/order.controller.js';
import { inventoryController } from '../inventory/index.js';
import { listRidersForAssignment } from '../riders/rider.controller.js';
import { metrics } from '../../utils/metrics.js';
import { checkDatabaseConnection, pool } from '../../database/connection.js';

export const adminRouter = Router();

adminRouter.get('/status', (_req, res) => {
  res.json({ module: 'admin', status: 'ready' });
});

adminRouter.get('/dashboard', requireAuth, requireRoles('ADMIN'), (_req, res) => {
  res.json({ success: true, message: 'Welcome Admin' });
});

// Admin Catalog Management (Categories & Products) - Guarded by ADMIN role inside adminCatalogRouter
adminRouter.use(adminCatalogRouter);

// Home promotions and media uploads - each route guarded by ADMIN inside.
adminRouter.use(adminPromotionsRouter);
adminRouter.use(adminMediaRouter);

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

// Out-of-stock / Item Unavailable resolution (both POST /resolve-item and PATCH /items/:itemId)
adminRouter.patch(
  '/orders/:id/items/:itemId',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  orderController.resolveUnavailableItem.bind(orderController)
);

adminRouter.post(
  '/orders/:id/resolve-item',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  orderController.resolveUnavailableItem.bind(orderController)
);

// Sourcing & Procurement Operations (Guarded by ADMIN and PACKING_STAFF)
adminRouter.post(
  '/orders/:id/items/:itemId/source',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  inventoryController.sourceOrderItem.bind(inventoryController)
);

adminRouter.get(
  '/orders/:id/sourcing',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  inventoryController.getOrderSourcing.bind(inventoryController)
);

// Riders the store manager can assign (Guarded by ADMIN)
adminRouter.get('/riders', requireAuth, requireRoles('ADMIN'), listRidersForAssignment);

// Manual Rider Assignment (Guarded by ADMIN)
adminRouter.post(
  '/orders/:id/assign-rider',
  requireAuth,
  requireRoles('ADMIN'),
  orderController.assignRiderAdmin.bind(orderController)
);

// Tracked Inventory Endpoints
adminRouter.get(
  '/inventory',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  inventoryController.listInventory.bind(inventoryController)
);

// Adjustment ledger across products. Registered before /inventory/:productId
// so "adjustments" is not read as a product id.
adminRouter.get(
  '/inventory/adjustments',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  inventoryController.listAdjustments.bind(inventoryController)
);

adminRouter.get(
  '/inventory/:productId',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  inventoryController.getInventoryByProduct.bind(inventoryController)
);

adminRouter.patch(
  '/inventory/:productId/mode',
  requireAuth,
  requireRoles('ADMIN'),
  inventoryController.setTrackingMode.bind(inventoryController)
);

adminRouter.post(
  '/inventory/:productId/adjust',
  requireAuth,
  requireRoles('ADMIN'),
  inventoryController.adjustStock.bind(inventoryController)
);

// Suppliers / Market Sources Management
adminRouter.get(
  '/suppliers',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  inventoryController.listSuppliers.bind(inventoryController)
);

adminRouter.post(
  '/suppliers',
  requireAuth,
  requireRoles('ADMIN'),
  inventoryController.createSupplier.bind(inventoryController)
);

adminRouter.get(
  '/suppliers/:id',
  requireAuth,
  requireRoles(['ADMIN', 'PACKING_STAFF']),
  inventoryController.getSupplierById.bind(inventoryController)
);

adminRouter.patch(
  '/suppliers/:id',
  requireAuth,
  requireRoles('ADMIN'),
  inventoryController.updateSupplier.bind(inventoryController)
);

// Notification Outbox Observability & Diagnostics (Guarded by ADMIN)
adminRouter.get(
  '/notifications',
  requireAuth,
  requireRoles('ADMIN'),
  async (_req, res, next) => {
    try {
      const { notificationRepository } = await import('../notifications/index.js');
      const queueMetrics = await notificationRepository.getQueueMetrics();
      res.json({
        success: true,
        data: queueMetrics,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Operations: In-Process Business Metrics Snapshot (ADMIN only)
// Returns aggregate counters since the last process restart.
// No PII, no secrets, aggregate counters only.
// ─────────────────────────────────────────────────────────────────────────────
adminRouter.get(
  '/operations/metrics',
  requireAuth,
  requireRoles('ADMIN'),
  (_req, res) => {
    res.json({
      success: true,
      data: metrics.snapshot(),
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Operations: Operational Status Dashboard (ADMIN only)
// Returns system health + pool stats for the admin operations panel.
// ─────────────────────────────────────────────────────────────────────────────
adminRouter.get(
  '/operations/status',
  requireAuth,
  requireRoles('ADMIN'),
  async (_req, res, next) => {
    try {
      const dbStatus = await checkDatabaseConnection();
      const poolStats = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      };

      res.json({
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          database: {
            status: dbStatus.ok ? 'connected' : 'disconnected',
            latencyMs: dbStatus.latencyMs,
            pool: poolStats,
          },
          metrics: metrics.snapshot(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
