import type { DBConnection } from '../orders/order.repository.js';
import type { OrderRow } from '../orders/lifecycle/types.js';
import { round2 } from './program-settings.js';
import { pointsValue } from './points.rules.js';
import {
  completeReferralOnDelivery,
  recomputeReferralDiscount,
  recordReferralUse,
  referralCandidate,
  referralSettings,
  releaseReferralUse,
  type AppliedReferral,
} from '../referrals/referral.service.js';
import { referralBeatsOther } from '../referrals/referral.rules.js';
import {
  decidePointsUse,
  earnPointsForOrder,
  pointsBalance,
  pointsSettings,
  recordPointsRedemption,
  refundPointsForOrder,
  trimPointsForOrder,
  type PointsUse,
} from './points.service.js';

/**
 * The small hooks the order code calls for refer-a-friend and Blynk Points
 * (owner, 2026-10-10; migration 037), so the order module only needs a line
 * at each point:
 *
 *   checkout (order.repository createOrderAtomic, in its transaction)
 *     1. coupon vs birthday gift - existing rule, larger wins (tie: coupon)
 *     2. referralForOrder        - the referral reward only when STRICTLY
 *                                  larger than step 1's winner (no stacking)
 *     3. pointsForOrder          - points pay part of what is still due
 *                                  (combine with any of the above)
 *     4. recordOrderRewards      - after the order row exists
 *   delivered (lifecycle settleCod)   onOrderDeliveredRewards
 *   cancelled (lifecycle cancelOrder) onOrderCancelledRewards
 *   item removed (RESOLVE_ITEM)       recomputeOrderRewards
 */

/** Step 2: the referral reward if it beats `otherDiscount` (the coupon/birthday chosen), else null. */
export async function referralForOrder(
  trx: DBConnection,
  params: { customerId: string; subtotal: number; deliveryFee: number; otherDiscount: number | null }
): Promise<AppliedReferral | null> {
  const setting = await referralSettings.read();
  const candidate = await referralCandidate(trx, { ...params, setting, lock: true });
  return candidate && referralBeatsOther(candidate.discount_amount, params.otherDiscount) ? candidate : null;
}

/** Step 3: points used on this order when the customer asked (`use`), else null. */
export async function pointsForOrder(
  trx: DBConnection,
  params: { customerId: string; due: number; use: boolean | undefined; now: Date }
): Promise<PointsUse | null> {
  if (!params.use) return null;
  const setting = await pointsSettings.read();
  return await decidePointsUse(trx, { customerId: params.customerId, due: round2(params.due), setting, now: params.now });
}

/** Step 4. */
export async function recordOrderRewards(
  trx: DBConnection,
  params: { orderId: string; customerId: string; referral: AppliedReferral | null; points: PointsUse | null; now: Date }
): Promise<void> {
  if (params.referral) await recordReferralUse(trx, params.referral, params.orderId, params.customerId);
  if (params.points) await recordPointsRedemption(trx, params.points, params.orderId, params.customerId, params.now);
}

/** The order columns for the insert. */
export function orderRewardColumns(referral: AppliedReferral | null, points: PointsUse | null) {
  return {
    referral_discount_amount: referral?.discount_amount ?? 0,
    points_redeemed: points?.points ?? 0,
    points_discount_amount: points?.discount_amount ?? 0,
  };
}

/** Delivered: the friend's referral completes (inviter credited) and the order earns points. */
export async function onOrderDeliveredRewards(trx: DBConnection, order: OrderRow): Promise<void> {
  await completeReferralOnDelivery(trx, order);
  await earnPointsForOrder(trx, order);
}

/** Cancelled: referral reward released, points given back. */
export async function onOrderCancelledRewards(trx: DBConnection, order: OrderRow): Promise<void> {
  await releaseReferralUse(trx, order.id);
  await refundPointsForOrder(trx, order);
}

/**
 * RESOLVE_ITEM: `offerDiscount` is what the existing code worked out for the
 * coupon / birthday gift on the new subtotal (or the old discount_amount
 * when the order had neither). Returns the order's new discount_amount and
 * the reward columns to write.
 */
export async function recomputeOrderRewards(
  trx: DBConnection,
  order: OrderRow,
  subtotal: number,
  offerDiscount: number
): Promise<{ discount_amount: number; fields: Record<string, number> }> {
  const fee = Number(order.delivery_fee);
  const hadPoints = Number(order.points_redeemed ?? 0) > 0;
  const hadReferral = Number(order.referral_discount_amount ?? 0) > 0;
  if (!hadPoints && !hadReferral) return { discount_amount: offerDiscount, fields: {} };

  let offer = offerDiscount;
  const fields: Record<string, number> = {};
  if (hadReferral) {
    offer = (await recomputeReferralDiscount(trx, order.id, subtotal, fee)) ?? 0;
    fields.referral_discount_amount = offer;
  } else if (!(Number(order.birthday_discount_amount ?? 0) > 0) && !order.coupon_code) {
    // No coupon or gift: the old discount_amount was only the points.
    offer = 0;
  }
  if (hadPoints) {
    const due = round2(Math.max(0, subtotal + fee - offer));
    const kept = await trimPointsForOrder(trx, order, due);
    fields.points_redeemed = kept.points;
    fields.points_discount_amount = kept.discount_amount;
    return { discount_amount: round2(offer + kept.discount_amount), fields };
  }
  return { discount_amount: round2(offer), fields };
}

// ---------------------------------------------------------------------------
// Advisory reads for the app (the order decides again under its locks)
// ---------------------------------------------------------------------------

/** POST /orders/validate-coupon: the referral reward this cart would get (no lock), or null. */
export async function previewReferral(
  executor: DBConnection,
  params: { customerId: string; subtotal: number; deliveryFee: number }
): Promise<AppliedReferral | null> {
  const setting = await referralSettings.read();
  return await referralCandidate(executor, { ...params, setting });
}

/**
 * GET /orders/checkout-info additions: the referral reward waiting for this
 * customer (applied automatically when it is the larger discount) and their
 * Blynk Points with the program's numbers, so the cart can say "You'll earn
 * N points" and checkout can offer "Use points".
 */
export async function checkoutRewardsInfo(executor: DBConnection, customerId: string, deliveryFee: number) {
  const [referralSetting, pointsSetting] = await Promise.all([referralSettings.read(), pointsSettings.read()]);
  // A large notional cart: which reward is waiting, not what it takes off this one.
  const referral = await referralCandidate(executor, { customerId, subtotal: 1e9, deliveryFee: deliveryFee > 0 ? deliveryFee : 1, setting: referralSetting });
  const balance = pointsSetting.enabled ? await pointsBalance(executor, customerId) : 0;
  return {
    referral_reward: referral
      ? { available: true, side: referral.side, mode: referral.mode, amount_lkr: referral.amount }
      : { available: false, side: null, mode: null, amount_lkr: 0 },
    points: {
      enabled: pointsSetting.enabled,
      balance,
      value_lkr: pointsValue(balance, pointsSetting.lkr_per_point),
      earn_points: pointsSetting.earn_points,
      earn_per_lkr: pointsSetting.earn_per_lkr,
      lkr_per_point: pointsSetting.lkr_per_point,
      min_redeem_points: pointsSetting.min_redeem_points,
      max_redeem_percent: pointsSetting.max_redeem_percent,
    },
  };
}
