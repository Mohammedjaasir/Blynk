import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import type { AuditActor } from '../audit/audit.writer.js';
import {
  adminSellerLocationSchema,
  approveSubmissionSchema,
  commissionSettingsSchema,
  createSellerProductSchema,
  createSellerSchema,
  idParamSchema,
  listSellersQuerySchema,
  listSubmissionsQuerySchema,
  patchSellerSchema,
  payoutParamSchema,
  recordPayoutSchema,
  rejectLocationSchema,
  rejectSubmissionSchema,
  sellerDetailQuerySchema,
} from './admin-sellers.schema.js';
import {
  approveLocation,
  approveSubmission,
  createSeller,
  rejectLocation,
  deletePayout,
  getSeller,
  listSellers,
  listSubmissions,
  recordPayout,
  rejectSubmission,
  updateSeller,
} from './admin-sellers.service.js';
import { createSellerProduct, listSellerProducts, setSellerLocation } from './admin-sellers.tools.js';
import { getCommissionSettings, setCommissionSettings } from './seller.commission.js';
import {
  cancelStockNoteSchema,
  declinePayoutRequestSchema,
  idParamSchema as requestIdParamSchema,
  payPayoutRequestSchema,
  receiveStockNoteSchema,
  staffPayoutRequestsQuerySchema,
  staffStockNotesQuerySchema,
} from './seller-requests.schema.js';
import {
  cancelStockNote,
  declinePayoutRequest,
  listPayoutRequests,
  listStockNotes,
  payPayoutRequest,
  receiveStockNote,
} from './seller-requests.service.js';

/**
 * Staff-facing seller API (ADMIN, OPERATIONS), mounted at /api/v1/admin next to the other admin
 * routes. Contract: docs/superpowers/plans/2026-10-24-seller-portal.md ("Staff side"); the rules
 * live in admin-sellers.service.ts.
 *
 *   GET    /admin/sellers                              ?status=&search=
 *   POST   /admin/sellers                              add a seller (invite-only, 2026-10-24)
 *   GET    /admin/sellers/:id                          seller + statement (?from=&to=)
 *   PATCH  /admin/sellers/:id                          approve / reject / suspend, commission, commission_free_until, shop details
 *   GET    /admin/sellers/:id/products                 what the seller sells (LIVE / PAUSED / OFF)      (admin-sellers.tools.ts)
 *   POST   /admin/sellers/:id/products                 add a live product for the seller (photo required)
 *   PUT    /admin/sellers/:id/location                 { latitude, longitude, how_to_find? } - approved at once
 *   POST   /admin/sellers/:id/location/approve         the seller's waiting shop pin becomes the one in use
 *   POST   /admin/sellers/:id/location/reject          { reason }
 *   GET    /admin/seller-submissions                   ?status=PENDING (default)&seller_id=
 *   POST   /admin/seller-submissions/:id/approve       { selling_price?, category_id? }
 *   POST   /admin/seller-submissions/:id/reject        { reason }
 *   POST   /admin/sellers/:id/payouts                  { amount, note?, paid_on? }
 *   DELETE /admin/sellers/:id/payouts/:payoutId
 *   GET    /admin/settings/seller-commission           default % + category rates (seller.commission.ts)
 *   PUT    /admin/settings/seller-commission           { default_percent, free_days?, categories?: [{ category_id, percent|null }] }
 *   GET    /admin/seller-stock-notes                   ?status=SENT (default)&seller_id=   (migration 057)
 *   POST   /admin/seller-stock-notes/:id/receive       { received_quantity } - onto the tracked stock
 *   POST   /admin/seller-stock-notes/:id/cancel        { reason? }
 *   GET    /admin/seller-payout-requests               ?status=REQUESTED (default)&seller_id=
 *   POST   /admin/seller-payout-requests/:id/pay       { paid_on?, note? } - records the payout
 *   POST   /admin/seller-payout-requests/:id/decline   { reason }
 *
 * The role check is per route, not router-wide: this router sits in front of the rest of /admin.
 */
export const adminSellersRouter = Router();

const staff = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

adminSellersRouter.get(
  '/sellers',
  ...staff,
  validate({ query: listSellersQuerySchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listSellers(req.query as never) });
  })
);

adminSellersRouter.post(
  '/sellers',
  ...staff,
  validate({ body: createSellerSchema }),
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: await createSeller(req.body, actorOf(req)) });
  })
);

adminSellersRouter.get(
  '/sellers/:id',
  ...staff,
  validate({ params: idParamSchema, query: sellerDetailQuerySchema }),
  handle(async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    res.status(200).json({ success: true, data: await getSeller(req.params.id as string, { from, to }) });
  })
);

adminSellersRouter.patch(
  '/sellers/:id',
  ...staff,
  validate({ params: idParamSchema, body: patchSellerSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await updateSeller(req.params.id as string, req.body, actorOf(req)) });
  })
);

adminSellersRouter.get(
  '/sellers/:id/products',
  ...staff,
  validate({ params: idParamSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listSellerProducts(req.params.id as string) });
  })
);

adminSellersRouter.post(
  '/sellers/:id/products',
  ...staff,
  validate({ params: idParamSchema, body: createSellerProductSchema }),
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: await createSellerProduct(req.params.id as string, req.body, actorOf(req)) });
  })
);

adminSellersRouter.put(
  '/sellers/:id/location',
  ...staff,
  validate({ params: idParamSchema, body: adminSellerLocationSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await setSellerLocation(req.params.id as string, req.body, actorOf(req)) });
  })
);

adminSellersRouter.post(
  '/sellers/:id/location/approve',
  ...staff,
  validate({ params: idParamSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await approveLocation(req.params.id as string, actorOf(req)) });
  })
);

adminSellersRouter.post(
  '/sellers/:id/location/reject',
  ...staff,
  validate({ params: idParamSchema, body: rejectLocationSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await rejectLocation(req.params.id as string, req.body.reason, actorOf(req)) });
  })
);

adminSellersRouter.get(
  '/seller-submissions',
  ...staff,
  validate({ query: listSubmissionsQuerySchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listSubmissions(req.query as never) });
  })
);

adminSellersRouter.post(
  '/seller-submissions/:id/approve',
  ...staff,
  validate({ params: idParamSchema, body: approveSubmissionSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await approveSubmission(req.params.id as string, req.body, actorOf(req)) });
  })
);

adminSellersRouter.post(
  '/seller-submissions/:id/reject',
  ...staff,
  validate({ params: idParamSchema, body: rejectSubmissionSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await rejectSubmission(req.params.id as string, req.body.reason, actorOf(req)) });
  })
);

adminSellersRouter.post(
  '/sellers/:id/payouts',
  ...staff,
  validate({ params: idParamSchema, body: recordPayoutSchema }),
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: await recordPayout(req.params.id as string, req.body, actorOf(req)) });
  })
);

adminSellersRouter.delete(
  '/sellers/:id/payouts/:payoutId',
  ...staff,
  validate({ params: payoutParamSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await deletePayout(req.params.id as string, req.params.payoutId as string, actorOf(req)) });
  })
);

// ----------------------------------------------------------------------------
// Commission settings (seller.commission.ts)
// ----------------------------------------------------------------------------

adminSellersRouter.get(
  '/settings/seller-commission',
  ...staff,
  handle(async (_req, res) => {
    res.status(200).json({ success: true, data: await getCommissionSettings() });
  })
);

adminSellersRouter.put(
  '/settings/seller-commission',
  ...staff,
  validate({ body: commissionSettingsSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await setCommissionSettings(req.body, actorOf(req)) });
  })
);

// ----------------------------------------------------------------------------
// Stock notes and payout requests (migration 057; seller-requests.service.ts)
// ----------------------------------------------------------------------------

adminSellersRouter.get(
  '/seller-stock-notes',
  ...staff,
  validate({ query: staffStockNotesQuerySchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listStockNotes(req.query as never) });
  })
);

adminSellersRouter.post(
  '/seller-stock-notes/:id/receive',
  ...staff,
  validate({ params: requestIdParamSchema, body: receiveStockNoteSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await receiveStockNote(req.params.id as string, req.body.received_quantity, actorOf(req)) });
  })
);

adminSellersRouter.post(
  '/seller-stock-notes/:id/cancel',
  ...staff,
  validate({ params: requestIdParamSchema, body: cancelStockNoteSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await cancelStockNote(req.params.id as string, req.body.reason ?? null, actorOf(req)) });
  })
);

adminSellersRouter.get(
  '/seller-payout-requests',
  ...staff,
  validate({ query: staffPayoutRequestsQuerySchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listPayoutRequests(req.query as never) });
  })
);

adminSellersRouter.post(
  '/seller-payout-requests/:id/pay',
  ...staff,
  validate({ params: requestIdParamSchema, body: payPayoutRequestSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await payPayoutRequest(req.params.id as string, req.body, actorOf(req)) });
  })
);

adminSellersRouter.post(
  '/seller-payout-requests/:id/decline',
  ...staff,
  validate({ params: requestIdParamSchema, body: declinePayoutRequestSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await declinePayoutRequest(req.params.id as string, req.body.reason, actorOf(req)) });
  })
);
