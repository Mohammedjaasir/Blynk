import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import type { AuditActor } from '../audit/audit.writer.js';
import { requireExpiryReady } from './expiry.ready.js';
import {
  batchIdParamsSchema,
  createBatchSchema,
  discardBatchSchema,
  listBatchesQuerySchema,
  productIdParamsSchema,
  trackingSchema,
  updateBatchSchema,
  type CreateBatchInput,
  type DiscardBatchInput,
  type ListBatchesQuery,
  type UpdateBatchInput,
} from './expiry.rules.js';
import {
  addBatch,
  discardBatch,
  expirySummary,
  listBatches,
  markSoldOut,
  productExpiry,
  setProductExpiryTracking,
  updateBatch,
} from './expiry.service.js';

/**
 * Expiry dates (owner, 2026-10-25; migration 059). Mounted under /admin. The
 * roles are the ones the stock endpoints use (Inventory staff receive stock, so
 * PACKING_STAFF may add and close batches too): ADMIN, OPERATIONS, PACKING_STAFF.
 * Every route answers 503 EXPIRY_NOT_READY until migration 059 exists.
 *
 *   GET   /admin/stock-batches?bucket=expired|week|month|all&product_id=&status=&page=&limit=
 *   GET   /admin/stock-batches/summary                          chips: expired / this week / this month
 *   POST  /admin/stock-batches                                  { product_id, variant_id?, batch_code?, quantity, expires_on, note? }
 *   PATCH /admin/stock-batches/:id                              { batch_code?, quantity?, expires_on?, note? } (ACTIVE only)
 *   POST  /admin/stock-batches/:id/sold-out                     marks it sold (stock untouched)
 *   POST  /admin/stock-batches/:id/discard                      { reason?: EXPIRED|WASTE, reduce_stock?: true, note? }
 *   GET   /admin/stock-batches/product/:productId               the product's switch + open batches
 *   PUT   /admin/stock-batches/product/:productId/tracking      { enabled } ("Track expiry dates")
 */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const staff = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS', 'PACKING_STAFF']), requireExpiryReady];
/** The product form's switch is a catalog setting: ADMIN and OPERATIONS only (like the stock mode). */
const catalogStaff = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), requireExpiryReady];

export const adminExpiryRouter = Router();

// "summary" and "product" before "/:id" so they are not read as a batch id.
adminExpiryRouter.get(
  '/stock-batches/summary',
  ...staff,
  handle(async (_req, res) => {
    res.json({ success: true, data: await expirySummary() });
  })
);

adminExpiryRouter.get(
  '/stock-batches/product/:productId',
  ...staff,
  validate({ params: productIdParamsSchema }),
  handle(async (req, res) => {
    res.json({ success: true, data: await productExpiry(req.params.productId as string) });
  })
);

adminExpiryRouter.put(
  '/stock-batches/product/:productId/tracking',
  ...catalogStaff,
  validate({ params: productIdParamsSchema, body: trackingSchema }),
  handle(async (req, res) => {
    res.json({ success: true, data: await setProductExpiryTracking(req.params.productId as string, req.body.enabled, actorOf(req)) });
  })
);

adminExpiryRouter.get(
  '/stock-batches',
  ...staff,
  validate({ query: listBatchesQuerySchema }),
  handle(async (req, res) => {
    res.json({ success: true, data: await listBatches(req.query as unknown as ListBatchesQuery) });
  })
);

adminExpiryRouter.post(
  '/stock-batches',
  ...staff,
  validate({ body: createBatchSchema }),
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: { batch: await addBatch(req.body as CreateBatchInput, actorOf(req)) } });
  })
);

adminExpiryRouter.patch(
  '/stock-batches/:id',
  ...staff,
  validate({ params: batchIdParamsSchema, body: updateBatchSchema }),
  handle(async (req, res) => {
    res.json({ success: true, data: { batch: await updateBatch(req.params.id as string, req.body as UpdateBatchInput, actorOf(req)) } });
  })
);

adminExpiryRouter.post(
  '/stock-batches/:id/sold-out',
  ...staff,
  validate({ params: batchIdParamsSchema }),
  handle(async (req, res) => {
    res.json({ success: true, data: { batch: await markSoldOut(req.params.id as string, actorOf(req)) } });
  })
);

adminExpiryRouter.post(
  '/stock-batches/:id/discard',
  ...staff,
  validate({ params: batchIdParamsSchema, body: discardBatchSchema }),
  handle(async (req, res) => {
    res.json({ success: true, data: await discardBatch(req.params.id as string, req.body as DiscardBatchInput, actorOf(req)) });
  })
);
