import type { Promotion } from '../api/types';

/*
 * The customer carousel's slide look and timings (docs/promo-surfaces.md §2),
 * as the new customer app draws them (src/blynk/promo/carousel.ts). The live
 * preview in the Promotions editor is built from this.
 */
export const CAROUSEL = {
  phoneWidth: 390,
  gutter: 15,
  height: 180,
  radius: 16,
  hold: 4000,
  change: 450,
  safeWidthPct: 0.58,
  scrim: 'rgba(16,19,25,0.66)',
} as const;

export type SlideBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string }
  | { kind: 'image'; uri: string; focalX: number; focalY: number }
  | { kind: 'artwork'; uri: string; focalX: number; focalY: number };

export interface SlideLook {
  background: SlideBackground;
  showText: boolean;
  title: string;
  subtitle: string | null;
  titleColor: string;
  subtitleColor: string;
  cta: string | null;
  /** Yellow pill on dark slides, ink pill on light ones (a yellow pill vanishes on a yellow card). */
  ctaColors: { bg: string; text: string };
  wholeCardTap: boolean;
  foreground: string | null;
}

/** The app's luminance check (< 0.45 = dark). */
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
    background = { kind: 'image', uri: img, focalX: pct(p.background_focal_x), focalY: pct(p.background_focal_y) };
  } else if (p.background_type === 'GRADIENT' && p.background_color && p.background_color_end) {
    background = { kind: 'gradient', from: p.background_color, to: p.background_color_end };
  } else {
    background = { kind: 'solid', color: p.background_color ?? '#F1F4F9' };
  }
  const artwork = background.kind === 'artwork';
  const dark =
    background.kind === 'image' ||
    isDarkHex(background.kind === 'gradient' ? background.from : background.kind === 'solid' ? background.color : null);
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
    wholeCardTap: artwork && !label && !!p.cta_destination_type,
    foreground: artwork ? null : p.image_url,
  };
}

/** Carousel order: display_order ascending, ties as listed. */
export function carouselOrder<T extends Pick<Promotion, 'display_order'>>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => [r, i] as const)
    .sort((a, b) => a[0].display_order - b[0].display_order || a[1] - b[1])
    .map(([r]) => r);
}

/**
 * The live carousel with the slide being edited in its place: the saved copy
 * is replaced by the draft (or the draft is added), hidden promotions are
 * left out - except the draft itself, so it can be watched in sequence.
 */
export function carouselWithDraft(rows: readonly Promotion[], draft: Promotion): Promotion[] {
  const others = rows.filter((r) => r.is_active && r.id !== draft.id);
  return carouselOrder([...others, draft]);
}
