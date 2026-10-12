import type { BasketFreeDeliverySetting, CheckoutSettings, OrderForSomeoneElseSetting } from '../api/types';

/**
 * Free delivery above a basket amount (owner, 2026-10-12): more than 0, up to
 * LKR 100,000, at most 2 decimals, as PATCH /admin/settings/checkout accepts.
 */
export function parseBasketAmount(raw: string): { amount: number } | { error: string } {
  const text = raw.trim().replace(/,/g, '');
  if (!text) return { error: 'Enter the basket amount in LKR, like 3000.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 3000 or 2999.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const amount = Number(text);
  if (amount <= 0 || amount > 100_000) return { error: 'The basket amount must be more than LKR 0 and at most LKR 100,000.' };
  return { amount };
}

/**
 * The newer checkout switches (owner, 2026-10-12) for PATCH
 * /admin/settings/checkout: free delivery above a basket amount, and ordering
 * for someone else. Each is sent only when it differs from what is stored, so
 * saving the other switches still works against a backend from before them.
 * `basketAmount` null = the typed amount is not valid (only allowed while the
 * basket switch is off; the stored amount is then kept).
 */
export function checkoutExtrasPatch(
  current: CheckoutSettings | null,
  draft: { basketOn: boolean; basketAmount: number | null; forOthersOn: boolean; codeToReceiver: boolean }
): { basket_free_delivery?: BasketFreeDeliverySetting; order_for_someone_else?: OrderForSomeoneElseSetting } {
  const out: { basket_free_delivery?: BasketFreeDeliverySetting; order_for_someone_else?: OrderForSomeoneElseSetting } = {};
  const basket = current?.basket_free_delivery;
  const amount = draft.basketAmount ?? basket?.min_subtotal_lkr ?? 3000;
  const basketChanged = basket
    ? draft.basketOn !== basket.enabled || (draft.basketAmount !== null && draft.basketAmount !== basket.min_subtotal_lkr)
    : draft.basketOn;
  if (basketChanged) out.basket_free_delivery = { enabled: draft.basketOn, min_subtotal_lkr: amount };

  const others = current?.order_for_someone_else ?? { enabled: true, send_code_to_receiver: true };
  if (draft.forOthersOn !== others.enabled || draft.codeToReceiver !== others.send_code_to_receiver) {
    out.order_for_someone_else = { enabled: draft.forOthersOn, send_code_to_receiver: draft.codeToReceiver };
  }
  return out;
}
