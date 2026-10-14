/*
 * Pure layout and timing for the phone login's rider hero (src/components/LoginHero.tsx).
 * The hero takes whatever height the form leaves: a full scene (headline, rider, items) on a
 * normal phone, a single headline row when the keyboard is up or the window is very short, so
 * the number field and Continue always stay on screen.
 */

export const HERO = {
  /** Skip / back row under the status bar (a 48 pt target). */
  rowH: 48,
  /** The white form overlaps the hero's foot by this much (its rounded top). */
  overlap: 20,
  /** Below this the scene does not fit: one headline row instead. */
  minFull: 230,
  maxH: 500,
  /** Cap as a share of the window, so tall phones keep a calm amount of yellow. */
  maxShare: 0.58,
  /** Headline: hold, then slide up and out, and the next rises in. */
  headlineHoldMs: 3000,
  headlineOutMs: 220,
  headlineInMs: 300,
  /** Entrance (ms from the start): the rider rides in, stops, waves; the items pop round him. */
  rideMs: 900,
  itemsAt: 650,
  itemStagger: 70,
  waveAt: 980,
  /** Idle loop period: the items float once per period, the rider bobs twice. */
  idleMs: 2400,
} as const;

export type HeroLayout =
  | { mode: 'full'; heroH: number; overlap: number; headlineSize: number; lineH: number; sceneH: number; rider: number; item: number }
  | { mode: 'compact'; heroH: number; overlap: 0; headlineSize: number; lineH: number };

/**
 * @param height usable window height (keyboard already taken off)
 * @param formH  measured height of the form's content below the hero
 */
export function loginHeroLayout({ width, height, topInset, formH }: { width: number; height: number; topInset: number; formH: number }): HeroLayout {
  const head = topInset + HERO.rowH;
  const room = height - formH + HERO.overlap;
  const cap = Math.min(HERO.maxH, Math.round(height * HERO.maxShare));
  const heroH = Math.round(Math.min(cap, room));
  if (heroH < HERO.minFull + topInset) {
    // one row: [back] headline [skip]; the form starts square under it
    return { mode: 'compact', heroH: head + 6, overlap: 0, headlineSize: 17, lineH: 22 };
  }
  const headlineSize = width < 380 ? 24 : 27;
  const lineH = Math.round(headlineSize * 1.15);
  const sceneH = heroH - head - lineH * 2 - 4 - HERO.overlap;
  const rider = Math.round(Math.max(90, Math.min(sceneH * 0.82, width * 0.56, 240)));
  const item = Math.round(Math.max(22, Math.min(rider * 0.17, 32)));
  return { mode: 'full', heroH, overlap: HERO.overlap, headlineSize, lineH, sceneH, rider, item };
}

export const nextHeadline = (i: number, n: number): number => (n > 0 ? (i + 1) % n : 0);

/**
 * The grocery items round the rider (the home banner's illustrated set), as centre points in
 * fractions of the scene box, with a float phase so they never move in step.
 */
export const HERO_ITEMS = [
  { emoji: '🥛', x: 0.12, y: 0.30, phase: 0.0 },
  { emoji: '🍞', x: 0.13, y: 0.74, phase: 0.55 },
  { emoji: '🍎', x: 0.44, y: 0.10, phase: 0.25 },
  { emoji: '🥚', x: 0.86, y: 0.16, phase: 0.7 },
  { emoji: '🥦', x: 0.91, y: 0.52, phase: 0.4 },
  { emoji: '🍌', x: 0.89, y: 0.84, phase: 0.85 },
] as const;
