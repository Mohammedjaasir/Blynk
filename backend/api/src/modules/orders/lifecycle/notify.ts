import type { OrderRow, Trx } from './types.js';

/**
 * The order texts a customer is sent (owner, 2026-10-07: SMS cost). Only what
 * they must act on: the order is on its way (be at the door with the cash),
 * or something went wrong (cancelled, or an item missing and the total
 * changed). Placed, rider assigned, delivered and cash received are shown in
 * the app instead - at most one SMS for an ordinary order, down from five.
 */
export const CUSTOMER_ORDER_SMS: ReadonlySet<string> = new Set(['OUT_FOR_DELIVERY', 'ORDER_CANCELLED', 'ITEM_UNAVAILABLE']);

/**
 * Enqueues a customer SMS in the outbox, in the same transaction as the
 * change it reports. The idempotency key makes a retried action send once.
 * A type outside [CUSTOMER_ORDER_SMS] is not sent.
 */
export async function enqueueCustomerSms(
  trx: Trx,
  order: OrderRow,
  notificationType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!CUSTOMER_ORDER_SMS.has(notificationType)) return;
  await trx
    .insertInto('notifications')
    .values({
      user_id: order.customer_id,
      order_id: order.id,
      idempotency_key: idempotencyKey,
      channel: 'SMS',
      notification_type: notificationType,
      recipient: order.delivery_recipient_phone,
      payload,
      status: 'QUEUED',
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .execute();
}
