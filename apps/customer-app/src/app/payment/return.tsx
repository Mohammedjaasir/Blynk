import { PaymentResult } from '@/blynk/payments/PaymentResult';

/** /payment/return?order=<id>: PayHere's return_url. The order is checked, the URL is not trusted. */
export default function PaymentReturn() {
  return <PaymentResult from="return" />;
}
