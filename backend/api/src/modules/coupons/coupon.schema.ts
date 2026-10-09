import { z } from 'zod';
import { orderItemInputSchema } from '../orders/order.schema.js';
import { orderComboLineSchema } from '../catalog/catalog.combos.js';

/** A-Z and 0-9, 4-20 characters; typed in any case, stored upper-case. */
export const couponCodeSchema = z
  .string({ required_error: 'code is required', invalid_type_error: 'code must be a string' })
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{4,20}$/, 'Coupon codes are 4-20 letters or digits'));

const money = z.coerce.number().min(0).max(10_000_000).transform((v) => Number(v.toFixed(2)));
const optionalMoney = money.nullable().optional();
const optionalDate = z.coerce.date({ invalid_type_error: 'Invalid date' }).nullable().optional();
const optionalLimit = z.coerce.number().int().min(1).max(1_000_000).nullable().optional();

const couponFields = z.object({
  description: z.string().trim().max(200).nullable().optional(),
  discount_type: z.enum(['FIXED', 'PERCENT', 'FREE_DELIVERY']),
  discount_value: money.optional(),
  max_discount: optionalMoney,
  min_subtotal: optionalMoney,
  first_order_only: z.boolean().optional(),
  starts_at: optionalDate,
  ends_at: optionalDate,
  usage_limit: optionalLimit,
  per_customer_limit: z.coerce.number().int().min(1).max(1000).optional(),
  is_active: z.boolean().optional(),
});

type CouponFields = z.infer<typeof couponFields>;

/** Rules that span fields; the database CHECKs repeat them. */
function checkTypeRules(v: Partial<CouponFields>, ctx: z.RefinementCtx) {
  const value = v.discount_value ?? 0;
  if (v.discount_type === 'FIXED' && !(value > 0)) {
    ctx.addIssue({ code: 'custom', path: ['discount_value'], message: 'A fixed discount needs an amount above 0' });
  }
  if (v.discount_type === 'PERCENT' && !(value >= 1 && value <= 100)) {
    ctx.addIssue({ code: 'custom', path: ['discount_value'], message: 'A percentage must be between 1 and 100' });
  }
  if (v.discount_type !== 'PERCENT' && v.max_discount != null) {
    ctx.addIssue({ code: 'custom', path: ['max_discount'], message: 'Only a percentage discount has a maximum' });
  }
  if (v.max_discount != null && !(v.max_discount > 0)) {
    ctx.addIssue({ code: 'custom', path: ['max_discount'], message: 'The maximum discount must be above 0' });
  }
}

function checkWindow(v: Partial<CouponFields>, ctx: z.RefinementCtx) {
  if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at) {
    ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'The end must be after the start' });
  }
}

export const createCouponSchema = couponFields.extend({ code: couponCodeSchema }).superRefine((v, ctx) => {
  checkTypeRules(v, ctx);
  checkWindow(v, ctx);
});
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

/** Everything but the code can change; the type and its value are sent together. */
export const updateCouponSchema = couponFields.partial().superRefine((v, ctx) => {
  if (v.discount_type !== undefined) checkTypeRules(v, ctx);
  else if (v.discount_value !== undefined || v.max_discount !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['discount_type'], message: 'Send discount_type with discount_value / max_discount' });
  }
  checkWindow(v, ctx);
});
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

export const couponIdParamsSchema = z.object({ id: z.string().uuid('Invalid coupon ID') });

/** POST /orders/validate-coupon: the cart's lines (priced by the server) or a subtotal. */
export const validateCouponSchema = z
  .object({
    code: couponCodeSchema,
    items: z.array(orderItemInputSchema).max(50).optional(),
    /** Migration 033: combo packs in the cart, priced like the order will price them. */
    combos: z.array(orderComboLineSchema).max(20).optional(),
    subtotal: z.coerce.number().min(0).max(10_000_000).optional(),
  })
  .refine((v) => (v.items?.length ?? 0) + (v.combos?.length ?? 0) > 0 || v.subtotal !== undefined, {
    message: 'Send the cart items or its subtotal',
    path: ['items'],
  });
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
