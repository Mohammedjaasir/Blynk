/*
 * Live (DEMO = false) content for the video-matched Home. Every value comes from Blynk's
 * catalogue (GET /catalog/*) or GET /store, which Admin and Ops control. Where the video
 * has a slot Blynk has no true data for (ratings, ETAs, "% lower", "Other apps", ads,
 * "lowest price" stamps), there is no field here and Home hides the slot.
 *
 * Pure functions, no React: CatalogContext is only imported as a type.
 */
import type { Category, Product, StoreInfo } from '../blynk/api/types';
import type { CatalogData } from '../blynk/catalog/CatalogContext';
import { categoryOfferActive } from '../blynk/lib/categories';
import { applyFilters, type FilterId } from '../blynk/lib/filters';
import { formatLkr } from '../blynk/lib/money';
import { effectivePrice, isOfferActive, savingsPerUnit } from '../blynk/lib/pricing';
import { flatFee, formatHours, freeDeliveryCount } from '../blynk/lib/storeText';
import { claimFee, claimLine, claimTitle, freeDeliveryClaim, NO_CLAIM, type FreeClaim } from '../blynk/store/freeClaim';
import { homeMessage, NEUTRAL_COPY, POINTS_COPY, pointsRuleOf, type PointsRule } from '../blynk/store/pointsPromo';

/** The "Under LKR 300" rail (the video's "Meals under ₹99"). */
export const UNDER_LKR = 300;

export const LIVE_LOCATION_NAME = 'Dharga Town';

export const LIVE_LOCATION_SHEET = {
  title: 'Location Permission is Off',
  sub: 'Lets the app find your delivery spot. Your location stays on this device.',
  cta: 'GRANT',
  manual: 'Enter Location Manually',
};

export type LiveRailItem = {
  id: string;
  name: string;
  /** Category photo, else the first product photo in it; null shows the emoji / initial. */
  image: string | null;
  /** Lowest effective price of an in-stock product in the aisle ("FROM LKR x"). */
  from: number | null;
  emoji?: string;
};

export type LiveAisleCard = {
  cat: Category;
  items: Product[];
  /** "24 items • 8 AM – 9 PM" */
  meta: string;
  /**
   * "Items from LKR 120" (the fee line when nothing is priced). Free deliveries are not
   * repeated on every card: the band title and the fee strip carry them (clean pass).
   */
  delivery: string;
  /** "5% off everything here" while a category offer runs, else null. */
  offer: string | null;
};

export type LiveVsTile = {
  id: string;
  name: string;
  image: string | null;
  /** Big white overlay on the photo, two lines. */
  overlay: [string, string];
  /** Line under the name (struck through when `strike`). */
  line: string;
  strike: boolean;
  /** Last row ("You save LKR n"), only with an active offer and show_offer_savings on. */
  save: string | null;
  /** The aisle the tile opens. */
  aisle: Pick<Category, 'slug' | 'name'> | null;
};

/**
 * kicker: the small line over the title - [line], e.g. "1 point for every LKR 100 · No
 * packaging or platform fee" while points are on, else a catchy line with nothing about fees
 * (owner, 2026-10-17).
 */
export type LiveVs = { kicker: [string]; title: string; tiles: LiveVsTile[] };

/** Lowest effective price among available products, or null (CatalogContext.minPrice without React). */
export function lowestPrice(products: Product[], now: Date = new Date()): number | null {
  const prices = products.filter((p) => p.is_available).map((p) => effectivePrice(p, now));
  return prices.length ? Math.min(...prices) : null;
}

const inAisle = (data: CatalogData, catId: string) => data.products.filter((p) => data.chainOf(p.category_id).includes(catId));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The free-delivery claim when the caller passes none: GET /store's new-customer offer, worded
 * for new customers (a guest). Home passes useFreeClaim() so a signed-in customer sees only
 * their own free deliveries left (src/blynk/store/freeClaim.ts).
 */
const guestClaim = (store: StoreInfo | null): FreeClaim => freeDeliveryClaim({ storeCount: freeDeliveryCount(store), signedIn: false });

/** The location row's second line: the active dark store's name, when Ops has one set up. */
export const liveAddress = (store: StoreInfo | null) => store?.hub_name?.trim() || null;

/** Search placeholder hints: real in-stock product names, short ones first. */
export function liveHints(data: CatalogData | null): string[] {
  const names = (data?.products ?? []).filter((p) => p.is_available).map((p) => p.name.trim()).filter(Boolean);
  const short = names.filter((n) => n.length <= 22);
  return (short.length >= 3 ? short : names).slice(0, 6);
}

/** Banner props: product photos for the beam, the cheapest price, the points rule and the free deliveries. */
export function liveBanner(
  data: CatalogData | null, store: StoreInfo | null, now: Date = new Date(), claim: FreeClaim = guestClaim(store),
  rule: PointsRule | null = pointsRuleOf(store),
) {
  const products = data?.products ?? [];
  return {
    images: products.filter((p) => p.is_available && p.image_url).slice(0, 6).map((p) => p.image_url as string),
    minPrice: data ? lowestPrice(products, now) : null,
    freeCount: claim.count,
    /** Whose count: the banner says "for new customers" to a guest, "left" to a signed-in customer. */
    freeKind: claim.kind,
    /** "1 point for every LKR 100" while Blynk Points are on (AUTO's EARN / POINTS and {points_rule}). */
    pointsRule: rule ? POINTS_COPY.rule(rule) : null,
  };
}

/** The category rail: "All", then every aisle that has products, with its "FROM LKR x". */
export function liveRail(data: CatalogData | null, now: Date = new Date()): LiveRailItem[] {
  if (!data) return [];
  const aisles = data.aisles
    .map((c) => {
      const items = inAisle(data, c.id);
      const photo = items.find((p) => p.is_available && p.image_url) ?? items.find((p) => p.image_url);
      return { id: c.id, name: c.name, image: c.image_url ?? photo?.image_url ?? null, from: lowestPrice(items, now), n: items.length };
    })
    .filter((r) => r.n > 0)
    .map(({ n: _n, ...r }) => r);
  return [{ id: 'all', name: 'All', image: null, from: null, emoji: '🛒' }, ...aisles];
}

/** "Under LKR 300": in-stock products at or under the line, in the chosen aisle, with the chips applied. */
export function liveUnder(data: CatalogData | null, cat: string, filters: FilterId[], now: Date = new Date()): Product[] {
  if (!data) return [];
  const scope = cat === 'all' ? data.products : inAisle(data, cat);
  return applyFilters(scope, filters, now).filter((p) => p.is_available && effectivePrice(p, now) <= UNDER_LKR).slice(0, 12);
}

/** What a card says about delivery: free deliveries, the flat fee, or "at checkout". */
export function deliveryLine(store: StoreInfo | null, claim: FreeClaim = guestClaim(store)): string {
  const line = claimLine(claim);
  if (line) return line;
  const flat = flatFee(store);
  return flat != null ? `Delivery ${formatLkr(flat)}` : 'Delivery fee at checkout';
}

/** The video's restaurant cards become aisles (real categories), each with its products. */
export function liveAisles(
  data: CatalogData | null, store: StoreInfo | null, cat: string, filters: FilterId[], now: Date = new Date(),
): LiveAisleCard[] {
  if (!data) return [];
  const hours = formatHours(store);
  // the fee only (no free-delivery claim): Home says that once, in the band title and the fee strip
  const delivery = deliveryLine(store, NO_CLAIM);
  return data.aisles
    .filter((c) => cat === 'all' || c.id === cat)
    .map((c) => {
      const all = inAisle(data, c.id);
      const items = applyFilters(all, filters, now);
      const from = lowestPrice(all, now);
      return {
        cat: c,
        items,
        meta: [plural(all.length, 'item'), ...(hours ? [hours] : [])].join(' • '),
        delivery: from != null ? `Items from ${formatLkr(from)}` : delivery,
        offer: categoryOfferActive(c, now) ? `${c.offer_percent}% off everything here` : null,
      };
    })
    .filter((a) => a.items.length > 0);
}

/**
 * The video's "BLYNK vs OTHER APPS / 40-60% LOWER PRICES" band, with true copy only and tiles
 * of products on offer (else aisles with their "FROM" price). Title: EARN BLYNK POINTS while
 * points are on (the rule and the fees in the small line), else the free deliveries this
 * customer may be told of, else the offers / aisles (pointsPromo.ts homeMessage).
 */
export function liveVs(
  data: CatalogData | null, store: StoreInfo | null, now: Date = new Date(), claim: FreeClaim = guestClaim(store),
  rule: PointsRule | null = pointsRuleOf(store),
): LiveVs | null {
  if (!data) return null;
  const showSave = store?.show_offer_savings === true;
  const topAisle = (p: Product) => {
    const top = data.topOf(p.category_id);
    return data.aisles.find((c) => c.id === top) ?? data.categories.find((c) => c.id === top) ?? null;
  };
  const offers = data.products.filter((p) => p.is_available && isOfferActive(p, now)).slice(0, 10);
  const tiles: LiveVsTile[] = offers.length
    ? offers.map((p) => {
      const save = savingsPerUnit(p, now);
      return {
        id: p.id, name: p.name, image: p.image_url,
        overlay: ['NOW', formatLkr(effectivePrice(p, now))],
        // the struck regular price only while Admin's show_offer_savings is on (as in the cart)
        line: showSave ? formatLkr(p.selling_price) : p.category_name, strike: showSave,
        save: showSave && save > 0 ? `You save ${formatLkr(save)}` : null,
        aisle: topAisle(p),
      };
    })
    : liveRail(data, now).filter((r) => r.id !== 'all' && r.from != null).slice(0, 8).map((r) => {
      const c = data.aisles.find((a) => a.id === r.id) ?? null;
      return {
        id: r.id, name: r.name, image: r.image,
        overlay: ['ITEMS', `FROM ${formatLkr(r.from as number)}`],
        line: c ? plural(inAisle(data, c.id).length, 'item') : '', strike: false, save: null, aisle: c,
      };
    });
  if (!tiles.length) return null;
  const msg = homeMessage(rule, claim);
  if (msg.kind === 'points') return { kicker: [POINTS_COPY.bandLine(msg.rule)], title: POINTS_COPY.bandTitle, tiles };
  const title = (msg.kind === 'free' ? claimTitle(msg.claim) : null) ?? (offers.length ? 'OFFER PRICES TODAY' : 'SHOP BY AISLE');
  return { kicker: NEUTRAL_COPY.bandKicker, title, tiles };
}

/**
 * The promo band's built-in copy (before Admin / Ops set their own): only what Blynk really
 * does. No free-delivery headline: Home says that once, in the band title and the fee strip
 * (clean pass, 2026-10-14). A catchy headline over the true ticks, not bare checkmarks (owner,
 * 2026-10-15: "here also, no packing and platform free, change, any other catchy").
 */
export function livePromo(_store?: StoreInfo | null, _claim?: FreeClaim): { line1: string | null; fees: string[] } {
  return {
    line1: 'No sneaky fees. Ever.',
    fees: ['No Platform Fee', 'No Packaging Fee'],
  };
}

/** The bottom fee strip: [coin, label], true labels only; the points rule while points are on. */
export function liveFees(store: StoreInfo | null, claim: FreeClaim = guestClaim(store), rule: PointsRule | null = pointsRuleOf(store)): [string, string][] {
  const flat = flatFee(store);
  const msg = homeMessage(rule, claim);
  return [
    ['0', 'Packaging fee'],
    ['0', 'Platform fee'],
    msg.kind === 'points' ? POINTS_COPY.fee(msg.rule)
      : (msg.kind === 'free' ? claimFee(msg.claim) : null) ?? (flat != null ? ['LKR', `Delivery ${formatLkr(flat)}`] : ['km', 'Fee at checkout']),
  ];
}
