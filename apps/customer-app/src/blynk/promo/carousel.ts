import type { Promotion } from '../api/types';
import { bandLink, type BandLink } from './promoBand';

/*
 * The promotion carousel's slide look and timings (docs/promo-surfaces.md §2). Pure, so it is
 * tested in Node; src/components/PromoCarousel.tsx draws it, and the Admin / Ops previews
 * follow the same numbers.
 */

export const CAROUSEL = {
  gutter: 15,
  height: 180,
  radius: 16,
  /** Safe text area, as in the spec. */
  safe: { left: 20, top: 20, bottom: 20, widthPct: 0.58 },
  foreground: { right: 12, maxWidthPct: 0.42, maxHeight: 150 },
  dots: { size: 6, active: 18, gap: 5, top: 10, on: '#1A1D2E', off: '#D5D6DD' },
  scrim: 'rgba(16,19,25,0.66)',
  hold: 4000,
  change: 450,
  resumeAfterTouch: 4000,
  enter: { textDelay: 120, text: 300, fgDelay: 160, fg: 420, ctaDelay: 260, cta: 240 },
} as const;

export type SlideBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string }
  | { kind: 'image'; uri: string; focalX: number; focalY: number; scrim: string }
  | { kind: 'artwork'; uri: string; focalX: number; focalY: number };

export interface SlideLook {
  background: SlideBackground;
  /** ARTWORK carries its own words: no title or subtitle is drawn. */
  showText: boolean;
  title: string;
  subtitle: string | null;
  titleColor: string;
  subtitleColor: string;
  /** The CTA pill's label, when one is drawn. */
  cta: string | null;
  /** Yellow pill on dark slides, ink pill on light ones (a yellow pill vanishes on a yellow card). */
  ctaColors: { bg: string; text: string };
  /** ARTWORK without a label: the whole card is the button. */
  wholeCardTap: boolean;
  foreground: string | null;
  link: BandLink | null;
}

/** The app's luminance check (< 0.45 = dark), as the staff previews use. */
export function isDarkHex(hex: string | null | undefined): boolean {
  if (!hex) return false;
  let v = hex.replace('#', '');
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  if (v.length === 8) v = v.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(v)) return false;
  const ch = (i: number) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4) < 0.45;
}

const pct = (n: unknown) => (typeof n === 'number' && n >= 0 && n <= 100 ? n : 50);

export function slideLook(p: Promotion): SlideLook {
  const img = p.background_image_url;
  let background: SlideBackground;
  if (p.background_type === 'ARTWORK' && img) {
    background = { kind: 'artwork', uri: img, focalX: pct(p.background_focal_x), focalY: pct(p.background_focal_y) };
  } else if (p.background_type === 'IMAGE' && img) {
    background = { kind: 'image', uri: img, focalX: pct(p.background_focal_x), focalY: pct(p.background_focal_y), scrim: CAROUSEL.scrim };
  } else if (p.background_type === 'GRADIENT' && p.background_color && p.background_color_end) {
    background = { kind: 'gradient', from: p.background_color, to: p.background_color_end };
  } else {
    background = { kind: 'solid', color: p.background_color ?? '#F1F4F9' };
  }
  const artwork = background.kind === 'artwork';
  const dark = background.kind === 'image' || isDarkHex(background.kind === 'gradient' ? background.from : background.kind === 'solid' ? background.color : null);
  const link = p.cta_destination_type ? bandLink(p.cta_target) ?? fallbackLink(p) : null;
  const label = p.cta_label?.trim() || null;
  return {
    background,
    showText: !artwork,
    title: p.title ?? '',
    subtitle: p.subtitle?.trim() || null,
    titleColor: dark ? '#FFFFFF' : '#12151F',
    subtitleColor: dark ? 'rgba(255,255,255,0.82)' : '#4B5364',
    cta: label && p.cta_destination_type ? label : null,
    ctaColors: dark || artwork ? { bg: '#FFE141', text: '#1A1D2E' } : { bg: '#1A1D2E', text: '#FFFFFF' },
    wholeCardTap: artwork && !label && !!link,
    foreground: artwork ? null : p.image_url,
    link,
  };
}

/** An older API without cta_target: the stored type and value. */
function fallbackLink(p: Promotion): BandLink | null {
  const v = p.cta_destination_value;
  if (p.cta_destination_type === 'CATEGORY' && v) return { kind: 'aisle', slug: v, name: p.title ?? '' };
  if (p.cta_destination_type === 'PRODUCT' && v) return { kind: 'product', id: v };
  if (p.cta_destination_type === 'CATALOG') return { kind: 'search' };
  return null;
}

/** Slides in carousel order: display_order ascending, ties as listed. */
export function carouselOrder<T extends Pick<Promotion, 'display_order'>>(rows: readonly T[]): T[] {
  return rows.map((r, i) => [r, i] as const).sort((a, b) => a[0].display_order - b[0].display_order || a[1] - b[1]).map(([r]) => r);
}

/** The next slide (forward, wrapping to the first after the last). */
export const nextSlide = (i: number, n: number) => (n <= 0 ? 0 : (i + 1) % n);
/** Auto-advance only with 2+ slides and motion allowed. */
export const autoAdvances = (n: number, reducedMotion: boolean) => n > 1 && !reducedMotion;
