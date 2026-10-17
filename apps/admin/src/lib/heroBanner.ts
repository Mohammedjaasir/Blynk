import type { HeroBannerFields, HeroBannerItem } from '../api/types';

/*
 * Home hero banner: the purple banner at the top of the customer app's Home
 * (saucer, two jumping title words, a rolling sub-line, ORDER NOW). The limits,
 * items, timings and the automatic words follow docs/promo-surfaces.md §3,
 * which the customer app (src/components/Banner.tsx, src/blynk/promo/
 * heroBanner.ts) and the API (modules/configuration/hero-banner.ts) also
 * follow - keep the four in step.
 */

export const HERO_LIMITS = { titleChars: 12, lines: 4, lineChars: 40, ctaChars: 16 } as const;

/**
 * The illustrated items the beam can lift (the app draws the same emoji art). Owner, 2026-10-17:
 * "can we add custom icons... we have diapers as well, maybe we can give multiple things" - a
 * few non-grocery items alongside the original produce.
 */
export const HERO_ITEMS: { key: HeroBannerItem; label: string; emoji: string }[] = [
  { key: 'milk', label: 'Milk', emoji: '🥛' },
  { key: 'bread', label: 'Bread', emoji: '🍞' },
  { key: 'apple', label: 'Apple', emoji: '🍎' },
  { key: 'carrot', label: 'Carrot', emoji: '🥕' },
  { key: 'egg', label: 'Egg', emoji: '🥚' },
  { key: 'broccoli', label: 'Broccoli', emoji: '🥦' },
  { key: 'banana', label: 'Banana', emoji: '🍌' },
  { key: 'diaper', label: 'Diapers', emoji: '🧷' },
  { key: 'soap', label: 'Soap', emoji: '🧼' },
  { key: 'biscuit', label: 'Biscuits', emoji: '🍪' },
  { key: 'bottle', label: 'Drinks', emoji: '🧃' },
];
/** What the automatic banner lifts. */
export const HERO_AUTO_ITEMS: HeroBannerItem[] = ['bread', 'apple', 'carrot', 'egg', 'broccoli', 'banana'];

/** The tokens a sub-line may use, with what they become. */
export const HERO_TOKENS = [
  { token: '{min_price}', meaning: 'the cheapest product price right now, e.g. "LKR 253"' },
  { token: '{free_count}', meaning: 'how many free deliveries new customers get, e.g. "2"' },
  { token: '{points_rule}', meaning: 'the Blynk Points earn rule, e.g. "1 point for every LKR 100"' },
] as const;

/** Motion timings (ms), as the app plays them. */
export const HERO_TIMING = { cycle: 2600, roll: 3200, exit: 380, next: 120 } as const;

/**
 * The sample facts the preview fills the tokens with (the live values come from the catalog and
 * the settings). pointsRule: the Blynk Points rule while points are on, null while off.
 */
export interface HeroSample { minPrice: number | null; freeCount: number; pointsRule?: string | null }
export const HERO_SAMPLE: HeroSample = { minPrice: 253, freeCount: 0, pointsRule: '1 point for every LKR 100' };

export const DEFAULT_HERO: HeroBannerFields = {
  mode: 'AUTO',
  title_1: 'FRESH',
  title_2: 'GROCERIES',
  lines: ['Quality groceries, delivered with care'],
  cta_label: 'ORDER NOW',
  cta_destination_type: null,
  cta_destination_value: null,
  items: [...HERO_AUTO_ITEMS],
  starts_at: null,
  ends_at: null,
};

export type HeroStatus = 'AUTO' | 'LIVE' | 'SCHEDULED' | 'ENDED';
export function heroStatus(h: Pick<HeroBannerFields, 'mode' | 'starts_at' | 'ends_at'>, now = new Date()): HeroStatus {
  if (h.mode !== 'CUSTOM') return 'AUTO';
  if (h.starts_at && now.getTime() < Date.parse(h.starts_at)) return 'SCHEDULED';
  if (h.ends_at && now.getTime() >= Date.parse(h.ends_at)) return 'ENDED';
  return 'LIVE';
}
export const HERO_STATUS_TEXT: Record<HeroStatus, string> = {
  AUTO: 'Automatic',
  LIVE: 'Custom - live in the app',
  SCHEDULED: 'Custom - scheduled, automatic until then',
  ENDED: 'Custom - ended, automatic again',
};

const lkr = (n: number) =>
  'LKR ' + n.toLocaleString('en-US', Math.abs(n % 1) < 0.005 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The preview's facts from the live settings (Blynk Points and the checkout switches), so
 * "Automatic" shows what customers see now; HERO_SAMPLE until they load (or if they fail).
 */
export function heroSampleFrom(
  points: { enabled: boolean; earn_points: number; earn_per_lkr: number } | null | undefined,
  checkout: { new_customer_free_deliveries?: { enabled: boolean; count: number } } | null | undefined,
  base: HeroSample = HERO_SAMPLE,
): HeroSample {
  const free = checkout?.new_customer_free_deliveries;
  const n = Math.max(1, Math.floor(points?.earn_points ?? 1));
  return {
    minPrice: base.minPrice,
    freeCount: checkout ? (free?.enabled && free.count > 0 ? free.count : 0) : base.freeCount,
    pointsRule: points
      ? points.enabled && points.earn_per_lkr > 0
        ? `${n} ${n === 1 ? 'point' : 'points'} for every ${lkr(points.earn_per_lkr)}`
        : null
      : base.pointsRule,
  };
}

/** A sub-line with its tokens filled in; null when a token has no value (the app skips the line). */
export function fillTokens(line: string, s: HeroSample): string | null {
  let missing = false;
  const out = line.replace(/\{(min_price|free_count|points_rule)\}/g, (_, t: string) => {
    if (t === 'min_price') {
      if (s.minPrice == null) missing = true;
      return s.minPrice != null ? lkr(s.minPrice) : '';
    }
    if (t === 'points_rule') {
      if (!s.pointsRule) missing = true;
      return s.pointsRule ?? '';
    }
    if (!(s.freeCount > 0)) missing = true;
    return s.freeCount > 0 ? String(s.freeCount) : '';
  });
  return missing ? null : out;
}

export interface HeroPreviewModel {
  title: [string, string];
  lines: string[];
  /** The price inside a line gets the firework. */
  accent: string | null;
  items: string[];
  cta: string;
  custom: boolean;
}

const clean = (xs: string[]) => xs.map((x) => x.trim()).filter((x) => x.length > 0);

/** What the app would draw for these (possibly unsaved) fields, with sample facts. */
export function heroPreviewModel(h: HeroBannerFields, s: HeroSample = HERO_SAMPLE): HeroPreviewModel {
  const price = s.minPrice != null ? lkr(s.minPrice) : null;
  const emoji = (keys: HeroBannerItem[]) => keys.map((k) => HERO_ITEMS.find((i) => i.key === k)?.emoji).filter((e): e is string => !!e);
  if (h.mode !== 'CUSTOM') {
    // the app's AUTO words: Blynk Points while they are on (owner, 2026-10-14), else two catchy
    // lines - no free-delivery claim and no price line any more (owner, 2026-10-15/16), matching
    // src/blynk/promo/heroBanner.ts autoHero() in the customer app
    const points = s.pointsRule || null;
    const lines = points ? [points, 'Shop smart, earn more'] : ['Quality groceries, delivered with care', 'Fresh picks, every day'];
    return {
      title: points ? ['EARN', 'POINTS'] : ['FRESH', 'GROCERIES'],
      lines,
      accent: null,
      items: emoji(HERO_AUTO_ITEMS),
      cta: 'ORDER NOW',
      custom: false,
    };
  }
  const items = emoji(h.items);
  return {
    title: [h.title_1.trim().toUpperCase() || ' ', h.title_2.trim().toUpperCase() || ' '],
    lines: clean(h.lines)
      .map((l) => fillTokens(l, s))
      .filter((l): l is string => !!l),
    accent: price,
    items: items.length ? items : emoji(HERO_AUTO_ITEMS),
    cta: h.cta_label.trim().toUpperCase() || 'ORDER NOW',
    custom: true,
  };
}

/** Title word size in the 196 pt column (Bowlby One ~0.82 em per capital, at most 36). */
export const heroWordSize = (w: string) => Math.min(36, Math.floor(196 / (Math.max(1, w.length) * 0.82)));
/** How far the letter wave runs (1 = 1 s; longer titles run on at the same speed). */
export const heroWaveSpan = (title: [string, string]) =>
  Math.max(1, ((title[0].length + 0.6 + Math.max(0, title[1].length - 1)) * 0.9 + 1) / 12);
/** Sub-line size: 15 pt; a long custom line shrinks (10.5 pt at the least) to end before the item. */
export function heroSubSize(line: string, custom: boolean): number {
  if (!custom) return 15;
  const fit = 220 / (Math.max(1, line.length) * 0.519);
  return Math.max(10.5, Math.min(15, Math.floor(fit * 2) / 2));
}

const TOKEN_RE = /\{([^{}]*)\}/g;

/**
 * The same checks the API makes, phrased for the form; null = fine. The API keeps the custom
 * fields while the banner is automatic, so they are checked in both modes.
 */
export function heroProblem(h: HeroBannerFields): string | null {
  if (h.starts_at && h.ends_at && Date.parse(h.ends_at) <= Date.parse(h.starts_at)) return 'The end must be after the start.';
  for (const [w, which] of [
    [h.title_1, 'first'],
    [h.title_2, 'second'],
  ] as const) {
    if (!w.trim()) return `Write the ${which} title word.`;
    if (w.trim().length > HERO_LIMITS.titleChars) return `Keep the ${which} title word to ${HERO_LIMITS.titleChars} characters so it fits.`;
  }
  const lines = clean(h.lines);
  if (lines.length < 1) return 'Add at least 1 sub-line.';
  if (lines.length > HERO_LIMITS.lines) return `At most ${HERO_LIMITS.lines} sub-lines.`;
  if (lines.some((l) => l.length < 2)) return 'Each sub-line needs at least 2 characters.';
  if (lines.some((l) => l.length > HERO_LIMITS.lineChars)) return `Keep each sub-line to ${HERO_LIMITS.lineChars} characters.`;
  for (const l of lines) {
    for (const m of l.matchAll(TOKEN_RE)) {
      if (m[1] !== 'min_price' && m[1] !== 'free_count' && m[1] !== 'points_rule') {
        return `Unknown token {${m[1]}}. Use {min_price}, {free_count} or {points_rule}.`;
      }
    }
  }
  if (!h.cta_label.trim()) return 'Write the button text.';
  if (h.cta_label.trim().length > HERO_LIMITS.ctaChars) return `Keep the button text to ${HERO_LIMITS.ctaChars} characters.`;
  if (h.items.length < 1) return 'Choose at least 1 item for the beam.';
  if ((h.cta_destination_type === 'CATEGORY' || h.cta_destination_type === 'PRODUCT') && !h.cta_destination_value) {
    return h.cta_destination_type === 'CATEGORY' ? 'Choose the category the button opens.' : 'Choose the product the button opens.';
  }
  return null;
}

/** The PATCH body: every editable field, trimmed (words upper-case, as the app shows them). */
export function heroPayload(h: HeroBannerFields): HeroBannerFields {
  return {
    ...h,
    title_1: h.title_1.trim().toUpperCase(),
    title_2: h.title_2.trim().toUpperCase(),
    lines: clean(h.lines),
    cta_label: h.cta_label.trim().toUpperCase(),
  };
}
