import { useCartSelect } from '@/lib/cart';
import { freeDeliveryCount } from '../lib/storeText';
import { useStore } from './StoreContext';

/**
 * Blynk exposes no basket free-delivery threshold on a public GET (it lives in the
 * signed-in checkout-info), so the "unlocked" moment comes from the new-customer
 * free deliveries: unlocked once the cart has items while that switch is on.
 * Returns the number of free deliveries (0 when off or the cart is empty).
 */
export function useFreeDeliveryUnlocked(): number {
  const store = useStore();
  const hasItems = useCartSelect((c) => c.count > 0);
  return hasItems ? freeDeliveryCount(store) : 0;
}
