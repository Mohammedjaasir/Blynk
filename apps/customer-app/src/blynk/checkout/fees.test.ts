import { afterEach, describe, expect, it } from 'vitest';
import type { StoreInfo } from '@/blynk/api/types';
import { setLang } from '@/blynk/i18n/lang';
import { checkoutBill } from '@/blynk/orders/checkout';
import type { CheckoutInfo } from '@/blynk/orders/types';
import { store } from '../test/fixtures';
import { deliveryFormulaText, smallFeeFor, smallFeeNote, smallFeeRule } from './fees';
import { FEE_WORDS } from './feeWords';

afterEach(() => setLang('en'));

const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;

const rule = { enabled: true, min_subtotal_lkr: 1000, fee_lkr: 50 };
const off = { enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 };

const quote = (over: Partial<CheckoutInfo> = {}): CheckoutInfo => ({
  delivery_fee_lkr: 160,
  standard_delivery_fee_lkr: 160,
  delivery_fee_mode: 'DISTANCE_TIERS',
  delivery_distance_km: 2.4,
  delivery_distance_estimated: false,
  delivery_fee_address_id: 'a1',
  coupons_enabled: false,
  free_delivery: { enabled: false, count: 0, since: '2026-10-08T18:30:00.000Z', used: 0, remaining: 0, applies: false },
  basket_free_delivery: { enabled: false, min_subtotal_lkr: 0, applies: false, remaining_lkr: null },
  ...over,
});

const withStore = (over: Partial<StoreInfo>): StoreInfo => ({ ...store, ...over });

describe('small-order fee', () => {
  it('is charged only while the item total is under the minimum', () => {
    expect(smallFeeFor(rule, 800)).toEqual({ enabled: true, min: 1000, fee: 50, applies: true, charged: 50, remaining: 200 });
    expect(smallFeeFor(rule, 999.99)).toMatchObject({ applies: true, remaining: 0.01 });
    expect(smallFeeFor(rule, 1000)).toMatchObject({ applies: false, charged: 0, remaining: null });
    expect(smallFeeFor(rule, 2400)).toMatchObject({ applies: false, charged: 0 });
  });

  it('is off when the switch is off, the rule is missing or unusable, or the cart is empty', () => {
    expect(smallFeeFor(off, 300)).toMatchObject({ enabled: false, applies: false, charged: 0 });
    expect(smallFeeFor(undefined, 300).enabled).toBe(false);
    expect(smallFeeFor({ enabled: true, min_subtotal_lkr: 0, fee_lkr: 50 }, 300).applies).toBe(false);
    expect(smallFeeFor({ enabled: true, min_subtotal_lkr: 1000, fee_lkr: NaN }, 300).applies).toBe(false);
    expect(smallFeeFor(rule, 0).applies).toBe(false);
  });

  it('says how much more to add, in the exact English words', () => {
    expect(smallFeeNote(smallFeeFor(rule, 800))).toBe('Add LKR 200 more to avoid the small-order fee.');
    expect(smallFeeNote(smallFeeFor(rule, 849.5))).toBe('Add LKR 150.50 more to avoid the small-order fee.');
    expect(smallFeeNote(smallFeeFor(rule, 1000))).toBeNull();
    expect(smallFeeNote(smallFeeFor(off, 800))).toBeNull();
    expect(FEE_WORDS.smallOrderFee).toBe('Small-order fee');
  });

  it('takes the quote rule once an address is chosen, the store rule before that', () => {
    const s = withStore({ small_order_fee: rule });
    expect(smallFeeRule(s, null)).toEqual(rule);
    expect(smallFeeRule(s, quote({ small_order_fee: { ...off, applies: null, charged_lkr: 0, remaining_lkr: null } }))).toMatchObject({ enabled: false });
    expect(smallFeeRule(s, quote())).toEqual(rule); // an older server quote without the field: the store one
    expect(smallFeeRule(store, null)).toBeNull();
  });
});

describe('what the cart total is', () => {
  const q = (o: Partial<CheckoutInfo> = {}) => quote({ small_order_fee: { ...rule, applies: null, charged_lkr: 0, remaining_lkr: null }, ...o });

  it('adds the fee to the total while it applies', () => {
    const b = checkoutBill(800, q());
    expect(b.smallFee).toMatchObject({ applies: true, charged: 50, remaining: 200 });
    expect(b.deliveryFee).toBe(160);
    expect(b.toPay).toBe(1010); // 800 + 160 + 50
  });

  it('adds nothing at or above the minimum', () => {
    expect(checkoutBill(1000, q()).toPay).toBe(1160);
    expect(checkoutBill(1000, q()).smallFee.applies).toBe(false);
  });

  it('adds nothing when the switch is off or the server has no such field', () => {
    expect(checkoutBill(800, quote({ small_order_fee: { ...off, applies: null, charged_lkr: 0, remaining_lkr: null } })).toPay).toBe(960);
    expect(checkoutBill(800, quote()).toPay).toBe(960);
  });

  it('is still charged when delivery is free (free delivery does not waive it)', () => {
    const free = q({
      delivery_fee_lkr: 0,
      basket_free_delivery: { enabled: true, min_subtotal_lkr: 500, applies: true, remaining_lkr: 0 },
    });
    const b = checkoutBill(800, free);
    expect(b.freeReason).toBe('BASKET');
    expect(b.deliveryFee).toBe(0);
    expect(b.toPay).toBe(850); // 800 + 0 + 50
  });

  it('is not discounted by a coupon, and the wallet pays after it', () => {
    const coupon = { code: 'SAVE10', discount_type: 'PERCENT', description: null, subtotal: 800, delivery_fee: 160, discount_amount: 80, birthday_discount_amount: 0, referral_discount_amount: 0, applied_discount: 'COUPON' as const, total: 930 };
    expect(checkoutBill(800, q(), coupon).toPay).toBe(930); // 800 + 160 + 50 - 80
    const w = checkoutBill(800, q({ wallet: { enabled: true, balance: 5000, max_use_percent: 100 } }), null, false, true);
    expect(w.wallet).toBe(1010);
    expect(w.toPay).toBe(0);
  });

  it('follows the basket, not a stale quote', () => {
    // the quote says it did not apply, but the basket is now under the minimum
    const b = checkoutBill(700, q({ small_order_fee: { ...rule, applies: false, charged_lkr: 0, remaining_lkr: 0 } }));
    expect(b.smallFee).toMatchObject({ applies: true, remaining: 300 });
    expect(b.toPay).toBe(910);
  });
});

describe('the delivery fee formula line', () => {
  const formula = { base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null };

  it('explains the base + per km fee in one line', () => {
    expect(deliveryFormulaText(withStore({ delivery_fee_formula: formula }))).toBe('LKR 120 up to 2 km, then LKR 40 for each extra km');
    expect(deliveryFormulaText(withStore({ delivery_fee_formula: { ...formula, base_km: 2.5, per_km_lkr: 42.5 } }))).toBe('LKR 120 up to 2.5 km, then LKR 42.50 for each extra km');
  });

  it('mentions the cap when one is set', () => {
    expect(deliveryFormulaText(withStore({ delivery_fee_formula: { ...formula, max_fee_lkr: 300 } }))).toBe('LKR 120 up to 2 km, then LKR 40 for each extra km. Never more than LKR 300.');
  });

  it('is absent for flat / tier fees, an older server and bad numbers', () => {
    expect(deliveryFormulaText(withStore({ delivery_fee_formula: null }))).toBeNull();
    expect(deliveryFormulaText(store)).toBeNull();
    expect(deliveryFormulaText(null)).toBeNull();
    expect(deliveryFormulaText(withStore({ delivery_fee_formula: { ...formula, base_lkr: NaN } }))).toBeNull();
  });
});

describe('Sinhala and Tamil', () => {
  it('render the fee words with the amounts kept', () => {
    const f = smallFeeFor(rule, 800);
    setLang('si');
    expect(FEE_WORDS.smallOrderFee).toMatch(SINHALA);
    expect(smallFeeNote(f)).toMatch(SINHALA);
    expect(smallFeeNote(f)).toContain('LKR 200');
    const s = withStore({ delivery_fee_formula: { base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: 300 } });
    expect(deliveryFormulaText(s)).toMatch(SINHALA);
    expect(deliveryFormulaText(s)).toContain('LKR 120');
    expect(deliveryFormulaText(s)).toContain('LKR 40');
    expect(deliveryFormulaText(s)).toContain('LKR 300');
    setLang('ta');
    expect(FEE_WORDS.smallOrderFee).toMatch(TAMIL);
    expect(smallFeeNote(f)).toMatch(TAMIL);
    expect(smallFeeNote(f)).toContain('LKR 200');
    expect(deliveryFormulaText(s)).toMatch(TAMIL);
    expect(deliveryFormulaText(s)).toContain('LKR 120');
    setLang('en');
    expect(smallFeeNote(f)).toBe('Add LKR 200 more to avoid the small-order fee.');
  });
});
