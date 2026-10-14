import { PaymentResult } from '@/blynk/payments/PaymentResult';

/** /payment/cancel?order=<id>: PayHere's cancel_url. The order is checked (a late success still shows as paid). */
export default function PaymentCancel() {
  return <PaymentResult from="cancel" />;
}
