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
import { promoBandService, updatePromoBandSchema } from './promo-band.js';
import { heroBannerService, updateHeroBannerSchema } from './hero-banner.js';
import { appUpdatesService, updateAppUpdatesSchema } from './app-updates.js';
import { appShareLinksService, updateShareLinkSchema } from './app-downloads.js';
import { customerSmsLanguageService, updateCustomerSmsLanguageSchema } from '../notifications/sms-language.js';
import { smsLanguagePreview } from '../notifications/sms-language.preview.js';
import { defaultMarkupSettings, updateDefaultMarkupSchema } from '../catalog/catalog.pricing.js';

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

// Global default markup (migration 044; owner, 2026-10-13): the markup for
// MARKUP products with no markup of their own and none on their category or
// parent category. Audited (DEFAULT_MARKUP_UPDATED); every product priced by
// it changes at once (v_product_catalog). Orders already placed keep the
// prices snapshotted on them.
adminSettingsRouter.get(
  '/settings/default-markup',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await defaultMarkupSettings.get() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/default-markup',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateDefaultMarkupSchema.parse(req.body);
      res.json({ success: true, data: await defaultMarkupSettings.set(input, actorOf(req)) });
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

// Home promo band (owner, 2026-10-14: "make sure promotional banner edit
// option like this animation in the ops and admin"): the customer app's
// animated yellow band - headlines, ticked points, colours, item in the beam,
// mascot, link and schedule. Any subset of fields per PATCH; the merged band
// is validated as a whole. Audited (PROMO_BAND_UPDATED). Customers read it
// from GET /store (`promo_band`). See modules/configuration/promo-band.ts.
adminSettingsRouter.get(
  '/settings/promo-band',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await promoBandService.get() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/promo-band',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updatePromoBandSchema.parse(req.body);
      res.json({ success: true, data: await promoBandService.set(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// Home hero banner: the purple banner at the top of the customer app's Home
// (saucer, two jumping title words, rolling sub-line, ORDER NOW). AUTO = the
// app's automatic words (the default); CUSTOM = Admin's / Operations' words,
// sub-lines with {min_price} / {free_count} / {points_rule}, button, items and an optional
// schedule. Any subset of fields per PATCH; the merged banner is validated as
// a whole. Audited (HERO_BANNER_UPDATED). Customers read it from GET /store
// (`hero_banner`). See modules/configuration/hero-banner.ts.
adminSettingsRouter.get(
  '/settings/hero-banner',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await heroBannerService.get() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/hero-banner',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateHeroBannerSchema.parse(req.body);
      res.json({ success: true, data: await heroBannerService.set(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// Staff app updates (owner, 2026-10-12): per app (ops, rider) a minimum
// version code and optional/required, plus short release notes. Audited
// (APP_UPDATES_UPDATED). The apps read it from the public
// GET /app-updates/policy (modules/configuration/app-updates.ts).
adminSettingsRouter.get(
  '/settings/app-updates',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: await appUpdatesService.get() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/app-updates',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateAppUpdatesSchema.parse(req.body);
      res.json({ success: true, data: await appUpdatesService.set(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// Temporary public share link per staff app (owner, 2026-10-12): the APKs are
// served only to signed-in staff; Admin or Operations can switch on a public
// link for 1-72 hours (default 24) to hand the app to a new phone. Each
// switch-on makes a fresh random token; Off or the expiry ends it. Audited
// (APP_SHARE_LINK_UPDATED, without the token). Served by the public
// GET /app-updates/share/<token>/<app>.apk (modules/configuration/app-downloads.ts).
adminSettingsRouter.get(
  '/settings/app-share-links',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await appShareLinksService.get() });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/app-share-links',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateShareLinkSchema.parse(req.body);
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await appShareLinksService.set(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// Customer SMS language (owner, 2026-10-12): English only (the default),
// the customer's own pick with a fallback, or always Sinhala / Tamil - for
// order, sign-in code, dental and rider texts. Audited
// (CUSTOMER_SMS_LANGUAGE_UPDATED); applies to texts queued afterwards. The
// answer carries sample texts in each language so staff see what goes out.
adminSettingsRouter.get(
  '/settings/customer-sms-language',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (_req, res, next) => {
    try {
      res.json({ success: true, data: smsLanguagePreview(await customerSmsLanguageService.get()) });
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/settings/customer-sms-language',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updateCustomerSmsLanguageSchema.parse(req.body);
      res.json({ success: true, data: smsLanguagePreview(await customerSmsLanguageService.set(input, actorOf(req))) });
    } catch (err) {
      next(err);
    }
  }
);
