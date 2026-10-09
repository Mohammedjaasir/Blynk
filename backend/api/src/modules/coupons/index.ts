import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { couponService } from './coupon.service.js';
import {
  couponIdParamsSchema,
  createCouponSchema,
  updateCouponSchema,
  type CreateCouponInput,
  type UpdateCouponInput,
} from './coupon.schema.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

// ----------------------------------------------------------------------------
// ADMIN COUPONS (mounted under /api/v1/admin). ADMIN and OPERATIONS (owner,
// 2026-10-10: "make sure admin and ops can create a coupon code for
// customers"). Every create, change and delete is audited (COUPON_CREATED,
// COUPON_UPDATED, COUPON_DELETED) with who did it.
// ----------------------------------------------------------------------------
export const adminCouponsRouter = Router();
const COUPON_STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];
const actorOf = (req: Request) => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

adminCouponsRouter.get(
  '/coupons',
  ...COUPON_STAFF,
  wrap(async (_req, res) => {
    res.json({ success: true, data: { coupons: await couponService.list() } });
  })
);

adminCouponsRouter.post(
  '/coupons',
  ...COUPON_STAFF,
  validate({ body: createCouponSchema }),
  wrap(async (req, res) => {
    const coupon = await couponService.create(req.body as CreateCouponInput, actorOf(req));
    res.status(201).json({ success: true, data: { coupon } });
  })
);

adminCouponsRouter.patch(
  '/coupons/:id',
  ...COUPON_STAFF,
  validate({ params: couponIdParamsSchema, body: updateCouponSchema }),
  wrap(async (req, res) => {
    const coupon = await couponService.update(req.params.id as string, req.body as UpdateCouponInput, actorOf(req));
    res.json({ success: true, data: { coupon } });
  })
);

adminCouponsRouter.delete(
  '/coupons/:id',
  ...COUPON_STAFF,
  validate({ params: couponIdParamsSchema }),
  wrap(async (req, res) => {
    await couponService.remove(req.params.id as string, actorOf(req));
    res.json({ success: true, data: { deleted: true } });
  })
);

export * from './coupon.schema.js';
export * from './coupon.rules.js';
export * from './coupon.service.js';
