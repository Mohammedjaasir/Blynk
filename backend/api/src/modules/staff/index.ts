import { Router } from 'express';
import { staffController } from './staff.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createStaffSchema, staffIdParamsSchema, updateStaffSchema } from './staff.schema.js';
import { riderProfileService, staffRiderSchema, type StaffRiderInput } from '../riders/rider.profile.js';
import { AppError } from '../../middleware/error.middleware.js';
import type { NextFunction, Request, Response } from 'express';

/**
 * Riders join by applying in the Rider app and being approved under Rider
 * requests (migration 029, owner 2026-10-07) - never from Staff accounts.
 * Checked before body validation, so the answer is this one clear code
 * rather than a list of missing rider fields.
 */
export const RIDERS_JOIN_BY_APPLICATION_MESSAGE =
  'Riders apply in the Blynk Rider app and are approved under Rider requests.';
function refuseRiderCreation(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object' && (req.body as { role?: unknown }).role === 'RIDER') {
    next(new AppError(RIDERS_JOIN_BY_APPLICATION_MESSAGE, 400, 'RIDERS_JOIN_BY_APPLICATION'));
    return;
  }
  next();
}

// ----------------------------------------------------------------------------
// STAFF ACCOUNTS ROUTER (mounted under /api/v1/admin, migration 014)
// ----------------------------------------------------------------------------
// ADMIN (Admin website) and OPERATIONS (Operations app) create and manage
// accounts; which roles each may create or change is enforced in
// staff.service.ts (the permission matrix). PACKING_STAFF never reaches it.
export const adminStaffRouter = Router();

const STAFF_MANAGERS = requireRoles(['ADMIN', 'OPERATIONS']);

adminStaffRouter.get('/staff', requireAuth, STAFF_MANAGERS, staffController.list.bind(staffController));
adminStaffRouter.post(
  '/staff',
  requireAuth,
  STAFF_MANAGERS,
  refuseRiderCreation,
  validate({ body: createStaffSchema }),
  staffController.create.bind(staffController)
);
adminStaffRouter.patch(
  '/staff/:id',
  requireAuth,
  STAFF_MANAGERS,
  validate({ params: staffIdParamsSchema, body: updateStaffSchema }),
  staffController.update.bind(staffController)
);
// "Can deliver": gives an OPERATIONS or ADMIN account a rider profile (or
// switches it off). The caller's own account is allowed - an admin who
// delivers turns it on for themselves here too.
adminStaffRouter.put(
  '/staff/:id/rider',
  requireAuth,
  requireRoles('ADMIN'),
  validate({ params: staffIdParamsSchema, body: staffRiderSchema }),
  async (req, res, next) => {
    try {
      const rider = await riderProfileService.setForStaff(req.params.id as string, req.body as StaffRiderInput, req.user!.id);
      res.status(200).json({ success: true, data: { rider } });
    } catch (err) {
      next(err);
    }
  }
);

export * from './staff.schema.js';
export * from './staff.service.js';
export * from './staff.controller.js';
