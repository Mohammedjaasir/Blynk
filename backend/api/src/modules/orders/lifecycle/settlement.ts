import { enqueueCustomerSms } from './notify.js';
import { setOrderStatus } from './status-writer.js';
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

  await trx
    .updateTable('deliveries')
    .set({ assignment_status: 'DELIVERED', cod_collected_amount: amount, delivered_at: now, updated_at: now })
    .where('id', '=', delivery.id)
    .execute();

  await trx
    .updateTable('payments')
    .set({ payment_status: 'PAID', paid_at: now, updated_at: now })
    .where('order_id', '=', order.id)
    .execute();

  await setOrderStatus(trx, order, 'DELIVERED', actor, note, { payment_status: 'PAID', delivered_at: now });

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
