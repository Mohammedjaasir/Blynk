import type { PromoTarget, PublicPromoBand } from '../api/types';

/*
 * The Home promo band's render model (docs/promo-surfaces.md §1). Pure, so it is tested in
 * Node; src/components/PromoBand.tsx only draws what this returns.
 *
 *   config undefined (older API, or the design mock) -> the band as it always was
 *   config null                                      -> hidden (off, or outside its schedule)
 *   config object                                    -> Admin / Ops' band; an empty list of
 *                                                       headlines or ticks keeps the app's own copy
 */

/** The band's built-in look: Blynk yellow, ink text, the waving rider. */
export const BAND_DEFAULT_COLORS = { start: '#FFE141', end: '#F2C600', text: '#1A1D2E' } as const;

/** Illustrated items the beam can hold (the same keys Admin and Ops offer). */
export const BAND_ILLUSTRATIONS: Record<string, string> = {
  bread: '🍞', apple: '🍎', carrot: '🥕', egg: '🥚', broccoli: '🥦', banana: '🍌', milk: '🥛',
  rice: '🍚', cheese: '🧀', tomato: '🍅', fish: '🐟', chicken: '🍗', gift: '🎁', cart: '🛒',
};

/** Motion timings shared with the staff previews. */
export const BAND_TIMING = {
  lineHold: 2800,
  lineOut: 200,
  lineIn: 220,
  waveStep: 220,
  waveRest: 1400,
  rideIn: 700,
  rideBob: 600,
  itemBob: 1300,
} as const;

/** Layout numbers (pt at the 390 pt design width). */
export const BAND_LAYOUT = {
  padX: 18, padTop: 14, padBottom: 16, scallop: 14, mascot: 74, mascotReserve: 84, itemReserve: 100,
  beamTop: 34, beamBottom: 96, beamRightWithMascot: 92, beamRightAlone: 14, item: 52, lineHeight: 18, fontSize: 14,
} as const;

export type BandItem = { kind: 'NONE' } | { kind: 'ILLUSTRATED'; emoji: string } | { kind: 'IMAGE'; uri: string };
export type BandLink =
  | { kind: 'aisle'; slug: string; name: string }
  | { kind: 'product'; id: string }
  | { kind: 'search' };

export interface PromoBandModel {
  /** The sliding headlines (one = static; none = no headline row). */
  lines: string[];
  ticks: string[];
  colors: { start: string; end: string; text: string };
  item: BandItem;
  mascot: 'WAVE' | 'RIDE' | 'OFF';
  link: BandLink | null;
}

/** The band's live copy before Admin / Ops write any (src/demo/homeLive.ts livePromo). */
export interface BandFallback { line1: string | null; fees: string[] }

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (xs: unknown): string[] =>
  Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];

/** Where a tap goes: a category or sub-category's aisle, a product page, or search for the whole catalog. */
export function bandLink(t: PromoTarget | null | undefined): BandLink | null {
  if (!t) return null;
  switch (t.level) {
    case 'CATEGORY':
      return t.slug ? { kind: 'aisle', slug: t.slug, name: t.name ?? '' } : null;
    case 'SUB_CATEGORY':
      // its parent's aisle, where the sub-category sits in the sidebar
      if (t.parent_slug) return { kind: 'aisle', slug: t.parent_slug, name: t.parent_name ?? t.name ?? '' };
      return t.slug ? { kind: 'aisle', slug: t.slug, name: t.name ?? '' } : null;
    case 'PRODUCT':
      return t.id ? { kind: 'product', id: t.id } : null;
    case 'MAIN':
    case 'CATALOG':
      return { kind: 'search' };
    default:
      return null;
  }
}

export function resolvePromoBand(config: PublicPromoBand | null | undefined, fallback: BandFallback): PromoBandModel | null {
  if (config === null) return null;
  const ownLines = fallback.line1 ? [fallback.line1] : [];
  if (!config) {
    return { lines: ownLines, ticks: fallback.fees, colors: { ...BAND_DEFAULT_COLORS }, item: { kind: 'NONE' }, mascot: 'WAVE', link: null };
  }
  const lines = clean(config.lines);
  const ticks = clean(config.ticks);
  const c = config.colors ?? BAND_DEFAULT_COLORS;
  const colors = HEX.test(c.start ?? '') && HEX.test(c.end ?? '') && HEX.test(c.text ?? '')
    ? { start: c.start, end: c.end, text: c.text }
    : { ...BAND_DEFAULT_COLORS };
  let item: BandItem = { kind: 'NONE' };
  const emoji = config.item?.illustration ? BAND_ILLUSTRATIONS[config.item.illustration] : undefined;
  if (config.item?.kind === 'ILLUSTRATED' && emoji) item = { kind: 'ILLUSTRATED', emoji };
  if (config.item?.kind === 'IMAGE' && config.item.image_url && /^https?:\/\//i.test(config.item.image_url)) {
    item = { kind: 'IMAGE', uri: config.item.image_url };
  }
  const mascot = config.mascot === 'RIDE' || config.mascot === 'OFF' ? config.mascot : 'WAVE';
  return {
    lines: lines.length ? lines : ownLines,
    ticks: ticks.length ? ticks : fallback.fees,
    colors,
    item,
    mascot,
    link: bandLink(config.cta_target),
  };
}

/** How wide the text column may be at a screen width (the mascot and the beam keep their room). */
export function bandTextWidth(screenW: number, m: Pick<PromoBandModel, 'item' | 'mascot'>): number {
  const L = BAND_LAYOUT;
  return Math.max(120, screenW - L.padX * 2 - (m.mascot !== 'OFF' ? L.mascotReserve : 0) - (m.item.kind !== 'NONE' ? L.itemReserve : 0));
}

/** Lines one headline row needs (1 or 2) so sliding between headlines never makes the band jump. */
export function bandHeadlineRows(lines: string[], textW: number): 1 | 2 {
  // Outfit SemiBold 14 averages ~6.9 pt per character; the check box and gap take 20.
  const perLine = Math.max(8, Math.floor((textW - 20) / 6.9));
  return lines.some((l) => l.length > perLine) ? 2 : 1;
}
