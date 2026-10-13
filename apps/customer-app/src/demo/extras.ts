import type { Product } from '@/blynk/api/types';

/**
 * Display-only fields the reference video shows on a dish card that Blynk's Product type
 * has no room for. Each demo file registers its own, keyed by product id; ProductCard
 * (and anything else) reads them with extraOf(id).
 */
export type DemoExtra = {
  /** Stand-in for the photo (the owner said no product photos). */
  emoji?: string;
  /** Restaurant line above the name, e.g. "Midnight biriyani". */
  store?: string;
  /** "★ 4.1" pill on the photo. */
  rating?: number;
  /** "Popular" tag on the photo. */
  popular?: boolean;
  /** Veg (green square-dot) or non-veg (red triangle) mark before the name. */
  veg?: boolean;
  /** "Other apps: ₹199–209". */
  other?: [number, number];
  /** "Our app: 50% lower". */
  lowerPct?: number;
};

const registry = new Map<string, DemoExtra>();
export function registerExtras(rec: Record<string, DemoExtra>) {
  for (const [id, x] of Object.entries(rec)) registry.set(id, x);
}
export const extraOf = (id: string): DemoExtra | undefined => registry.get(id);

/** A demo dish shaped as Blynk's Product, so the cart store takes it as is. */
export function demoProduct(
  id: string, name: string, price: number, offer: number | null, category: string, extra?: DemoExtra,
): Product {
  if (extra) registry.set(id, extra);
  return {
    id, category_id: category, category_name: category, name, slug: id, description: null,
    unit: '', pack_size: null, image_url: null, image_focal_x: null, image_focal_y: null,
    selling_price: price, offer_price: offer, offer_ends_at: null,
    offer_kind: offer != null ? 'PRODUCT' : null, is_available: true,
  };
}
