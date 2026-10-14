import { useCartSelect } from '@/lib/cart';
import type { FreeClaim } from './freeClaim';
import { NO_CLAIM } from './freeClaim';
import { useFreeClaim } from './useFreeClaim';

/**
 * The cart bar's free-delivery strip once the cart has items: a guest sees the new-customer
 * offer, a signed-in customer only the free deliveries they still have (useFreeClaim).
 * Returns the claim (count 0 when nothing may be said or the cart is empty).
 */
export function useFreeDeliveryClaimWithItems(): FreeClaim {
  const claim = useFreeClaim();
  const hasItems = useCartSelect((c) => c.count > 0);
  return hasItems ? claim : NO_CLAIM;
}

/** The number of free deliveries the strip may mention (0 when off, used up, unknown or the cart is empty). */
export function useFreeDeliveryUnlocked(): number {
  return useFreeDeliveryClaimWithItems().count;
}
