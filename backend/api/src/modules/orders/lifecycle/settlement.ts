import { enqueueCustomerSms } from './notify.js';
import { riderPaySnapshot } from '../../riders/rider.pay.js';
import { setOrderStatus } from './status-writer.js';
import { onOrderDeliveredRewards } from '../../loyalty/order-rewards.js';
import type { Actor, DeliveryRow, OrderRow, Trx } from './types.js';

export interface CodSettlement {
  delivery_id: string;
  order_id: string;
  order_status: 'DELIVERED';
  payment_status: 'PAID';
  cod_collected_amount: number;
  delivered_at: Date;
}

/**
 * The one COD settlement (architecture §I), used by the rider's cash
 * collection and by an admin marking an order delivered (D4). Callers have
 * already locked the delivery and the order and checked every rule; this
 * performs the effects in one transaction: delivery DELIVERED with the cash
 * amount, payment PAID, order DELIVERED/PAID with its history row, and the
 * DELIVERED and COD_PAYMENT_CONFIRMED messages.
 */
export async function settleCod(
  trx: Trx,
  params: { delivery: DeliveryRow; order: OrderRow; amount: number; actor: Actor; note: string }
): Promise<CodSettlement> {
  const { delivery, order, amount, actor, note } = params;
  const now = new Date();
  // Rider pay (migration 032; owner, 2026-10-09): what this delivery earned,
  // with the rider's pay type and share as they are now - a snapshot, so a
  // later change never rewrites it.
  const pay = await riderPaySnapshot(trx, delivery, order);

  await trx
    .updateTable('deliveries')
    .set({ assignment_status: 'DELIVERED', cod_collected_amount: amount, delivered_at: now, updated_at: now, ...pay })
    .where('id', '=', delivery.id)
    .execute();

  await trx
    .updateTable('payments')
    .set({ payment_status: 'PAID', paid_at: now, updated_at: now })
    .where('order_id', '=', order.id)
    .execute();

  const delivered = await setOrderStatus(trx, order, 'DELIVERED', actor, note, { payment_status: 'PAID', delivered_at: now });
  // Refer a friend + Blynk Points (owner, 2026-10-10; migration 037): the
  // friend's first delivered order credits the inviter; the order earns points.
  await onOrderDeliveredRewards(trx, delivered);

  await enqueueCustomerSms(trx, order, 'DELIVERED', `order_${order.id}_DELIVERED_SMS`, {
    order_number: order.order_number,
  });
  await enqueueCustomerSms(trx, order, 'COD_PAYMENT_CONFIRMED', `order_${order.id}_COD_CONFIRMED_SMS`, {
    order_number: order.order_number,
    amount,
  });

  return {
    delivery_id: delivery.id,
    order_id: order.id,
    order_status: 'DELIVERED',
    payment_status: 'PAID',
    cod_collected_amount: amount,
    delivered_at: now,
  };
}
