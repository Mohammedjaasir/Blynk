import type { PublicHeroBanner } from '../api/types';
import { promoDestination, type PromoDestination } from '../catalog/promoTarget';
import { formatLkr } from '../lib/money';

/*
 * The Home hero banner's render model (docs/promo-surfaces.md §3). Pure, so it is tested in
 * Node; src/components/Banner.tsx only draws what this returns, with the same animation in
 * both modes.
 *
 *   config undefined / null  -> AUTO: the automatic words the banner always had
 *   config object (CUSTOM)   -> Admin / Ops' words, with {min_price} / {free_count} filled in;
 *                               after its ends_at (a cached /store) it is AUTO again
 */

/** Customer-facing words (kept together for the Sinhala / Tamil phase). */
export const HERO_COPY = {
  titleFree: ['FREE', 'DELIVERY'] as [string, string],
  titleFresh: ['FRESH', 'GROCERIES'] as [string, string],
  firstOrders: (n: number) => `On your first ${n} order${n > 1 ? 's' : ''}`,
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
}

export interface HeroFacts { minPrice: number | null; freeCount: number }

/** A sub-line with its tokens filled in; null when a token has no value (the line is skipped). */
export function fillHeroTokens(line: string, facts: HeroFacts): string | null {
  let missing = false;
  const out = line.replace(/\{(min_price|free_count)\}/g, (_, t: string) => {
    if (t === 'min_price') {
      if (facts.minPrice == null) missing = true;
      return facts.minPrice != null ? formatLkr(facts.minPrice) : '';
    }
    if (!(facts.freeCount > 0)) missing = true;
    return facts.freeCount > 0 ? String(facts.freeCount) : '';
  });
  return missing ? null : out;
}

function autoHero(facts: HeroFacts): HeroModel {
  const price = facts.minPrice != null ? formatLkr(facts.minPrice) : null;
  const lines: string[] = [];
  if (facts.freeCount > 0) lines.push(HERO_COPY.firstOrders(facts.freeCount));
  if (price) lines.push(HERO_COPY.startingAt(price));
  return {
    title: facts.freeCount > 0 ? HERO_COPY.titleFree : HERO_COPY.titleFresh,
    lines,
    accent: price,
    items: HERO_AUTO_ITEMS.map((k) => HERO_ITEMS[k]!),
    cta: HERO_COPY.cta,
    link: null,
    custom: false,
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
