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
// ADMIN COUPONS (mounted under /api/v1/admin). ADMIN only.
// ----------------------------------------------------------------------------
export const adminCouponsRouter = Router();
const ADMIN_ONLY = [requireAuth, requireRoles('ADMIN')];

adminCouponsRouter.get(
  '/coupons',
  ...ADMIN_ONLY,
  wrap(async (_req, res) => {
    res.json({ success: true, data: { coupons: await couponService.list() } });
  })
);

adminCouponsRouter.post(
  '/coupons',
  ...ADMIN_ONLY,
  validate({ body: createCouponSchema }),
  wrap(async (req, res) => {
    const coupon = await couponService.create(req.body as CreateCouponInput, req.user!.id);
    res.status(201).json({ success: true, data: { coupon } });
  })
);

adminCouponsRouter.patch(
  '/coupons/:id',
  ...ADMIN_ONLY,
  validate({ params: couponIdParamsSchema, body: updateCouponSchema }),
  wrap(async (req, res) => {
    const coupon = await couponService.update(req.params.id as string, req.body as UpdateCouponInput);
    res.json({ success: true, data: { coupon } });
  })
);

adminCouponsRouter.delete(
  '/coupons/:id',
  ...ADMIN_ONLY,
  validate({ params: couponIdParamsSchema }),
  wrap(async (req, res) => {
    await couponService.remove(req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  })
);

export * from './coupon.schema.js';
export * from './coupon.rules.js';
export * from './coupon.service.js';
