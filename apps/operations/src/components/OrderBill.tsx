import type { OrderDetail } from '../api/types';
import { formatMoney } from '../lib/orders';
import { cashToCollectText, walletPaid } from '../lib/wallet';

/**
 * An order's bill (backend migration 018): items, delivery, the coupon
 * discount and the total. For cash on delivery the total is exactly the cash
 * the rider collects - the API refuses any other amount.
 */
export function OrderBill({ order }: { order: OrderDetail }) {
  const discount = order.discount_amount ?? 0;
  // A birthday gift is the whole discount, never with a coupon (owner, 2026-10-09).
  const birthday = (order.birthday_discount_amount ?? 0) > 0;
  // Blynk Wallet (docs/api/wallet.md): a payment, already taken off the total.
  const wallet = walletPaid(order);
  return (
    <dl className="order-bill" aria-label="Bill">
      {order.subtotal_amount != null ? (
        <div className="order-bill__row">
          <dt>Items</dt>
          <dd className="mono">{formatMoney(order.subtotal_amount)}</dd>
        </div>
      ) : null}
      {order.delivery_fee != null ? (
        <div className="order-bill__row">
          <dt>Delivery</dt>
          <dd className="mono">{formatMoney(order.delivery_fee)}</dd>
        </div>
      ) : null}
      {discount > 0 ? (
        <div className="order-bill__row order-bill__row--discount">
          <dt>{birthday ? 'Birthday gift' : `Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}`}</dt>
          <dd className="mono">−{formatMoney(discount)}</dd>
        </div>
      ) : null}
      {wallet > 0 ? (
        <div className="order-bill__row order-bill__row--discount" data-testid="bill-wallet">
          <dt>Paid by wallet</dt>
          <dd className="mono">−{formatMoney(wallet)}</dd>
        </div>
      ) : null}
      <div className="order-bill__row order-bill__row--total">
        <dt>{order.payment_method === 'COD' ? 'Total · cash to collect' : 'Total'}</dt>
        <dd className="mono">{order.payment_method === 'COD' ? cashToCollectText(order) : formatMoney(order.total_amount)}</dd>
      </div>
    </dl>
  );
}
