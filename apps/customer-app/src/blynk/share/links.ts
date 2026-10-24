/*
 * Shareable links, the Flutter shop's rules (lib/Services/share_links.dart and
 * lib/Services/referral_link.dart, owner 2026-09-29 / 2026-10-10).
 *
 * - A shared product is `https://<site>/p/<productId>`. The website sends that on to the web
 *   shop at `/app/#/p/<productId>`; the app reads the `/p/<id>` route from the hash (or from a
 *   plain `/app/p/<id>` path) and opens the product.
 * - Refer a friend is `https://<site>/app/?ref=CODE`; the code is kept until sign-in.
 *
 * The site address is a build value (EXPO_PUBLIC_SHARE_BASE_URL), https only. Without one it
 * is https://blynk.lk, the shop's public site. Expo inlines EXPO_PUBLIC_* at build time.
 */
import { SHARE_WORDS } from './words';

export const SHARE_BASE_URL: string = process.env.EXPO_PUBLIC_SHARE_BASE_URL || 'https://blynk.lk';

/** Product ids are the API's ids: letters, digits, '-' and '_' only. */
const PRODUCT_ROUTE = /^\/p\/([A-Za-z0-9_-]{1,64})\/?$/;
const REFERRAL_LINK_CODE = /^[A-Za-z0-9]{1,32}$/;
/** A friend's code: letters and digits (lenient; the server is the judge), typed in any case, sent upper-case. */
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{3,32}$/;

export const normaliseReferralCode = (raw: string) => raw.trim().toUpperCase();

/** The https origin of `base` (no path, query or hash), or null when it is not an https address. */
function httpsOrigin(base: string): string | null {
  try {
    const u = new URL(base.trim());
    if (u.protocol !== 'https:' || !u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The product id in a `/p/<id>` route (query string and hash ignored), or null. */
export function productIdFromRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  const path = route.split(/[?#]/)[0];
  return PRODUCT_ROUTE.exec(path)?.[1] ?? null;
}

/** The public link for a product, or null when the base is not https or the id is not one. */
export function productUrl(productId: string, baseUrl: string = SHARE_BASE_URL): string | null {
  const origin = httpsOrigin(baseUrl);
  if (!origin || !PRODUCT_ROUTE.test(`/p/${productId}`)) return null;
  return `${origin}/p/${productId}`;
}

/** What the share sheet sends: the name, then the link when there is one. */
export function productShareText(name: string, productId: string, baseUrl: string = SHARE_BASE_URL): string {
  const url = productUrl(productId, baseUrl);
  const text = SHARE_WORDS.product(name);
  return url ? `${text}\n${url}` : text;
}

/** Refer a friend: `<site>/app/?ref=CODE`, or null without an https site or with a code that is not plain letters and digits. */
export function referralUrl(code: string, baseUrl: string = SHARE_BASE_URL): string | null {
  const origin = httpsOrigin(baseUrl);
  if (!origin || !REFERRAL_LINK_CODE.test(code)) return null;
  return `${origin}/app/?ref=${encodeURIComponent(code)}`;
}

/** What the referral share sheet sends: the code, then the link when there is one. */
export function referralShareText(code: string, baseUrl: string = SHARE_BASE_URL): string {
  const url = referralUrl(code, baseUrl);
  return url ? `${SHARE_WORDS.referralWithLink(code)}\n${url}` : SHARE_WORDS.referralNoLink(code);
}

/** The `ref` code in a page's query string (normalised), or null when absent or malformed. */
export function referralCodeFromSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('ref');
  } catch {
    return null;
  }
  if (raw == null) return null;
  const code = normaliseReferralCode(raw);
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/*
 * The Flutter web shop routed with the hash (`/app/#/refer`). Old links and the site's
 * `/p/<id>` redirect still arrive that way; these are the ones that map onto this app.
 */
const HASH_ROUTES: Record<string, string> = {
  '/refer': '/refer',
  '/points': '/points',
  '/search': '/search',
  '/cart': '/cart',
  '/dental/clinics': '/doctors',
  '/dental/appointments': '/doctors/appointments',
};

/**
 * The in-app path for a page hash such as `#/p/<id>` or `#/refer`, or null when the hash is
 * empty or names nothing this app has. Base-path independent: only the hash is read.
 */
export function routeFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const route = hash.replace(/^#!?/, '');
  if (!route.startsWith('/')) return null;
  const id = productIdFromRoute(route);
  if (id) return `/p/${id}`;
  const path = route.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return HASH_ROUTES[path] ?? null;
}
