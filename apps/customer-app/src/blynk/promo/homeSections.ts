import type { Category, Product, PublicHomeSection } from '../api/types';
import { inCategory } from '../catalog/membership';
import { localized } from '../i18n/localized';

/** Words of the Home rails and the "Ends in" pills (shared with flash deals). */
export const COUNTDOWN_WORDS = localized(
  {
    endsIn: (time: string) => `Ends in ${time}`,
    /** "2h 10m" (hours and minutes) in the flash-deal pill. */
    hoursMinutes: (h: number, m: number) => `${h}h ${m}m`,
    /** "2d 04:10" (days, then hours:minutes). */
    daysClock: (d: number, hhmm: string) => `${d}d ${hhmm}`,
    /** Screen reader: "Ends in 1 hour 59 minutes" (minutes only, never the ticking seconds). */
    speechMinutes: (m: number) => `Ends in ${m} minute${m === 1 ? '' : 's'}`,
    speechHours: (h: number) => `Ends in ${h} hour${h === 1 ? '' : 's'}`,
    speechHoursMinutes: (h: number, m: number) => `Ends in ${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'}`,
    seeAll: 'See all',
    seeAllOf: (title: string) => `See all ${title}`,
    flashDeals: 'Flash deals',
  },
  {
    si: {
      endsIn: (time: string) => `${time} කින් අවසන්`,
      hoursMinutes: (h: number, m: number) => `පැය ${h} මිනි ${m}`,
      daysClock: (d: number, hhmm: string) => `දින ${d} ${hhmm}`,
      speechMinutes: (m: number) => `මිනිත්තු ${m} කින් අවසන් වේ`,
      speechHours: (h: number) => `පැය ${h} කින් අවසන් වේ`,
      speechHoursMinutes: (h: number, m: number) => `පැය ${h} මිනිත්තු ${m} කින් අවසන් වේ`,
      seeAll: 'සියල්ල බලන්න',
      seeAllOf: (title: string) => `${title} සියල්ල බලන්න`,
      flashDeals: 'ෆ්ලෑෂ් දීමනා',
    },
    ta: {
      endsIn: (time: string) => `${time} இல் முடிகிறது`,
      hoursMinutes: (h: number, m: number) => `${h} மணி ${m} நிமி`,
      daysClock: (d: number, hhmm: string) => `${d} நாள் ${hhmm}`,
      speechMinutes: (m: number) => `${m} நிமிடத்தில் முடிகிறது`,
      speechHours: (h: number) => `${h} மணி நேரத்தில் முடிகிறது`,
      speechHoursMinutes: (h: number, m: number) => `${h} மணி ${m} நிமிடத்தில் முடிகிறது`,
      seeAll: 'அனைத்தையும் பார்க்க',
      seeAllOf: (title: string) => `${title} அனைத்தையும் பார்க்க`,
      flashDeals: 'ஃப்ளாஷ் டீல்கள்',
    },
  },
  'promo.COUNTDOWN_WORDS',
);

/*
 * Staff-made Home rails (Admin / Ops "Home sections", 2026-10-24; docs/superpowers/plans/
 * 2026-10-24-home-sections.md). GET /store `home_sections` lists only the sections that are live
 * on the server; this file turns them into what Home draws, using the catalogue the app already
 * loaded, and words the "Ends in 02:14:09" countdown. Pure code: HomeSections.tsx only draws it.
 */

/** What a rail shows at most (the server allows 4-12, default 8; a hand-picked list is at most 12). */
export const SECTION_MAX = 12;
export const SECTION_MIN = 4;
export const SECTION_DEFAULT = 8;

/** The catalogue pieces a section needs (CatalogData has all of them). */
export interface SectionCatalog {
  products: Product[];
  categories: Category[];
  chainOf: (categoryId: string) => string[];
}

/** One rail, ready to draw. */
export interface HomeSectionView {
  id: string;
  title: string;
  subtitle: string | null;
  products: Product[];
  /** The end as epoch ms, or null when the section has none. */
  endsAtMs: number | null;
  /** Show "Ends in ..." on the header (needs an end). */
  countdown: boolean;
  /** CATEGORY source: where "See all" goes; null for hand-picked products. */
  seeAll: { slug: string; name: string } | null;
}

/** Epoch ms of an ISO datetime, or null when there is none or it cannot be read. */
export function endMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** The rail length: the server's max_items, kept to 4-12 (8 when missing or not a number). */
export function railLimit(maxItems: unknown): number {
  if (typeof maxItems !== 'number' || !Number.isFinite(maxItems)) return SECTION_DEFAULT;
  return Math.min(SECTION_MAX, Math.max(SECTION_MIN, Math.floor(maxItems)));
}

/** A section is gone once its end has passed (the server already hid the ones not yet started). */
export const sectionEnded = (endsAtMs: number | null, nowMs: number) => endsAtMs !== null && endsAtMs <= nowMs;

const orderable = (p: Product | undefined): p is Product => !!p && p.is_available;

/**
 * The live sections for Home, in the server's order. A CATEGORY source shows the category's (and its
 * sub-categories') orderable products in catalogue order, up to max_items; a PRODUCTS source keeps
 * staff order and skips products that are missing or can't be ordered now (up to 12). A section
 * whose end has passed, or that has no products, is left out.
 */
export function homeSectionViews(
  sections: PublicHomeSection[] | null | undefined, catalog: SectionCatalog | null | undefined, nowMs: number,
): HomeSectionView[] {
  if (!catalog || !Array.isArray(sections) || sections.length === 0) return [];
  const byId = new Map<string, Product>();
  for (const p of catalog.products) byId.set(p.id, p);
  const seen = new Set<string>();
  const out: HomeSectionView[] = [];
  for (const s of sections) {
    if (!s || typeof s.id !== 'string' || seen.has(s.id)) continue;
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    if (!title) continue;
    const endsAtMs = endMs(s.ends_at);
    if (sectionEnded(endsAtMs, nowMs)) continue;

    let products: Product[] = [];
    let seeAll: HomeSectionView['seeAll'] = null;
    if (s.category && typeof s.category.id === 'string') {
      const catId = s.category.id;
      products = catalog.products.filter((p) => orderable(p) && inCategory(p, catalog.chainOf, catId)).slice(0, railLimit(s.max_items));
      const name = catalog.categories.find((c) => c.id === catId)?.name ?? title;
      if (s.category.slug) seeAll = { slug: s.category.slug, name };
    } else if (Array.isArray(s.product_ids)) {
      const ids = new Set<string>();
      for (const id of s.product_ids) {
        if (ids.has(id)) continue;
        const p = byId.get(id);
        if (orderable(p)) { ids.add(id); products.push(p); }
        if (products.length >= SECTION_MAX) break;
      }
    }
    if (products.length === 0) continue;

    seen.add(s.id);
    const subtitle = typeof s.subtitle === 'string' && s.subtitle.trim() ? s.subtitle.trim() : null;
    out.push({ id: s.id, title, subtitle, products, endsAtMs, countdown: !!s.show_countdown && endsAtMs !== null, seeAll });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "02:14:09" under a day, "2d 04:10" from a day on (days, then hours:minutes). Null once there is
 * nothing left, so the caller shows nothing. Whole seconds round up: the last second still reads 00:00:01.
 */
export function countdownText(remainingMs: number): string | null {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const total = Math.ceil(remainingMs / 1000);
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return days > 0 ? COUNTDOWN_WORDS.daysClock(days, `${pad(h)}:${pad(m)}`) : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** The header pill: "Ends in 02:14:09", or null when the section has no countdown or it is over. */
export function endsInText(endsAtMs: number | null, nowMs: number): string | null {
  if (endsAtMs === null) return null;
  const t = countdownText(endsAtMs - nowMs);
  return t === null ? null : COUNTDOWN_WORDS.endsIn(t);
}

/** Under an hour left: the pill turns urgent. */
export const countdownUrgent = (endsAtMs: number, nowMs: number) => endsAtMs - nowMs < 3_600_000;

/** Longest delay a JS timer accepts (a larger one fires at once). */
const MAX_TIMER_MS = 2_147_483_000;

/**
 * How long until the soonest end among `views` (plus a beat so the clock has really passed it), so Home
 * can drop that section without a reload. Null when nothing is ending. Capped for far-off ends: the
 * timer then just re-checks.
 */
export function nextEndDelay(views: Pick<HomeSectionView, 'endsAtMs'>[], nowMs: number): number | null {
  let soonest: number | null = null;
  for (const v of views) {
    if (v.endsAtMs !== null && v.endsAtMs > nowMs && (soonest === null || v.endsAtMs < soonest)) soonest = v.endsAtMs;
  }
  return soonest === null ? null : Math.min(MAX_TIMER_MS, soonest - nowMs + 50);
}
