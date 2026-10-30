import { sql, type Transaction } from 'kysely';
import type { Database } from '../../../database/types.js';
import { logger } from '../../../utils/logger.js';
import { ACTIVE_DELIVERY_STATUSES } from '../../orders/lifecycle/catalogue.js';
import { bestEffort, enqueuePush, PUSH_TYPES } from './push.repository.js';
import { isPushEnabled } from './push.sender.js';

type Trx = Transaction<Database>;

/**
 * Order notifications for sellers, and the "order is ready" push to the rider / staff (seller
 * portal, 2026-10-30: "when a seller gets orders they must get notifications; when the order is
 * ready the seller sends the notification to the rider"). Queued in the order change's own
 * transaction (sent after commit by the outbox worker), best effort: a failure is logged and never
 * fails or blocks the order. The seller's pushes are PUSH_SELLER rows (data.type SELLER_NEW_ORDER /
 * SELLER_ORDER_CANCELLED, data.url '/orders': the seller app opens its Orders tab).
 */

export const SELLER_PUSH_BODY_MAX = 120;

/** "BL-20261030-1283" -> "1283" (what staff and sellers say aloud); anything else is kept whole. */
export function shortOrderNumber(orderNumber: string): string {
  const last = orderNumber.split('-').pop();
  return last && /^\d+$/.test(last) ? last : orderNumber;
}

/** Cuts to `max` characters, ending in an ellipsis when something was left out. */
function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "#1283: 2 x Apple Pie, 1 x Samosa", at most 120 characters. */
export function sellerNewOrderBody(orderNumber: string, lines: ReadonlyArray<{ name: string; quantity: number }>): string {
  return cut(`#${shortOrderNumber(orderNumber)}: ${lines.map((l) => `${l.quantity} x ${l.name}`).join(', ')}`, SELLER_PUSH_BODY_MAX);
}

export const sellerOrderCancelledBody = (orderNumber: string): string =>
  `#${shortOrderNumber(orderNumber)} was cancelled. No need to prepare it.`;

interface SellerLines {
  user_id: string;
  seller_id: string;
  lines: { name: string; quantity: number }[];
}

/**
 * The approved sellers who have a product on this order and what they have on it (items still in
 * the bag: not UNAVAILABLE, variant label folded into the name), one entry per seller.
 */
async function sellersOnOrder(trx: Trx, orderId: string): Promise<SellerLines[]> {
  const { rows } = await sql<{ user_id: string; seller_id: string; name: string; quantity: number }>`
    SELECT s.user_id, s.id AS seller_id,
           TRIM(oi.product_name_snapshot || COALESCE(' ' || NULLIF(oi.variant_label_snapshot, ''), '')) AS name,
           oi.quantity
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN sellers s ON s.id = p.seller_id
     WHERE oi.order_id = ${orderId}
       AND oi.item_status <> 'UNAVAILABLE'
       AND s.status = 'APPROVED'
     ORDER BY s.id, oi.created_at, name, oi.id`.execute(trx);
  const bySeller = new Map<string, SellerLines>();
  for (const r of rows) {
    const entry = bySeller.get(r.seller_id) ?? { user_id: r.user_id, seller_id: r.seller_id, lines: [] };
    entry.lines.push({ name: r.name, quantity: Number(r.quantity) });
    bySeller.set(r.seller_id, entry);
  }
  return [...bySeller.values()];
}

/**
 * "New order" to each seller whose products are on an order that just became PLACED (at checkout
 * for cash on delivery, when the PayHere payment is confirmed for online). One push per order and
 * seller. A mixed order (the one-seller-per-order rule switched off) tells every seller involved.
 */
export async function enqueueSellerNewOrderPush(trx: Trx, order: { id: string; order_number: string }): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    async () => {
      for (const s of await sellersOnOrder(trx, order.id)) {
        await enqueuePush(trx, {
          userId: s.user_id,
          orderId: order.id,
          type: PUSH_TYPES.SELLER,
          idempotencyKey: `seller-new-order:${order.id}:${s.user_id}`,
          payload: {
            title: 'New order',
            body: sellerNewOrderBody(order.order_number, s.lines),
            data: { type: 'SELLER_NEW_ORDER', order_id: order.id, url: '/orders' },
          },
        });
      }
    },
    (err) => logger.error({ err, orderId: order.id }, 'Could not queue the seller new-order push; the order goes ahead')
  );
}

/** "Order cancelled" to each seller who was told about the order (one that left PLACED or later for CANCELLED). */
export async function enqueueSellerOrderCancelledPush(trx: Trx, order: { id: string; order_number: string }): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    async () => {
      for (const s of await sellersOnOrder(trx, order.id)) {
        await enqueuePush(trx, {
          userId: s.user_id,
          orderId: order.id,
          type: PUSH_TYPES.SELLER,
          idempotencyKey: `seller-order-cancelled:${order.id}:${s.user_id}`,
          payload: {
            title: 'Order cancelled',
            body: sellerOrderCancelledBody(order.order_number),
            data: { type: 'SELLER_ORDER_CANCELLED', order_id: order.id, url: '/orders' },
          },
        });
      }
    },
    (err) => logger.error({ err, orderId: order.id }, 'Could not queue the seller order-cancelled push; the cancellation goes ahead')
  );
}

/**
 * The seller tapped "Order is ready": tell the rider. When a rider already holds the delivery,
 * that rider ("Order #1283 is ready" / "Pick up at <shop>."); otherwise every Admin / Operations
 * device ("Order #1283 is ready at <shop>" / "Assign a rider."), and the automatic assignment
 * (riders/rider.auto-assign.ts) picks the PACKED order up like any other.
 */
export async function enqueueOrderReadyPush(
  trx: Trx,
  input: { order: { id: string; order_number: string }; shopName: string }
): Promise<void> {
  if (!isPushEnabled()) return;
  const { order, shopName } = input;
  const short = shortOrderNumber(order.order_number);
  await bestEffort(
    trx,
    async () => {
      const delivery = await trx
        .selectFrom('deliveries as d')
        .innerJoin('riders as r', 'r.id', 'd.rider_id')
        .select(['d.id as delivery_id', 'r.user_id as rider_user_id'])
        .where('d.order_id', '=', order.id)
        .where('d.assignment_status', 'in', ACTIVE_DELIVERY_STATUSES)
        .limit(1)
        .executeTakeFirst();
      if (delivery) {
        await enqueuePush(trx, {
          userId: delivery.rider_user_id,
          orderId: order.id,
          type: PUSH_TYPES.RIDER_ASSIGNED,
          idempotencyKey: `order-ready:${order.id}:${delivery.delivery_id}`,
          payload: {
            title: `Order #${short} is ready`,
            body: `Pick up at ${shopName}.`,
            data: { type: 'rider_order_ready', delivery_id: delivery.delivery_id, order_id: order.id },
          },
        });
        return;
      }
      const staff = await trx
        .selectFrom('users as u')
        .select('u.id')
        .where('u.role', 'in', ['ADMIN', 'OPERATIONS'])
        .where('u.is_active', '=', true)
        .where((eb) => eb.exists(eb.selectFrom('device_tokens as d').select('d.id').whereRef('d.user_id', '=', 'u.id')))
        .execute();
      for (const s of staff) {
        await enqueuePush(trx, {
          userId: s.id,
          orderId: order.id,
          type: PUSH_TYPES.NEW_ORDER,
          idempotencyKey: `order-ready:${order.id}:${s.id}`,
          payload: {
            title: `Order #${short} is ready at ${shopName}`,
            body: 'Assign a rider.',
            data: { type: 'staff_order', order_id: order.id },
          },
        });
      }
    },
    (err) => logger.error({ err, orderId: order.id }, 'Could not queue the order-ready push; the order is ready anyway')
  );
}
