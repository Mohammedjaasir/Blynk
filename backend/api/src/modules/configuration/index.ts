import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import {
  settingsService,
  updateBirthdayOfferSchema,
  updateCheckoutSettingsSchema,
  updateDeliveryFeeSchema,
  updateRiderCommissionSchema,
} from './settings.service.js';

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

// Checkout switches (owner, 2026-10-08): coupon codes on/off and the free
// deliveries for new customers. Audited (CHECKOUT_SETTINGS_UPDATED); they
// apply to orders placed afterwards.
adminSettingsRouter.get(
  '/settings/checkout',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await settingsService.getCheckoutSettings() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/checkout',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateCheckoutSettingsSchema.parse(req.body);
      res.json({ success: true, data: await settingsService.setCheckoutSettings(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// Rider commission (owner, 2026-10-09): a commission rider's default share of
// the standard delivery fee. Audited (RIDER_COMMISSION_UPDATED); applies to
// deliveries settled afterwards.
adminSettingsRouter.get(
  '/settings/rider-commission',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await settingsService.getRiderCommission() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/rider-commission',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateRiderCommissionSchema.parse(req.body);
      res.json({ success: true, data: await settingsService.setRiderCommission(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// Birthday offer (owner, 2026-10-09): on/off, % off one order in the birthday
// week, and the birthday SMS text. Audited (BIRTHDAY_OFFER_UPDATED); applies
// to orders placed and SMS queued afterwards.
adminSettingsRouter.get(
  '/settings/birthday-offer',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: settingsService.presentBirthdayOffer(await settingsService.getBirthdayOffer()) });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/birthday-offer',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateBirthdayOfferSchema.parse(req.body);
      res.json({ success: true, data: await settingsService.setBirthdayOffer(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);
