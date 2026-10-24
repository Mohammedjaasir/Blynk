import type { Product, StoreInfo } from '../api/types';
import { localized } from '../i18n/localized';

/** The words the store-hours and delivery-fee lines are built from. */
export const STORE_TEXT = localized(
  {
    am: 'AM',
    pm: 'PM',
    daysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as string[],
    hoursVary: (today: string) => `${today} today (hours vary by day)`,
    everyDay: (range: string) => `${range}, every day`,
    radius: (km: number) => `Groceries delivered within ${km} km`,
    from: (amount: string) => `From ${amount}`,
    calculated: 'Calculated at checkout',
    today: 'today',
    reopens: (when: string, time: string) => `Reopens ${when}, ${time}`,
  },
  {
    si: {
      am: 'පෙ.ව.',
      pm: 'ප.ව.',
      daysShort: ['සඳු', 'අඟහ', 'බදා', 'බ්‍රහ', 'සිකු', 'සෙන', 'ඉරි'],
      hoursVary: (today: string) => `අද ${today} (දින අනුව වේලාවන් වෙනස් වේ)`,
      everyDay: (range: string) => `${range}, සෑම දිනකම`,
      radius: (km: number) => `කි.මී. ${km} ක් ඇතුළත සිල්ලර බඩු බෙදාහරිනවා`,
      from: (amount: string) => `${amount} සිට`,
      calculated: 'ඇණවුම් කරන විට ගණනය වේ',
      today: 'අද',
      reopens: (when: string, time: string) => `${when} ${time} ට නැවත විවෘත වේ`,
    },
    ta: {
      am: 'AM',
      pm: 'PM',
      daysShort: ['திங்', 'செவ்', 'புத', 'வியா', 'வெள்', 'சனி', 'ஞாயி'],
      hoursVary: (today: string) => `இன்று ${today} (நாளுக்கு ஏற்ப நேரம் மாறும்)`,
      everyDay: (range: string) => `${range}, தினமும்`,
      radius: (km: number) => `${km} கி.மீ.க்குள் மளிகைப் பொருட்கள் டெலிவரி`,
      from: (amount: string) => `${amount} முதல்`,
      calculated: 'ஆர்டர் செய்யும்போது கணக்கிடப்படும்',
      today: 'இன்று',
      reopens: (when: string, time: string) => `${when} ${time} க்கு மீண்டும் திறக்கும்`,
    },
  },
  'lib.STORE_TEXT',
);

/** "8 AM" / "9:30 PM" with the language's own AM and PM. */
const withMeridiem = (time: string) => time.replace(/AM$/, STORE_TEXT.am).replace(/PM$/, STORE_TEXT.pm);

/** "08:00" -> "8 AM", "21:30" -> "9:30 PM". Returns null for anything that is not HH:MM. */
export function formatClock(hhmm: string | undefined | null): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${m[2]}` : ''} ${h < 12 ? STORE_TEXT.am : STORE_TEXT.pm}`;
}

/** "8 AM – 9 PM" from the store's delivery hours, or null when the store has not loaded. */
export function formatHours(store: StoreInfo | null): string | null {
  const a = formatClock(store?.delivery_hours?.start), b = formatClock(store?.delivery_hours?.end);
  return a && b ? `${a} – ${b}` : null;
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The opening hours with their days, from the weekly schedule Admin / Ops set (owner,
 * 2026-10-21: a change there must show everywhere): "8 AM – 9 PM, every day", "8 AM – 9 PM,
 * Mon–Sat", or "8 AM – 9 PM today (hours vary by day)". Null while the store has not loaded.
 */
export function hoursSummary(store: StoreInfo | null): string | null {
  const today = formatHours(store);
  const days = store?.hours?.days;
  if (!days) return today;
  const open = WEEK.map((k, i) => ({ i, d: days[k] })).filter((x) => x.d && !x.d.closed);
  if (!open.length) return today;
  const first = open[0]!.d!;
  const uniform = open.every((x) => x.d!.open === first.open && x.d!.close === first.close);
  if (!uniform) return today ? `${today} today (hours vary by day)` : null;
  const range = `${formatClock(first.open) ?? first.open} – ${formatClock(first.close) ?? first.close}`;
  if (open.length === 7) return `${range}, every day`;
  const idx = open.map((x) => x.i);
  const run = idx.every((v, n) => n === 0 || v === idx[n - 1]! + 1);
  const DAY_SHORT = STORE_TEXT.daysShort;
  const dayText = run && idx.length > 2 ? `${DAY_SHORT[idx[0]!]}–${DAY_SHORT[idx[idx.length - 1]!]}` : idx.map((v) => DAY_SHORT[v]).join(', ');
  return `${range}, ${dayText}`;
}

/** "Groceries delivered within 4 km", or null when the radius is not known. */
export function radiusText(store: StoreInfo | null): string | null {
  const r = store?.radius_km;
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? STORE_TEXT.radius(r) : null;
}

export const formatOfferEnd = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Colombo' });

/** "Delivery fee: LKR 100" (flat) / null when the fee depends on the address or is unknown. */
export function flatFee(store: StoreInfo | null): number | null {
  return store?.delivery_fee_mode === 'FLAT' && typeof store.delivery_fee_lkr === 'number' && Number.isFinite(store.delivery_fee_lkr)
    ? store.delivery_fee_lkr
    : null;
}

/** Number of free deliveries on offer, or 0 when the switch is off. */
export function freeDeliveryCount(store: StoreInfo | null): number {
  const f = store?.new_customer_free_deliveries;
  return f?.enabled && typeof f.count === 'number' && f.count > 0 ? f.count : 0;
}

/**
 * Whether an offer's struck price and "Save LKR n" may show. Owner, 2026-10-18: "it should
 * enable always" - no longer reads Admin's show_offer_savings; an active offer always shows
 * what it saves - unless Admin / Ops switched "Show offer price cut" off for that product
 * (migration 050, the same day: "the admin can choose the option for offer price cut down to show").
 */
export function offerSavingsOn(store?: StoreInfo | null, product?: Pick<Product, 'show_offer_cut'> | null): boolean {
  return product?.show_offer_cut !== false;
}

/**
 * What the bill says for delivery: a plain number (the flat fee, or 0 while free deliveries
 * apply - no "FREE" wording; owner, 2026-10-16: "we are not giving free delivery, remove that
 * or replace with any other wordings"), or "Calculated at checkout" when the fee depends on the
 * address.
 */
export function deliveryFeeText(store: StoreInfo | null, format: (n: number) => string): string {
  if (freeDeliveryCount(store) > 0) return format(0);
  const flat = flatFee(store);
  if (flat != null) return format(flat);
  // per-km fees: the lowest one until the address is known (owner, 2026-10-19: "we have to show
  // case the delivery amount" instead of "Calculated at checkout")
  const from = store?.delivery_fee_from_lkr;
  return typeof from === 'number' && Number.isFinite(from) && from > 0 ? STORE_TEXT.from(format(from)) : STORE_TEXT.calculated;
}

/** "Reopens Tue, 8 AM" from next_open_at / reopens_at (shown in Sri Lanka time); null when unknown. */
export function reopensText(store: StoreInfo | null, now: Date = new Date()): string | null {
  const iso = store?.reopens_at ?? store?.next_open_at;
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const tz = 'Asia/Colombo';
  const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: tz });
  const time = withMeridiem(at.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', ''));
  const sameDay = day(at) === day(now);
  const enDay = at.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short' });
  const weekday = STORE_TEXT.daysShort[EN_DAYS.indexOf(enDay)] ?? enDay;
  return STORE_TEXT.reopens(sameDay ? STORE_TEXT.today : weekday, time);
}
