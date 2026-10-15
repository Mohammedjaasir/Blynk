import type { Combo, Product } from '../api/types';
import { effectivePrice, type PricedItem } from '../lib/pricing';
import { storage } from '../lib/storage';

/*
 * Google Tag Manager events for the web shop (owner's "Tracking & SEO brief", 2026-10-15).
 *
 * The one place the app talks to the dataLayer. It only describes what happened; GA4, Google Ads,
 * the Meta Pixel and TikTok are set up inside GTM (docs/06-deployment/
 * google-tag-manager-and-ads-setup.md, section 14, lists every event and where it fires).
 *
 * - Web only. On Android/iOS, in tests, and on a build without a GTM container
 *   (public/index.html then has no snippet, so there is no window.dataLayer) nothing is pushed.
 * - Never throws: a tracking problem must never break a tap.
 * - No personal data, ever: no names, phone numbers, addresses, map points or emails. Items are
 *   built field by field, page URLs keep only allow-listed query parameters (the OTP screen's
 *   ?phone= never leaves), free text (a search) has phone- and email-looking parts redacted, and
 *   every push passes `sanitize` as a last guard.
 * - Shopping events use GA4's ecommerce format: `{ecommerce: null}` first, then
 *   `{event, ecommerce: {currency: 'LKR', value, items, ...}}`. Amounts are numbers in LKR.
 */

/* ------------------------------------------------------------------ the dataLayer */

type Layer = { push: (...entries: unknown[]) => unknown };
type Env = { document?: unknown; dataLayer?: unknown; location?: { href?: string; search?: string; pathname?: string; origin?: string };
  matchMedia?: (q: string) => { matches: boolean }; navigator?: { standalone?: boolean } };
const env = () => globalThis as unknown as Env;

/** window.dataLayer on the web when GTM is on; null on native, in Node and without a container. */
function layer(): Layer | null {
  try {
    const g = env();
    if (!g.document) return null;
    const dl = g.dataLayer;
    return Array.isArray(dl) ? (dl as Layer) : null;
  } catch {
    return null;
  }
}

function push(entry: Record<string, unknown>): boolean {
  const dl = layer();
  if (!dl) return false;
  try {
    dl.push(entry);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ privacy */

/** Keys that are personal data whatever their value. `item_name` / `item_list_name` are product and list names, allowed. */
const PII_KEY = /(^|_)(full_?name|first_?name|last_?name|name|phone|mobile|msisdn|email|e_?mail|address|address_line\d?|street|recipient|lat|lng|lon|latitude|longitude|coords?|geo|otp|token|password|birthday|dob|referral_code)($|_)/i;
const ALLOWED_NAME_KEYS = new Set(['item_name', 'item_list_name', 'promotion_name', 'page_title']);
export const isPiiKey = (k: string) => !ALLOWED_NAME_KEYS.has(k) && PII_KEY.test(k);

/** Phone- or email-looking text in free text (a search term) becomes [redacted]. */
export function redact(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[redacted]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[redacted]');
}

/** Drops personal keys (top level and inside `ecommerce`); undefined values are kept (they clear a key in GTM). */
export function sanitize(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (isPiiKey(k)) continue;
    if (k === 'ecommerce' && v && typeof v === 'object') {
      const e: Record<string, unknown> = {};
      for (const [ek, ev] of Object.entries(v as Record<string, unknown>)) if (!isPiiKey(ek)) e[ek] = ev;
      out[k] = e;
    } else out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ public API */

/** A plain event: `{event, ...params}`. Web only; a no-op without a dataLayer; never throws. */
export function track(event: string, params: Record<string, unknown> = {}): boolean {
  try {
    return push(sanitize({ event, ...params }));
  } catch {
    return false;
  }
}

/**
 * A GA4 ecommerce event: clears the previous ecommerce object first (Google's recommendation),
 * then `{event, ecommerce: {currency: 'LKR', ...ecommerce}, ...extra}`. Never throws.
 */
export function trackEcommerce(event: string, ecommerce: Record<string, unknown>, extra: Record<string, unknown> = {}): boolean {
  try {
    if (!layer()) return false;
    push({ ecommerce: null });
    return push(sanitize({ event, ecommerce: { currency: 'LKR', ...ecommerce }, ...extra }));
  } catch {
    return false;
  }
}

/** Sets data-layer values with no event (GTM keeps them for every later event). */
export function setData(values: Record<string, unknown>): boolean {
  try {
    return push(sanitize(values));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ items */

export type GaItem = {
  item_id: string; item_name: string; item_variant?: string; item_category?: string; item_category2?: string;
  price: number; quantity: number; index?: number; item_list_name?: string; item_list_id?: string;
};

type ProductLike = Pick<Product, 'id' | 'name' | 'selling_price' | 'offer_price' | 'offer_ends_at'> &
  Partial<Pick<Product, 'category_id' | 'category_name'>> & { sku?: string | null };
type VariantLike = { id: string; label?: string | null; sku?: string | null } & Partial<PricedItem>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const str = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);

type CatIndex = { name: Map<string, string>; topOf: (id: string) => string };
let cats: CatIndex | null = null;
let productsById = new Map<string, ProductLike>();

/**
 * The catalogue the events read category names and SKUs from (the root layout's AnalyticsHost
 * keeps it current). Products are only used for an order's lines, which carry no SKU.
 */
export function setCatalogIndex(c: { categories?: { id: string; name: string }[]; topOf?: (id: string) => string; products?: ProductLike[] } | null) {
  try {
    if (!c) { cats = null; productsById = new Map(); return; }
    if (c.categories) cats = { name: new Map(c.categories.map((x) => [x.id, x.name])), topOf: c.topOf ?? ((id) => id) };
    if (c.products) productsById = new Map(c.products.map((p) => [p.id, p]));
  } catch { /* keep the old index */ }
}

/** Top-level category name and, when the product sits in a sub-category, its name. */
export function categoriesOf(p: Partial<Pick<Product, 'category_id' | 'category_name'>>): { item_category?: string; item_category2?: string } {
  const own = str(p.category_name);
  if (!p.category_id || !cats) return own ? { item_category: own } : {};
  let topId = p.category_id;
  try { topId = cats.topOf(p.category_id) || p.category_id; } catch { /* keep its own */ }
  const top = cats.name.get(topId) ?? own;
  if (topId === p.category_id) return top ? { item_category: top } : {};
  const sub = cats.name.get(p.category_id) ?? own;
  return { ...(top ? { item_category: top } : {}), ...(sub ? { item_category2: sub } : {}) };
}

/* Variant SKUs: a cart line keeps only a small snapshot of its size (no SKU), so the SKUs seen
   on the product page / size picker are remembered here (persisted, capped) for later events. */
const SKU_KEY = 'blynk.app.analytics.skus.v1';
let skuMemo: Record<string, string> | null = null;
function skus(): Record<string, string> {
  if (skuMemo) return skuMemo;
  try {
    const raw = JSON.parse(storage.get(SKU_KEY) || '{}');
    skuMemo = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
  } catch { skuMemo = {}; }
  return skuMemo;
}
/** Remember the SKUs of a product's sizes (GET /catalog/products/:id `variants`). */
export function learnSkus(variants: VariantLike[] | null | undefined) {
  try {
    if (!Array.isArray(variants) || !variants.length) return;
    const m = skus();
    let changed = false;
    for (const v of variants) {
      const sku = str(v?.sku);
      if (v?.id && sku && m[v.id] !== sku) { m[v.id] = sku; changed = true; }
    }
    if (!changed) return;
    const keys = Object.keys(m);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete m[k];
    storage.set(SKU_KEY, JSON.stringify(m));
  } catch { /* storage blocked: the id stands in */ }
}

/** SKU of the size if one is chosen, else the product's SKU; the id when no SKU is known. */
export function itemIdOf(p: { id: string; sku?: string | null }, v?: { id: string; sku?: string | null } | null): string {
  if (v) return str(v.sku) ?? skus()[v.id] ?? v.id;
  return str(p.sku) ?? str(productsById.get(p.id)?.sku) ?? p.id;
}

/** One GA4 item for a product (or one size of it). `price` is the unit price paid (offer-aware). */
export function productItem(p: ProductLike, opts: { variant?: VariantLike | null; quantity?: number; price?: number; index?: number; listName?: string } = {}): GaItem {
  const v = opts.variant ?? null;
  const priced: PricedItem | null = v && typeof v.selling_price === 'number'
    ? { selling_price: v.selling_price, offer_price: v.offer_price ?? null, offer_ends_at: v.offer_ends_at ?? null }
    : v ? null : p;
  const price = typeof opts.price === 'number' ? opts.price : priced ? effectivePrice(priced) : effectivePrice(p);
  const item: GaItem = {
    item_id: itemIdOf(p, v),
    item_name: p.name,
    ...(v && str(v.label) ? { item_variant: str(v.label) } : {}),
    ...categoriesOf(p),
    price: round2(num(price)),
    quantity: Math.max(1, Math.round(num(opts.quantity ?? 1))),
  };
  if (typeof opts.index === 'number') item.index = opts.index;
  if (opts.listName) { item.item_list_name = opts.listName; item.item_list_id = listId(opts.listName); }
  return item;
}

/** A combo pack as an item (its packs are priced as one; category "Combo packs"). */
export function comboItem(c: Pick<Combo, 'id' | 'name' | 'price'>, quantity = 1): GaItem {
  return { item_id: `combo_${c.id}`, item_name: c.name, item_category: 'Combo packs', price: round2(num(c.price)), quantity: Math.max(1, Math.round(quantity)) };
}

export const itemsValue = (items: GaItem[]) => round2(items.reduce((a, i) => a + i.price * i.quantity, 0));
export const listId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

/* ------------------------------------------------------------------ cart */

type CartLineLike = { product: ProductLike; quantity: number; variant?: (VariantLike & { is_available?: boolean }) | null };
type ComboLineLike = { combo: Pick<Combo, 'id' | 'name' | 'price'> & { is_available?: boolean }; quantity: number };
export type CartLike = { lines: CartLineLike[]; combos?: ComboLineLike[] };

const keyOf = (l: CartLineLike) => (l.variant?.id ? `${l.product.id}:${l.variant.id}` : l.product.id);

/** The cart as items (unavailable lines are left out, like the subtotal). */
export function cartItems(c: CartLike): GaItem[] {
  const lines = (c.lines ?? []).filter((l) => l.quantity > 0 && (l.product as { is_available?: boolean }).is_available !== false && l.variant?.is_available !== false);
  return [
    ...lines.map((l) => productItem(l.product, { variant: l.variant, quantity: l.quantity })),
    ...(c.combos ?? []).filter((l) => l.quantity > 0 && l.combo.is_available !== false).map((l) => comboItem(l.combo, l.quantity)),
  ];
}

/**
 * A customer's own change to the cart (the single cart store calls this for every "+", "−",
 * Add, size pick, "Order again", "Add all" and "Clear cart"): `add_to_cart` for what went up and
 * `remove_from_cart` for what went down, each with the quantity changed. Sync with the catalogue,
 * refusals at checkout and the cart emptied after an order are not customer changes and never
 * come here.
 */
export function trackCartChange(before: CartLike, after: CartLike, variantHint?: VariantLike | null): void {
  try {
    if (variantHint) learnSkus([variantHint]);
    if (!layer()) return;
    const added: GaItem[] = [];
    const removed: GaItem[] = [];
    const was = new Map(before.lines.map((l) => [keyOf(l), l]));
    const now = new Map(after.lines.map((l) => [keyOf(l), l]));
    for (const k of new Set([...was.keys(), ...now.keys()])) {
      const a = was.get(k);
      const b = now.get(k);
      const d = (b?.quantity ?? 0) - (a?.quantity ?? 0);
      const l = (b ?? a) as CartLineLike;
      if (d > 0) added.push(productItem(l.product, { variant: l.variant, quantity: d }));
      if (d < 0) removed.push(productItem(l.product, { variant: l.variant, quantity: -d }));
    }
    const wasC = new Map((before.combos ?? []).map((l) => [l.combo.id, l]));
    const nowC = new Map((after.combos ?? []).map((l) => [l.combo.id, l]));
    for (const k of new Set([...wasC.keys(), ...nowC.keys()])) {
      const a = wasC.get(k);
      const b = nowC.get(k);
      const d = (b?.quantity ?? 0) - (a?.quantity ?? 0);
      const l = (b ?? a) as ComboLineLike;
      if (d > 0) added.push(comboItem(l.combo, d));
      if (d < 0) removed.push(comboItem(l.combo, -d));
    }
    if (added.length) trackEcommerce('add_to_cart', { value: itemsValue(added), items: added });
    if (removed.length) trackEcommerce('remove_from_cart', { value: itemsValue(removed), items: removed });
  } catch { /* never in the way of the cart */ }
}

/** The cart screen opened with something in it. Value: the cart subtotal (offer prices). */
export function trackViewCart(c: CartLike): void {
  const items = cartItems(c);
  if (items.length) trackEcommerce('view_cart', { value: itemsValue(items), items });
}

/**
 * Checkout begins: signed in, a delivery address chosen and the cart has items, so the cart
 * screen shows its checkout part ("Deliver to", the bill and "Place order"). Fired once per
 * visit of the cart screen. Value: the cart subtotal (discounts and points are not known yet).
 */
export function trackBeginCheckout(c: CartLike): void {
  const items = cartItems(c);
  if (items.length) trackEcommerce('begin_checkout', { value: itemsValue(items), items });
}

/**
 * The delivery fee for the chosen address is known (GET /orders/checkout-info answered).
 * `value`: items after the estimated discount and points; `shipping`: the fee.
 */
export function trackShippingInfo(c: CartLike, bill: { shipping: number; distanceKm?: number | null; discount?: number; points?: number }): void {
  const items = cartItems(c);
  if (!items.length) return;
  const value = round2(Math.max(0, itemsValue(items) - num(bill.discount) - num(bill.points)));
  const km = typeof bill.distanceKm === 'number' && Number.isFinite(bill.distanceKm) ? Math.round(bill.distanceKm * 10) / 10 : undefined;
  trackEcommerce('add_shipping_info', { value, shipping: round2(num(bill.shipping)), items }, km !== undefined ? { distance_km: km } : {});
}

/* ------------------------------------------------------------------ lists */

/** The lists shown lately (newest last), so a product tap can say which list it came from. */
const lists: { name: string; ids: Set<string> }[] = [];
let currentPath = '';

/** A product list shows (category screen, a Home row): first 20 products with their position. */
export function trackViewItemList(name: string, products: ProductLike[]): void {
  try {
    if (!name || !products.length) return;
    const shown = products.slice(0, 20);
    const i = lists.findIndex((l) => l.name === name);
    if (i >= 0) lists.splice(i, 1);
    lists.push({ name, ids: new Set(products.map((p) => p.id)) });
    if (lists.length > 12) lists.shift();
    const items = shown.map((p, index) => productItem(p, { index, listName: name }));
    trackEcommerce('view_item_list', { item_list_id: listId(name), item_list_name: name, items });
  } catch { /* ignore */ }
}

/** Which list a product was tapped in: the newest shown list holding it, else the screen. */
export function listNameFor(productId: string): string {
  for (let i = lists.length - 1; i >= 0; i--) if (lists[i].ids.has(productId)) return lists[i].name;
  if (currentPath.startsWith('/search')) return 'Search results';
  if (currentPath.startsWith('/p/')) return 'Product page';
  if (currentPath.startsWith('/cart')) return 'Cart';
  return 'Other';
}

/** A product card was tapped (every card opens the product through openProduct). */
export function trackSelectItem(p: ProductLike): void {
  const name = listNameFor(p.id);
  trackEcommerce('select_item', { item_list_id: listId(name), item_list_name: name, items: [productItem(p, { listName: name })] });
}

/** A product page shows (once per product per visit). With a size chosen, that size. */
export function trackViewItem(p: ProductLike & { variants?: VariantLike[] }, variant?: VariantLike | null): void {
  if (Array.isArray(p.variants)) learnSkus(p.variants);
  const item = productItem(p, { variant });
  trackEcommerce('view_item', { value: item.price, items: [item] });
}

/** "Notify me" switched on for a sold-out product. */
export function trackNotifyMe(p: ProductLike, variant?: VariantLike | null): void {
  const item = productItem(p, { variant });
  trackEcommerce('notify_me', { value: item.price, items: [item] });
}

/* ------------------------------------------------------------------ search, zone, share */

let lastSearch = '';
/** A search the customer settled on (submit, a recent search, or the typing paused): once per term. */
export function trackSearch(term: string): void {
  const t = redact(term.trim().toLowerCase()).slice(0, 100);
  if (!t || t === lastSearch) return;
  lastSearch = t;
  track('search', { search_term: t });
}

/**
 * The delivery spot is outside the delivery radius (422 DELIVERY_OUTSIDE_RADIUS, or the map pin
 * settled outside the circle). `area`: an approximate place name only (a town / named area),
 * never the address or the map point.
 */
let lastZone = { area: '', at: 0 };
export function trackOutOfZone(area: string | null | undefined, now = Date.now()): void {
  const a = str(area);
  const name = a ? redact(a).slice(0, 60) : '(unknown)';
  // the pin settling outside and then the save being refused for it is one miss, not two
  if (lastZone.area === name && now - lastZone.at < 60_000) return;
  lastZone = { area: name, at: now };
  track('out_of_zone', { area: name });
}

/** The same for a POST /orders or address refusal: only DELIVERY_OUTSIDE_RADIUS counts. */
export function trackOutOfZoneError(e: unknown, area: string | null | undefined): void {
  if ((e as { code?: unknown } | null)?.code === 'DELIVERY_OUTSIDE_RADIUS') trackOutOfZone(area);
}

/**
 * The share sheet was used (or the link copied where there is no sheet). `content`: product,
 * referral (Refer a friend; the code itself is never sent) or app (Account's "Share Blynk").
 */
export function trackShare(result: 'shared' | 'copied' | 'failed', content: 'product' | 'referral' | 'app', itemId?: string): void {
  if (result === 'failed') return;
  track('share', { method: result === 'copied' ? 'copy_link' : 'share_sheet', content_type: content, ...(itemId ? { item_id: itemId } : {}) });
}

/* ------------------------------------------------------------------ the customer */

export type AppMode = 'installed' | 'browser';
export function appMode(): AppMode {
  try {
    const g = env();
    if (g.matchMedia?.('(display-mode: standalone)').matches || g.navigator?.standalone === true) return 'installed';
  } catch { /* browser */ }
  return 'browser';
}

let identified: string | null | undefined;
/**
 * Who is shopping: the internal customer id (never the phone), the app's language and whether
 * it runs installed (Home Screen) or in the browser. Null = signed out: user_id is cleared.
 * Pushed once per change (app start with a session, sign-in, sign-out).
 */
export function identify(userId: string | null | undefined): void {
  const id = str(userId) ?? null;
  if (id === identified) return;
  if (id === null && identified === undefined) { identified = null; return; } // signed out at start: nothing to clear
  identified = id;
  // the app's screens are in English today (the SMS language setting is for SMS only)
  if (id) setData({ user_id: id, app_language: 'en', app_mode: appMode() });
  else setData({ user_id: undefined });
}

/** A returning customer signed in with the SMS code. */
export function trackLogin(userId: string): void {
  identify(userId);
  track('login', { method: 'sms', user_id: userId });
}

/** A new customer finished OTP + registration (gave their name). */
export function trackSignUp(userId?: string | null): void {
  if (userId) identify(userId);
  track('sign_up', { method: 'sms' });
}

/* ------------------------------------------------------------------ purchase */

type OrderItemLike = {
  product_id: string; product_name_snapshot: string; unit_selling_price: number; quantity: number;
  order_combo_id?: string | null; variant_id?: string | null; variant_label_snapshot?: string | null;
};
export type OrderLike = {
  order_number: string; order_status: string; payment_method: string; payment_status: string;
  total_amount: number; delivery_fee: number; coupon_code?: string | null; points_discount_amount?: number;
  items?: OrderItemLike[]; combos?: { combo_id: string | null; id: string; name: string; unit_price: number; quantity: number }[];
};

export const PURCHASES_KEY = 'blynk.app.analytics.purchases.v1';
function sentOrders(): string[] {
  try {
    const raw = JSON.parse(storage.get(PURCHASES_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
/** Whether `purchase` was already sent for this order number on this device. */
export const purchaseSent = (orderNumber: string) => sentOrders().includes(orderNumber);
function markSent(orderNumber: string) {
  try { storage.set(PURCHASES_KEY, JSON.stringify([...sentOrders().filter((x) => x !== orderNumber), orderNumber].slice(-50))); } catch { /* blocked */ }
}

/** The order's lines as items; the cart (still full when a cash order is confirmed) supplies SKUs and categories. */
export function orderItems(o: OrderLike, cart?: CartLike | null): GaItem[] {
  const fromCart = new Map((cart?.lines ?? []).map((l) => [keyOf(l), l]));
  const items: GaItem[] = (o.items ?? []).filter((i) => !i.order_combo_id).map((i) => {
    const line = fromCart.get(i.variant_id ? `${i.product_id}:${i.variant_id}` : i.product_id);
    const p: ProductLike = line?.product ?? productsById.get(i.product_id)
      ?? { id: i.product_id, name: i.product_name_snapshot, selling_price: i.unit_selling_price, offer_price: null, offer_ends_at: null };
    const variant = i.variant_id ? { id: i.variant_id, label: i.variant_label_snapshot ?? line?.variant?.label ?? null, sku: line?.variant?.sku ?? null } : null;
    return { ...productItem(p, { variant, quantity: i.quantity, price: num(i.unit_selling_price) }), item_name: i.product_name_snapshot || p.name };
  });
  for (const c of o.combos ?? []) items.push(comboItem({ id: c.combo_id ?? c.id, name: c.name, price: c.unit_price }, c.quantity));
  return items;
}

/**
 * The server confirmed an order: `purchase`, once per order number on this device (a persisted
 * guard, so a refresh, Back or the "Order placed" screen opening again never sends it twice).
 * Cash on delivery: when POST /orders answers. PayHere: only once the order is paid (the return
 * screen saw payment_status PAID); an order still AWAITING_PAYMENT is not a purchase yet.
 * value = items after discounts and points, without the delivery fee; shipping = the fee.
 * Points used on the order also send `points_redeem {points}` (inside the same guard).
 */
export function trackPurchase(o: OrderLike, opts: { cart?: CartLike | null; points?: number } = {}): boolean {
  try {
    if (!o?.order_number) return false;
    if (o.order_status === 'AWAITING_PAYMENT') return false;
    if (o.payment_method === 'ONLINE' && o.payment_status !== 'PAID') return false;
    if (purchaseSent(o.order_number)) return false;
    if (!layer()) return false;
    markSent(o.order_number);
    const items = orderItems(o, opts.cart);
    const shipping = round2(num(o.delivery_fee));
    const value = round2(Math.max(0, num(o.total_amount) - shipping));
    trackEcommerce('purchase', {
      transaction_id: o.order_number, value, shipping, items,
      ...(str(o.coupon_code) ? { coupon: str(o.coupon_code) } : {}),
      payment_type: o.payment_method === 'ONLINE' ? 'ONLINE' : 'COD',
    });
    const points = Math.round(num((o as { points_redeemed?: unknown }).points_redeemed) || (num(o.points_discount_amount) > 0 ? num(opts.points) : 0));
    if (points > 0) track('points_redeem', { points });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ page views */

/** Ad-click parameters kept on the first page view even though the intro moves the address on. */
export const AD_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'gbraid', 'wbraid', 'ttclid', 'msclkid'];
/** Screens that send no page_view (their address holds personal data). */
const NO_PAGE_VIEW = new Set(['/otp']);
/** Query parameters a page URL may carry in an event (anything else, e.g. the OTP screen's phone, is dropped). */
const PAGE_PARAMS = new Set([...AD_PARAMS, 'sub', 'c', 'gate', 'order', 'from']);

function parseQuery(search: string): [string, string][] {
  try {
    return Array.from(new URLSearchParams(search).entries());
  } catch {
    return [];
  }
}

/** The ad-click parameters the page was opened with, read once when the app loads. */
let landingAds: [string, string][] = (() => {
  try {
    const loc = env().location;
    return env().document && loc?.search ? parseQuery(loc.search).filter(([k]) => AD_PARAMS.includes(k)) : [];
  } catch {
    return [];
  }
})();
let firstPageView = true;
let lastPageKey = '';

/** Base path of the web app (`/app` on blynk.lk). */
function basePath(): string {
  const b = typeof process !== 'undefined' ? process.env.EXPO_BASE_URL : undefined;
  if (typeof b === 'string') return b.replace(/\/$/, '');
  const p = env().location?.pathname ?? '';
  return p === '/app' || p.startsWith('/app/') ? '/app' : '';
}

/** A readable title per screen (document.title is "Blynk" everywhere). */
export function pageTitleFor(path: string): string {
  const p = path.split('?')[0];
  const exact: Record<string, string> = {
    '/home': 'Home', '/orders': 'Orders', '/help': 'Help', '/account': 'Account', '/cart': 'Cart', '/search': 'Search',
    '/categories': 'Categories', '/login': 'Log in', '/otp': 'Verify code', '/register': 'Sign up', '/birthday': 'Birthday',
    '/address': 'Delivery address', '/addresses': 'Addresses', '/placed': 'Order placed', '/points': 'Blynk Points', '/refer': 'Refer a friend',
    '/profile': 'Profile', '/settings': 'Settings', '/about': 'About', '/feedback': 'Feedback', '/delivery-area': 'Delivery area',
    '/payment/pay': 'Pay online', '/payment/return': 'Payment result', '/payment/cancel': 'Payment cancelled', '/doctors': 'Doctors',
  };
  if (exact[p]) return `${exact[p]} | Blynk`;
  const prefix: [string, string][] = [['/p/', 'Product'], ['/category/', 'Category'], ['/order/', 'Order'], ['/track/', 'Track order'], ['/store/', 'Aisle'], ['/doctors/', 'Doctors']];
  for (const [k, v] of prefix) if (p.startsWith(k)) return `${v} | Blynk`;
  return 'Blynk';
}

/**
 * A screen shows (the root layout calls this on every route change). `route` is the router path
 * (`/home`, `/p/123`), `params` its search parameters. page_path carries the /app prefix;
 * page_location is the full address with only allow-listed parameters; the first page view also
 * carries the ad-click parameters the app was opened with (the intro's redirect to /home drops
 * them from the address bar). The same path twice in a row is one page view.
 */
export function trackPageView(route: string, params: Record<string, unknown> = {}): boolean {
  try {
    currentPath = route;
    // the OTP screen's own address carries the phone number (?phone=): no page view there, so no
    // tag (Meta's PageView reads the address bar itself) ever fires while it is showing
    if (NO_PAGE_VIEW.has(route)) return false;
    const q: [string, string][] = [];
    for (const [k, v] of Object.entries(params)) {
      const val = Array.isArray(v) ? v[0] : v;
      if (PAGE_PARAMS.has(k) && typeof val === 'string' && val) q.push([k, val]);
    }
    const page_path = `${basePath()}${route === '/' ? '/' : route}`;
    const ownKey = q.filter(([k]) => !AD_PARAMS.includes(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
    const key = ownKey ? `${page_path}?${ownKey}` : page_path;
    if (key === lastPageKey) return false;
    if (!layer()) return false;
    lastPageKey = key;
    if (firstPageView) {
      firstPageView = false;
      for (const kv of landingAds) if (!q.some(([k]) => k === kv[0])) q.push(kv);
    }
    const origin = env().location?.origin ?? 'https://blynk.lk';
    const search = q.length ? `?${q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : '';
    return track('page_view', { page_path, page_location: `${origin}${page_path}${search}`, page_title: pageTitleFor(route) });
  } catch {
    return false;
  }
}

/** For tests: forget everything this module remembers. */
export function resetForTests(o: { landingSearch?: string } = {}) {
  lists.length = 0;
  currentPath = '';
  lastSearch = '';
  lastZone = { area: '', at: 0 };
  lastPageKey = '';
  firstPageView = true;
  identified = undefined;
  skuMemo = null;
  cats = null;
  productsById = new Map();
  landingAds = o.landingSearch ? parseQuery(o.landingSearch).filter(([k]) => AD_PARAMS.includes(k)) : [];
}
