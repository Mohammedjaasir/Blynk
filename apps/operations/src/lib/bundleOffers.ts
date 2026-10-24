/* Blynk Ops copy of apps/admin/src/lib/bundleOffers.ts (common.md rule 2: no cross-app imports) - keep the two in step. */
/*
 * Bundle offers (owner, 2026-10-25: "buy 2 get 1", "spend X, get a gift"): rules staff set that run inside
 * the real order pricing. BUY_X_GET_Y: for every group of buy_qty + get_qty matching units the cheapest
 * get_qty are free. SPEND_GET_GIFT: once the discounted subtotal reaches min_subtotal a gift product is
 * added at LKR 0 (one gift per order). GET|PUT /admin/settings/bundle-offers; PUT replaces the whole list.
 * The words (badge, cart line, progress) are the customer app's - keep bundleBadgeText / bundleProgressText
 * / bundleOfferSummary in step with apps/customer-app/src/blynk/bundles/copy.ts (and Blynk Ops' copy of this file).
 */

export type BundleType = 'BUY_X_GET_Y' | 'SPEND_GET_GIFT';
export type BundleStatus = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'OFF';

/** What the PUT carries for one offer (`id` is missing until the server has assigned one). */
export interface BundleOffer {
  id?: string;
  type: BundleType;
  title: string;
  is_active: boolean;
  /** ISO datetime with offset; before it the offer does not apply. */
  starts_at: string | null;
  ends_at: string | null;
  /** BUY_X_GET_Y: buy this many, get_qty of the matching units are free. */
  buy_qty: number | null;
  get_qty: number | null;
  /** BUY_X_GET_Y: the products it covers (or a category). */
  product_ids: string[] | null;
  category_id: string | null;
  /** SPEND_GET_GIFT: the discounted subtotal that unlocks the gift. */
  min_subtotal: number | null;
  gift_product_id: string | null;
  gift_qty: number | null;
}

/** An offer as the API lists it: names are filled in so the page needs no other call. */
export interface BundleOfferView extends BundleOffer {
  id: string;
  status?: BundleStatus;
  /** The covered products, in order (BUY_X_GET_Y with products). */
  product_names?: { id: string; name: string }[];
  /** "Beverages › Juices" (BUY_X_GET_Y with a category). */
  category_name?: string | null;
  /** The gift's name (SPEND_GET_GIFT). */
  gift_product_name?: string | null;
}

export interface BundleOffersSetting {
  /** false until the order columns exist (migration 062): the rules can be saved but nothing applies yet. */
  ready?: boolean;
  offers: BundleOfferView[];
  updated_at: string | null;
}

/** An offer being edited. `key` only identifies the row on screen; names let the page show it without another call. */
export interface BundleDraft extends BundleOffer {
  key: string;
  products: { id: string; name: string }[];
  category_name: string;
  gift_product_name: string;
  /** BUY_X_GET_Y: which picker shows (a category can be chosen later). Not sent. */
  scopeMode?: 'PRODUCTS' | 'CATEGORY';
}

export const BUNDLE_LIMITS = {
  offers: 10,
  title: { min: 2, max: 40 },
  qty: { min: 1, max: 10 },
  giftQty: { min: 1, max: 10 },
  products: 20,
  minSubtotal: { min: 1, max: 1_000_000 },
} as const;

/** Sri Lanka has no daylight saving: the store's zone is a fixed +05:30. */
const STORE_OFFSET = '+05:30';
const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO time -> the value of an <input type="datetime-local">, in Sri Lanka time whatever the browser's zone is. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 330 * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** An <input type="datetime-local"> value (Sri Lanka time) -> ISO with offset; null when empty or invalid. */
export function fromLocalInput(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const iso = `${local}:00${STORE_OFFSET}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Same rule as the API: OFF when switched off, else by the schedule. */
export function bundleStatus(o: Pick<BundleOffer, 'is_active' | 'starts_at' | 'ends_at'>, at: Date = new Date()): BundleStatus {
  if (!o.is_active) return 'OFF';
  const t = at.getTime();
  if (o.starts_at && t < Date.parse(o.starts_at)) return 'SCHEDULED';
  if (o.ends_at && t >= Date.parse(o.ends_at)) return 'ENDED';
  return 'LIVE';
}

export const BUNDLE_STATUS_WORDS: Record<BundleStatus, string> = {
  LIVE: 'Live',
  SCHEDULED: 'Scheduled',
  ENDED: 'Ended',
  OFF: 'Off',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct, 6 pm" in Sri Lanka time. */
export function dateTimeText(iso: string): string {
  const local = toLocalInput(iso);
  if (!local) return iso;
  const [date, time] = local.split('T') as [string, string];
  const h = Number(time.slice(0, 2));
  const m = time.slice(3, 5);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}, ${h12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'am' : 'pm'}`;
}

/** "24 Oct, 9 am to 24 Oct, 6 pm", or "No schedule: always on". */
export function scheduleText(o: Pick<BundleOffer, 'starts_at' | 'ends_at'>): string {
  if (o.starts_at && o.ends_at) return `${dateTimeText(o.starts_at)} to ${dateTimeText(o.ends_at)}`;
  if (o.starts_at) return `From ${dateTimeText(o.starts_at)}`;
  if (o.ends_at) return `Until ${dateTimeText(o.ends_at)}`;
  return 'No schedule: always on';
}

const lkr = (n: number) => `LKR ${n.toLocaleString('en-US', Math.abs(n % 1) < 0.005 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The badge on a product card / page (same words as the customer app): "Buy 2 get 1 free". */
export const bundleBadgeText = (buy: number, get: number) => `Buy ${buy} get ${get} free`;

/** The gift as the customer reads it: "Biscuit pack", or "2 x Biscuit pack" for more than one. */
const giftWords = (name: string, qty: number) => (qty > 1 ? `${qty} x ${name}` : name);

/** "Add LKR 450 more for a free Biscuit pack" / "Add 1 more to get 1 free" (the cart's progress card). */
export function bundleProgressText(args: { remainingLkr?: number | null; remainingUnits?: number | null; get?: number | null; giftName?: string | null; giftQty?: number | null }): string {
  if (args.remainingLkr != null) {
    return `Add ${lkr(args.remainingLkr)} more for a free ${giftWords(args.giftName?.trim() || 'gift', args.giftQty ?? 1)}`;
  }
  return `Add ${args.remainingUnits ?? 1} more to get ${args.get ?? 1} free`;
}

/** One sentence for a list row: what the offer does. */
export function bundleOfferSummary(o: Pick<BundleOffer, 'type' | 'buy_qty' | 'get_qty' | 'min_subtotal' | 'gift_qty'> & { gift_product_name?: string | null }): string {
  if (o.type === 'BUY_X_GET_Y') return bundleBadgeText(o.buy_qty ?? 0, o.get_qty ?? 0);
  return `Spend ${lkr(o.min_subtotal ?? 0)}, get a free ${giftWords(o.gift_product_name?.trim() || 'gift', o.gift_qty ?? 1)}`;
}

/** What the offer covers, in words: "Beverages › Juices", "3 products", or "the whole basket". */
export function bundleScopeText(o: Pick<BundleDraft, 'type' | 'product_ids' | 'category_id' | 'category_name' | 'products'>): string {
  if (o.type === 'SPEND_GET_GIFT') return 'Whole basket';
  if (o.category_id) return o.category_name || 'A category';
  const n = o.product_ids?.length ?? 0;
  if (n === 0) return 'No products chosen yet';
  return n === 1 && o.products[0] ? o.products[0].name : `${n} products`;
}

/**
 * The lines a customer sees for this offer, for the editor's preview:
 * card badge + cart wording. Example numbers are made up to show the wording.
 */
export function bundlePreview(o: BundleDraft): { badge: string | null; cart: string[] } {
  if (o.type === 'BUY_X_GET_Y') {
    const buy = o.buy_qty ?? 0;
    const get = o.get_qty ?? 0;
    if (buy < 1 || get < 1) return { badge: null, cart: [] };
    return {
      badge: bundleBadgeText(buy, get),
      cart: [bundleProgressText({ remainingUnits: buy > 1 ? 1 : buy, get }), `Free x ${get}`],
    };
  }
  const min = o.min_subtotal ?? 0;
  if (min <= 0 || !o.gift_product_id) return { badge: null, cart: [] };
  const name = o.gift_product_name || 'gift';
  return {
    badge: null,
    cart: [bundleProgressText({ remainingLkr: Math.max(1, Math.round(min * 0.15)), giftName: name, giftQty: o.gift_qty ?? 1 }), `Free gift: ${giftWords(name, o.gift_qty ?? 1)}`],
  };
}

/** What is wrong with one offer, in words for the form; null = fine. Same rules as the API. */
export function bundleProblem(o: BundleOffer): string | null {
  const title = o.title.trim();
  if (title.length < BUNDLE_LIMITS.title.min) return `Give the offer a title (at least ${BUNDLE_LIMITS.title.min} characters).`;
  if (title.length > BUNDLE_LIMITS.title.max) return `The title can be at most ${BUNDLE_LIMITS.title.max} characters.`;
  const int = (n: number | null, min: number, max: number) => n !== null && Number.isInteger(n) && n >= min && n <= max;
  if (o.type === 'BUY_X_GET_Y') {
    if (!int(o.buy_qty, BUNDLE_LIMITS.qty.min, BUNDLE_LIMITS.qty.max)) return `"${title}": buy quantity must be between ${BUNDLE_LIMITS.qty.min} and ${BUNDLE_LIMITS.qty.max}.`;
    if (!int(o.get_qty, BUNDLE_LIMITS.qty.min, BUNDLE_LIMITS.qty.max)) return `"${title}": free quantity must be between ${BUNDLE_LIMITS.qty.min} and ${BUNDLE_LIMITS.qty.max}.`;
    const picked = o.product_ids?.length ?? 0;
    if (!o.category_id && picked === 0) return `"${title}": pick the products it covers, or a category.`;
    if (!o.category_id && picked > BUNDLE_LIMITS.products) return `"${title}": at most ${BUNDLE_LIMITS.products} products.`;
  } else {
    if (o.min_subtotal === null || !Number.isFinite(o.min_subtotal) || o.min_subtotal < BUNDLE_LIMITS.minSubtotal.min || o.min_subtotal > BUNDLE_LIMITS.minSubtotal.max) {
      return `"${title}": the spend must be between LKR ${BUNDLE_LIMITS.minSubtotal.min} and LKR ${BUNDLE_LIMITS.minSubtotal.max.toLocaleString('en-US')}.`;
    }
    if (!o.gift_product_id) return `"${title}": choose the gift product.`;
    if (!int(o.gift_qty, BUNDLE_LIMITS.giftQty.min, BUNDLE_LIMITS.giftQty.max)) return `"${title}": gift quantity must be between ${BUNDLE_LIMITS.giftQty.min} and ${BUNDLE_LIMITS.giftQty.max}.`;
  }
  if (o.starts_at && o.ends_at && Date.parse(o.ends_at) <= Date.parse(o.starts_at)) return `"${title}": the end must be after the start.`;
  return null;
}

/** The first problem across all offers (and the count), or null. */
export function bundlesProblem(list: ReadonlyArray<BundleOffer>): string | null {
  if (list.length > BUNDLE_LIMITS.offers) return `At most ${BUNDLE_LIMITS.offers} bundle offers.`;
  for (const o of list) {
    const p = bundleProblem(o);
    if (p) return p;
  }
  return null;
}

/** The PUT body: only what the API knows for the offer's type (a new offer has no id yet). */
export function bundlesPayload(list: ReadonlyArray<BundleOffer>): { offers: BundleOffer[] } {
  return {
    offers: list.map((o) => {
      const common = { ...(o.id ? { id: o.id } : {}), type: o.type, title: o.title.trim(), is_active: o.is_active, starts_at: o.starts_at, ends_at: o.ends_at };
      return o.type === 'BUY_X_GET_Y'
        ? {
            ...common,
            buy_qty: o.buy_qty,
            get_qty: o.get_qty,
            product_ids: o.category_id ? null : [...(o.product_ids ?? [])],
            category_id: o.category_id || null,
            min_subtotal: null,
            gift_product_id: null,
            gift_qty: null,
          }
        : {
            ...common,
            buy_qty: null,
            get_qty: null,
            product_ids: null,
            category_id: null,
            min_subtotal: o.min_subtotal,
            gift_product_id: o.gift_product_id,
            gift_qty: o.gift_qty ?? 1,
          };
    }),
  };
}

let counter = 0;
const newKey = () => `new-${Date.now().toString(36)}-${(counter += 1)}`;

/** A saved offer as a draft. */
export function draftFrom(view: BundleOfferView): BundleDraft {
  return {
    ...view,
    buy_qty: view.buy_qty ?? null,
    get_qty: view.get_qty ?? null,
    product_ids: view.product_ids ?? null,
    category_id: view.category_id ?? null,
    min_subtotal: view.min_subtotal ?? null,
    gift_product_id: view.gift_product_id ?? null,
    gift_qty: view.gift_qty ?? null,
    key: view.id,
    products: view.product_names ?? [],
    category_name: view.category_name ?? '',
    gift_product_name: view.gift_product_name ?? '',
  };
}

/** A blank offer of one type to fill in. */
export function blankDraft(type: BundleType = 'BUY_X_GET_Y'): BundleDraft {
  return {
    key: newKey(),
    type,
    title: '',
    is_active: true,
    starts_at: null,
    ends_at: null,
    buy_qty: type === 'BUY_X_GET_Y' ? 2 : null,
    get_qty: type === 'BUY_X_GET_Y' ? 1 : null,
    product_ids: type === 'BUY_X_GET_Y' ? [] : null,
    category_id: null,
    min_subtotal: null,
    gift_product_id: null,
    gift_qty: type === 'SPEND_GET_GIFT' ? 1 : null,
    products: [],
    category_name: '',
    gift_product_name: '',
  };
}
