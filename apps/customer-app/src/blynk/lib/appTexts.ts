import type { PublicAppTexts, StoreInfo } from '../api/types';

/*
 * The app's own words with Admin / Ops' overrides (GET /store `app_texts`; owner, 2026-10-18:
 * "make sure each and everything was editable from the admin"). A word staff left blank is not
 * sent, so the built-in one stays. Pure.
 */

type TextKey = { [K in keyof PublicAppTexts]-?: PublicAppTexts[K] extends string | undefined ? K : never }[keyof PublicAppTexts];

/** Staff's word for `key`, else `fallback`. */
export function appText(store: StoreInfo | null | undefined, key: TextKey, fallback: string): string {
  const v = store?.app_texts?.[key];
  return typeof v === 'string' && v.trim() ? v : fallback;
}

/** Staff's list for `key` when it has lines, else `fallback`. */
export function appLines<T extends readonly string[]>(
  store: StoreInfo | null | undefined, key: 'home_aisle_lines' | 'login_headlines', fallback: T,
): readonly string[] {
  const v = store?.app_texts?.[key];
  return Array.isArray(v) && v.length ? v : fallback;
}

/** "Under LKR 300": staff's amount, else 300. */
export const UNDER_LKR_DEFAULT = 300;
export function underAmount(store: StoreInfo | null | undefined): number {
  const v = store?.app_texts?.home_under_amount;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : UNDER_LKR_DEFAULT;
}

const HEX = /^#[0-9a-f]{6}$/i;
type ColorKey = 'hero_bg_top' | 'hero_bg_bottom' | 'home_band_bg' | 'cart_header_bg' | 'cart_bar_bg' | 'cart_bar_strip_bg';

/** Staff's colour for a surface (owner, 2026-10-18: "even colors also editable"), else `fallback`. */
export function appColor(store: StoreInfo | null | undefined, key: ColorKey, fallback: string): string {
  const v = store?.app_texts?.[key];
  return typeof v === 'string' && HEX.test(v) ? v : fallback;
}

/** Ink or white, whichever reads on `hex` (so a dark colour picked in Admin keeps its words readable). */
export function inkOn(hex: string, ink = '#1A1D2E', light = '#FFFFFF'): string {
  if (!HEX.test(hex)) return ink;
  const ch = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return lum < 0.45 ? light : ink;
}

/** Staff's card colour for this aisle (category id), if set. */
export function aisleColor(store: StoreInfo | null | undefined, categoryId: string): string | null {
  const c = store?.app_texts?.aisle_colors?.[categoryId];
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
}
