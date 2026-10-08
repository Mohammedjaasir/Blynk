import type { OrderStatus } from '../../database/types.js';
import type { DBConnection } from './order.repository.js';

/**
 * New-customer free deliveries (owner, 2026-10-08): while the switch is on, a
 * customer's first `count` orders carry no delivery fee.
 *
 * What uses one up: every earlier order except a CANCELLED or FAILED one. A
 * cancelled order never went out and a failed delivery was not delivered, so
 * the customer keeps that free delivery. Anything else (placed, packing, on
 * the way, delivered, customer unavailable, item unavailable) counts.
 */
export const FREE_DELIVERY_NOT_USED_BY: OrderStatus[] = ['CANCELLED', 'FAILED'];

export interface FreeDeliveryPolicy {
  enabled: boolean;
  count: number;
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
    return { enabled: policy.enabled, count: policy.count, used: 0, remaining: 0, applies: false };
  }
  if (lock) {
    await executor.selectFrom('users').select('id').where('id', '=', customerId).forNoKeyUpdate().executeTakeFirst();
  }
  const row = await executor
    .selectFrom('orders')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('customer_id', '=', customerId)
    .where('order_status', 'not in', FREE_DELIVERY_NOT_USED_BY)
    .executeTakeFirst();
  const used = Number(row?.n ?? 0);
  const remaining = Math.max(policy.count - used, 0);
  return { enabled: true, count: policy.count, used, remaining, applies: remaining > 0 };
}
