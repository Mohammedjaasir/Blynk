import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { rewardsSummary } from '@/blynk/checkout/rewards';
import { savingsHeader } from '@/blynk/checkout/savings';
import { parseCheckoutInfo, parseOrder } from '@/blynk/orders/api';
import { checkoutBill, checkoutSignature } from '@/blynk/orders/checkout';
import { paymentLine } from '@/blynk/orders/status';
import type { CheckoutInfo, Order } from '@/blynk/orders/types';
import { effectiveMethod, payOptions } from '@/blynk/payments/method';
import { MemoryStorage } from '../test/fixtures';
import { WALLET_COPY } from './copy';
import {
  canUseWallet, checkoutWalletOf, entryAmount, hasMore, kindLabel, mergeWalletPage, paidByWallet, parseOrderWallet, parseWallet,
  refundNotice, showWalletRow, walletPreview, walletRules, walletUseLine, walletVisible,
} from './models';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const quote = (over: Partial<CheckoutInfo> = {}): CheckoutInfo => ({
  delivery_fee_lkr: 150,
  standard_delivery_fee_lkr: 150,
  delivery_fee_mode: 'FLAT',
  delivery_distance_km: 2.4,
  delivery_distance_estimated: false,
  delivery_fee_address_id: 'a1',
  coupons_enabled: false,
  free_delivery: { enabled: false, count: 0, since: '2026-10-08T18:30:00.000Z', used: 0, remaining: 0, applies: false },
  basket_free_delivery: { enabled: false, min_subtotal_lkr: 0, applies: false, remaining_lkr: null },
  ...over,
});

describe('GET /me/wallet', () => {
  const raw = {
    enabled: true, balance: '450.00', expiry_months: 0, expiry_note: 'Your balance never expires.', max_use_percent: 100,
    entries: [
      { id: 'e2', kind: 'order_payment', amount: '-300.00', order_id: 'o2', order_number: 'BL-2', reason: 'Paid for order BL-2', expires_at: null, created_at: '2026-10-15T08:00:00.000Z' },
      { id: 'e1', kind: 'REFUND_ORDER_CANCELLED', amount: 750, order_id: 'o1', order_number: 'BL-1', reason: ' Order BL-1 cancelled ', expires_at: '2027-04-15T08:00:00.000Z', created_at: '2026-10-14T08:00:00.000Z' },
      { id: 'zero', kind: 'ADJUSTMENT', amount: 0 },
      'junk',
    ],
    pagination: { page: 1, limit: 30, total: 2, total_pages: 1 },
  };

  test('parses the balance, rules and signed history', () => {
    const w = parseWallet(raw)!;
    expect(w.balance).toBe(450);
    expect(w.maxUsePercent).toBe(100);
    expect(w.entries.map((e) => [e.id, e.kind, e.amount])).toEqual([['e2', 'ORDER_PAYMENT', -300], ['e1', 'REFUND_ORDER_CANCELLED', 750]]);
    expect(w.entries[1].reason).toBe('Order BL-1 cancelled');
    expect(w.entries[1].expiresAt?.toISOString()).toBe('2027-04-15T08:00:00.000Z');
    expect(hasMore(w)).toBe(false);
    expect(parseWallet({ balance: 1 })).toBeNull();
    expect(parseWallet(null)).toBeNull();
  });

  test('wording: kind labels, +/- amounts, rules with the expiry note and a cap', () => {
    expect(kindLabel('REFUND_ITEM')).toBe('Refund: item');
    expect(kindLabel('SOMETHING_NEW')).toBe(WALLET_COPY.kindOther);
    expect(entryAmount(450)).toBe('+LKR 450');
    expect(entryAmount(-120.5)).toBe('−LKR 120.50');
    expect(walletRules({ expiryNote: 'Your balance never expires.', maxUsePercent: 100 })).toEqual([...WALLET_COPY.rules, 'Your balance never expires.']);
    expect(walletRules({ expiryNote: null, maxUsePercent: 50 }).at(-1)).toBe('It can pay up to 50% of an order.');
  });

  test('the Profile row and the screen: on, or money / history while off', () => {
    expect(showWalletRow({ enabled: true, balance: 0 })).toBe(true);
    expect(showWalletRow({ enabled: false, balance: 10 })).toBe(true);
    expect(showWalletRow({ enabled: false, balance: 0 })).toBe(false);
    expect(showWalletRow(null)).toBe(false);
    expect(walletVisible({ enabled: false, balance: 0, entries: [] })).toBe(false);
    expect(walletVisible({ enabled: false, balance: 0, entries: parseWallet(raw)!.entries })).toBe(true);
  });

  test('a next page is appended without repeating an entry', () => {
    const first = parseWallet({ ...raw, pagination: { page: 1, limit: 2, total: 3, total_pages: 2 } })!;
    expect(hasMore(first)).toBe(true);
    const next = parseWallet({ ...raw, entries: [raw.entries[1], { id: 'e0', kind: 'REFUND_ITEM', amount: 50 }], pagination: { page: 2, limit: 2, total: 3, total_pages: 2 } })!;
    const merged = mergeWalletPage(first, next);
    expect(merged.entries.map((e) => e.id)).toEqual(['e2', 'e1', 'e0']);
    expect(hasMore(merged)).toBe(false);
  });

  test('fetchWallet reads /me/wallet with the bearer token', async () => {
    vi.resetModules();
    const session = await import('@/blynk/auth/session');
    session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
    const { fetchWallet } = await import('./api');
    const { API_BASE_URL } = await import('@/blynk/api/client');
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { success: true, data: raw }));
    expect((await fetchWallet(2, 10)).balance).toBe(450);
    expect(f.mock.calls[0][0]).toBe(`${API_BASE_URL}/me/wallet?page=2&limit=10`);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
  });
});

describe('checkout preview', () => {
  const w = (over: Partial<{ enabled: boolean; balance: number; max_use_percent: number }> = {}) =>
    ({ enabled: true, balance: 450, max_use_percent: 100, ...over });

  test('checkout-info wallet block: offered only while on with a balance', () => {
    expect(checkoutWalletOf(w())).toEqual({ enabled: true, balance: 450, maxUsePercent: 100 });
    expect(checkoutWalletOf({ enabled: true, balance: '12.5', max_use_percent: 0 })).toEqual({ enabled: true, balance: 12.5, maxUsePercent: 100 });
    expect(checkoutWalletOf(undefined)).toBeNull();
    expect(canUseWallet(checkoutWalletOf(w()))).toBe(true);
    expect(canUseWallet(checkoutWalletOf(w({ balance: 0 })))).toBe(false);
    expect(canUseWallet(checkoutWalletOf(w({ enabled: false })))).toBe(false);
    expect(parseCheckoutInfo(quote({ wallet: { enabled: true, balance: '99.5' as unknown as number, max_use_percent: 50 } })).wallet)
      .toEqual({ enabled: true, balance: 99.5, max_use_percent: 50 });
    expect(parseCheckoutInfo(quote()).wallet).toBeUndefined();
  });

  test('capped by the balance and by max_use_percent of what is due', () => {
    const on = checkoutWalletOf(w())!;
    expect(walletPreview(on, 1150)).toBe(450);
    expect(walletPreview(on, 300)).toBe(300);
    expect(walletPreview(checkoutWalletOf(w({ max_use_percent: 50 })), 300)).toBe(150);
    expect(walletPreview(checkoutWalletOf(w({ max_use_percent: 33 })), 100.01)).toBe(33);
    expect(walletPreview(on, 0)).toBe(0);
    expect(walletPreview(null, 500)).toBe(0);
  });

  test('applied after the coupon / gift / referral and the points, on the total including delivery', () => {
    // 1000 items + 150 fee, a 100 coupon -> 1050; 50 points (1 LKR each) -> 1000 due; the wallet pays 450
    const q = quote({ points: { enabled: true, balance: 50, value_lkr: 50, lkr_per_point: 1, min_redeem_points: 0, max_redeem_percent: 100 }, wallet: w() });
    const coupon = {
      code: 'SAVE', discount_type: 'FIXED', description: null, subtotal: 1000, delivery_fee: 150, discount_amount: 100,
      birthday_discount_amount: 0, referral_discount_amount: 0, applied_discount: 'COUPON' as const, total: 1050,
    };
    const r = rewardsSummary({ subtotal: 1000, deliveryFee: 150, quote: q, coupon, usePoints: true, useWallet: true });
    expect([r.points.value, r.dueBeforeWallet, r.wallet, r.toPay]).toEqual([50, 1000, 450, 550]);
    // off: nothing from the wallet
    expect(rewardsSummary({ subtotal: 1000, deliveryFee: 150, quote: q, coupon, usePoints: true }).wallet).toBe(0);
  });

  test('the bill: the wallet covering everything leaves 0 to pay, and online is not offered', () => {
    const b = checkoutBill(200, quote({ wallet: w() }), null, false, true);
    expect([b.wallet, b.toPay]).toEqual([350, 0]);
    expect(checkoutBill(200, quote({ wallet: w() })).wallet).toBe(0);
    expect(checkoutBill(200, null, null, false, true).wallet).toBe(0);
    const info = { enabled: true, payment_window_minutes: 20 } as Parameters<typeof effectiveMethod>[1];
    expect(effectiveMethod('ONLINE', info, b.toPay)).toBe('COD');
    expect(payOptions(info, 0, WALLET_COPY.nothingOnline)[1]).toMatchObject({ enabled: false, sub: WALLET_COPY.nothingOnline });
  });

  test('the switch line, and the savings header (the wallet is a payment, not a saving)', () => {
    const half = checkoutWalletOf(w({ max_use_percent: 50 }))!;
    expect(walletUseLine(half, 150, 300)).toBe(`${WALLET_COPY.payNote(150)} ${WALLET_COPY.capNote('50%')}`);
    expect(walletUseLine(checkoutWalletOf(w())!, 300, 300)).toBe(WALLET_COPY.payNote(300));
    expect(walletUseLine(half, 0, 0)).toBe(WALLET_COPY.cannotUse);
    expect(savingsHeader({ offerSaved: 0, showOfferSavings: false, discount: 100, pointsValue: 0, toPay: 600, walletUsed: 450 }))
      .toEqual({ saved: 100, before: 1150, show: true });
    expect(savingsHeader({ offerSaved: 0, showOfferSavings: false, discount: 0, pointsValue: 0, toPay: 0, walletUsed: 450 }).show).toBe(false);
  });

  test('use_wallet makes it a different order (older signatures unchanged)', () => {
    const base = { items: [{ product_id: 'x', quantity: 1 }], addressId: 'a1' };
    const plain = checkoutSignature({ ...base, extra: { use_points: true } });
    expect(checkoutSignature({ ...base, extra: { use_points: true, use_wallet: false } })).toBe(plain);
    expect(checkoutSignature({ ...base, extra: { use_points: true, use_wallet: true } })).toBe(`${plain}|WALLET`);
  });
});

describe('orders', () => {
  const order = (over: Partial<Order> = {}) => ({
    id: 'o1', order_number: 'BL-1', order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING',
    subtotal_amount: 1000, delivery_fee: 150, discount_amount: 0, birthday_discount_amount: 0, referral_discount_amount: 0,
    points_discount_amount: 0, coupon_code: null, total_amount: 0, scheduled_for: null, delivery_recipient_name: null,
    delivery_recipient_phone: null, delivery_address_line1: null, delivery_address_line2: null, delivery_city: null,
    delivery_instructions: null, placed_at: null, created_at: '2026-10-15T08:00:00.000Z', can_cancel: true, items: [],
    ...over,
  }) as Order;

  test('parseOrder reads wallet_amount_used (0 on an older server) and the wallet block', () => {
    expect(parseOrder(order()).wallet_amount_used).toBe(0);
    expect(parseOrder(order()).wallet).toBeUndefined();
    const o = parseOrder(order({
      wallet_amount_used: '1150.00' as unknown as number,
      wallet: { used: '1150', refunded_total: '1150', entries: [
        { id: 'r1', kind: 'ORDER_PAYMENT_RETURNED', amount: '1150', reason: 'Order BL-1 cancelled: wallet payment returned', created_at: '2026-10-15T09:00:00.000Z' },
        { id: 'bad', kind: 'X', amount: 0 },
      ] } as unknown as Order['wallet'],
    }));
    expect(o.wallet_amount_used).toBe(1150);
    expect(o.wallet?.refundedTotal).toBe(1150);
    expect(o.wallet?.entries.map((e) => e.id)).toEqual(['r1']);
    expect(refundNotice(o.wallet)).toBe('Refund of LKR 1,150 added to your Blynk Wallet');
    expect(refundNotice(parseOrderWallet({ used: 0, refunded_total: 0, entries: [] }))).toBeNull();
    expect(refundNotice(null)).toBeNull();
  });

  test('paid in full by the wallet: "Paid by wallet", nothing to collect', () => {
    expect(paidByWallet({ total_amount: 0, wallet_amount_used: 1150 })).toBe(true);
    expect(paidByWallet({ total_amount: 200, wallet_amount_used: 950 })).toBe(false);
    expect(paymentLine({ order_status: 'PLACED', payment_status: 'PENDING', total_amount: 0, wallet_amount_used: 1150 })).toBe('Paid by wallet');
    expect(paymentLine({ order_status: 'PLACED', payment_status: 'PENDING', total_amount: 200, wallet_amount_used: 950 })).toBe('Cash on delivery — pay LKR 200 to the rider');
    expect(paymentLine({ order_status: 'CANCELLED', payment_status: 'PENDING', total_amount: 0, wallet_amount_used: 1150 })).toBe('Nothing to pay');
  });
});
