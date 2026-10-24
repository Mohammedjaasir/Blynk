import { DateTime } from 'luxon';

/**
 * The daily report text (owner, 2026-10-25). A PURE function over a snapshot of one Colombo day, so
 * every rule here is tested without a database (tests/daily-report-builder.test.ts); the numbers are
 * gathered by daily-report.data.ts.
 *
 * The text is plain GSM English - no emoji, no curly quotes, nothing that turns a 160-character SMS
 * into a 70-character Unicode one - and compact: at most REPORT_MAX_CHARS (480 = 3 parts of 153+).
 * The core line (date, orders, sales, cash, basket, new customers) always stays; the extras are
 * dropped from the end when the text would run over: tips, repeat orders, the rating, then fewer
 * product / low-stock names.
 */
export const REPORT_MAX_CHARS = 480;

export interface DailyReportSnapshot {
  /** The Colombo calendar day, YYYY-MM-DD. */
  date: string;
  orders_placed: number;
  orders_delivered: number;
  orders_cancelled: number;
  /** Delivered orders' revenue (reports revenueOf: the rider's cash tip is not Blynk's). */
  sales_lkr: number;
  cash_collected_lkr: number;
  /** sales / delivered orders; 0 with none delivered. */
  avg_basket_lkr: number;
  new_customers: number;
  top_products: { name: string; quantity: number }[];
  low_stock_count: number;
  low_stock_names: string[];
  /** Average of the stars given that day; null when nobody rated (or ratings are not set up yet). */
  avg_rating: number | null;
  ratings_count: number;
  repeat_orders: number;
  /** Rider tips on that day's delivered orders (cash + wallet); null = not available, 0 = none (left out). */
  tips_lkr: number | null;
}

const MARKS: [RegExp, string][] = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[–—−]/g, '-'],
  [/×/g, 'x'],
  [/…/g, '...'],
  [/[\r\n\t]+/g, ' '],
];

/**
 * Plain single-byte text: curly marks become straight ones, and anything outside printable ASCII
 * (Sinhala / Tamil names, emoji, euro) or the extended-table GSM characters ([ ] { } ^ ~ \ |, two
 * septets each) is dropped. "" when nothing is left.
 */
export function gsmSafe(text: string): string {
  let t = text;
  for (const [re, to] of MARKS) t = t.replace(re, to);
  return t
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[[\]{}^~\\|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 3)).trimEnd()}...` : s);

/** A name as it appears in the SMS: plain, at most `max` characters. */
function shortName(name: string, max: number): string {
  const safe = gsmSafe(name);
  return clip(safe || 'item', max);
}

/** 123456.6 -> "123,457" (whole rupees, thousands commas; no locale involved). */
export function lkr(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  const sign = v < 0 ? '-' : '';
  return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "Sat 25 Oct" for a Colombo date. */
export function dateLabel(date: string): string {
  const d = DateTime.fromISO(date, { zone: 'Asia/Colombo' }).setLocale('en');
  return d.isValid ? d.toFormat('ccc d LLL') : gsmSafe(date);
}

/** SMS parts for a plain GSM text: 160 characters in one, else 153 per part. */
export function smsParts(text: string): number {
  if (text.length === 0) return 0;
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

interface Shape {
  topN: number;
  lowN: number;
  rating: boolean;
  repeat: boolean;
  tips: boolean;
  nameMax: number;
}

function compose(s: DailyReportSnapshot, shape: Shape): string {
  const parts: string[] = [];
  parts.push(`Blynk ${dateLabel(s.date)}:`);
  parts.push(`Orders ${s.orders_placed} placed, ${s.orders_delivered} delivered, ${s.orders_cancelled} cancelled.`);
  parts.push(`Sales LKR ${lkr(s.sales_lkr)}.`);
  parts.push(`Cash LKR ${lkr(s.cash_collected_lkr)}.`);
  if (s.orders_delivered > 0) parts.push(`Avg basket LKR ${lkr(s.avg_basket_lkr)}.`);
  parts.push(`New customers ${s.new_customers}.`);
  const top = s.top_products.slice(0, shape.topN);
  if (top.length) parts.push(`Top: ${top.map((p) => `${shortName(p.name, shape.nameMax)} x${p.quantity}`).join(', ')}.`);
  if (s.low_stock_count > 0) {
    const names = s.low_stock_names.slice(0, shape.lowN).map((n) => shortName(n, shape.nameMax));
    parts.push(`Low stock ${s.low_stock_count}${names.length ? ` (${names.join(', ')})` : ''}.`);
  }
  if (shape.rating && s.avg_rating !== null && s.ratings_count > 0) parts.push(`Rating ${s.avg_rating.toFixed(1)} (${s.ratings_count}).`);
  if (shape.repeat && s.repeat_orders > 0) parts.push(`Repeat orders ${s.repeat_orders}.`);
  if (shape.tips && s.tips_lkr !== null && s.tips_lkr > 0) parts.push(`Tips LKR ${lkr(s.tips_lkr)}.`);
  return parts.join(' ');
}

/** From the fullest text to the barest: the first that fits wins. */
const SHAPES: Shape[] = [
  { topN: 3, lowN: 3, rating: true, repeat: true, tips: true, nameMax: 18 },
  { topN: 3, lowN: 3, rating: true, repeat: true, tips: false, nameMax: 18 },
  { topN: 3, lowN: 3, rating: true, repeat: false, tips: false, nameMax: 18 },
  { topN: 3, lowN: 3, rating: false, repeat: false, tips: false, nameMax: 14 },
  { topN: 3, lowN: 2, rating: false, repeat: false, tips: false, nameMax: 12 },
  { topN: 2, lowN: 1, rating: false, repeat: false, tips: false, nameMax: 10 },
  { topN: 1, lowN: 0, rating: false, repeat: false, tips: false, nameMax: 10 },
  { topN: 0, lowN: 0, rating: false, repeat: false, tips: false, nameMax: 10 },
];

/** The SMS text for a day. Never longer than REPORT_MAX_CHARS. */
export function buildDailyReport(snapshot: DailyReportSnapshot): string {
  let text = '';
  for (const shape of SHAPES) {
    text = compose(snapshot, shape);
    if (text.length <= REPORT_MAX_CHARS) return text;
  }
  return clip(text, REPORT_MAX_CHARS);
}
