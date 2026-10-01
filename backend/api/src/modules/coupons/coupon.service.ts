import { sql, type Selectable } from 'kysely';
import { db } from '../../database/connection.js';
import type { DBConnection } from '../orders/order.repository.js';
import type { CouponsTable } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { computeDiscount } from './coupon.rules.js';
import type { CreateCouponInput, UpdateCouponInput } from './coupon.schema.js';

export type CouponRow = Selectable<CouponsTable>;

export interface AppliedCoupon {
  coupon_id: string;
  code: string;
  discount_type: CouponRow['discount_type'];
  description: string | null;
  discount_amount: number;
}

/** Uses that still count: a cancelled order's redemption is released. */
async function liveUses(executor: DBConnection, couponId: string, customerId?: string): Promise<number> {
  let q = executor
    .selectFrom('coupon_redemptions')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('coupon_id', '=', couponId)
    .where('released_at', 'is', null);
  if (customerId) q = q.where('customer_id', '=', customerId);
  return (await q.executeTakeFirstOrThrow()).n;
}

/** "First order" = no earlier order of theirs that is not CANCELLED. */
async function hasEarlierOrder(executor: DBConnection, customerId: string): Promise<boolean> {
  const row = await executor
    .selectFrom('orders')
    .select('id')
    .where('customer_id', '=', customerId)
    .where('order_status', '!=', 'CANCELLED')
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

const lkr = (n: number) => `LKR ${n.toFixed(2)}`;

/**
 * Checks a code for this customer and cart and returns the discount, or
 * throws one AppError (422) with a code the apps show in plain words:
 * COUPON_NOT_FOUND, COUPON_INACTIVE, COUPON_NOT_STARTED, COUPON_EXPIRED,
 * COUPON_LIMIT_REACHED, COUPON_FIRST_ORDER_ONLY, COUPON_MIN_SUBTOTAL.
 *
 * `lock: true` (order creation, inside its transaction) takes the coupon row
 * FOR UPDATE, so two checkouts racing for the last use are serialised and the
 * limits hold.
 */
export async function evaluateCoupon(
  executor: DBConnection,
  params: { code: string; customerId: string; subtotal: number; deliveryFee: number; lock?: boolean; now?: Date }
): Promise<AppliedCoupon> {
  const code = params.code.trim().toUpperCase();
  let q = executor.selectFrom('coupons').selectAll().where('code', '=', code);
  if (params.lock) q = q.forUpdate();
  const coupon = await q.executeTakeFirst();
  if (!coupon) throw new AppError('That coupon code does not exist.', 422, 'COUPON_NOT_FOUND', { code });

  const now = params.now ?? new Date();
  if (!coupon.is_active) throw new AppError('This coupon is no longer active.', 422, 'COUPON_INACTIVE', { code });
  if (coupon.starts_at && now < coupon.starts_at) {
    throw new AppError('This coupon is not valid yet.', 422, 'COUPON_NOT_STARTED', { code, starts_at: coupon.starts_at });
  }
  if (coupon.ends_at && now >= coupon.ends_at) {
    throw new AppError('This coupon has expired.', 422, 'COUPON_EXPIRED', { code, ends_at: coupon.ends_at });
  }
  if (coupon.usage_limit != null && (await liveUses(executor, coupon.id)) >= coupon.usage_limit) {
    throw new AppError('This coupon has been fully used.', 422, 'COUPON_LIMIT_REACHED', { code, scope: 'TOTAL' });
  }
  if ((await liveUses(executor, coupon.id, params.customerId)) >= coupon.per_customer_limit) {
    throw new AppError('You have already used this coupon.', 422, 'COUPON_LIMIT_REACHED', { code, scope: 'CUSTOMER' });
  }
  if (coupon.first_order_only && (await hasEarlierOrder(executor, params.customerId))) {
    throw new AppError('This coupon is for your first order only.', 422, 'COUPON_FIRST_ORDER_ONLY', { code });
  }
  const min = coupon.min_subtotal != null ? Number(coupon.min_subtotal) : null;
  if (min != null && params.subtotal < min) {
    throw new AppError(`Add items worth ${lkr(min)} or more to use this coupon.`, 422, 'COUPON_MIN_SUBTOTAL', {
      code,
      min_subtotal: min,
      subtotal: params.subtotal,
    });
  }

  return {
    coupon_id: coupon.id,
    code: coupon.code,
    discount_type: coupon.discount_type,
    description: coupon.description,
    discount_amount: computeDiscount(coupon, params.subtotal, params.deliveryFee),
  };
}

/** Inside the order transaction, after the order row exists. */
export async function recordRedemption(
  executor: DBConnection,
  applied: AppliedCoupon,
  orderId: string,
  customerId: string
): Promise<void> {
  await executor
    .insertInto('coupon_redemptions')
    .values({ coupon_id: applied.coupon_id, order_id: orderId, customer_id: customerId, discount_amount: applied.discount_amount })
    .execute();
}

/** Cancelling an order gives the use back (the row stays for the record). */
export async function releaseRedemption(executor: DBConnection, orderId: string): Promise<void> {
  await executor
    .updateTable('coupon_redemptions')
    .set({ released_at: new Date() })
    .where('order_id', '=', orderId)
    .where('released_at', 'is', null)
    .execute();
}

/**
 * The discount after the store removes an item (RESOLVE_ITEM): recomputed on
 * the new subtotal with the coupon's own terms. The minimum subtotal is not
 * re-checked - the customer should not lose the coupon for the store's
 * shortage. Returns 0 when the order has no coupon.
 */
export async function recomputeOrderDiscount(
  executor: DBConnection,
  orderId: string,
  subtotal: number,
  deliveryFee: number
): Promise<number> {
  const row = await executor
    .selectFrom('coupon_redemptions')
    .innerJoin('coupons', 'coupons.id', 'coupon_redemptions.coupon_id')
    .select(['coupon_redemptions.id', 'coupons.discount_type', 'coupons.discount_value', 'coupons.max_discount'])
    .where('coupon_redemptions.order_id', '=', orderId)
    .executeTakeFirst();
  if (!row) return 0;
  const discount = computeDiscount(row, subtotal, deliveryFee);
  await executor.updateTable('coupon_redemptions').set({ discount_amount: discount }).where('id', '=', row.id).execute();
  return discount;
}

// ----------------------------------------------------------------------------
// ADMIN
// ----------------------------------------------------------------------------

function present(row: CouponRow & { usage_count: number }) {
  return {
    ...row,
    discount_value: Number(row.discount_value),
    max_discount: row.max_discount == null ? null : Number(row.max_discount),
    min_subtotal: row.min_subtotal == null ? null : Number(row.min_subtotal),
    usage_count: Number(row.usage_count),
  };
}

const usageCount = sql<number>`(SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = coupons.id AND r.released_at IS NULL)`;

export class CouponService {
  async list() {
    const rows = await db
      .selectFrom('coupons')
      .selectAll()
      .select(usageCount.as('usage_count'))
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(present);
  }

  async get(id: string) {
    const row = await db
      .selectFrom('coupons')
      .selectAll()
      .select(usageCount.as('usage_count'))
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new AppError('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    return present(row);
  }

  async create(input: CreateCouponInput, userId: string) {
    const exists = await db.selectFrom('coupons').select('id').where('code', '=', input.code).executeTakeFirst();
    if (exists) throw new AppError('A coupon with this code already exists.', 409, 'COUPON_CODE_TAKEN', { code: input.code });
    const row = await db
      .insertInto('coupons')
      .values({
        code: input.code,
        description: input.description ?? null,
        discount_type: input.discount_type,
        discount_value: input.discount_type === 'FREE_DELIVERY' ? 0 : input.discount_value ?? 0,
        max_discount: input.discount_type === 'PERCENT' ? input.max_discount ?? null : null,
        min_subtotal: input.min_subtotal ?? null,
        first_order_only: input.first_order_only ?? false,
        starts_at: input.starts_at ?? null,
        ends_at: input.ends_at ?? null,
        usage_limit: input.usage_limit ?? null,
        per_customer_limit: input.per_customer_limit ?? 1,
        is_active: input.is_active ?? true,
        created_by_user_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .catch((err: { code?: string }) => {
        // A concurrent create of the same code.
        if (err.code === '23505') throw new AppError('A coupon with this code already exists.', 409, 'COUPON_CODE_TAKEN');
        throw err;
      });
    return this.get(row.id);
  }

  async update(id: string, input: UpdateCouponInput) {
    const current = await this.get(id);
    const next: UpdateCouponInput = {
      ...input,
      ...(input.discount_type === 'FREE_DELIVERY' ? { discount_value: 0, max_discount: null } : {}),
      ...(input.discount_type === 'FIXED' ? { max_discount: null } : {}),
    };
    const starts = next.starts_at !== undefined ? next.starts_at : current.starts_at;
    const ends = next.ends_at !== undefined ? next.ends_at : current.ends_at;
    if (starts && ends && ends <= starts) {
      throw new AppError('Request validation failed', 400, 'VALIDATION_ERROR', [
        { field: 'ends_at', message: 'The end must be after the start' },
      ]);
    }
    if (Object.keys(next).length > 0) {
      await db
        .updateTable('coupons')
        .set({ ...next, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
    }
    return this.get(id);
  }

  /** Only a coupon nobody has used; otherwise switch it off. */
  async remove(id: string) {
    const current = await this.get(id);
    const used = await db.selectFrom('coupon_redemptions').select('id').where('coupon_id', '=', id).limit(1).executeTakeFirst();
    if (used) {
      throw new AppError('This coupon has been used on orders; switch it off instead.', 409, 'COUPON_IN_USE', {
        code: current.code,
      });
    }
    await db.deleteFrom('coupons').where('id', '=', id).execute();
  }
}

export const couponService = new CouponService();
