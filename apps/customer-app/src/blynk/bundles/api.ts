import { apiPost } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';
import type { PlaceOrderBody } from '@/blynk/orders/types';
import { parseBundleQuote, type BundleQuote } from './model';

/**
 * POST /orders/bundle-quote (signed in): what the bundle offers do to this cart (free units, the gift, the
 * nearest offer still to unlock, the charged subtotal). The same rules run again when the order is placed.
 * null when the answer is not a quote (an older server): the cart then shows no bundle lines.
 */
export async function getBundleQuote(items: PlaceOrderBody['items'], combos: PlaceOrderBody['combos'] = [], signal?: AbortSignal): Promise<BundleQuote | null> {
  const body = { items, ...(combos?.length ? { combos } : {}) };
  return parseBundleQuote(await authed((t) => apiPost<unknown>('/orders/bundle-quote', body, t, signal)));
}
