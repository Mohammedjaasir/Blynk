import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { riderController } from './rider.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ownRiderProfileSchema, riderProfileService, type OwnRiderProfileInput } from './rider.profile.js';

export const ridersRouter = Router();

ridersRouter.get('/status', (_req, res) => {
  res.json({ module: 'riders', status: 'ready' });
});

// Backward-compatible test route
ridersRouter.get('/orders', requireAuth, requireRoles('RIDER'), (_req, res) => {
  res.json({ success: true, message: 'Welcome Rider' });
});

/**
 * Rider Deliveries & COD Cash Collection.
 *
 * ADMIN is on the allow-list for the Operations app (operations plan §2, §7):
 * one users row with role='ADMIN', optionally linked to one riders row through
 * the existing riders.user_id FK. Passing this guard is only permission to
 * *reach* the rider services - it is not an identity. Every handler below
 * still resolves the acting rider from findRiderByUserId(req.user.id) alone,
 * so an ADMIN with no linked riders row gets 403 RIDER_PROFILE_NOT_FOUND, an
 * inactive one 403 RIDER_INACTIVE, and another rider's delivery is still the
 * same 404 DELIVERY_NOT_FOUND it has always been. No rider id is ever read
 * from the request.
 */
const RIDER_OR_OPS = requireRoles(['RIDER', 'ADMIN', 'OPERATIONS']);

ridersRouter.get(
  '/deliveries',
  requireAuth,
  RIDER_OR_OPS,
  riderController.getActiveDeliveries.bind(riderController)
);

// The caller's own rider profile (staff riders, rider.profile.ts): read by
// any rider-capable role, set up only by ADMIN/OPERATIONS for themselves.
ridersRouter.get('/me/profile', requireAuth, RIDER_OR_OPS, async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: { profile: await riderProfileService.getOwn(req.user!.id) } });
  } catch (err) {
    next(err);
  }
});
ridersRouter.post(
  '/me/profile',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  validate({ body: ownRiderProfileSchema }),
  async (req, res, next) => {
    try {
      const profile = await riderProfileService.setUpOwn(req.user!.id, req.user!.role, req.body as OwnRiderProfileInput);
      res.status(200).json({ success: true, data: { profile } });
    } catch (err) {
      next(err);
    }
  }
);

// "My day": the calling rider's own counts and cash (never another rider's).
ridersRouter.get('/me/day', requireAuth, RIDER_OR_OPS, riderController.getMyDay.bind(riderController));

ridersRouter.get(
  '/deliveries/:id',
  requireAuth,
  RIDER_OR_OPS,
  riderController.getDeliveryById.bind(riderController)
);

ridersRouter.patch(
  '/deliveries/:id/status',
  requireAuth,
  RIDER_OR_OPS,
  riderController.updateDeliveryStatus.bind(riderController)
);

ridersRouter.post(
  '/deliveries/:id/collect-cod',
  requireAuth,
  RIDER_OR_OPS,
  riderController.collectCod.bind(riderController)
);

ridersRouter.post(
  '/deliveries/:id/location',
  requireAuth,
  RIDER_OR_OPS,
  riderController.updateLocation.bind(riderController)
);

export * from './rider.repository.js';
export * from './rider.service.js';
export * from './rider.controller.js';
export * from './rider.profile.js';
