import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { riderController } from './rider.controller.js';

export const ridersRouter = Router();

ridersRouter.get('/status', (_req, res) => {
  res.json({ module: 'riders', status: 'ready' });
});

// Backward-compatible test route
ridersRouter.get('/orders', requireAuth, requireRoles('RIDER'), (_req, res) => {
  res.json({ success: true, message: 'Welcome Rider' });
});

// Rider Deliveries & COD Cash Collection (Guarded by RIDER role)
ridersRouter.get(
  '/deliveries',
  requireAuth,
  requireRoles('RIDER'),
  riderController.getActiveDeliveries.bind(riderController)
);

ridersRouter.get(
  '/deliveries/:id',
  requireAuth,
  requireRoles('RIDER'),
  riderController.getDeliveryById.bind(riderController)
);

ridersRouter.patch(
  '/deliveries/:id/status',
  requireAuth,
  requireRoles('RIDER'),
  riderController.updateDeliveryStatus.bind(riderController)
);

ridersRouter.post(
  '/deliveries/:id/collect-cod',
  requireAuth,
  requireRoles('RIDER'),
  riderController.collectCod.bind(riderController)
);

export * from './rider.repository.js';
export * from './rider.service.js';
export * from './rider.controller.js';
