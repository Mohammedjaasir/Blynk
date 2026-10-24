import type { Product } from '../api/types';
import { isOfferActive, type PricedItem } from '../lib/pricing';
import { countdownText, endMs } from './homeSections';

/*
 * Flash deals (wave 2, 2026-10-25): a product offer (offer_price + offer_ends_at, the same offer staff
 * already set) that ends within the next 24 hours is a "flash deal". Customers see a live countdown on
 * the tile and on the product page, and Home gets an automatic "Flash deals" rail. There is no new
 * pricing: when the end arrives the offer simply stops applying (src/blynk/lib/pricing.ts). Pure code;
 * FlashDeals.tsx draws it, and src/blynk/promo/clock.ts is the one shared 1-second timer.
 */

/** An offer is a flash deal once it ends within this long (24 h). */
export const FLASH_WINDOW_MS = 24 * 3_600_000;
/** From here down the pill shows a ticking clock ("01:59:12"); above it, hours and minutes ("2h 10m"). */
export const FLASH_CLOCK_BELOW_MS = 2 * 3_600_000;
/** Under an hour left the pill turns urgent (red). */
export const FLASH_URGENT_MS = 3_600_000;
/** The Home rail shows at most this many deals, soonest first. */
export const FLASH_RAIL_MAX = 12;

/**
 * When the offer on this priced item ends, as epoch ms, while it is a flash deal right now: the offer
 * applies now AND ends within 24 h (an offer with no end date, or ending later, is not one). Null otherwise.
 */
export function flashEndMs(p: PricedItem, nowMs: number): number | null {
  if (!isOfferActive(p, new Date(nowMs))) return null;
  const end = endMs(p.offer_ends_at);
  if (end === null) return null;
  const left = end - nowMs;
  return left > 0 && left <= FLASH_WINDOW_MS ? end : null;
}

export const isFlashDeal = (p: PricedItem, nowMs: number) => flashEndMs(p, nowMs) !== null;

/**
 * "01:59:12" under two hours (whole seconds, rounded up like every countdown here), "2h 10m" from two
 * hours on (minutes round up too, so it never shows less than is left). Null when nothing is left.
 */
export function flashCountdown(remainingMs: number): string | null {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  if (remainingMs < FLASH_CLOCK_BELOW_MS) return countdownText(remainingMs);
  const totalMin = Math.ceil(remainingMs / 60_000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

/** The pill text: "Ends in 01:59:12" / "Ends in 2h 10m", or null once the time is up. */
export function flashPillText(endsAtMs: number, nowMs: number): string | null {
  const t = flashCountdown(endsAtMs - nowMs);
  return t === null ? null : `Ends in ${t}`;
}

/** Under an hour left (and still running): the pill turns red. */
export const flashUrgent = (endsAtMs: number, nowMs: number) => endsAtMs - nowMs > 0 && endsAtMs - nowMs < FLASH_URGENT_MS;

/** What a screen reader says: whole minutes, never the ticking seconds ("Ends in 1 hour 59 minutes"). */
export function flashSpeech(endsAtMs: number, nowMs: number): string | null {
  const left = endsAtMs - nowMs;
  if (!(left > 0)) return null;
  const min = Math.max(1, Math.ceil(left / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (h === 0) return `Ends in ${part(m, 'minute')}`;
  return m === 0 ? `Ends in ${part(h, 'hour')}` : `Ends in ${part(h, 'hour')} ${part(m, 'minute')}`;
}

/** The products that could become a flash deal: orderable, an offer with an end date. Cheap to keep; re-filtered by the clock. */
export function flashCandidates(products: readonly Product[] | null | undefined): Product[] {
  if (!products) return [];
  return products.filter((p) => p.is_available && p.offer_price != null && !!p.offer_ends_at);
}

export interface FlashRail {
  products: Product[];
  /** The soonest end among them (epoch ms), for the header countdown; null when there are none. */
  nearestEndMs: number | null;
}

/** The Home rail: orderable flash deals, soonest end first (ties keep catalogue order), at most 12. */
export function flashRail(candidates: readonly Product[], nowMs: number, limit: number = FLASH_RAIL_MAX): FlashRail {
  const seen = new Set<string>();
  const rows: { p: Product; end: number; i: number }[] = [];
  candidates.forEach((p, i) => {
    if (!p.is_available || seen.has(p.id)) return;
    const end = flashEndMs(p, nowMs);
    if (end === null) return;
    seen.add(p.id);
    rows.push({ p, end, i });
  });
  rows.sort((a, b) => a.end - b.end || a.i - b.i);
  const top = rows.slice(0, Math.max(0, limit));
  return { products: top.map((r) => r.p), nearestEndMs: top.length ? top[0].end : null };
}

/** The ids of the rail now, as one string: the clock re-renders the rail only when this changes. */
export const flashRailKey = (candidates: readonly Product[], nowMs: number) =>
  flashRail(candidates, nowMs).products.map((p) => p.id).join(',');
