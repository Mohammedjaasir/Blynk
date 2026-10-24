import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles, requireShopper } from '../../middleware/role.middleware.js';
import type { AuditActor } from '../audit/audit.writer.js';
import { customerBuyAgain } from './buy-again.service.js';
import { requireRepeatReady } from './repeat.ready.js';
import {
  createBasketSchema,
  fromOrderSchema,
  idParamSchema,
  orderIdParamSchema,
  patchBasketSchema,
  staffListQuerySchema,
  staffPatchSchema,
} from './repeat.schema.js';
import {
  cancelCustomerBasket,
  createBasketFromOrder,
  createCustomerBasket,
  listCustomerBaskets,
  listStaffBaskets,
  patchCustomerBasket,
  patchStaffBasket,
  toggleSkipNext,
} from './repeat.service.js';

/**
 * Buy again + repeat baskets (owner, 2026-10-24; contract
 * docs/superpowers/plans/2026-10-24-buy-again-repeat.md).
 *
 * Customer (mounted under /me; shoppers = customers and staff shopping with their own number):
 *   GET    /me/buy-again                              most-bought products (no migration)
 *   GET    /me/repeat-baskets                         my baskets (not cancelled), last run, estimate
 *   POST   /me/repeat-baskets                         { name?, items, frequency, weekday?, place_at, address_id, notes?, start_date? }
 *   POST   /me/repeat-baskets/from-order/:orderId     { frequency, weekday?, place_at, address_id?, name?, notes?, start_date? }
 *   PATCH  /me/repeat-baskets/:id                     any of the above + status ACTIVE | PAUSED
 *   POST   /me/repeat-baskets/:id/skip-next           toggles "skip the next one"
 *   DELETE /me/repeat-baskets/:id                     cancels it
 *
 * Staff (ADMIN, OPERATIONS; mounted under /admin, role checked per route):
 *   GET    /admin/repeat-baskets?status=&page=&limit=
 *   PATCH  /admin/repeat-baskets/:id                  { status: PAUSED | ACTIVE | CANCELLED } (audited REPEAT_BASKET_UPDATED)
 *
 * Every repeat-basket route answers 503 REPEAT_NOT_READY until migration 054 exists.
 */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const repeatMeRouter = Router();
const shopper = [requireAuth, requireShopper()];
const basketGuard = [requireAuth, requireShopper(), requireRepeatReady];

repeatMeRouter.get(
  '/buy-again',
  ...shopper,
  handle(async (req, res) => {
    res.json({ success: true, data: await customerBuyAgain(req.user!.id) });
  })
);

repeatMeRouter.get(
  '/repeat-baskets',
  ...basketGuard,
  handle(async (req, res) => {
    res.json({ success: true, data: await listCustomerBaskets(req.user!.id) });
  })
);

repeatMeRouter.post(
  '/repeat-baskets',
  ...basketGuard,
  handle(async (req, res) => {
    const input = createBasketSchema.parse(req.body);
    res.status(201).json({ success: true, data: await createCustomerBasket(req.user!.id, input) });
  })
);

repeatMeRouter.post(
  '/repeat-baskets/from-order/:orderId',
  ...basketGuard,
  handle(async (req, res) => {
    const { orderId } = orderIdParamSchema.parse(req.params);
    const input = fromOrderSchema.parse(req.body ?? {});
    res.status(201).json({ success: true, data: await createBasketFromOrder(req.user!.id, orderId, input) });
  })
);

repeatMeRouter.patch(
  '/repeat-baskets/:id',
  ...basketGuard,
  handle(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = patchBasketSchema.parse(req.body);
    res.json({ success: true, data: await patchCustomerBasket(req.user!.id, id, input) });
  })
);

repeatMeRouter.post(
  '/repeat-baskets/:id/skip-next',
  ...basketGuard,
  handle(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ success: true, data: await toggleSkipNext(req.user!.id, id) });
  })
);

repeatMeRouter.delete(
  '/repeat-baskets/:id',
  ...basketGuard,
  handle(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ success: true, data: await cancelCustomerBasket(req.user!.id, id) });
  })
);

// ----------------------------------------------------------------------------
export const adminRepeatRouter = Router();
const staff = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), requireRepeatReady];
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

adminRepeatRouter.get(
  '/repeat-baskets',
  ...staff,
  handle(async (req, res) => {
    const query = staffListQuerySchema.parse(req.query);
    res.json({ success: true, data: await listStaffBaskets(query) });
  })
);

adminRepeatRouter.patch(
  '/repeat-baskets/:id',
  ...staff,
  handle(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { status } = staffPatchSchema.parse(req.body);
    res.json({ success: true, data: await patchStaffBasket(id, status, actorOf(req)) });
  })
);
