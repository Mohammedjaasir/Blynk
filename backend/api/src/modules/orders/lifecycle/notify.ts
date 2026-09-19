import type { OrderRow, Trx } from './types.js';

/**
 * Enqueues a customer SMS in the outbox, in the same transaction as the
 * change it reports. The idempotency key makes a retried action send once.
 */
export async function enqueueCustomerSms(
  trx: Trx,
  order: OrderRow,
  notificationType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>
): Promise<void> {
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
