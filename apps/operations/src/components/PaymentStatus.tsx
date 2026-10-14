import { Status } from './ui';
import { REFUND_NEEDED, paymentLabel, type PaymentLike } from '../lib/payments';

/**
 * An order's payment method + status as a small labelled dot (PayHere,
 * docs/api/payhere.md §5), plus "Refund needed" when the API flags one.
 */
export function PaymentStatus({ order, refundRequired = false }: { order: PaymentLike; refundRequired?: boolean }) {
  const label = paymentLabel(order);
  if (!label && !refundRequired) return null;
  return (
    <>
      {label ? (
        <span className="payment-status" data-testid="payment-status">
          <Status tone={label.tone}>{label.text}</Status>
        </span>
      ) : null}
      {refundRequired ? (
        <span className="payment-status" data-testid="refund-needed">
          <Status tone="bad">{REFUND_NEEDED}</Status>
        </span>
      ) : null}
    </>
  );
}
