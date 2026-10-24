import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import type { AuditActor } from '../audit/audit.writer.js';
import {
  approveSubmissionSchema,
  idParamSchema,
  listSellersQuerySchema,
  listSubmissionsQuerySchema,
  patchSellerSchema,
  payoutParamSchema,
  recordPayoutSchema,
  rejectSubmissionSchema,
  sellerDetailQuerySchema,
} from './admin-sellers.schema.js';
import {
  approveSubmission,
  deletePayout,
  getSeller,
  listSellers,
  listSubmissions,
  recordPayout,
  rejectSubmission,
  updateSeller,
} from './admin-sellers.service.js';

/**
 * Staff-facing seller API (ADMIN, OPERATIONS), mounted at /api/v1/admin next to the other admin
 * routes. Contract: docs/superpowers/plans/2026-10-24-seller-portal.md ("Staff side"); the rules
 * live in admin-sellers.service.ts.
 *
 *   GET    /admin/sellers                              ?status=&search=
 *   GET    /admin/sellers/:id                          seller + statement (?from=&to=)
 *   PATCH  /admin/sellers/:id                          approve / reject / suspend, commission
 *   GET    /admin/seller-submissions                   ?status=PENDING (default)&seller_id=
 *   POST   /admin/seller-submissions/:id/approve       { selling_price?, category_id? }
 *   POST   /admin/seller-submissions/:id/reject        { reason }
 *   POST   /admin/sellers/:id/payouts                  { amount, note?, paid_on? }
 *   DELETE /admin/sellers/:id/payouts/:payoutId
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
