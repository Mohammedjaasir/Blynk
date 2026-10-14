import type { Promotion } from '../api/types';
import { categoriesHref, categoryHref } from './tree';

/*
 * Where a tapped Home banner goes (docs/api/catalog-tools.md section 2, owner 2026-10-14):
 *
 *   cta_target.level   opens
 *   MAIN               the categories screen at that group (cta_target.id = home-groups id)
 *   CATEGORY           that category's screen
 *   SUB_CATEGORY       the parent's screen with that sub-category selected in the sidebar
 *   PRODUCT            the product page
 *   CATALOG / unknown  the categories screen
 *   cta_target null    nothing: the banner is not tappable
 *
 * A switched-off target (is_active false) is not tappable either: it would open "not available".
 * An older backend sends no cta_target at all; then the stored destination is used as before.
 */

export type PromoDestination =
  | { kind: 'categories'; group: string | null }
  | { kind: 'category'; slug: string; sub: string | null }
  | { kind: 'product'; id: string };

type PromoLink = Pick<Promotion, 'cta_target' | 'cta_destination_type' | 'cta_destination_value'>;

export function promoDestination(p: PromoLink): PromoDestination | null {
  const t = p.cta_target;
  if (t === null) return null;
  if (t) {
    if (t.is_active === false) return null;
    switch (t.level) {
      case 'MAIN': return { kind: 'categories', group: t.id ?? null };
      case 'CATEGORY': return t.slug ? { kind: 'category', slug: t.slug, sub: null } : null;
      case 'SUB_CATEGORY':
        if (t.parent_slug && t.slug) return { kind: 'category', slug: t.parent_slug, sub: t.slug };
        return t.slug ? { kind: 'category', slug: t.slug, sub: null } : null;
      case 'PRODUCT': return t.id ? { kind: 'product', id: t.id } : null;
      default: return { kind: 'categories', group: null };
    }
  }
  // older backend (no cta_target): the stored type and value
  const v = p.cta_destination_value?.trim() || null;
  switch (p.cta_destination_type) {
    case 'CATEGORY': return v ? { kind: 'category', slug: v, sub: null } : null;
    case 'PRODUCT': return v ? { kind: 'product', id: v } : null;
    case 'CATALOG': return { kind: 'categories', group: null };
    default: return null;
  }
}

/** The router target for a destination. */
export function destinationHref(d: PromoDestination) {
  switch (d.kind) {
    case 'categories': return categoriesHref(d.group);
    case 'category': return categoryHref(d.slug, d.sub);
    case 'product': return { pathname: '/p/[id]' as const, params: { id: d.id } };
  }
}

/* The carousel's timing and slide look: src/blynk/promo/carousel.ts (docs/promo-surfaces.md section 2). */

/** Banners worth showing: an image, or a title over a coloured card. */
export function visiblePromotions<T extends Pick<Promotion, 'image_url' | 'background_image_url' | 'title' | 'display_order'>>(list: T[]): T[] {
  return list
    .filter((p) => !!(p.image_url || p.background_image_url || p.title?.trim()))
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
}
