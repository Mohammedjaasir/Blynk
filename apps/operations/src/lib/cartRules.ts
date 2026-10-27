import type { CartRulesSetting } from '../api/types';

/**
 * Cart rules (owner, 2026-10-27; GET|PATCH /admin/settings/cart-rules):
 * `one_seller_per_order` - a cart may hold items from only one seller (or only
 * Blynk's own products). ON by default: the API has no row until the first
 * save and then answers `enabled: true`. This only fills the gap while an older
 * backend or an empty answer leaves the value out. Mixed carts for nearby
 * sellers come later; the setting shape has room for more rules.
 */
export const DEFAULT_CART_RULES: CartRulesSetting = { one_seller_per_order: { enabled: true } };

/** The stored switch, or ON when the API sent no value. */
export function oneSellerPerOrderEnabled(setting: Partial<CartRulesSetting> | null | undefined): boolean {
  const enabled = setting?.one_seller_per_order?.enabled;
  return typeof enabled === 'boolean' ? enabled : DEFAULT_CART_RULES.one_seller_per_order.enabled;
}

/** The PATCH body for the switch. */
export function cartRulesBody(enabled: boolean): { one_seller_per_order: { enabled: boolean } } {
  return { one_seller_per_order: { enabled } };
}

/** "One seller per order is on." / "... is off." */
export function oneSellerPerOrderText(enabled: boolean): string {
  return `One seller per order is ${enabled ? 'on' : 'off'}.`;
}
