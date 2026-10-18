/*
 * App texts (owner, 2026-10-18: "make sure each and everything was editable from the admin"):
 * the customer app's other words and Home's aisle colours, GET|PATCH /admin/settings/app-texts.
 * Blank = the app's own words (shown as the placeholder). Limits match the backend
 * (backend/api/src/modules/configuration/app-texts.ts).
 */

export type AppTextKey =
  | 'home_explore_title' | 'home_aisle_offer' | 'home_band_kicker' | 'home_band_title_offers' | 'home_band_title_aisles'
  | 'home_footer_title' | 'home_footer_sub' | 'aisle_banner_title' | 'aisle_banner_sub'
  | 'cart_header_pill' | 'cart_burst_top' | 'cart_burst_bottom' | 'cart_burst_big' | 'cart_burst_line_1' | 'cart_burst_line_2'
  | 'cart_bar_line' | 'cart_basket_title' | 'cart_bill_note' | 'pay_online_coming_soon' | 'placed_title' | 'placed_sub';

/** Surface colours (owner, 2026-10-18: "even colors also editable"); '' = the app's own. */
export type AppColorKey = 'hero_bg_top' | 'hero_bg_bottom' | 'home_band_bg' | 'cart_header_bg' | 'cart_bar_bg' | 'cart_bar_strip_bg';
export const APP_COLORS: { key: AppColorKey; label: string; builtIn: string }[] = [
  { key: 'hero_bg_top', label: 'Home banner, top (also the Home header)', builtIn: '#2E0C66' },
  { key: 'hero_bg_bottom', label: 'Home banner, bottom', builtIn: '#3A1380' },
  { key: 'home_band_bg', label: 'Home offers band', builtIn: '#FFF8D6' },
  { key: 'cart_header_bg', label: 'Cart header', builtIn: '#FFE141' },
  { key: 'cart_bar_bg', label: 'Cart bar', builtIn: '#FFE141' },
  { key: 'cart_bar_strip_bg', label: 'Cart bar strip', builtIn: '#F2C600' },
];

export type AppTextsFields = Record<AppTextKey, string> & Record<AppColorKey, string> & {
  home_aisle_lines: string[];
  login_headlines: string[];
  home_under_amount: number | null;
  aisle_colors: Record<string, string>;
};
export type AppTextsSetting = AppTextsFields & { updated_at: string | null };

export interface AppTextDef {
  key: AppTextKey;
  label: string;
  /** The app's own words, used while the field is blank. */
  builtIn: string;
  max: number;
  hint?: string;
}

export const APP_TEXT_SECTIONS: { title: string; note: string; fields: AppTextDef[] }[] = [
  {
    title: 'Home',
    note: 'The headings and lines on the customer app\'s Home.',
    fields: [
      { key: 'home_explore_title', label: 'Aisles heading', builtIn: 'Explore all aisles', max: 32 },
      { key: 'home_aisle_offer', label: 'Aisle card offer line', builtIn: '{percent}% off everything here', max: 40, hint: 'Shown while a category offer runs. {percent} becomes the offer, e.g. 10.' },
      { key: 'home_band_kicker', label: 'Offers band small line', builtIn: 'Fresh picks, great prices', max: 36 },
      { key: 'home_band_title_offers', label: 'Offers band title (offers running)', builtIn: 'OFFER PRICES TODAY', max: 24 },
      { key: 'home_band_title_aisles', label: 'Offers band title (no offers)', builtIn: 'SHOP BY AISLE', max: 24 },
      { key: 'home_footer_title', label: 'Footer small line', builtIn: 'Fresh groceries delivered', max: 36 },
      { key: 'home_footer_sub', label: 'Footer big line', builtIn: 'to your door in Dharga Town', max: 48 },
    ],
  },
  {
    title: 'Aisle screen',
    note: 'The highlighted row at the top of an aisle when it has no offer (and points are off).',
    fields: [
      { key: 'aisle_banner_title', label: 'Row title', builtIn: 'QUALITY YOU CAN TRUST', max: 32 },
      { key: 'aisle_banner_sub', label: 'Row line', builtIn: 'Fresh picks, every day', max: 40 },
    ],
  },
  {
    title: 'Cart',
    note: 'The yellow header at the top of the cart (a pill, then two animated slides), the strip on the cart bar, and the cart\'s own lines.',
    fields: [
      { key: 'cart_header_pill', label: 'Header pill', builtIn: 'Fresh groceries, every day', max: 36 },
      { key: 'cart_burst_top', label: 'Slide 1, top line', builtIn: 'FRESH GROCERIES', max: 20 },
      { key: 'cart_burst_bottom', label: 'Slide 1, bottom line', builtIn: 'EVERY DAY', max: 20 },
      { key: 'cart_burst_big', label: 'Slide 2, big word', builtIn: 'FRESH', max: 10 },
      { key: 'cart_burst_line_1', label: 'Slide 2, line 1', builtIn: 'Groceries', max: 20 },
      { key: 'cart_burst_line_2', label: 'Slide 2, line 2', builtIn: 'Every day', max: 20 },
      { key: 'cart_bar_line', label: 'Cart bar strip', builtIn: 'Great picks, every time!', max: 36 },
      { key: 'cart_basket_title', label: 'Suggestions title', builtIn: 'COMPLETE YOUR BASKET', max: 28 },
      { key: 'cart_bill_note', label: 'Bill note', builtIn: 'No packaging or platform fee.', max: 48 },
      { key: 'pay_online_coming_soon', label: '"Pay online" note while it is off', builtIn: 'Coming soon', max: 32 },
    ],
  },
  {
    title: 'Order placed',
    note: 'The screen after a customer places an order.',
    fields: [
      { key: 'placed_title', label: 'Headline', builtIn: 'Order placed!', max: 28 },
      { key: 'placed_sub', label: 'Line under it', builtIn: 'Your Blynk order is being packed', max: 48 },
    ],
  },
];

export const APP_TEXT_LISTS = {
  home_aisle_lines: {
    label: 'Aisle card lines',
    max: 8,
    chars: 36,
    note: 'Each aisle card shows two lines, taken in order (card 1 gets lines 1 and 2, card 2 lines 3 and 4, ...). Leave empty for the app\'s own.',
    builtIn: ['Freshly stocked, daily', 'Great quality, honest prices', 'Carefully selected items', 'Shop with confidence'],
  },
  login_headlines: {
    label: 'Login screen headlines',
    max: 5,
    chars: 28,
    note: 'They take turns on the sign-in screen, about 3 s each. Leave empty for the app\'s own.',
    builtIn: ['Fresh to your door', 'Dharga Town in minutes', 'Groceries, delivered fast'],
  },
} as const;

export const UNDER_AMOUNT = { min: 50, max: 100_000, builtIn: 300 } as const;

const TEXT_KEYS: AppTextKey[] = APP_TEXT_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
const COLOR_KEYS: AppColorKey[] = APP_COLORS.map((c) => c.key);
const ALL_KEYS: (AppTextKey | AppColorKey)[] = [...TEXT_KEYS, ...COLOR_KEYS];

export const EMPTY_APP_TEXTS: AppTextsFields = {
  ...(Object.fromEntries(ALL_KEYS.map((k) => [k, ''])) as Record<AppTextKey | AppColorKey, string>),
  home_aisle_lines: [],
  login_headlines: [],
  home_under_amount: null,
  aisle_colors: {},
};

export function appTextsFieldsOf(s: Partial<AppTextsFields>): AppTextsFields {
  return {
    ...EMPTY_APP_TEXTS,
    ...(Object.fromEntries(ALL_KEYS.map((k) => [k, typeof s[k] === 'string' ? s[k] : ''])) as Record<AppTextKey | AppColorKey, string>),
    home_aisle_lines: Array.isArray(s.home_aisle_lines) ? s.home_aisle_lines : [],
    login_headlines: Array.isArray(s.login_headlines) ? s.login_headlines : [],
    home_under_amount: typeof s.home_under_amount === 'number' ? s.home_under_amount : null,
    aisle_colors: s.aisle_colors && typeof s.aisle_colors === 'object' ? s.aisle_colors : {},
  };
}

/** What PATCH sends: trimmed words, lists without blank lines. */
export function appTextsPayload(d: AppTextsFields): AppTextsFields {
  return {
    ...(Object.fromEntries(ALL_KEYS.map((k) => [k, d[k].trim()])) as Record<AppTextKey | AppColorKey, string>),
    home_aisle_lines: d.home_aisle_lines.map((l) => l.trim()).filter(Boolean),
    login_headlines: d.login_headlines.map((l) => l.trim()).filter(Boolean),
    home_under_amount: d.home_under_amount,
    aisle_colors: d.aisle_colors,
  };
}

/** The first problem with the draft, or null. */
export function appTextsProblem(d: AppTextsFields): string | null {
  for (const s of APP_TEXT_SECTIONS) {
    for (const f of s.fields) {
      const v = d[f.key].trim();
      if (v.length > f.max) return `${f.label}: at most ${f.max} characters.`;
    }
  }
  const u = d.home_under_amount;
  if (u !== null && (!Number.isInteger(u) || u < UNDER_AMOUNT.min || u > UNDER_AMOUNT.max)) {
    return `The "Under LKR" amount must be a whole number from ${UNDER_AMOUNT.min} to ${UNDER_AMOUNT.max}.`;
  }
  return null;
}
