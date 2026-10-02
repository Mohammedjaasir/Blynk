import { db } from '../../../database/connection.js';
import type { Database, OrderStatus } from '../../../database/types.js';
import type { Transaction } from 'kysely';
import { logger } from '../../../utils/logger.js';
import { bestEffort, enqueuePush, PUSH_TYPES } from './push.repository.js';
import { isPushEnabled } from './push.sender.js';

type Trx = Transaction<Database>;

/**
 * What the customer's phone shows for each order status. Statuses not
 * listed (PLACED, ITEM_UNAVAILABLE) send no push. The delivery code is never
 * part of a push: it stays in the app.
 */
export function orderStatusPush(status: OrderStatus, orderNumber: string): { title: string; body: string } | null {
  switch (status) {
    case 'PACKED':
      return { title: 'Your order is packed', body: `Order ${orderNumber} is packed and waiting for a rider.` };
    case 'OUT_FOR_DELIVERY':
      return { title: 'On the way', body: `Your rider is bringing order ${orderNumber}. Your delivery code is in the app.` };
    case 'DELIVERED':
      return { title: 'Delivered', body: `Order ${orderNumber} was delivered. Enjoy!` };
    case 'CANCELLED':
      return { title: 'Order cancelled', body: `Order ${orderNumber} was cancelled.` };
    case 'FAILED':
    case 'CUSTOMER_UNAVAILABLE':
      return { title: "We couldn't deliver", body: `We couldn't deliver order ${orderNumber}. We'll contact you.` };
    default:
      return null;
  }
}

/**
 * Queues the customer's push for an order status change, in the status
 * change's own transaction (sent by the worker after commit). Best effort:
 * a failure here is logged and never fails the transition.
 */
export async function enqueueOrderStatusPush(
  trx: Trx,
  order: { id: string; order_number: string; customer_id: string },
  from: OrderStatus,
  to: OrderStatus
): Promise<void> {
  if (from === to || !isPushEnabled()) return;
  const text = orderStatusPush(to, order.order_number);
  if (!text) return;
  await bestEffort(
    trx,
    () =>
      enqueuePush(trx, {
        userId: order.customer_id,
        orderId: order.id,
        type: PUSH_TYPES.ORDER_STATUS,
        payload: { ...text, data: { type: 'order', order_id: order.id }, status: to },
      }),
    (err) => logger.error({ err, orderId: order.id, status: to }, 'Could not queue the order status push; the transition goes ahead')
  );
}

/**
 * "Back in stock": when a product is available to customers again
 * (is_active and is_available, not deleted), queues one push per pending
 * subscriber and marks each alert notified, so every alert fires once.
 *
 * Runs in the caller's transaction. With push disabled nothing is sent and
 * the alerts stay pending. Returns how many alerts were released.
 */
export async function releaseStockAlerts(trx: Trx, productId: string): Promise<number> {
  if (!isPushEnabled()) return 0;
  const product = await trx
    .selectFrom('products')
    .select(['id', 'name'])
    .where('id', '=', productId)
    .where('is_active', '=', true)
    .where('is_available', '=', true)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) return 0;

  // The UPDATE claims each pending alert exactly once, even when two
  // releases race: the second finds notified_at already set.
  const alerts = await trx
    .updateTable('stock_alerts')
    .set({ notified_at: new Date() })
    .where('product_id', '=', productId)
    .where('notified_at', 'is', null)
    .returning(['id', 'user_id', 'created_at'])
    .execute();

  for (const alert of alerts) {
    await enqueuePush(trx, {
      userId: alert.user_id,
      type: PUSH_TYPES.BACK_IN_STOCK,
      idempotencyKey: `push:stock:${alert.id}:${new Date(alert.created_at).getTime()}`,
      payload: {
        title: `Back in stock: ${product.name}`,
        body: 'It is available again on Blynk. Tap to add it to your basket.',
        data: { type: 'product', product_id: product.id },
      },
    });
  }
  if (alerts.length) logger.info({ productId, alerts: alerts.length }, 'Back-in-stock alerts released');
  return alerts.length;
}

/** releaseStockAlerts inside a savepoint of a larger transaction (stock movements). */
export async function releaseStockAlertsSafely(trx: Trx, productId: string): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    () => releaseStockAlerts(trx, productId),
    (err) => logger.error({ err, productId }, 'Could not release back-in-stock alerts; the stock change goes ahead')
  );
}

/** releaseStockAlerts in its own transaction (after an admin edit has committed). */
export async function releaseStockAlertsNow(productId: string): Promise<void> {
  if (!isPushEnabled()) return;
  try {
    await db.transaction().execute((trx) => releaseStockAlerts(trx, productId));
  } catch (err) {
    logger.error({ err, productId }, 'Could not release back-in-stock alerts');
  }
}
