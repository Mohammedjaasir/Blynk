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
  /**
   * AUTO, no points: two catchy lines that roll, no free-delivery claim (owner, 2026-10-15)
   * and no price line any more (owner, 2026-10-16: "i don't need this line, instead change
   * some other catchy").
   */
  catchy: ['Quality groceries, delivered with care', 'Fresh picks, every day'],
  /** AUTO, points on: the live rule, then a second catchy line (owner, 2026-10-16). */
  catchyPoints: 'Shop smart, earn more',
  cta: 'ORDER NOW',
};

/**
 * The illustrated items the saucer's beam can lift (the same keys Admin and Ops offer). Owner,
 * 2026-10-17: "can we add custom icons... we have diapers as well, maybe we can give multiple
 * things" - a few non-grocery items alongside the original produce.
 */
export const HERO_ITEMS: Record<string, string> = {
  milk: '🥛', bread: '🍞', apple: '🍎', carrot: '🥕', egg: '🥚', broccoli: '🥦', banana: '🍌',
  diaper: '🧷', soap: '🧼', biscuit: '🍪', bottle: '🧃',
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
  /** The slides after the main one: their own words, a line (null = the main lines roll) and an item (null = the beam's items take turns). */
  slides: HeroSlideModel[];
  custom: boolean;
  /** Sub-lines may shrink to fit and run past the title column (CUSTOM, or AUTO's longer guest line). */
  fit: boolean;
}

export interface HeroSlideModel {
  title: [string, string];
  line: string | null;
  /** Emoji art, or null. */
  item: string | null;
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
  // Points first (owner, 2026-10-14); otherwise two catchy lines, never free delivery (owner,
  // 2026-10-15: "remove that, add some other catchy thing") and no price line any more (owner,
  // 2026-10-16: "i don't need this line, instead change some other catchy").
  const points = facts.pointsRule || null;
  const lines = points ? [points, HERO_COPY.catchyPoints] : HERO_COPY.catchy;
  return {
    title: points ? HERO_COPY.titlePoints : HERO_COPY.titleFresh,
    lines,
    accent: null,
    items: HERO_AUTO_ITEMS.map((k) => HERO_ITEMS[k]!),
    cta: HERO_COPY.cta,
    link: null,
    slides: [],
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
  // CUSTOM lines may still name the price themselves ({min_price}); the firework highlights it
  // there even though AUTO no longer shows a price line (owner, 2026-10-16).
  const accent = facts.minPrice != null ? formatLkr(facts.minPrice) : null;
  // the extra slides (owner, 2026-10-23): a slide with a broken title is dropped
  const slides: HeroSlideModel[] = [];
  for (const x of Array.isArray(config.slides) ? config.slides : []) {
    const [sa, sb] = Array.isArray(x?.title) ? x.title : [];
    const t1 = word(sa);
    const t2 = word(sb);
    if (!t1 || !t2) continue;
    const line = typeof x.line === 'string' && x.line.trim() ? fillHeroTokens(x.line.trim(), facts) : null;
    slides.push({ title: [t1, t2], line, item: (typeof x.item === 'string' && HERO_ITEMS[x.item]) || null });
  }
  return {
    title: [w1, w2],
    lines,
    accent,
    items: items.length ? items : auto.items,
    cta,
    link,
    slides,
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
