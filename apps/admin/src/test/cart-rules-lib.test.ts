import { describe, expect, it } from 'vitest';
import { DEFAULT_CART_RULES, cartRulesBody, oneSellerPerOrderEnabled, oneSellerPerOrderText } from '../lib/cartRules';

/** Cart rules helper (owner, 2026-10-27; docs/superpowers/plans/2026-10-27-one-seller-cart-and-seller-applications.md, R). */
describe('cart rules helper', () => {
  it('defaults to ON', () => {
    expect(DEFAULT_CART_RULES).toEqual({ one_seller_per_order: { enabled: true } });
  });

  it('reads the stored switch', () => {
    expect(oneSellerPerOrderEnabled({ one_seller_per_order: { enabled: false } })).toBe(false);
    expect(oneSellerPerOrderEnabled({ one_seller_per_order: { enabled: true } })).toBe(true);
  });

  it('shows ON when the API has no value yet (empty, null, malformed)', () => {
    expect(oneSellerPerOrderEnabled(null)).toBe(true);
    expect(oneSellerPerOrderEnabled(undefined)).toBe(true);
    expect(oneSellerPerOrderEnabled({})).toBe(true);
    expect(oneSellerPerOrderEnabled({ one_seller_per_order: {} as { enabled: boolean } })).toBe(true);
    expect(oneSellerPerOrderEnabled({ one_seller_per_order: { enabled: 'no' as unknown as boolean } })).toBe(true);
  });

  it('builds the strict PATCH body', () => {
    expect(cartRulesBody(false)).toEqual({ one_seller_per_order: { enabled: false } });
    expect(cartRulesBody(true)).toEqual({ one_seller_per_order: { enabled: true } });
  });

  it('words the state', () => {
    expect(oneSellerPerOrderText(true)).toBe('One seller per order is on.');
    expect(oneSellerPerOrderText(false)).toBe('One seller per order is off.');
  });
});
