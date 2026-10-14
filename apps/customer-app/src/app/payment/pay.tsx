import { PayScreen } from '@/blynk/payments/PayScreen';

/** /payment/pay?order=<id>: pay an order that is waiting for its online payment (PayHere). */
export default function Pay() {
  return <PayScreen />;
}
