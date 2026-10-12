import type { OrderStatus } from '../../database/types.js';
import type { DBConnection } from './order.repository.js';
import { phoneLineageIds } from '../users/phone-identity.js';

/**
 * Free deliveries (owner, 2026-10-08; every customer since 2026-10-09): while
 * the switch is on, a customer's first `count` orders since `since` carry no
 * delivery fee.
 *
 * What uses one up: every earlier order except a CANCELLED or FAILED one. A
 * cancelled order never went out and a failed delivery was not delivered, so
 * the customer keeps that free delivery. Anything else (placed, packing, on
 * the way, delivered, customer unavailable, item unavailable) counts.
 */
export const FREE_DELIVERY_NOT_USED_BY: OrderStatus[] = ['CANCELLED', 'FAILED'];

/**
 * Free deliveries for every customer (owner, 2026-10-09): every customer,
 * existing ones included, gets `count` free deliveries counted from `since`.
 * Orders placed before `since` never use one up. "Start again from today" in
 * Admin/Operations moves `since` to now, giving everyone `count` again.
 */
export interface FreeDeliveryPolicy {
  enabled: boolean;
  count: number;
  /** ISO timestamp; only orders created at/after it count as used. */
  since: string;
}

export interface FreeDeliveryStatus extends FreeDeliveryPolicy {
  /** Earlier orders that used up a free delivery. */
  used: number;
  /** Free deliveries this customer still has (0 when the offer is off). */
  remaining: number;
  /** Whether the next order goes out free. */
  applies: boolean;
}

/**
 * Where this customer stands. Pass `lock` inside the order transaction: the
 * customer's user row is locked first, so two checkouts racing cannot both
 * take the last free delivery.
 */
export async function freeDeliveryStatus(
  executor: DBConnection,
  customerId: string,
  policy: FreeDeliveryPolicy,
  lock = false
): Promise<FreeDeliveryStatus> {
  if (!policy.enabled || policy.count <= 0) {
    return { enabled: policy.enabled, count: policy.count, since: policy.since, used: 0, remaining: 0, applies: false };
  }
  if (lock) {
    await executor.selectFrom('users').select('id').where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
  }
  // Counted across every account on the same verified number, so deleting
  // the account and registering again does not give the free deliveries back
  // (migration 041; security audit 2026-10).
  const customerIds = await phoneLineageIds(executor, customerId);
  const row = await executor
    .selectFrom('orders')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('customer_id', 'in', customerIds)
    .where('order_status', 'not in', FREE_DELIVERY_NOT_USED_BY)
    // An order made free by the basket amount never used one up (migration
    // 043; owner, 2026-10-12).
    .where((eb) => eb.or([eb('free_delivery_reason', 'is', null), eb('free_delivery_reason', '!=', 'BASKET_THRESHOLD')]))
    .where('created_at', '>=', new Date(policy.since))
    .executeTakeFirst();
  const used = Number(row?.n ?? 0);
  const remaining = Math.max(policy.count - used, 0);
  return { enabled: true, count: policy.count, since: policy.since, used, remaining, applies: remaining > 0 };
}

/**
 * Free delivery above a basket amount (owner, 2026-10-12). The basket is the
 * order's item subtotal (orders.subtotal_amount: after item / category offers
 * and combo prices, BEFORE coupons, the birthday gift, referral rewards and
 * points), so a coupon can never take a basket back under the amount, and the
 * amount the customer sees in the cart is the one compared. At or above
 * `min_subtotal_lkr` (while switched on) the delivery fee is 0.
 *
 * Checked BEFORE the free deliveries: an order free by the basket never uses
 * one of them up (it is stored with free_delivery_reason 'BASKET_THRESHOLD',
 * which freeDeliveryStatus does not count). Later changes to the order (an
 * item found unavailable) do not re-charge the fee snapshotted at placement.
 */
export interface BasketFreeDeliveryPolicy {
  enabled: boolean;
  min_subtotal_lkr: number;
}

export interface BasketFreeDeliveryStatus extends BasketFreeDeliveryPolicy {
  /** Whether this subtotal gets free delivery (null = no subtotal given). */
  applies: boolean | null;
  /** LKR still to add for free delivery (0 once reached; null = off or no subtotal). */
  remaining_lkr: number | null;
}

export function basketFreeDeliveryApplies(policy: BasketFreeDeliveryPolicy | null | undefined, subtotal: number): boolean {
  return !!policy && policy.enabled && policy.min_subtotal_lkr > 0 && subtotal + 1e-9 >= policy.min_subtotal_lkr;
}

export function basketFreeDeliveryStatus(policy: BasketFreeDeliveryPolicy, subtotal?: number | null): BasketFreeDeliveryStatus {
  if (!policy.enabled || subtotal === undefined || subtotal === null) {
    return { ...policy, applies: policy.enabled ? null : false, remaining_lkr: null };
  }
  const applies = basketFreeDeliveryApplies(policy, subtotal);
  return {
    ...policy,
    applies,
    remaining_lkr: applies ? 0 : Math.round((policy.min_subtotal_lkr - subtotal) * 100) / 100,
  };
}
