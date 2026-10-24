import type { Product, ProductVariant } from '@/blynk/api/types';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive, type MrpPriced } from '@/blynk/lib/pricing';
import { localized } from '@/blynk/i18n/localized';

/*
 * Variants, sold out and delivery lead time on the shop side (migration 045, owner 2026-10-14:
 * "chilli powder has 50g, 100g, 250g, 500g with different prices - show LKR 50-350, then the
 * proper price for the gram they pick"; "items that can only be delivered after some days").
 * Pure: the product card, product page, size picker and cart all read their words from here.
 * UI strings stay in VARIANT_COPY (English, Sinhala, Tamil).
 */

export const VARIANT_COPY = localized(
  {
    soldOut: 'Sold out',
    chooseSize: 'Choose a size',
    sizes: 'Sizes',
    done: 'Done',
    loadFailed: "We couldn't load the sizes.",
    retry: 'Try again',
    pickSizeAgain: 'Pick a size again',
    addToCart: (label: string | null) => (label ? `Add ${label} to cart` : 'Add to cart'),
    from: (price: string) => `From ${price}`,
    deliveredFrom: (date: string) => `Delivered from ${date}`,
  } as const,
  {
    si: {
      soldOut: 'විකිණී අවසන්',
      chooseSize: 'ප්‍රමාණයක් තෝරන්න',
      sizes: 'ප්‍රමාණ',
      done: 'අවසන්',
      loadFailed: 'ප්‍රමාණ පූරණය කළ නොහැකි විය.',
      retry: 'නැවත උත්සාහ කරන්න',
      pickSizeAgain: 'ප්‍රමාණය නැවත තෝරන්න',
      addToCart: (label: string | null) => (label ? `${label} කරත්තයට දාන්න` : 'කරත්තයට දාන්න'),
      from: (price: string) => `${price} සිට`,
      deliveredFrom: (date: string) => `${date} සිට බෙදාහැරේ`,
    },
    ta: {
      soldOut: 'விற்றுத் தீர்ந்தது',
      chooseSize: 'அளவைத் தேர்ந்தெடுங்கள்',
      sizes: 'அளவுகள்',
      done: 'முடிந்தது',
      loadFailed: 'அளவுகளை ஏற்ற முடியவில்லை.',
      retry: 'மீண்டும் முயற்சிக்கவும்',
      pickSizeAgain: 'அளவை மீண்டும் தேர்ந்தெடுங்கள்',
      addToCart: (label: string | null) => (label ? `${label} கார்ட்டில் சேர்` : 'கார்ட்டில் சேர்'),
      from: (price: string) => `${price} முதல்`,
      deliveredFrom: (date: string) => `${date} முதல் டெலிவரி`,
    },
  },
  'catalog.VARIANT_COPY',
);

/** The product is sold in sizes/packs: adding it means picking one. */
export const hasVariants = (p: Pick<Product, 'has_variants'>): boolean => p.has_variants === true;

const num = (v: unknown): number | null => {
  const x = typeof v === 'string' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};

/** The product's lowest and highest price right now (offers included). */
export function priceRange(p: Product, now: Date = new Date()): { min: number; max: number } {
  const own = effectivePrice(p, now);
  if (!hasVariants(p)) return { min: own, max: own };
  const min = num(p.price_min) ?? own;
  const max = num(p.price_max) ?? min;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** A card has room for at most this many characters of price ("LKR 1,250 – 3,500" is 17). */
export const RANGE_MAX_CHARS = 16;

/**
 * The price a card or list shows: "LKR 50 – 350" for a product with variants whose prices
 * differ ("From LKR 50" when `compact`, or when the range would not fit), else the one price.
 */
export function priceText(p: Product, opts: { compact?: boolean; now?: Date; money?: (n: number) => string } = {}): string {
  const money = opts.money ?? formatLkr;
  const { min, max } = priceRange(p, opts.now);
  if (!hasVariants(p) || min === max) return money(min);
  const full = `${money(min)} – ${money(max).replace(/^LKR\s*/, '')}`;
  return opts.compact || full.length > RANGE_MAX_CHARS ? VARIANT_COPY.from(money(min)) : full;
}

/** A variant's price fields as the pricing helpers read them (with its MRP, migration 048). */
export const variantPriced = (v: Pick<ProductVariant, 'selling_price' | 'offer_price' | 'offer_ends_at' | 'mrp'>): MrpPriced => ({
  selling_price: v.selling_price, offer_price: v.offer_price, offer_ends_at: v.offer_ends_at, mrp: v.mrp ?? null,
});

/** What one unit of this variant costs now (its own offer or the category one, already in offer_price). */
export const variantPrice = (v: ProductVariant, now: Date = new Date()) => effectivePrice(variantPriced(v), now);
export const variantOnOffer = (v: ProductVariant, now: Date = new Date()) => isOfferActive(variantPriced(v), now);

/** GET /catalog/products/:id variants, defensively (numbers may arrive as strings; a bad row is dropped). */
export function parseVariants(raw: unknown): ProductVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductVariant[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const v = r as Record<string, unknown>;
    const selling = num(v.selling_price);
    if (typeof v.id !== 'string' || !v.id || typeof v.label !== 'string' || selling === null) continue;
    const offer = v.offer_price == null ? null : num(v.offer_price);
    out.push({
      id: v.id,
      label: v.label,
      sku: typeof v.sku === 'string' ? v.sku : null,
      barcode: typeof v.barcode === 'string' ? v.barcode : null,
      sort_order: num(v.sort_order) ?? out.length,
      selling_price: selling,
      offer_price: offer,
      offer_ends_at: typeof v.offer_ends_at === 'string' ? v.offer_ends_at : null,
      offer_kind: v.offer_kind === 'PRODUCT' || v.offer_kind === 'CATEGORY' ? v.offer_kind : null,
      price: num(v.price) ?? offer ?? selling,
      is_available: v.is_available === true,
      // migration 048: the size's MRP (only sent when above its price)
      mrp: v.mrp == null ? null : num(v.mrp),
    });
  }
  return out.sort((a, b) => a.sort_order - b.sort_order);
}

/** The numeric variant/lead fields of a product response (list or detail), normalised. */
export function normalizeProductExtras<T extends Product>(p: T): T {
  const out: T = { ...p };
  if (p.price_min != null) out.price_min = num(p.price_min) ?? undefined;
  if (p.price_max != null) out.price_max = num(p.price_max) ?? undefined;
  if (p.mrp != null) out.mrp = num(p.mrp);
  if (p.delivery_lead_days != null) out.delivery_lead_days = Math.max(0, Math.floor(num(p.delivery_lead_days) ?? 0));
  if (p.variants !== undefined) out.variants = parseVariants(p.variants);
  return out;
}

/** The size the product page starts on: the first one in stock, else the first. */
export function defaultVariant(variants: readonly ProductVariant[]): ProductVariant | null {
  return variants.find((v) => v.is_available) ?? variants[0] ?? null;
}

/** The chosen variant when it is still listed, else the default. */
export function selectVariant(variants: readonly ProductVariant[], id: string | null | undefined): ProductVariant | null {
  return (id ? variants.find((v) => v.id === id) : undefined) ?? defaultVariant(variants);
}

/* ------------------------------------------------------------------ delivery lead time */

/** Short day and month names for "Fri 17 Oct" (and how a day reads in each language). */
const DATE_WORDS = localized(
  {
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as readonly string[],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as readonly string[],
    label: (day: string, date: number, month: string) => `${day} ${date} ${month}`,
  },
  {
    si: {
      days: ['ඉරිදා', 'සඳුදා', 'අඟහ', 'බදාදා', 'බ්‍රහස්', 'සිකු', 'සෙන'],
      months: ['ජන', 'පෙබ', 'මාර්', 'අප්‍රේ', 'මැයි', 'ජූනි', 'ජූලි', 'අගෝ', 'සැප්', 'ඔක්', 'නොවැ', 'දෙසැ'],
      label: (day: string, date: number, month: string) => `${month} ${date}, ${day}`,
    },
    ta: {
      days: ['ஞாயிறு', 'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி'],
      months: ['ஜன.', 'பிப்.', 'மார்.', 'ஏப்.', 'மே', 'ஜூன்', 'ஜூலை', 'ஆக.', 'செப்.', 'அக்.', 'நவ.', 'டிச.'],
      label: (day: string, date: number, month: string) => `${day}, ${month} ${date}`,
    },
  },
  'catalog.DATE_WORDS',
);
/** Sri Lanka is UTC+5:30 all year (no daylight saving). */
const COLOMBO_OFFSET_MS = 330 * 60_000;

/** "Fri 17 Oct" for a YYYY-MM-DD day; null when it is not one. */
export function dayLabel(ymd: string | null | undefined): string | null {
  const m = typeof ymd === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return null;
  return DATE_WORDS.label(DATE_WORDS.days[d.getUTCDay()], d.getUTCDate(), DATE_WORDS.months[d.getUTCMonth()]);
}

/** Today (Asia/Colombo) plus `days`, as YYYY-MM-DD. */
export function colomboDayPlus(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() + COLOMBO_OFFSET_MS + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** The product's lead time in whole days (0 = same day / as soon as possible). */
export const leadDaysOf = (p: Pick<Product, 'delivery_lead_days'>): number => {
  const n = num(p.delivery_lead_days);
  return n && n > 0 ? Math.floor(n) : 0;
};

/** The first delivery day of a product with a lead time (the server's date, else today + N). */
export function earliestDeliveryDate(p: Pick<Product, 'delivery_lead_days' | 'earliest_delivery_date'>, now: Date = new Date()): string | null {
  const days = leadDaysOf(p);
  if (days === 0) return null;
  return dayLabel(p.earliest_delivery_date) ? (p.earliest_delivery_date as string) : colomboDayPlus(days, now);
}

/** "Delivered from Fri 17 Oct" for a product that needs days; null for same day. */
export function deliveredFromText(p: Pick<Product, 'delivery_lead_days' | 'earliest_delivery_date'>, now: Date = new Date()): string | null {
  const label = dayLabel(earliestDeliveryDate(p, now));
  return label ? VARIANT_COPY.deliveredFrom(label) : null;
}
