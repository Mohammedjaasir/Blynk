import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { settingsService, updateDeliveryFeeSchema } from './settings.service.js';

export const configurationRouter = Router();

configurationRouter.get('/status', (_req, res) => {
  res.json({ module: 'configuration', status: 'ready' });
});

// ----------------------------------------------------------------------------
// Public store facts (GET /api/v1/store) - no auth; the customer app and the
// landing site read the live delivery fee from here.
// ----------------------------------------------------------------------------
export const storeRouter = Router();
storeRouter.get('/', async (_req, res, next) => {
  try {
    const store = await settingsService.getPublicStore();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ success: true, data: store });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// Store settings (mounted under /admin) - ADMIN and OPERATIONS.
// ----------------------------------------------------------------------------
const actorOf = (req: Request) => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const adminSettingsRouter = Router();

adminSettingsRouter.get(
  '/settings/delivery-fee',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await settingsService.getDeliveryFee() });
    } catch (err) {
      next(err);
    }
  }
);

// Audited (audit_logs DELIVERY_FEE_UPDATED). Orders already placed keep the
// fee snapshotted on them.
adminSettingsRouter.patch(
  '/settings/delivery-fee',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateDeliveryFeeSchema.parse(req.body);
      res.json({ success: true, data: await settingsService.setDeliveryFee(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);
