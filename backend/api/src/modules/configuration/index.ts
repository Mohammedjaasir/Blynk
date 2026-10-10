import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import {
  settingsService,
  updateBirthdayOfferSchema,
  updateCheckoutSettingsSchema,
  updateDeliveryFeeSchema,
  updateRiderCommissionSchema,
  updateRiderTripsSchema,
} from './settings.service.js';
import {
  storeScheduleService,
  updateDeliverySlotsSchema,
  updateStoreClosureSchema,
  updateStoreHolidaysSchema,
  updateStoreHoursSchema,
  updateStoreSmsSchema,
} from './store-schedule.js';
import { doctorsAccessService, updateDoctorsAccessSchema } from './doctors-access.js';

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
    // 30 s (was 60): a "close the store now" reaches apps quickly (owner, 2026-10-10).
    res.set('Cache-Control', 'public, max-age=30');
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

// Rider trips (owner, 2026-10-10): "ops can control the 2 orders for one
// delivery if it's in the same route". How many orders one rider may carry at
// once (1 = no trips) and the max straight-line km between their drop-offs
// before staff must confirm (ASSIGN_RIDER, riders/batching.ts). Audited
// (RIDER_TRIPS_UPDATED); applies to assignments made afterwards.
adminSettingsRouter.get(
  '/settings/rider-trips',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await settingsService.getRiderTrips() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/rider-trips',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateRiderTripsSchema.parse(req.body);
      res.json({ success: true, data: await settingsService.setRiderTrips(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// Store timing (owner, 2026-10-10: "make sure the timing will be decided by
// ops and admin"): opening hours, "close the store now", the holiday list and
// scheduled delivery slots. One GET for the whole screen; each PATCH answers
// with the whole schedule again. Each change is audited (STORE_HOURS_UPDATED,
// STORE_CLOSED_NOW / STORE_REOPENED, STORE_HOLIDAYS_UPDATED,
// DELIVERY_SLOTS_UPDATED, STORE_SMS_UPDATED) and applies at once (the
// in-process cache is dropped). /settings/store-sms is the "Send offer/birthday
// texts on closed days" switch (owner, 2026-10-10).
adminSettingsRouter.get(
  '/settings/store-schedule',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await storeScheduleService.get() });
    } catch (err) {
      next(err);
    }
  }
);

const scheduleEdits = [
  ['/settings/store-hours', updateStoreHoursSchema, storeScheduleService.setHours],
  ['/settings/store-closure', updateStoreClosureSchema, storeScheduleService.setClosure],
  ['/settings/store-holidays', updateStoreHolidaysSchema, storeScheduleService.setHolidays],
  ['/settings/delivery-slots', updateDeliverySlotsSchema, storeScheduleService.setSlots],
  ['/settings/store-sms', updateStoreSmsSchema, storeScheduleService.setSms],
] as const;

for (const [path, schema, apply] of scheduleEdits) {
  adminSettingsRouter.patch(path, requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), async (req, res, next) => {
    try {
      const input = schema.parse(req.body);
      res.json({ success: true, data: await (apply as (i: unknown, a: ReturnType<typeof actorOf>) => Promise<unknown>)(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  });
}

// Doctors need sign-in (owner, 2026-10-10: "If they want to go to the doctors
// section, they must log in or create an account"). On by default; when off,
// guests may browse clinics and doctors again. Audited
// (DOCTORS_ACCESS_UPDATED); applies to the next request.
adminSettingsRouter.get(
  '/settings/doctors-access',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await doctorsAccessService.get() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/doctors-access',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateDoctorsAccessSchema.parse(req.body);
      res.json({ success: true, data: await doctorsAccessService.set(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);
