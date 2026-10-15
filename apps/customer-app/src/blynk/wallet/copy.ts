import { formatLkr } from '@/blynk/lib/money';

/**
 * Blynk Wallet words (owner, 2026-10-15: every approved refund goes to the wallet). Kept in one
 * object for the Sinhala / Tamil phase: screens read their wallet text from here, never inline.
 */
export const WALLET_COPY = {
  title: 'Blynk Wallet',
  /** Profile row: the balance under the title. */
  rowSub: (balance: number) => formatLkr(balance),

  // the wallet screen
  balanceLabel: 'Your balance',
  howTitle: 'How it works',
  rules: [
    'Refunds for your Blynk orders are added here.',
    "Use it on your next order. It can't be withdrawn as cash.",
  ],
  maxUse: (percent: string) => `It can pay up to ${percent} of an order.`,
  paused: "Using the wallet at checkout is paused right now. Your balance is kept.",
  historyTitle: 'History',
  empty: 'No wallet activity yet',
  emptySub: 'Refunds for your orders show here.',
  orderRef: (orderNumber: string) => `Order ${orderNumber}`,
  expires: (date: string) => `Expires ${date}`,
  showMore: 'Show more',
  loadingMore: 'Loading…',
  demoNote: 'Sample wallet. Your own balance shows here once the shop is live.',
  signedOutTitle: 'Log in to see your wallet',
  signedOutSub: 'Refunds for your orders are kept in your Blynk Wallet.',
  logIn: 'Log in',
  loadFailedTitle: "Couldn't load your wallet",
  loadFailedSub: 'Check your connection and try again.',
  tryAgain: 'Try again',
  offTitle: 'Not available right now',
  offSub: "The Blynk Wallet isn't running at the moment.",

  /** History labels per ledger kind (docs/api/wallet.md §2). */
  kinds: {
    ORDER_PAYMENT: 'Paid for an order',
    ORDER_PAYMENT_RETURNED: 'Wallet payment returned',
    REFUND_ORDER_CANCELLED: 'Refund: order cancelled',
    REFUND_ITEM: 'Refund: item',
    REFUND_DELIVERY_FEE: 'Refund: delivery fee',
    ADJUSTMENT: 'Adjusted by Blynk',
    EXPIRED: 'Expired',
  } as Record<string, string>,
  kindOther: 'Wallet update',

  // checkout
  toggleLabel: (balance: number) => `Use wallet balance (${formatLkr(balance)})`,
  toggleSub: 'Pays after any coupon and points',
  payNote: (amount: number) => `${formatLkr(amount)} from your wallet on this order. The final amount is confirmed when you place it.`,
  capNote: (percent: string) => `The wallet can pay up to ${percent} of an order.`,
  cannotUse: "The wallet can't be used on this order.",
  billLine: 'Wallet',
  paidByWallet: 'Paid by wallet',
  nothingOnline: 'Your wallet covers this order. Nothing to pay online.',

  // orders
  orderBillLine: 'Paid by wallet',
  refundAdded: (amount: number) => `Refund of ${formatLkr(amount)} added to your Blynk Wallet`,
  refundsTitle: 'Refunds',
  viewWallet: 'View wallet',
  placedFromWallet: 'From your wallet',
};
