import type { Product, PublicBundleOffer, StoreInfo } from '@/blynk/api/types';
import { lineKey } from '@/blynk/cart/cartStore';
import { localized } from '@/blynk/i18n/localized';
import { formatLkr } from '@/blynk/lib/money';

/** Bundle-offer words (badge, the sentence under it, the cart's lines and the order's tags). */
export const BUNDLE_WORDS = localized(
  {
    badgeCompact: (buy: number, get: number) => `Buy ${buy}+${get}`,
    badgeCard: (buy: number, get: number) => `Buy ${buy} get ${get}`,
    badgeFull: (buy: number, get: number) => `Buy ${buy} get ${get} free`,
    anyEligible: 'any of the eligible items',
    thisItem: 'this item',
    /** "Add 3 of this item: the cheapest one is free." */
    note: (total: number, which: string, get: number) => `Add ${total} of ${which}: the cheapest ${get === 1 ? 'one is' : `${get} are`} free.`,
    gift: 'gift',
    spendGift: (amount: string, gift: string) => `Spend ${amount}, get a free ${gift}`,
    freeUnits: (n: number) => `${n} free`,
    freeGiftLine: (gift: string) => `Free gift: ${gift}`,
    progressGift: (amount: string, gift: string) => `Add ${amount} more for a free ${gift}`,
    progressUnits: (n: number, get: number) => `Add ${n} more to get ${get} free`,
    free: 'Free',
    freeGift: 'Free gift',
    /** Screen reader on a cart line's free units. */
    freeLineLabel: (free: number, name: string, value: string) => `${free} free ${name}, saves ${value}`,
  },
  {
    si: {
      badgeCompact: (buy: number, get: number) => `${buy}+${get}`,
      badgeCard: (buy: number, get: number) => `${buy}ට ${get} ක්`,
      badgeFull: (buy: number, get: number) => `${buy}ක් ගන්න, ${get}ක් නොමිලේ`,
      anyEligible: 'සුදුසුකම් ඇති ඕනෑම භාණ්ඩයකින්',
      thisItem: 'මෙම භාණ්ඩයෙන්',
      note: (total: number, which: string, get: number) => `${which} ${total}ක් එක් කරන්න: වඩාත්ම අඩු මිලැති ${get}ක් නොමිලේ.`,
      gift: 'තෑග්ග',
      spendGift: (amount: string, gift: string) => `${amount} වියදම් කරන්න, නොමිලේ ${gift} ලබා ගන්න`,
      freeUnits: (n: number) => `${n}ක් නොමිලේ`,
      freeGiftLine: (gift: string) => `නොමිලේ තෑග්ග: ${gift}`,
      progressGift: (amount: string, gift: string) => `නොමිලේ ${gift} සඳහා තවත් ${amount} එක් කරන්න`,
      progressUnits: (n: number, get: number) => `${get}ක් නොමිලේ ලබා ගැනීමට තවත් ${n}ක් එක් කරන්න`,
      free: 'නොමිලේ',
      freeGift: 'නොමිලේ තෑග්ග',
      freeLineLabel: (free: number, name: string, value: string) => `${name} ${free}ක් නොමිලේ, ${value} ඉතිරියි`,
    },
    ta: {
      badgeCompact: (buy: number, get: number) => `${buy}+${get}`,
      badgeCard: (buy: number, get: number) => `${buy} வாங்கினால் ${get}`,
      badgeFull: (buy: number, get: number) => `${buy} வாங்கினால் ${get} இலவசம்`,
      anyEligible: 'தகுதியுள்ள எந்தப் பொருளிலும்',
      thisItem: 'இந்தப் பொருளில்',
      note: (total: number, which: string, get: number) => `${which} ${total} சேர்க்கவும்: மிகக் குறைந்த விலை உள்ள ${get} இலவசம்.`,
      gift: 'பரிசு',
      spendGift: (amount: string, gift: string) => `${amount} செலவு செய்தால், இலவச ${gift} கிடைக்கும்`,
      freeUnits: (n: number) => `${n} இலவசம்`,
      freeGiftLine: (gift: string) => `இலவச பரிசு: ${gift}`,
      progressGift: (amount: string, gift: string) => `இலவச ${gift} பெற இன்னும் ${amount} சேர்க்கவும்`,
      progressUnits: (n: number, get: number) => `${get} இலவசமாகப் பெற இன்னும் ${n} சேர்க்கவும்`,
      free: 'இலவசம்',
      freeGift: 'இலவச பரிசு',
      freeLineLabel: (free: number, name: string, value: string) => `${name} ${free} இலவசம், ${value} சேமிப்பு`,
    },
  },
  'bundles.BUNDLE_WORDS',
);

/*
 * Bundle offers (owner, 2026-10-25: "buy 2 get 1", "spend X, get a gift"): the rules live in Admin / Ops
 * and run inside the real order pricing (backend W-B1). This file is the customer app's reading of them,
 * with no React in it: the badge on a product, the progress card, the cart's "Free" and gift lines and
 * the order detail's wording. The staff pages (Admin / Ops "Bundle offers") preview the same words from
 * their own copy of bundleBadgeText / bundleProgressText - keep them in step (apps/admin/src/lib/bundleOffers.ts).
 *
 * Money model (server): a free unit is a separate order line (same product, price 0); a gift is an extra
 * line at price 0. POST /orders/bundle-quote answers for the cart; POST /orders applies the same rules.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, fallback = 0): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/* ---------------------------------------------------------------- the rules (GET /store) */

/** The LIVE offers from GET /store (an older server, or before migration 062, has none), minus any whose end has passed. */
export function liveBundleOffers(store: Pick<StoreInfo, 'bundle_offers'> | null | undefined, now: number = Date.now()): PublicBundleOffer[] {
  const list = store?.bundle_offers;
  if (!Array.isArray(list)) return [];
  return list.filter((o) => !!o && (o.type === 'BUY_X_GET_Y' || o.type === 'SPEND_GET_GIFT') && !(o.ends_at && Date.parse(o.ends_at) <= now));
}

/** Does a BUY_X_GET_Y offer cover this product (picked products, or its category / a sub-category of it)? */
export function offerCoversProduct(offer: PublicBundleOffer, product: Pick<Product, 'id' | 'category_id'>, chainOf?: (categoryId: string) => string[]): boolean {
  if (offer.type !== 'BUY_X_GET_Y') return false;
  if (offer.product_ids && offer.product_ids.includes(product.id)) return true;
  if (offer.category) {
    const chain = chainOf ? chainOf(product.category_id) : [product.category_id];
    return chain.includes(offer.category.id) || product.category_id === offer.category.id;
  }
  return false;
}

/** The first live BUY_X_GET_Y offer (rule order) that covers the product, or null. SPEND_GET_GIFT has no product badge. */
export function bundleOfferFor(product: Pick<Product, 'id' | 'category_id'>, offers: readonly PublicBundleOffer[], chainOf?: (categoryId: string) => string[]): PublicBundleOffer | null {
  return offers.find((o) => offerCoversProduct(o, product, chainOf)) ?? null;
}

/**
 * The badge words. "full" (product page, cart): "Buy 2 get 1 free". "card": "Buy 2 get 1" (the tile is small),
 * and "compact" for a very narrow tile: "Buy 2+1".
 */
export function bundleBadgeText(offer: Pick<PublicBundleOffer, 'buy_qty' | 'get_qty'>, size: 'full' | 'card' | 'compact' = 'full'): string {
  const buy = offer.buy_qty ?? 0;
  const get = offer.get_qty ?? 0;
  if (size === 'compact') return BUNDLE_WORDS.badgeCompact(buy, get);
  return size === 'card' ? BUNDLE_WORDS.badgeCard(buy, get) : BUNDLE_WORDS.badgeFull(buy, get);
}

/** One line under the badge on the product page: what the offer means in a sentence. */
export function bundleBadgeNote(offer: Pick<PublicBundleOffer, 'buy_qty' | 'get_qty' | 'category' | 'product_ids'>): string {
  const buy = offer.buy_qty ?? 0;
  const get = offer.get_qty ?? 0;
  const which = offer.category || (offer.product_ids?.length ?? 0) > 1 ? BUNDLE_WORDS.anyEligible : BUNDLE_WORDS.thisItem;
  return BUNDLE_WORDS.note(buy + get, which, get);
}

/** The gift as people read it: "Biscuit pack" or "2 x Biscuit pack". */
export const giftWords = (name: string, qty: number) => (qty > 1 ? `${qty} x ${name}` : name);

/** "Spend LKR 3,000, get a free Biscuit pack" (the offer in a sentence, for a rule that is not applied yet). */
export function spendGiftText(offer: Pick<PublicBundleOffer, 'min_subtotal' | 'gift_product_name' | 'gift_qty'>): string {
  return BUNDLE_WORDS.spendGift(formatLkr(offer.min_subtotal ?? 0), giftWords(offer.gift_product_name?.trim() || BUNDLE_WORDS.gift, offer.gift_qty ?? 1));
}

/* ---------------------------------------------------------------- the cart's quote (POST /orders/bundle-quote) */

export interface BundleApplied {
  offer_id: string; title: string; type: 'BUY_X_GET_Y' | 'SPEND_GET_GIFT'; savings_lkr: number;
  free_units?: number; gift?: { product_id: string; name: string; quantity: number; value_lkr: number };
}
export interface BundleGift { product_id: string; name: string; quantity: number; value_lkr: number; offer_id: string; item_id?: string }
export interface BundleProgress {
  offer_id: string; title: string; type: 'BUY_X_GET_Y' | 'SPEND_GET_GIFT';
  remaining_units?: number; remaining_lkr?: number;
  get_qty?: number; buy_qty?: number; gift_product_id?: string; gift_product_name?: string | null; gift_qty?: number;
}
export interface BundleQuoteLine {
  product_id: string; variant_id: string | null; quantity: number; paid_quantity: number; free_quantity: number; unit_price: number;
}
export interface BundleQuote {
  /** false = the server cannot apply offers yet (migration 062 not run): treat as no quote. */
  ready: boolean;
  subtotal_before_bundles: number;
  bundle_savings: number;
  /** What is charged for the items, after bundles. */
  subtotal: number;
  bundle_applied: BundleApplied[];
  gift_items: BundleGift[];
  bundle_progress: BundleProgress | null;
  lines: BundleQuoteLine[];
}

/** A quote from the server, with every amount a number and every list a list; null when it is not a quote. */
export function parseBundleQuote(raw: unknown): BundleQuote | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const applied = (Array.isArray(r.bundle_applied) ? r.bundle_applied : []) as Record<string, unknown>[];
  const gifts = (Array.isArray(r.gift_items) ? r.gift_items : []) as Record<string, unknown>[];
  const lines = (Array.isArray(r.lines) ? r.lines : []) as Record<string, unknown>[];
  const pr = r.bundle_progress && typeof r.bundle_progress === 'object' ? (r.bundle_progress as Record<string, unknown>) : null;
  const progress: BundleProgress | null = pr && typeof pr.offer_id === 'string' && (pr.type === 'BUY_X_GET_Y' || pr.type === 'SPEND_GET_GIFT')
    ? {
      offer_id: pr.offer_id, title: typeof pr.title === 'string' ? pr.title : '', type: pr.type,
      ...(numOrNull(pr.remaining_units) !== null ? { remaining_units: numOrNull(pr.remaining_units) as number } : {}),
      ...(numOrNull(pr.remaining_lkr) !== null ? { remaining_lkr: numOrNull(pr.remaining_lkr) as number } : {}),
      ...(numOrNull(pr.get_qty) !== null ? { get_qty: numOrNull(pr.get_qty) as number } : {}),
      ...(numOrNull(pr.buy_qty) !== null ? { buy_qty: numOrNull(pr.buy_qty) as number } : {}),
      ...(typeof pr.gift_product_id === 'string' ? { gift_product_id: pr.gift_product_id } : {}),
      ...(typeof pr.gift_product_name === 'string' ? { gift_product_name: pr.gift_product_name } : {}),
      ...(numOrNull(pr.gift_qty) !== null ? { gift_qty: numOrNull(pr.gift_qty) as number } : {}),
    }
    : null;
  return {
    ready: r.ready !== false,
    subtotal_before_bundles: num(r.subtotal_before_bundles),
    bundle_savings: Math.max(0, num(r.bundle_savings)),
    subtotal: num(r.subtotal),
    bundle_applied: applied.map((a) => ({
      offer_id: String(a.offer_id ?? ''), title: String(a.title ?? ''), type: a.type === 'SPEND_GET_GIFT' ? 'SPEND_GET_GIFT' : 'BUY_X_GET_Y',
      savings_lkr: num(a.savings_lkr),
      ...(numOrNull(a.free_units) !== null ? { free_units: numOrNull(a.free_units) as number } : {}),
    })),
    gift_items: gifts.map((g) => ({
      product_id: String(g.product_id ?? ''), name: String(g.name ?? ''), quantity: Math.max(1, num(g.quantity, 1)),
      value_lkr: num(g.value_lkr), offer_id: String(g.offer_id ?? ''),
      ...(typeof g.item_id === 'string' ? { item_id: g.item_id } : {}),
    })),
    bundle_progress: progress,
    lines: lines.map((l) => ({
      product_id: String(l.product_id ?? ''), variant_id: typeof l.variant_id === 'string' ? l.variant_id : null,
      quantity: num(l.quantity), paid_quantity: num(l.paid_quantity), free_quantity: Math.max(0, num(l.free_quantity)), unit_price: num(l.unit_price),
    })),
  };
}

/** The quote when it can be used (the server applies offers), else null. */
export const usableQuote = (q: BundleQuote | null | undefined): BundleQuote | null => (q && q.ready ? q : null);

/** What the items are charged after bundles; the cart's own total when there is no usable quote. */
export function chargedSubtotal(cartTotal: number, quote: BundleQuote | null | undefined): number {
  const q = usableQuote(quote);
  return q ? round2(q.subtotal) : round2(cartTotal);
}

/** The bundle savings of a usable quote (0 without one). */
export const bundleSavingsOf = (quote: BundleQuote | null | undefined): number => usableQuote(quote)?.bundle_savings ?? 0;

/* ---------------------------------------------------------------- the cart's lines */

/** The free part of a cart line: how many units, and what they would have cost. */
export interface FreeUnits { free: number; paid: number; value: number }

/** Per cart line key (`lineKey(productId, variantId)`): the lines that have free units. Lines without any are absent. */
export function freeUnitsByLine(quote: BundleQuote | null | undefined): Map<string, FreeUnits> {
  const out = new Map<string, FreeUnits>();
  const q = usableQuote(quote);
  if (!q) return out;
  for (const l of q.lines) {
    if (l.free_quantity <= 0) continue;
    const k = lineKey(l.product_id, l.variant_id);
    const prev = out.get(k);
    out.set(k, { free: (prev?.free ?? 0) + l.free_quantity, paid: (prev?.paid ?? 0) + l.paid_quantity, value: round2((prev?.value ?? 0) + l.free_quantity * l.unit_price) });
  }
  return out;
}

/** "1 free", "2 free". */
export const freeUnitsText = (n: number) => BUNDLE_WORDS.freeUnits(n);

/** The gift lines of a quote: "Free gift: Biscuit pack" with what they are worth. */
export function giftLines(quote: BundleQuote | null | undefined): { key: string; label: string; productId: string; value: number }[] {
  const q = usableQuote(quote);
  if (!q) return [];
  return q.gift_items.map((g, i) => ({ key: `${g.offer_id}:${g.product_id}:${i}`, label: BUNDLE_WORDS.freeGiftLine(giftWords(g.name || BUNDLE_WORDS.gift, g.quantity)), productId: g.product_id, value: g.value_lkr }));
}

/** A string that changes when a gift is added or taken away (to play the unlock animation once per unlock). */
export const giftSignature = (quote: BundleQuote | null | undefined): string => giftLines(quote).map((g) => g.key).join('|');

/**
 * Did a gift just unlock? `prev` is the signature of the last quote the screen saw (null = none seen yet:
 * a gift that was already there when the cart opened does not celebrate).
 */
export const giftJustUnlocked = (prev: string | null, next: string): boolean => prev !== null && prev === '' && next !== '';

/* ---------------------------------------------------------------- the progress card */

/** "Add LKR 450 more for a free Biscuit pack" / "Add 1 more to get 1 free". null when there is nothing to say. */
export function progressText(p: BundleProgress | null | undefined, offers: readonly PublicBundleOffer[] = []): string | null {
  if (!p) return null;
  if (p.type === 'SPEND_GET_GIFT' || (p.remaining_lkr != null && p.remaining_units == null)) {
    if (p.remaining_lkr == null || p.remaining_lkr <= 0) return null;
    const offer = offers.find((o) => o.id === p.offer_id);
    const name = (p.gift_product_name ?? offer?.gift_product_name ?? '').trim() || BUNDLE_WORDS.gift;
    return BUNDLE_WORDS.progressGift(formatLkr(round2(p.remaining_lkr)), giftWords(name, p.gift_qty ?? offer?.gift_qty ?? 1));
  }
  if (p.remaining_units == null || p.remaining_units <= 0) return null;
  const get = p.get_qty ?? offers.find((o) => o.id === p.offer_id)?.get_qty ?? 1;
  return BUNDLE_WORDS.progressUnits(p.remaining_units, get);
}

/** How far along the card's bar is, 0..1 (null = no bar: not enough is known). */
export function progressFraction(p: BundleProgress | null | undefined, offers: readonly PublicBundleOffer[] = []): number | null {
  if (!p) return null;
  const offer = offers.find((o) => o.id === p.offer_id);
  if (p.remaining_lkr != null && p.remaining_units == null) {
    const min = offer?.min_subtotal;
    if (!min || min <= 0) return null;
    return Math.max(0, Math.min(1, (min - p.remaining_lkr) / min));
  }
  const buy = p.buy_qty ?? offer?.buy_qty;
  if (p.remaining_units != null && buy && buy > 0 && p.remaining_units <= buy) return Math.max(0, Math.min(1, (buy - p.remaining_units) / buy));
  return null;
}

/* ---------------------------------------------------------------- the order (GET /orders/:id) */

/** What an order line is, bundle-wise: a free unit, a gift, or an ordinary line. */
export type OrderBundleKind = 'FREE_UNITS' | 'GIFT' | null;

export interface OrderBundleFields {
  bundle_savings?: number;
  is_bundle_free?: boolean;
  bundle_kind?: OrderBundleKind;
  bundle_value?: number | null;
}

/** How a line reads on the order: "Free", "Free gift", or null for an ordinary line. */
export function orderLineTag(item: OrderBundleFields): string | null {
  if (!item.is_bundle_free) return null;
  return item.bundle_kind === 'GIFT' ? BUNDLE_WORDS.freeGift : BUNDLE_WORDS.free;
}

/** The "Bundle savings" amount an order shows (0 hides the row). */
export const orderBundleSavings = (order: { bundle_savings?: number | null }): number => Math.max(0, num(order.bundle_savings));
