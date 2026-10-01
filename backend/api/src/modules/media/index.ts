import { Router } from 'express';
import { imageUpload, mediaController } from './media.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';

/**
 * Admin media routes (mounted under /api/v1/admin).
 *
 * Uploading is an ADMIN-only capability: a customer token gets 403 here
 * exactly as it does on the catalog mutations.
 */
export const adminMediaRouter = Router();

adminMediaRouter.post(
  '/media',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  imageUpload.single('file'),
  mediaController.upload.bind(mediaController)
);

adminMediaRouter.delete(
  '/media',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  mediaController.remove.bind(mediaController)
);

export * from './media.controller.js';
