import type { BasketFreeDeliverySetting, CheckoutSettings, OrderForSomeoneElseSetting } from '../api/types';

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
