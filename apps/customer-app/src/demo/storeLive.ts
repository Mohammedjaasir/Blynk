/*
 * Live (DEMO = false) content for the video-matched aisle intro and aisle screen. Every
 * value here comes from Blynk's catalogue (GET /catalog/*) or GET /store, which Admin and
 * Ops control. A slot the video has but Blynk has no true data for returns null, and the
 * screen hides it.
 */
import type { Category, Product, StoreInfo } from '@/blynk/api/types';
import type { CatalogData } from '@/blynk/catalog/CatalogContext';
import { categoryOfferActive } from '@/blynk/lib/categories';
import { formatLkr } from '@/blynk/lib/money';
import { flatFee, formatHours, formatOfferEnd, freeDeliveryCount } from '@/blynk/lib/storeText';

export type LiveSection = { id: string; title: string; items: Product[] };

export type LiveAisle = {
  cat: Category;
  /** Every product in the aisle and its sub-categories. */
  all: Product[];
  /** Sub-categories become sections; products sitting directly in the aisle get their own. */
  sections: LiveSection[];
  /** The hero photo: the category's own image (cover), else the first product photo (contain). */
  hero: { kind: 'category'; uri: string } | { kind: 'product'; product: Product } | null;
  /** "24 items", "8 AM – 9 PM", hub name: each only when known. */
  meta: string[];
  /** The pink offer row: a running category offer, else new-customer free deliveries, else null. */
  offer: { title: string; sub: string | null } | null;
  /** New-customer free deliveries (0 when Ops has the switch off). */
  freeCount: number;
};

/** Products in a category or any of its sub-categories (CatalogContext.productsIn without its React import). */
const inAisle = (data: CatalogData, catId: string) => data.products.filter((p) => data.chainOf(p.category_id).includes(catId));

export function findAisle(data: CatalogData | null, id: string | undefined): Category | null {
  if (!data || !id) return null;
  return data.categories.find((c) => c.slug === id || c.id === id) ?? null;
}

export function aisleSections(data: CatalogData, cat: Category): LiveSection[] {
  const all = inAisle(data, cat.id);
  const kids = data.categories.filter((k) => k.parent_id === cat.id).sort((a, b) => a.display_order - b.display_order);
  if (!kids.length) return all.length ? [{ id: cat.id, title: cat.name, items: all }] : [];
  const used = new Set<string>();
  const out: LiveSection[] = kids.map((k) => {
    const items = all.filter((p) => !used.has(p.id) && data.chainOf(p.category_id).includes(k.id));
    items.forEach((p) => used.add(p.id));
    return { id: k.id, title: k.name, items };
  });
  const rest = all.filter((p) => !used.has(p.id));
  if (rest.length) out.unshift({ id: cat.id, title: `More in ${cat.name}`, items: rest });
  return out.filter((s) => s.items.length > 0);
}

export function aisleOffer(cat: Category, store: StoreInfo | null, now: Date = new Date()): LiveAisle['offer'] {
  if (categoryOfferActive(cat, now)) {
    return {
      title: `${cat.offer_percent}% OFF EVERYTHING HERE`,
      sub: cat.offer_ends_at ? `Offer until ${formatOfferEnd(cat.offer_ends_at)}` : 'Offer prices across this aisle',
    };
  }
  const free = freeDeliveryCount(store);
  if (free > 0) {
    const fee = flatFee(store);
    return {
      title: `FREE DELIVERY ON YOUR FIRST ${free} ORDER${free > 1 ? 'S' : ''}`,
      sub: fee != null ? `Delivery ${formatLkr(fee)} after that` : 'After that, delivery is calculated at checkout',
    };
  }
  return null;
}

export function liveAisle(data: CatalogData | null, id: string | undefined, store: StoreInfo | null, now: Date = new Date()): LiveAisle | null {
  const cat = findAisle(data, id);
  if (!data || !cat) return null;
  const all = inAisle(data, cat.id);
  const photo = all.find((p) => p.is_available && p.image_url) ?? all.find((p) => p.image_url);
  const hours = formatHours(store);
  const hub = store?.hub_name?.trim();
  return {
    cat,
    all,
    sections: aisleSections(data, cat),
    hero: cat.image_url ? { kind: 'category', uri: cat.image_url } : photo ? { kind: 'product', product: photo } : null,
    meta: [`${all.length} item${all.length === 1 ? '' : 's'}`, ...(hours ? [hours] : []), ...(hub ? [hub] : [])],
    offer: aisleOffer(cat, store, now),
    freeCount: freeDeliveryCount(store),
  };
}

/** The "pair" panel: other in-stock products from the same aisle, up to four. */
export function pairPicks(pool: Product[], forId: string): Product[] {
  return pool.filter((p) => p.id !== forId && p.is_available).slice(0, 4);
}

/** The aisle intro's printed card: up to three sub-categories (else products), each with a photo product. */
export function openingCourses(data: CatalogData | null, cat: Category | null): { name: string; product: Product | null }[] {
  if (!data || !cat) return [];
  const pick = (items: Product[]) => items.find((p) => p.is_available && p.image_url) ?? items.find((p) => p.image_url) ?? items[0] ?? null;
  const secs = aisleSections(data, cat).filter((s) => s.id !== cat.id); // sub-categories only
  if (secs.length) return secs.slice(0, 3).map((s) => ({ name: s.title, product: pick(s.items) }));
  return inAisle(data, cat.id).filter((p) => p.is_available).slice(0, 3).map((p) => ({ name: p.name, product: p }));
}

/** "DAIRY & EGGS" / "24 ITEMS IN STOCK": the intro's two pink lines. The second is null until the catalogue loads. */
export function openingTitle(data: CatalogData | null, cat: Category | null, name: string | undefined): [string | null, string | null] {
  const label = (cat?.name ?? name ?? '').trim();
  const inStock = data && cat ? inAisle(data, cat.id).filter((p) => p.is_available).length : null;
  return [label ? label.toUpperCase() : null, inStock ? `${inStock} ITEM${inStock === 1 ? '' : 'S'} IN STOCK` : null];
}
