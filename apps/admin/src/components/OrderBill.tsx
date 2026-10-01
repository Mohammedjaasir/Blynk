import { formatMoney } from '../lib/orders';

/**
 * An order's bill: items, delivery, the coupon discount (backend migration
 * 018) and the total - which for cash on delivery is exactly what the rider
 * collects.
 */
export function OrderBill({
  order,
}: {
  order: {
    subtotal_amount: number;
    delivery_fee: number;
    discount_amount?: number;
    coupon_code?: string | null;
    total_amount: number;
    payment_method?: 'COD' | 'ONLINE';
  };
}) {
  const discount = order.discount_amount ?? 0;
  return (
    <dl className="bill" aria-label="Bill">
      <div className="bill__row">
        <dt>Items</dt>
        <dd className="mono">{formatMoney(order.subtotal_amount)}</dd>
      </div>
      <div className="bill__row">
        <dt>Delivery</dt>
        <dd className="mono">{formatMoney(order.delivery_fee)}</dd>
      </div>
      {discount > 0 ? (
        <div className="bill__row bill__row--discount">
          <dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</dt>
          <dd className="mono">−{formatMoney(discount)}</dd>
        </div>
      ) : null}
      <div className="bill__row bill__row--total">
        <dt>{order.payment_method === 'ONLINE' ? 'Total' : 'Total · cash to collect'}</dt>
        <dd className="mono">{formatMoney(order.total_amount)}</dd>
      </div>
    </dl>
  );
}
