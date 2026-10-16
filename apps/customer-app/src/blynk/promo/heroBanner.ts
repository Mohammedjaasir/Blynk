import type { PublicHeroBanner } from '../api/types';
import { promoDestination, type PromoDestination } from '../catalog/promoTarget';
import { formatLkr } from '../lib/money';
import { NEUTRAL_COPY, POINTS_COPY } from '../store/pointsPromo';

/*
 * The Home hero banner's render model (docs/promo-surfaces.md §3). Pure, so it is tested in
 * Node; src/components/Banner.tsx only draws what this returns, with the same animation in
 * both modes.
 *
 *   config undefined / null  -> AUTO: the automatic words the banner always had
 *   config object (CUSTOM)   -> Admin / Ops' words, with {min_price} / {free_count} /
 *                               {points_rule} filled in;
 *                               after its ends_at (a cached /store) it is AUTO again
 *
 * Free deliveries follow the customer's own claim (src/blynk/store/freeClaim.ts): a guest hears
 * the store's new-customer offer, always "for new customers"; a signed-in customer only the
 * free deliveries they still have. FREE / FRESH and the sub-line in AUTO, and the {free_count}
 * token in CUSTOM, all read the same claim.
 *
 * Blynk Points (owner, 2026-10-14: points instead of free delivery): while GET /store
 * `points_program` is on, AUTO says EARN / POINTS with the live rule ("1 point for every
 * LKR 100") - for guests and signed-in customers alike - and the {points_rule} token fills in
 * that rule (a line using it is skipped while points are off). CUSTOM keeps Admin / Ops' words.
 */

/** Customer-facing words (kept together for the Sinhala / Tamil phase). */
export const HERO_COPY = {
  titleFresh: NEUTRAL_COPY.heroTitle,
  titlePoints: POINTS_COPY.heroTitle,
  /** AUTO, no points: a catchy line, no free-delivery claim (owner, 2026-10-15). */
  catchy: 'Quality groceries, delivered with care',
  startingAt: (price: string) => `Groceries starting at ${price}`,
  cta: 'ORDER NOW',
};

/** The illustrated items the saucer's beam can lift (the same keys Admin and Ops offer). */
export const HERO_ITEMS: Record<string, string> = {
  milk: '🥛', bread: '🍞', apple: '🍎', carrot: '🥕', egg: '🥚', broccoli: '🥦', banana: '🍌',
};
/** What AUTO lifts: illustrated grocery stand-ins, never product photos. */
export const HERO_AUTO_ITEMS = ['bread', 'apple', 'carrot', 'egg', 'broccoli', 'banana'];

/** Banner layout numbers the model needs (pt). */
/** subRoom: the width a custom sub-line may take (it runs past the 196 pt column, never into the item). */
export const HERO_LAYOUT = { textW: 196, subSize: 15, subMin: 10.5, subFitW: 220, subRoom: 240 } as const;

export interface HeroModel {
  title: [string, string];
  /** The rolling sub-lines (one = static; none = no sub-line). */
  lines: string[];
  /** The part of a line that gets the firework (the cheapest price), when it is in the line. */
  accent: string | null;
  /** Emoji art for the beam, in order. */
  items: string[];
  cta: string;
  /** Where ORDER NOW goes; null = the app's own (scroll down to the aisles). */
  link: PromoDestination | null;
  custom: boolean;
  /** Sub-lines may shrink to fit and run past the title column (CUSTOM, or AUTO's longer guest line). */
  fit: boolean;
}

export interface HeroFacts {
  minPrice: number | null;
  /** The free deliveries this customer may be told about (useFreeClaim): 0 = none. */
  freeCount: number;
  /** Whose count it is: 'personal' (signed in, their own left) or the store's offer for new customers (default). */
  freeKind?: 'personal' | 'new-customer' | 'none';
  /** The Blynk Points rule while points are on ("1 point for every LKR 100"), else null / absent. */
  pointsRule?: string | null;
}

const NEW_CUSTOMERS = /new customer/i;

/** A sub-line with its tokens filled in; null when a token has no value (the line is skipped). */
export function fillHeroTokens(line: string, facts: HeroFacts): string | null {
  let missing = false;
  let usedFree = false;
  const out = line.replace(/\{(min_price|free_count|points_rule)\}/g, (_, t: string) => {
    if (t === 'min_price') {
      if (facts.minPrice == null) missing = true;
      return facts.minPrice != null ? formatLkr(facts.minPrice) : '';
    }
    if (t === 'points_rule') {
      if (!facts.pointsRule) missing = true;
      return facts.pointsRule ?? '';
    }
    if (!(facts.freeCount > 0)) missing = true;
    usedFree = true;
    return facts.freeCount > 0 ? String(facts.freeCount) : '';
  });
  if (missing) return null;
  // a guest hears the store's offer, so it is said to be for new customers
  if (usedFree && facts.freeKind !== 'personal' && !NEW_CUSTOMERS.test(out)) return `${out} for new customers`;
  return out;
}

function autoHero(facts: HeroFacts): HeroModel {
  const price = facts.minPrice != null ? formatLkr(facts.minPrice) : null;
  const lines: string[] = [];
  // Points first (owner, 2026-10-14); otherwise a catchy line, never free delivery (owner,
  // 2026-10-15: "remove that, add some other catchy thing" - the purple banner was still
  // showing FREE DELIVERY while the setting was on; it never does again).
  const points = facts.pointsRule || null;
  if (points) lines.push(points);
  else lines.push(HERO_COPY.catchy);
  if (price) lines.push(HERO_COPY.startingAt(price));
  return {
    title: points ? HERO_COPY.titlePoints : HERO_COPY.titleFresh,
    lines,
    accent: price,
    items: HERO_AUTO_ITEMS.map((k) => HERO_ITEMS[k]!),
    cta: HERO_COPY.cta,
    link: null,
    custom: false,
    fit: false,
  };
}

const word = (x: unknown) => (typeof x === 'string' ? x.trim().toUpperCase().slice(0, 12) : '');

export function resolveHero(config: PublicHeroBanner | null | undefined, facts: HeroFacts, now: Date = new Date()): HeroModel {
  const auto = autoHero(facts);
  if (!config || config.mode !== 'CUSTOM') return auto;
  if (config.ends_at && now.getTime() >= Date.parse(config.ends_at)) return auto;
  const [a, b] = Array.isArray(config.title) ? config.title : [];
  const w1 = word(a);
  const w2 = word(b);
  if (!w1 || !w2) return auto;
  const lines = (Array.isArray(config.lines) ? config.lines : [])
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    .map((l) => fillHeroTokens(l.trim(), facts))
    .filter((l): l is string => !!l);
  const items = (Array.isArray(config.items) ? config.items : []).map((k) => HERO_ITEMS[k]).filter((e): e is string => !!e);
  const cta = typeof config.cta_label === 'string' && config.cta_label.trim() ? config.cta_label.trim().toUpperCase() : HERO_COPY.cta;
  const link = config.cta_target
    ? promoDestination({ cta_target: config.cta_target, cta_destination_type: null, cta_destination_value: null })
    : null;
  return {
    title: [w1, w2],
    lines,
    accent: auto.accent,
    items: items.length ? items : auto.items,
    cta,
    link,
    custom: true,
    fit: true,
  };
}

/** Title word size: Bowlby One averages ~0.82 em per capital; fit the word into the left column. */
export function heroWordSize(w: string): number {
  return Math.min(36, Math.floor(HERO_LAYOUT.textW / (Math.max(1, w.length) * 0.82)));
}

/**
 * The letter jump travels across both words at ~75 ms a letter. The wave runs 0 -> 1 in 1 s
 * for short titles (as always); for longer words it runs on at the same speed so the last
 * letters finish their jump instead of stopping mid-air.
 */
export function heroWaveSpan(title: [string, string]): number {
  const last = title[0].length + 0.6 + Math.max(0, title[1].length - 1);
  return Math.max(1, (last * 0.9 + 1) / 12);
}

/**
 * Sub-line size: AUTO keeps 15 pt as always. A custom line shrinks (to 10.5 pt at the least) so
 * it ends before the beam's item, also on a 360 pt phone. Outfit Bold 15 with 0.8 tracking
 * averages ~7.8 pt per character.
 */
export function heroSubSize(line: string, custom: boolean): number {
  if (!custom) return HERO_LAYOUT.subSize;
  const perPt = 0.519; // width per character per pt of font size
  const fit = HERO_LAYOUT.subFitW / (Math.max(1, line.length) * perPt);
  return Math.max(HERO_LAYOUT.subMin, Math.min(HERO_LAYOUT.subSize, Math.floor(fit * 2) / 2));
}
