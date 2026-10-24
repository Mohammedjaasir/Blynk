/**
 * Flash deals (wave 2, 2026-10-25): a product's existing offer (offer_price + offer_ends_at) that ends
 * within 24 hours. The customer app shows a live countdown on it and lists it in the Home "Flash deals"
 * rail. Staff start one from the product row / form: a price and how long it runs (1 h, 2 h, 4 h, until
 * closing time, or a custom number of minutes); "End now" clears the offer. It goes through the ordinary
 * product update (PATCH /admin/products/:id), so the server's offer rules stay the authority: the offer
 * must be below the selling price and the end in the future. Pure code (the dialog draws it).
 * A copy of this file lives in apps/operations/src/lib/flashDeal.ts (no cross-app imports): keep them in step.
 */

const MIN = 60_000;
const COLOMBO_OFFSET_MS = 330 * MIN; // Asia/Colombo is UTC+05:30 all year

/** A flash deal runs at most this long (it is "ending within 24 h" for customers). */
export const FLASH_MAX_MINUTES = 24 * 60;
/** Shortest run staff can pick (a shorter one would be gone before it is seen). */
export const FLASH_MIN_MINUTES = 5;

export type FlashDurationId = '1h' | '2h' | '4h' | 'closing' | 'custom';

export const FLASH_DURATIONS: ReadonlyArray<{ id: FlashDurationId; label: string; minutes: number | null }> = [
  { id: '1h', label: '1 hour', minutes: 60 },
  { id: '2h', label: '2 hours', minutes: 120 },
  { id: '4h', label: '4 hours', minutes: 240 },
  { id: 'closing', label: 'Until closing time', minutes: null },
  { id: 'custom', label: 'Custom', minutes: null },
];

/** The parts of a product these helpers read (AdminProduct has all of them). */
export interface FlashProductLike {
  calculated_selling_price?: number | string | null;
  selling_price?: number | string | null;
  offer_price?: number | string | null;
  offer_ends_at?: string | null;
  offer_active?: boolean;
  has_variants?: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `LKR ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The regular price the flash price must beat (the server's capped selling price); null when unknown. */
export function flashSellingPrice(p: FlashProductLike): number | null {
  const raw = p.calculated_selling_price ?? p.selling_price;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

/** A product sold in sizes has its offers per size, so the quick action is for single-price products. */
export const canStartFlash = (p: FlashProductLike) => !p.has_variants && flashSellingPrice(p) !== null;

/** The flash price as typed: above 0, at most 2 decimals, lower than the selling price. */
export function parseFlashPrice(text: string, selling: number | null): { value: number } | { error: string } {
  const t = text.trim();
  if (t === '') return { error: 'Enter the flash price.' };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: 'Enter a price above 0 with at most 2 decimals.' };
  const value = Number(t);
  if (!(value > 0)) return { error: 'Enter a price above 0 with at most 2 decimals.' };
  if (selling === null) return { error: 'The selling price is not known yet. Set the product price first.' };
  if (!(value < selling)) return { error: `The flash price must be lower than the selling price (${money(selling)}).` };
  return { value: round2(value) };
}

/** Custom length in minutes, 5 to 1440 (24 hours), whole numbers. */
export function parseCustomMinutes(text: string): { minutes: number } | { error: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return { error: `Enter the minutes, ${FLASH_MIN_MINUTES} to ${FLASH_MAX_MINUTES}.` };
  const minutes = Number(t);
  if (minutes < FLASH_MIN_MINUTES || minutes > FLASH_MAX_MINUTES) {
    return { error: `Pick between ${FLASH_MIN_MINUTES} minutes and 24 hours (${FLASH_MAX_MINUTES} minutes).` };
  }
  return { minutes };
}

/**
 * Today's closing time (Colombo) as an ISO instant, from the store schedule's status.today_hours, or
 * null when the store has no hours today or closing has passed / is under the minimum away.
 */
export function closingTimeIso(todayHours: { close: string } | null | undefined, now: Date = new Date()): string | null {
  if (!todayHours || !/^\d{2}:\d{2}$/.test(todayHours.close)) return null;
  const dayKey = new Date(now.getTime() + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
  const at = Date.parse(`${dayKey}T${todayHours.close}:00.000Z`) - COLOMBO_OFFSET_MS;
  return Number.isFinite(at) && at - now.getTime() >= FLASH_MIN_MINUTES * MIN ? new Date(at).toISOString() : null;
}

/** When the deal ends for the chosen length, as an ISO instant, or what is wrong. */
export function flashEndsAt(
  choice: FlashDurationId,
  now: Date,
  opts: { closingIso?: string | null; customMinutes?: string } = {},
): { iso: string } | { error: string } {
  if (choice === 'closing') {
    return opts.closingIso
      ? { iso: opts.closingIso }
      : { error: 'There is no closing time left today. Pick a length instead.' };
  }
  let minutes: number;
  if (choice === 'custom') {
    const parsed = parseCustomMinutes(opts.customMinutes ?? '');
    if ('error' in parsed) return parsed;
    minutes = parsed.minutes;
  } else {
    minutes = FLASH_DURATIONS.find((d) => d.id === choice)?.minutes ?? 60;
  }
  return { iso: new Date(now.getTime() + minutes * MIN).toISOString() };
}

/** "1h 59m" / "45m" / "2d 3h" for a span: how long is left, kept short. */
export function leftText(ms: number): string {
  if (!(ms > 0)) return '0m';
  const totalMin = Math.max(1, Math.ceil(ms / MIN));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Colombo clock time of an instant: "6 PM", "4:30 PM". */
export function clockText(iso: string): string {
  const c = new Date(Date.parse(iso) + COLOMBO_OFFSET_MS);
  const h = c.getUTCHours();
  const m = c.getUTCMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export interface FlashPreview {
  /** What the customer pays: "LKR 220.00". */
  price: string;
  /** The struck regular price: "LKR 250.00". */
  was: string;
  /** "12% off" (whole percent, at least 1). */
  percent: string;
  /** The pill customers see on the tile. */
  endsIn: string;
  /** "until today 6 PM". */
  until: string;
}

/** What the customer sees for this price and end (the app's tile: price, struck price, "Ends in ..."). */
export function flashPreview(price: number, selling: number, endsAtIso: string, now: Date): FlashPreview {
  const percent = Math.max(1, Math.round((1 - price / selling) * 100));
  const left = Date.parse(endsAtIso) - now.getTime();
  const dayDiff = Math.floor((Date.parse(endsAtIso) + COLOMBO_OFFSET_MS) / 86_400_000) - Math.floor((now.getTime() + COLOMBO_OFFSET_MS) / 86_400_000);
  const day = dayDiff <= 0 ? 'today' : dayDiff === 1 ? 'tomorrow' : 'in 2 days';
  return {
    price: money(price),
    was: money(selling),
    percent: `${percent}% off`,
    endsIn: `Ends in ${leftText(left)}`,
    until: `until ${day} ${clockText(endsAtIso)}`,
  };
}

/** The product update that starts (or restarts) the deal. */
export const startPayload = (price: number, endsAtIso: string) => ({ offer_price: price, offer_ends_at: endsAtIso });

/** "End now": clearing the offer price clears its end too (the API does both). */
export const endNowPayload = () => ({ offer_price: null, offer_ends_at: null });

/** The end (epoch ms) while this product's offer applies now and ends within 24 h, else null. */
export function flashEndOf(p: FlashProductLike, now: Date = new Date()): number | null {
  if (p.offer_price === null || p.offer_price === undefined || !p.offer_ends_at) return null;
  if (p.offer_active === false) return null;
  const end = Date.parse(p.offer_ends_at);
  const left = end - now.getTime();
  return Number.isFinite(end) && left > 0 && left <= FLASH_MAX_MINUTES * MIN ? end : null;
}

export const isFlashRunning = (p: FlashProductLike, now: Date = new Date()) => flashEndOf(p, now) !== null;

/** The running flash deals of a product list, soonest end first. */
export function runningFlashDeals<T extends FlashProductLike>(list: readonly T[], now: Date = new Date()): T[] {
  return list
    .map((p, i) => ({ p, end: flashEndOf(p, now), i }))
    .filter((r): r is { p: T; end: number; i: number } => r.end !== null)
    .sort((a, b) => a.end - b.end || a.i - b.i)
    .map((r) => r.p);
}

/** A row's tag: "Flash · 1h 59m left (ends 6 PM)". */
export function flashRowText(p: FlashProductLike, now: Date = new Date()): string | null {
  const end = flashEndOf(p, now);
  return end === null ? null : `Flash deal · ${leftText(end - now.getTime())} left (ends ${clockText(new Date(end).toISOString())})`;
}
