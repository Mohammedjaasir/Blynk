import { ApiError, apiDelete, apiGet, apiPost } from '@/blynk/api/client';
import type { Combo, Product } from '@/blynk/api/types';
import { authed, getSession } from '@/blynk/auth/session';

/*
 * The product page's calls (Flutter ProductProvider.loadProductDetail / setNotifyMe).
 * GET /catalog/products/:id is public; signed in, the bearer token makes the answer carry
 * `notify_me_subscribed` for this customer (optionalAuth on the backend).
 */

export type ProductDetail = { product: Product; notifyMe: boolean };

const path = (id: string) => `/catalog/products/${encodeURIComponent(id)}`;

export async function fetchProductDetail(id: string, signal?: AbortSignal): Promise<ProductDetail> {
  type Raw = { product?: (Product & { notify_me_subscribed?: unknown }) | null };
  const r = getSession()
    ? await authed((t) => apiGet<Raw>(path(id), t, signal))
    : await apiGet<Raw>(path(id), null, signal);
  const p = r?.product;
  if (!p || typeof p !== 'object' || typeof p.id !== 'string') throw new ApiError('Malformed product response', 500);
  const { notify_me_subscribed, ...product } = p;
  const n = (v: unknown) => (typeof v === 'string' ? Number(v) : v);
  return {
    product: { ...product, selling_price: n(product.selling_price) as number, offer_price: product.offer_price == null ? null : (n(product.offer_price) as number) },
    notifyMe: notify_me_subscribed === true,
  };
}

/** A 404 is "removed from the store"; anything else is a connection or server problem. */
export const isProductGone = (e: unknown) => e instanceof ApiError && e.status === 404;

export type NotifyResult = 'on' | 'off' | 'back-in-stock';

/**
 * Turns the back-in-stock alert on (POST) or off (DELETE). Signed-in shoppers only. A product
 * that is back already (409 PRODUCT_AVAILABLE) answers 'back-in-stock' so the page re-reads it.
 */
export async function setNotifyMe(id: string, on: boolean): Promise<NotifyResult> {
  try {
    await authed((t) => (on ? apiPost<unknown>(`${path(id)}/notify-me`, {}, t) : apiDelete<unknown>(`${path(id)}/notify-me`, t)));
    return on ? 'on' : 'off';
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return 'back-in-stock';
    throw e;
  }
}

/** Label before the customer asks. */
export const NOTIFY_ME_LABEL = "Notify me when it's back";
/** Label once they have asked (tapping it again cancels). */
export const NOTIFY_ME_ON_LABEL = "We'll tell you when it's back";
export const NOTIFY_ME_ON_HINT = 'Tap again if you no longer want the alert.';

/** What tapping the button does for this customer right now. */
export function notifyMeAction(signedIn: boolean, subscribed: boolean): 'sign-in' | 'subscribe' | 'unsubscribe' {
  if (!signedIn) return 'sign-in';
  return subscribed ? 'unsubscribe' : 'subscribe';
}

/** Combo packs (GET /combos) that hold this product, on sale ones first. */
export function combosWith(productId: string, combos: Combo[]): Combo[] {
  return combos
    .filter((c) => c.items.some((i) => i.product_id === productId))
    .sort((a, b) => Number(b.is_available) - Number(a.is_available));
}

/** "Unit · Pack" for the summary line. */
export const unitLine = (p: Pick<Product, 'unit' | 'pack_size'>) =>
  [p.unit, p.pack_size].map((s) => (s ?? '').trim()).filter(Boolean).join(' · ');

/** The "Product details" rows: only the ones with real content. */
export function detailRows(p: Pick<Product, 'unit' | 'pack_size' | 'category_name'>): [string, string][] {
  const rows: [string, string][] = [];
  if ((p.unit ?? '').trim()) rows.push(['Unit', p.unit]);
  if ((p.pack_size ?? '').trim()) rows.push(['Pack', p.pack_size as string]);
  if ((p.category_name ?? '').trim()) rows.push(['Category', p.category_name]);
  return rows;
}
