import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import type { AuditActor } from '../audit/audit.writer.js';
import {
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  idParamSchema,
  listPurchaseOrdersQuerySchema,
  patchPurchaseOrderSchema,
  receivePurchaseOrderSchema,
  suggestionsQuerySchema,
} from './purchase-orders.schema.js';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  patchPurchaseOrder,
  receivePurchaseOrder,
  sendPurchaseOrder,
} from './purchase-orders.service.js';
import { requirePurchasingReady } from './purchasing.ready.js';
import { reorderSuggestions } from './reorder.service.js';

/**
 * Reorder suggestions and supplier purchase orders (owner, 2026-10-25; migration 058), mounted at
 * /api/v1/admin next to the other admin routes. ADMIN and OPERATIONS (checked per route: this
 * router sits in front of the rest of /admin). PACKING_STAFF (the Inventory app's Deliveries page) may
 * use only the order list (SENT / PARTIAL unless a status is given), one order and the receive, and
 * sees no money. Every route answers 503 PURCHASING_NOT_READY until
 * the migration has run.
 *
 *   GET   /admin/reorder-suggestions?days=14|28&cover_days=7&lead_days=1   what to buy, grouped by supplier
 *   GET   /admin/purchase-orders?status=ALL|OPEN|DRAFT|SENT|PARTIAL|RECEIVED|CANCELLED&supplier_id=&search=&page=&limit=
 *   POST  /admin/purchase-orders            { supplier_id?, expected_on?, notes?, lines:[{ product_id, variant_id?, ordered_qty, unit_cost?, note? }] }
 *   GET   /admin/purchase-orders/:id        the order with its lines and the share text
 *   PATCH /admin/purchase-orders/:id        { notes?, expected_on?, supplier_id?, lines? } (supplier + lines only while DRAFT)
 *   POST  /admin/purchase-orders/:id/send   DRAFT -> SENT; { message, whatsapp_url } (whatsapp_url only when the supplier has a phone)
 *   POST  /admin/purchase-orders/:id/receive { lines:[{ item_id, received_qty, unit_cost?, update_product_cost? }], close_short? }
 *   POST  /admin/purchase-orders/:id/cancel { reason }
 */
export const adminPurchasingRouter = Router();

const staff = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), requirePurchasingReady];
// Packing staff (the Inventory app's Deliveries page) may only list, open and receive orders.
const receivers = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS', 'PACKING_STAFF']), requirePurchasingReady];

/** Packing staff get the goods without the money (no costs, money totals, supplier phone or share text). */
const viewOf = (req: Request) => ({ redact: req.user!.role === 'PACKING_STAFF' });

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

adminPurchasingRouter.get(
  '/reorder-suggestions',
  ...staff,
  validate({ query: suggestionsQuerySchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await reorderSuggestions(req.query as never) });
  })
);

adminPurchasingRouter.get(
  '/purchase-orders',
  ...receivers,
  validate({ query: listPurchaseOrdersQuerySchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await listPurchaseOrders(req.query as never, viewOf(req)) });
  })
);

adminPurchasingRouter.post(
  '/purchase-orders',
  ...staff,
  validate({ body: createPurchaseOrderSchema }),
  handle(async (req, res) => {
    res.status(201).json({ success: true, data: await createPurchaseOrder(req.body, actorOf(req)) });
  })
);

adminPurchasingRouter.get(
  '/purchase-orders/:id',
  ...receivers,
  validate({ params: idParamSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await getPurchaseOrder(req.params.id as string, viewOf(req)) });
  })
);

adminPurchasingRouter.patch(
  '/purchase-orders/:id',
  ...staff,
  validate({ params: idParamSchema, body: patchPurchaseOrderSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await patchPurchaseOrder(req.params.id as string, req.body, actorOf(req)) });
  })
);

adminPurchasingRouter.post(
  '/purchase-orders/:id/send',
  ...staff,
  validate({ params: idParamSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await sendPurchaseOrder(req.params.id as string, actorOf(req)) });
  })
);

adminPurchasingRouter.post(
  '/purchase-orders/:id/receive',
  ...receivers,
  validate({ params: idParamSchema, body: receivePurchaseOrderSchema }),
  handle(async (req, res) => {
    res.status(200).json({
      success: true,
      data: await receivePurchaseOrder(req.params.id as string, req.body, actorOf(req), viewOf(req)),
    });
  })
);

adminPurchasingRouter.post(
  '/purchase-orders/:id/cancel',
  ...staff,
  validate({ params: idParamSchema, body: cancelPurchaseOrderSchema }),
  handle(async (req, res) => {
    res.status(200).json({ success: true, data: await cancelPurchaseOrder(req.params.id as string, req.body.reason, actorOf(req)) });
  })
);
