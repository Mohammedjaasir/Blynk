import { formatMoney } from '../lib/orders';
import { WALLET_ONLY_TEXT, paidByWalletOnly, walletUsed } from '../lib/wallet';
import './wallet.css';

/**
 * An order's bill: items, delivery, the coupon discount (backend migration
 * 018) and the total - which for cash on delivery is exactly what the rider
 * collects. With Blynk Wallet (docs/api/wallet.md) the wallet's share is a
 * payment, not a discount: total_amount stays what is still to pay.
 */
export function OrderBill({
  order,
}: {
  order: {
    subtotal_amount: number;
    delivery_fee: number;
    /** Small-order fee (owner, 2026-10-25): 0 / absent when none; already inside total_amount. */
    small_order_fee?: number;
    discount_amount?: number;
    coupon_code?: string | null;
    birthday_discount_amount?: number;
    total_amount: number;
    /** What the Blynk Wallet paid (absent on an older API). */
    wallet_amount_used?: number;
    payment_method?: 'COD' | 'ONLINE';
    payment_status?: string;
    /** Staff made the delivery free (owner, 2026-10-21); absent on an older API. */
    delivery_fee_waiver?: { original_fee: number } | null;
  };
}) {
  const discount = order.discount_amount ?? 0;
  const smallOrderFee = Number(order.small_order_fee ?? 0) || 0;
  // A birthday gift is the whole discount, never with a coupon (owner, 2026-10-09).
  const birthday = (order.birthday_discount_amount ?? 0) > 0;
  const wallet = walletUsed(order);
  const walletOnly = paidByWalletOnly(order);
  return (
    <>
      <dl className="bill" aria-label="Bill">
        <div className="bill__row">
          <dt>Items</dt>
          <dd className="mono">{formatMoney(order.subtotal_amount)}</dd>
        </div>
        <div className="bill__row">
          <dt>Delivery</dt>
          <dd className="mono" data-testid="bill-delivery">
            {order.delivery_fee_waiver && !(order.delivery_fee > 0) ? 'Free (waived by staff)' : formatMoney(order.delivery_fee)}
          </dd>
        </div>
        {smallOrderFee > 0 ? (
          <div className="bill__row">
            <dt>Small-order fee</dt>
            <dd className="mono" data-testid="bill-small-order-fee">
              {formatMoney(smallOrderFee)}
            </dd>
          </div>
        ) : null}
        {discount > 0 ? (
          <div className="bill__row bill__row--discount">
            <dt>{birthday ? 'Birthday gift' : `Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}`}</dt>
            <dd className="mono">−{formatMoney(discount)}</dd>
          </div>
        ) : null}
        {wallet > 0 ? (
          <div className="bill__row bill__row--wallet">
            <dt>Paid by wallet</dt>
            <dd className="mono">−{formatMoney(wallet)}</dd>
          </div>
        ) : null}
        <div className="bill__row bill__row--total">
          <dt>{totalLabel(order.payment_method, order.payment_status)}</dt>
          <dd className="mono">{formatMoney(order.total_amount)}</dd>
        </div>
      </dl>
      {walletOnly ? (
        <p className="bill__wallet-only" data-testid="bill-wallet-only">
          {WALLET_ONLY_TEXT}
        </p>
      ) : null}
    </>
  );
}

/** What the total means for whoever reads the bill (docs/api/payhere.md section 6). */
export function totalLabel(method?: 'COD' | 'ONLINE', status?: string): string {
  if (method === 'ONLINE') return status === 'PAID' ? 'Total · paid online' : 'Total';
  return status === 'PAID' ? 'Total · cash collected' : 'Total · cash to collect';
}
