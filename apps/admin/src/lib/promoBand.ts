import type {
  PromoBandBackground,
  PromoBandFields,
  PromoBandMascot,
  PromoBandTextColor,
} from '../api/types';

/*
 * Home promo band (owner, 2026-10-14: "make sure promotional banner edit
 * option like this animation in the ops and admin"). The palette, limits and
 * motion timings follow docs/promo-surfaces.md, which the customer app
 * (src/components/PromoBand.tsx) and the API (modules/configuration/
 * promo-band.ts) also follow - keep the four in step.
 */

export const BAND_BACKGROUNDS: Record<PromoBandBackground, { label: string; start: string; end: string }> = {
  YELLOW: { label: 'Blynk yellow', start: '#FFE141', end: '#F2C600' },
  YELLOW_SOFT: { label: 'Soft yellow', start: '#FFEFA0', end: '#FFE141' },
  CREAM: { label: 'Cream', start: '#FFF8D6', end: '#FFEFA0' },
  WHITE: { label: 'White', start: '#FFFFFF', end: '#F4F4F6' },
  INK: { label: 'Ink', start: '#1A1D2E', end: '#2A2E45' },
  GREEN: { label: 'Green', start: '#0C831F', end: '#0A6B19' },
};
export const BAND_BACKGROUND_KEYS = Object.keys(BAND_BACKGROUNDS) as PromoBandBackground[];

export const BAND_TEXT_COLORS: Record<PromoBandTextColor, { label: string; hex: string }> = {
  INK: { label: 'Ink', hex: '#1A1D2E' },
  WHITE: { label: 'White', hex: '#FFFFFF' },
  YELLOW: { label: 'Yellow', hex: '#FFE141' },
  BROWN: { label: 'Brown', hex: '#7A5F00' },
  GREEN: { label: 'Green', hex: '#0A6B19' },
};
export const BAND_TEXT_KEYS = Object.keys(BAND_TEXT_COLORS) as PromoBandTextColor[];

/** The illustrated items the beam can hold (the app draws the same emoji art). */
export const BAND_ILLUSTRATIONS: { key: string; label: string; emoji: string }[] = [
  { key: 'bread', label: 'Bread', emoji: '🍞' },
  { key: 'apple', label: 'Apple', emoji: '🍎' },
  { key: 'carrot', label: 'Carrot', emoji: '🥕' },
  { key: 'egg', label: 'Egg', emoji: '🥚' },
  { key: 'broccoli', label: 'Broccoli', emoji: '🥦' },
  { key: 'banana', label: 'Banana', emoji: '🍌' },
  { key: 'milk', label: 'Milk', emoji: '🥛' },
  { key: 'rice', label: 'Rice', emoji: '🍚' },
  { key: 'cheese', label: 'Cheese', emoji: '🧀' },
  { key: 'tomato', label: 'Tomato', emoji: '🍅' },
  { key: 'fish', label: 'Fish', emoji: '🐟' },
  { key: 'chicken', label: 'Chicken', emoji: '🍗' },
  { key: 'gift', label: 'Gift', emoji: '🎁' },
  { key: 'cart', label: 'Cart', emoji: '🛒' },
];

export const BAND_MASCOTS: { key: PromoBandMascot; label: string; hint: string }[] = [
  { key: 'WAVE', label: 'Rider waves', hint: 'The rider waves hello (the band as it is today)' },
  { key: 'RIDE', label: 'Rider rides in', hint: 'The rider drives in and bobs on the spot' },
  { key: 'OFF', label: 'No mascot', hint: 'More room for the words' },
];

export const BAND_LIMITS = { lines: 5, lineChars: 44, ticks: 3, tickChars: 24 } as const;

/** Motion timings (ms), as the app plays them. */
export const BAND_TIMING = { lineHold: 2800, lineOut: 200, lineIn: 220 } as const;

/** The app's own copy, shown while no headlines / points are set. */
export const BAND_APP_COPY = {
  lines: ['Free delivery on your first 2 orders'],
  ticks: ['No Platform Fee', 'No Packaging Fee'],
};

export const DEFAULT_BAND: PromoBandFields = {
  enabled: true,
  lines: [],
  ticks: [],
  background: 'YELLOW',
  text_color: null,
  item_kind: 'NONE',
  item_illustration: null,
  item_image_url: null,
  mascot: 'WAVE',
  cta_destination_type: null,
  cta_destination_value: null,
  starts_at: null,
  ends_at: null,
};

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const ch = (i: number) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Worst WCAG contrast of a text colour against both stops of a background. */
export function textContrast(bg: PromoBandBackground, text: PromoBandTextColor): number {
  const { start, end } = BAND_BACKGROUNDS[bg];
  const hex = BAND_TEXT_COLORS[text].hex;
  return Math.min(contrast(start, hex), contrast(end, hex));
}
export const readable = (bg: PromoBandBackground, text: PromoBandTextColor) => textContrast(bg, text) >= 4.5;
export const readableTextColors = (bg: PromoBandBackground) => BAND_TEXT_KEYS.filter((t) => readable(bg, t));
/** Automatic = the most readable colour on that background. */
export const autoTextColor = (bg: PromoBandBackground): PromoBandTextColor =>
  [...BAND_TEXT_KEYS].sort((a, b) => textContrast(bg, b) - textContrast(bg, a))[0]!;

export type BandStatus = 'LIVE' | 'OFF' | 'SCHEDULED' | 'ENDED';
export function bandStatus(b: Pick<PromoBandFields, 'enabled' | 'starts_at' | 'ends_at'>, now = new Date()): BandStatus {
  if (!b.enabled) return 'OFF';
  if (b.starts_at && now.getTime() < Date.parse(b.starts_at)) return 'SCHEDULED';
  if (b.ends_at && now.getTime() >= Date.parse(b.ends_at)) return 'ENDED';
  return 'LIVE';
}
export const BAND_STATUS_TEXT: Record<BandStatus, string> = {
  LIVE: 'Live in the app',
  OFF: 'Switched off',
  SCHEDULED: 'Scheduled - not showing yet',
  ENDED: 'Ended - no longer showing',
};

export type BandPreviewItem = { kind: 'NONE' } | { kind: 'ILLUSTRATED'; emoji: string } | { kind: 'IMAGE'; uri: string };
export interface BandPreviewModel {
  lines: string[];
  ticks: string[];
  colors: { start: string; end: string; text: string };
  item: BandPreviewItem;
  mascot: PromoBandMascot;
  /** Whether the words are the app's own (nothing set yet). */
  appCopy: { lines: boolean; ticks: boolean };
}

const clean = (xs: string[]) => xs.map((x) => x.trim()).filter((x) => x.length > 0);

/** What the app would draw for these (possibly unsaved) fields - the preview's input. */
export function bandPreviewModel(b: PromoBandFields): BandPreviewModel {
  const lines = clean(b.lines);
  const ticks = clean(b.ticks);
  const bg = BAND_BACKGROUNDS[b.background] ?? BAND_BACKGROUNDS.YELLOW;
  const text = b.text_color && readable(b.background, b.text_color) ? b.text_color : autoTextColor(b.background);
  const emoji = BAND_ILLUSTRATIONS.find((i) => i.key === b.item_illustration)?.emoji;
  const item: BandPreviewItem =
    b.item_kind === 'ILLUSTRATED' && emoji
      ? { kind: 'ILLUSTRATED', emoji }
      : b.item_kind === 'IMAGE' && b.item_image_url
        ? { kind: 'IMAGE', uri: b.item_image_url }
        : { kind: 'NONE' };
  return {
    lines: lines.length ? lines : BAND_APP_COPY.lines,
    ticks: ticks.length ? ticks : BAND_APP_COPY.ticks,
    colors: { start: bg.start, end: bg.end, text: BAND_TEXT_COLORS[text].hex },
    item,
    mascot: b.mascot,
    appCopy: { lines: lines.length === 0, ticks: ticks.length === 0 },
  };
}

/** The same checks the API makes, phrased for the form; null = fine. */
export function bandProblem(b: PromoBandFields): string | null {
  const lines = clean(b.lines);
  const ticks = clean(b.ticks);
  if (lines.length > BAND_LIMITS.lines) return `At most ${BAND_LIMITS.lines} headlines.`;
  if (lines.some((l) => l.length < 2)) return 'Each headline needs at least 2 characters.';
  if (lines.some((l) => l.length > BAND_LIMITS.lineChars)) return `Keep each headline to ${BAND_LIMITS.lineChars} characters.`;
  if (ticks.length > BAND_LIMITS.ticks) return `At most ${BAND_LIMITS.ticks} ticked points.`;
  if (ticks.some((l) => l.length < 2)) return 'Each ticked point needs at least 2 characters.';
  if (ticks.some((l) => l.length > BAND_LIMITS.tickChars)) return `Keep each ticked point to ${BAND_LIMITS.tickChars} characters.`;
  if (b.text_color && !readable(b.background, b.text_color)) {
    return `${BAND_TEXT_COLORS[b.text_color].label} text is hard to read on ${BAND_BACKGROUNDS[b.background].label.toLowerCase()}.`;
  }
  if (b.item_kind === 'ILLUSTRATED' && !b.item_illustration) return 'Choose the illustrated item.';
  if (b.item_kind === 'IMAGE' && !b.item_image_url) return 'Upload the item image.';
  if ((b.cta_destination_type === 'CATEGORY' || b.cta_destination_type === 'PRODUCT') && !b.cta_destination_value) {
    return b.cta_destination_type === 'CATEGORY' ? 'Choose the category the band opens.' : 'Choose the product the band opens.';
  }
  if (b.starts_at && b.ends_at && Date.parse(b.ends_at) <= Date.parse(b.starts_at)) return 'The end must be after the start.';
  return null;
}

/** The PATCH body: every editable field, trimmed. */
export function bandPayload(b: PromoBandFields): PromoBandFields {
  return { ...b, lines: clean(b.lines), ticks: clean(b.ticks) };
}

/** ISO -> the value of an <input type="datetime-local"> in this browser's time zone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** <input type="datetime-local"> value -> ISO (null when empty or invalid). */
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
