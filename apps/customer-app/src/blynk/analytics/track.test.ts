import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Product } from '../api/types';
import {
  cartItems, identify, isPiiKey, listNameFor, productItem, purchaseSent, redact, resetForTests, sanitize, setCatalogIndex, track,
  trackBeginCheckout, trackCartChange, trackEcommerce, trackLogin, trackOutOfZone, trackOutOfZoneError, trackPageView, trackPurchase,
  trackSearch, trackSelectItem, trackShare, trackShippingInfo, trackSignUp, trackViewCart, trackViewItem, trackViewItemList, PURCHASES_KEY,
} from './track';
import { storage } from '../lib/storage';

type G = { document?: unknown; dataLayer?: unknown[]; location?: unknown };
const g = globalThis as unknown as G;

function web(landingSearch = '') {
  g.document = {};
  g.dataLayer = [];
  g.location = { origin: 'https://blynk.lk', pathname: '/app/home', search: '', href: 'https://blynk.lk/app/home' };
  resetForTests({ landingSearch });
  return g.dataLayer as Record<string, unknown>[];
}
const events = () => (g.dataLayer as Record<string, unknown>[]).filter((e) => 'event' in e);
const byName = (name: string) => events().filter((e) => e.event === name);

const product = (over: Partial<Product> & { sku?: string } = {}): Product & { sku?: string } => ({
  id: 'p1', category_id: 'sub-milk', category_name: 'Milk', name: 'Kotmale Milk 1L', slug: 'kotmale-milk', description: null,
  unit: '1 L', pack_size: null, image_url: null, image_focal_x: 50, image_focal_y: 50, selling_price: 600, offer_price: 540,
  offer_ends_at: null, offer_kind: 'PRODUCT', is_available: true, sku: 'KOT-1L', ...over,
});
const catalog = () => setCatalogIndex({
  categories: [{ id: 'dairy', name: 'Dairy' }, { id: 'sub-milk', name: 'Milk' }, { id: 'baby', name: 'Baby care' }],
  topOf: (id) => (id === 'sub-milk' ? 'dairy' : id),
});

beforeEach(() => { web(); });
afterEach(() => { delete g.document; delete g.dataLayer; delete g.location; resetForTests(); storage.set(PURCHASES_KEY, ''); });

describe('the dataLayer', () => {
  test('no dataLayer (no GTM container) or no document (native): nothing is pushed, nothing throws', () => {
    delete g.dataLayer;
    expect(track('search', { search_term: 'milk' })).toBe(false);
    expect(trackEcommerce('view_cart', { value: 1, items: [] })).toBe(false);
    expect(() => trackCartChange({ lines: [] }, { lines: [{ product: product(), quantity: 1 }] })).not.toThrow();
    expect(trackPurchase({ order_number: 'BL-1', order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING', total_amount: 100, delivery_fee: 0 })).toBe(false);
    expect(g.dataLayer).toBeUndefined();
    g.dataLayer = [];
    delete g.document;
    expect(track('search', { search_term: 'milk' })).toBe(false);
    expect(g.dataLayer).toEqual([]);
  });

  test('a dataLayer whose push throws never breaks the caller', () => {
    g.dataLayer = Object.assign([], { push: () => { throw new Error('blocked'); } });
    expect(() => track('x')).not.toThrow();
    expect(() => trackViewCart({ lines: [{ product: product(), quantity: 1 }] })).not.toThrow();
  });

  test('ecommerce events clear the previous ecommerce object first, then push with currency LKR', () => {
    trackEcommerce('view_cart', { value: 540, items: [] });
    expect(g.dataLayer).toEqual([{ ecommerce: null }, { event: 'view_cart', ecommerce: { currency: 'LKR', value: 540, items: [] } }]);
  });
});

describe('privacy', () => {
  test('personal keys are dropped, item and list names are kept', () => {
    for (const k of ['name', 'full_name', 'phone', 'phone_number', 'email', 'address', 'address_line1', 'latitude', 'longitude', 'lat', 'lng', 'recipient_name', 'otp', 'access_token', 'referral_code']) {
      expect(isPiiKey(k)).toBe(true);
    }
    for (const k of ['item_name', 'item_list_name', 'page_title', 'page_location', 'user_id', 'search_term', 'area', 'distance_km', 'transaction_id', 'method']) {
      expect(isPiiKey(k)).toBe(false);
    }
    expect(sanitize({ event: 'x', phone: '+94771234567', ecommerce: { email: 'a@b.lk', value: 1 } })).toEqual({ event: 'x', ecommerce: { value: 1 } });
  });

  test('phone numbers and emails typed into a search are redacted', () => {
    expect(redact('0771234567 milk')).toBe('[redacted] milk');
    expect(redact('+94 77 123 4567')).toBe('[redacted]');
    expect(redact('me@example.com')).toBe('[redacted]');
    trackSearch('Call 077 123 4567');
    expect(byName('search')[0].search_term).toBe('call [redacted]');
  });

  test('a whole journey carries no personal data', () => {
    catalog();
    identify('cust-42');
    trackPageView('/otp', { phone: '+94771234567', gate: '1' });
    trackLogin('cust-42');
    const line = { product: product(), quantity: 2 };
    trackCartChange({ lines: [] }, { lines: [line] });
    trackViewCart({ lines: [line] });
    trackBeginCheckout({ lines: [line] });
    trackShippingInfo({ lines: [line] }, { shipping: 150, distanceKm: 3.14 });
    trackOutOfZone('Beruwala');
    trackPurchase({
      order_number: 'BL-20261015-0001', order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING', total_amount: 1230, delivery_fee: 150,
      items: [{ product_id: 'p1', product_name_snapshot: 'Kotmale Milk 1L', unit_selling_price: 540, quantity: 2 }],
      ...({ delivery_recipient_name: 'Fathima Rizna', delivery_recipient_phone: '+94771234567', delivery_address_line1: '12 Main St', delivery_latitude: 6.43 } as object),
    }, { cart: { lines: [line] } });
    const dump = JSON.stringify(g.dataLayer);
    for (const bad of ['771234567', 'Fathima', 'Main St', '6.43', 'phone', 'latitude', 'address']) expect(dump).not.toContain(bad);
    expect(dump).toContain('cust-42');
  });
});

describe('items', () => {
  test('item_id is the SKU (the size\'s SKU when one is chosen), categories are top level + sub-category', () => {
    catalog();
    expect(productItem(product(), { quantity: 2 })).toEqual({
      item_id: 'KOT-1L', item_name: 'Kotmale Milk 1L', item_category: 'Dairy', item_category2: 'Milk', price: 540, quantity: 2,
    });
    const sized = productItem(product(), { variant: { id: 'v250', label: '250 ml', sku: 'KOT-250', selling_price: 200, offer_price: null, offer_ends_at: null } });
    expect(sized).toMatchObject({ item_id: 'KOT-250', item_variant: '250 ml', price: 200, quantity: 1 });
    expect(productItem(product({ sku: undefined, category_id: 'baby', category_name: 'Baby care' })).item_id).toBe('p1');
    expect(productItem(product({ category_id: 'baby', category_name: 'Baby care' }))).not.toHaveProperty('item_category2');
  });

  test('a cart line\'s size snapshot (no SKU) uses the SKU learned on the product page', () => {
    trackViewItem({ ...product(), variants: [{ id: 'v250', label: '250 ml', sku: 'KOT-250' } as never] });
    const items = cartItems({ lines: [{ product: product(), quantity: 1, variant: { id: 'v250', label: '250 ml', selling_price: 200, offer_price: null, offer_ends_at: null, is_available: true } }] });
    expect(items[0].item_id).toBe('KOT-250');
  });

  test('unavailable lines are left out; combo packs are items of their own', () => {
    const items = cartItems({
      lines: [{ product: product(), quantity: 1 }, { product: product({ id: 'p2', is_available: false }), quantity: 3 }],
      combos: [{ combo: { id: 'c1', name: 'Breakfast pack', price: 990 }, quantity: 2 }],
    });
    expect(items.map((i) => [i.item_id, i.quantity])).toEqual([['KOT-1L', 1], ['combo_c1', 2]]);
    expect(items[1].item_category).toBe('Combo packs');
  });
});

describe('cart changes', () => {
  test('quantity deltas become add_to_cart / remove_from_cart with numbers, never strings', () => {
    const one = { lines: [{ product: product(), quantity: 1 }] };
    const three = { lines: [{ product: product(), quantity: 3 }] };
    trackCartChange({ lines: [] }, one);
    trackCartChange(one, three);
    trackCartChange(three, { lines: [] });
    const adds = byName('add_to_cart').map((e) => e.ecommerce as { value: number; items: { quantity: number }[]; currency: string });
    expect(adds.map((e) => [e.value, e.items[0].quantity, e.currency])).toEqual([[540, 1, 'LKR'], [1080, 2, 'LKR']]);
    const rem = byName('remove_from_cart')[0].ecommerce as { value: number; items: { quantity: number }[] };
    expect([rem.value, rem.items[0].quantity]).toEqual([1620, 3]);
  });
});

describe('purchase', () => {
  const order = {
    order_number: 'BL-20261015-0001', order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING',
    total_amount: 1030, delivery_fee: 150, points_discount_amount: 100, coupon_code: null,
    items: [{ product_id: 'p1', product_name_snapshot: 'Kotmale Milk 1L', unit_selling_price: 540, quantity: 2 }],
    points_redeemed: 100,
  };

  test('sent once per order number, even after a reload (the guard is persisted)', () => {
    expect(trackPurchase(order)).toBe(true);
    expect(trackPurchase(order)).toBe(false);
    resetForTests(); // a reload: the module forgets, storage does not
    g.dataLayer?.push({});
    expect(purchaseSent(order.order_number)).toBe(true);
    expect(trackPurchase(order)).toBe(false);
    const p = byName('purchase');
    expect(p).toHaveLength(1);
    expect(p[0].ecommerce).toEqual({
      currency: 'LKR', transaction_id: 'BL-20261015-0001', value: 880, shipping: 150, payment_type: 'COD',
      items: [{ item_id: 'p1', item_name: 'Kotmale Milk 1L', price: 540, quantity: 2 }],
    });
    expect(byName('points_redeem')).toEqual([{ event: 'points_redeem', points: 100 }]);
  });

  test('PayHere: not while awaiting payment, only once paid', () => {
    const online = { ...order, order_number: 'BL-2', payment_method: 'ONLINE', order_status: 'AWAITING_PAYMENT', payment_status: 'PENDING', points_discount_amount: 0, points_redeemed: 0 };
    expect(trackPurchase(online)).toBe(false);
    expect(trackPurchase({ ...online, order_status: 'PLACED', payment_status: 'FAILED' })).toBe(false);
    expect(trackPurchase({ ...online, order_status: 'PLACED', payment_status: 'PAID' })).toBe(true);
    expect(byName('purchase')).toHaveLength(1);
    expect(byName('points_redeem')).toHaveLength(0);
  });

  test('Blynk Wallet: a payment, so it counts in the value and is sent as wallet_used', () => {
    expect(trackPurchase({ ...order, order_number: 'BL-W', total_amount: 0, wallet_amount_used: 1030 })).toBe(true);
    const e = byName('purchase')[0].ecommerce as { value: number; wallet_used?: number; payment_type: string };
    expect([e.value, e.wallet_used, e.payment_type]).toEqual([880, 1030, 'COD']);
    trackPurchase({ ...order, order_number: 'BL-NW' });
    expect((byName('purchase')[1].ecommerce as { wallet_used?: number }).wallet_used).toBeUndefined();
  });

  test('the cart supplies SKUs and categories for the order lines', () => {
    catalog();
    trackPurchase({ ...order, order_number: 'BL-3' }, { cart: { lines: [{ product: product(), quantity: 2 }] } });
    expect((byName('purchase')[0].ecommerce as { items: unknown[] }).items[0]).toMatchObject({ item_id: 'KOT-1L', item_category: 'Dairy', item_category2: 'Milk' });
  });
});

describe('page views', () => {
  test('page_path has the /app prefix; the same path twice is one page view; only allow-listed parameters', () => {
    trackPageView('/home');
    trackPageView('/home');
    trackPageView('/login', { gate: '1', phone: '+94771234567', ref: 'FRIEND1' });
    trackPageView('/home');
    const pv = byName('page_view');
    expect(pv.map((e) => e.page_path)).toEqual(['/app/home', '/app/login', '/app/home']);
    expect(pv[1].page_location).toBe('https://blynk.lk/app/login?gate=1');
    expect(pv[0].page_title).toBe('Home | Blynk');
  });

  test('the OTP screen (its address holds the phone number) sends no page view', () => {
    expect(trackPageView('/otp', { phone: '+94771234567', gate: '1' })).toBe(false);
    expect(byName('page_view')).toHaveLength(0);
  });

  test('the first page view carries the ad-click parameters the app was opened with', () => {
    web('?utm_source=test&gclid=abc&ref=FRIEND1&phone=0771234567');
    trackPageView('/home');
    trackPageView('/cart');
    const pv = byName('page_view');
    expect(pv[0].page_location).toBe('https://blynk.lk/app/home?utm_source=test&gclid=abc');
    expect(pv[1].page_location).toBe('https://blynk.lk/app/cart');
  });

  test('a category\'s sub-category is its own page', () => {
    trackPageView('/category/dairy');
    trackPageView('/category/dairy', { slug: 'dairy', sub: 'milk' });
    expect(byName('page_view').map((e) => e.page_location)).toEqual(['https://blynk.lk/app/category/dairy', 'https://blynk.lk/app/category/dairy?sub=milk']);
  });
});

describe('the other events', () => {
  test('identity: user_id (never the phone), app_language, app_mode; cleared on sign-out; pushed once per change', () => {
    identify(null);
    expect(g.dataLayer).toEqual([]);
    identify('cust-1');
    identify('cust-1');
    identify(null);
    expect(g.dataLayer).toEqual([{ user_id: 'cust-1', app_language: 'en', app_mode: 'browser' }, { user_id: undefined }]);
  });

  test('login and sign_up use method sms', () => {
    trackLogin('cust-9');
    trackSignUp('cust-10');
    expect(byName('login')).toEqual([{ event: 'login', method: 'sms', user_id: 'cust-9' }]);
    expect(byName('sign_up')).toEqual([{ event: 'sign_up', method: 'sms' }]);
  });

  test('view_item_list: at most 20 items with positions; select_item names the list it came from', () => {
    const many = Array.from({ length: 30 }, (_, i) => product({ id: `p${i}`, sku: `S${i}` }));
    trackViewItemList('Dairy', many);
    const list = byName('view_item_list')[0].ecommerce as { item_list_name: string; items: { index: number }[] };
    expect(list.item_list_name).toBe('Dairy');
    expect(list.items).toHaveLength(20);
    expect(list.items[19].index).toBe(19);
    expect(listNameFor('p25')).toBe('Dairy');
    trackSelectItem(many[3]);
    expect(byName('select_item')[0].ecommerce).toMatchObject({ item_list_name: 'Dairy', items: [{ item_id: 'S3', item_list_name: 'Dairy' }] });
  });

  test('search once per term; out_of_zone only for DELIVERY_OUTSIDE_RADIUS, a place name, once a minute', () => {
    trackSearch('milk');
    trackSearch('Milk ');
    trackSearch('rice');
    expect(byName('search').map((e) => e.search_term)).toEqual(['milk', 'rice']);
    trackOutOfZoneError({ code: 'VALIDATION_ERROR' }, 'Aluthgama');
    trackOutOfZoneError({ code: 'DELIVERY_OUTSIDE_RADIUS' }, 'Beruwala');
    trackOutOfZone('Beruwala');
    expect(byName('out_of_zone')).toEqual([{ event: 'out_of_zone', area: 'Beruwala' }]);
  });

  test('share: method and item only; a failed share is not sent', () => {
    trackShare('shared', 'product', 'p1');
    trackShare('copied', 'referral');
    trackShare('failed', 'app');
    expect(byName('share')).toEqual([
      { event: 'share', method: 'share_sheet', content_type: 'product', item_id: 'p1' },
      { event: 'share', method: 'copy_link', content_type: 'referral' },
    ]);
  });

  test('add_shipping_info: shipping and distance as numbers, value after discount and points', () => {
    trackShippingInfo({ lines: [{ product: product(), quantity: 2 }] }, { shipping: 150, distanceKm: 3.149, discount: 80, points: 20 });
    const e = byName('add_shipping_info')[0];
    expect(e.distance_km).toBe(3.1);
    expect(e.ecommerce).toMatchObject({ currency: 'LKR', value: 980, shipping: 150 });
  });
});
