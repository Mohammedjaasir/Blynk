import { db } from '../../database/connection.js';
import type { OrderStatus } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { recomputeOrderDiscount } from '../coupons/coupon.service.js';
import { recomputeOrderRewards } from '../loyalty/order-rewards.js';
import { cannotRecordForSelf } from '../riders/self-record.js';
import { settleWalletAfterItemChange } from '../wallet/wallet.service.js';
import { updateOrderFields } from './lifecycle/status-writer.js';

/**
 * "Make delivery free" (owner, 2026-10-21: "if the admin is willing to give
 * free delivery for the particular order they can give"). Admin and
 * Operations, POST /admin/orders/:id/waive-delivery-fee.
 *
 * The order's charged delivery fee becomes 0 and the money that follows from
 * it is worked out again under the order lock, the way RESOLVE_ITEM does it:
 * a coupon's discount, Blynk Points (never more than is now due) and the
 * Blynk Wallet part (its surplus goes back to the wallet), then the total and
 * the unpaid payments row - which for cash on delivery is exactly what the
 * rider collects. orders.standard_delivery_fee keeps the fee, so a
 * commission rider is still paid on it and staff can see what was waived.
 *
 * Only while the order is open and still to be paid in cash (COD): an order
 * paid online (or waiting for PayHere, whose amount is fixed) is refused -
 * staff use "Refund to wallet" -> delivery fee for those. No SMS is sent; the
 * customer's app reads the new total from the order.
 *
 * Audited (ORDER_DELIVERY_FEE_WAIVED) with the old and new money and who did
 * it; the admin order detail reads the latest entry back (no migration).
 */
export const WAIVE_DELIVERY_FEE_ACTION = 'ORDER_DELIVERY_FEE_WAIVED';

/** The order states in which the fee may still be waived (before it is delivered or closed). */
export const WAIVABLE_ORDER_STATUSES: readonly OrderStatus[] = ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED', 'OUT_FOR_DELIVERY'];

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface DeliveryFeeWaiver {
  /** The fee that was charged before staff made the delivery free. */
  original_fee: number;
  reason: string | null;
  waived_by_name: string | null;
  waived_at: Date;
}

export async function waiveDeliveryFee(orderId: string, reason: string | undefined, actor: AuditActor) {
  const note = reason?.trim() || null;
  const result = await db.transaction().execute(async (trx) => {
    const order = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    // Never your own order (owner, 2026-10-12: staff never credit themselves).
    if (order.customer_id === actor.actorId) throw cannotRecordForSelf('a free delivery');
    if (!WAIVABLE_ORDER_STATUSES.includes(order.order_status)) {
      throw new AppError('Delivery can only be made free before the order is delivered or closed.', 409, 'ORDER_NOT_OPEN', {
        order_status: order.order_status,
      });
    }
    if (order.payment_method !== 'COD' || order.payment_status === 'PAID') {
      throw new AppError(
        "This order is paid online, so its total can't change. Use Refund to wallet -> delivery fee instead.",
        409,
        'ORDER_PAID_ONLINE',
        { payment_method: order.payment_method, payment_status: order.payment_status }
      );
    }
    const oldFee = Number(order.delivery_fee);
    if (!(oldFee > 0)) {
      throw new AppError('Delivery is already free on this order.', 409, 'DELIVERY_ALREADY_FREE');
    }
    // A free-delivery coupon or referral reward already takes the fee off.
    const [coupon, referral] = await Promise.all([
      trx
        .selectFrom('coupon_redemptions')
        .innerJoin('coupons', 'coupons.id', 'coupon_redemptions.coupon_id')
        .select('coupons.discount_type')
        .where('coupon_redemptions.order_id', '=', order.id)
        .executeTakeFirst(),
      trx.selectFrom('referral_rewards').select('mode').where('order_id', '=', order.id).executeTakeFirst(),
    ]);
    if (coupon?.discount_type === 'FREE_DELIVERY' || referral?.mode === 'FREE_DELIVERY') {
      throw new AppError(
        `Delivery is already free on this order (its ${coupon?.discount_type === 'FREE_DELIVERY' ? 'coupon' : 'referral reward'}).`,
        409,
        'DELIVERY_ALREADY_FREE'
      );
    }

    // The money again with no delivery fee (as RESOLVE_ITEM, the subtotal unchanged).
    const subtotal = Number(order.subtotal_amount);
    const birthday = Number(order.birthday_discount_amount ?? 0);
    const offer =
      birthday > 0
        ? birthday
        : order.coupon_code
          ? await recomputeOrderDiscount(trx, order.id, subtotal, 0)
          : Number(order.discount_amount ?? 0);
    const rewards = await recomputeOrderRewards(trx, { ...order, delivery_fee: 0 }, subtotal, offer);
    const due = round2(subtotal - rewards.discount_amount);
    const wallet = await settleWalletAfterItemChange(trx, order, due, 'Delivery fee', new Date(), {
      refund: `Delivery made free on order ${order.order_number}`,
      returned: `Delivery made free on order ${order.order_number} - wallet payment returned`,
    });
    const total = wallet.total_amount;

    const updated = await updateOrderFields(trx, order, {
      delivery_fee: 0,
      // Rider pay is worked out on the standard fee; keep it for older rows without one.
      ...(order.standard_delivery_fee == null ? { standard_delivery_fee: oldFee } : {}),
      discount_amount: rewards.discount_amount,
      ...rewards.fields,
      ...(Number(order.wallet_amount_used ?? 0) > 0 ? { wallet_amount_used: wallet.wallet_amount_used } : {}),
      total_amount: total,
    });
    // What is still to collect (cash on delivery).
    await trx
      .updateTable('payments')
      .set({ amount: total, updated_at: new Date() })
      .where('order_id', '=', order.id)
      .where('payment_status', '!=', 'PAID')
      .execute();

    const money = (o: typeof order) => ({
      delivery_fee: Number(o.delivery_fee),
      discount_amount: Number(o.discount_amount ?? 0),
      points_redeemed: Number(o.points_redeemed ?? 0),
      wallet_amount_used: Number(o.wallet_amount_used ?? 0),
      total_amount: Number(o.total_amount),
    });
    await writeAudit(trx, actor, {
      action: WAIVE_DELIVERY_FEE_ACTION,
      entityType: 'ORDER',
      entityId: order.id,
      oldValues: money(order),
      newValues: { ...money(updated), order_number: order.order_number, customer_id: order.customer_id, reason: note },
    });
    return { oldFee, oldTotal: Number(order.total_amount), total };
  });
  logger.info({ orderId, ...result, actorId: actor.actorId }, 'Order delivery fee waived by staff');
  return result;
}

/**
 * The latest "Make delivery free" on an order, for the staff order detail
 * (read from the audit log; null when staff never waived its fee).
 */
export async function deliveryFeeWaiver(orderId: string): Promise<DeliveryFeeWaiver | null> {
  const row = await db
    .selectFrom('audit_logs')
    .leftJoin('users', 'users.id', 'audit_logs.actor_user_id')
    .select(['audit_logs.old_values', 'audit_logs.new_values', 'audit_logs.created_at', 'users.full_name', 'users.email'])
    .where('audit_logs.entity_type', '=', 'ORDER')
    .where('audit_logs.entity_id', '=', orderId)
    .where('audit_logs.action', '=', WAIVE_DELIVERY_FEE_ACTION)
    .orderBy('audit_logs.created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  const json = (v: unknown): Record<string, unknown> => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  };
  const before = json(row.old_values);
  const after = json(row.new_values);
  return {
    original_fee: Number(before.delivery_fee ?? 0),
    reason: typeof after.reason === 'string' && after.reason ? after.reason : null,
    waived_by_name: row.full_name ?? row.email ?? null,
    waived_at: row.created_at,
  };
}
