/*
 * Design-mock Blynk Wallet (EXPO_PUBLIC_DEMO unset): a sample balance and history so the Profile
 * row and the wallet screen render without a server. Nothing here is fetched or sent anywhere.
 * Amounts are LKR (the wallet is Blynk's own feature; the reference video has none).
 */
import { parseWallet, type WalletInfo } from '@/blynk/wallet/models';

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 8, 30)).toISOString();

export const DEMO_WALLET: WalletInfo = parseWallet({
  enabled: true,
  balance: 620,
  expiry_months: 0,
  expiry_note: 'Your balance never expires.',
  max_use_percent: 100,
  entries: [
    { id: 'demo-w4', kind: 'REFUND_ITEM', amount: 120, order_id: 'demo-o3', order_number: 'BL-20261014-0412', reason: 'Damaged: Kotmale Milk 1L', expires_at: null, created_at: day(14) },
    { id: 'demo-w3', kind: 'ORDER_PAYMENT', amount: -300, order_id: 'demo-o2', order_number: 'BL-20261012-0233', reason: 'Paid for order BL-20261012-0233', expires_at: null, created_at: day(12) },
    { id: 'demo-w2', kind: 'REFUND_DELIVERY_FEE', amount: 150, order_id: 'demo-o1', order_number: 'BL-20261010-0108', reason: 'Delivery fee refunded', expires_at: null, created_at: day(10) },
    { id: 'demo-w1', kind: 'REFUND_ORDER_CANCELLED', amount: 650, order_id: 'demo-o1', order_number: 'BL-20261010-0108', reason: 'Order BL-20261010-0108 cancelled', expires_at: null, created_at: day(10) },
  ],
  pagination: { page: 1, limit: 30, total: 4, total_pages: 1 },
})!;
