import { Router } from 'express';
import { staffController } from './staff.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createStaffSchema, staffIdParamsSchema, updateStaffSchema } from './staff.schema.js';

// ----------------------------------------------------------------------------
// ADMIN STAFF ACCOUNTS ROUTER (mounted under /api/v1/admin, migration 014)
// ----------------------------------------------------------------------------
// Only ADMIN creates or changes staff accounts - never PACKING_STAFF or
// OPERATIONS, who each have their own single app.
export const adminStaffRouter = Router();

adminStaffRouter.get('/staff', requireAuth, requireRoles('ADMIN'), staffController.list.bind(staffController));
adminStaffRouter.post(
  '/staff',
  requireAuth,
  requireRoles('ADMIN'),
  validate({ body: createStaffSchema }),
  staffController.create.bind(staffController)
);
adminStaffRouter.patch(
  '/staff/:id',
  requireAuth,
  requireRoles('ADMIN'),
  validate({ params: staffIdParamsSchema, body: updateStaffSchema }),
  staffController.update.bind(staffController)
);

export * from './staff.schema.js';
export * from './staff.service.js';
export * from './staff.controller.js';
