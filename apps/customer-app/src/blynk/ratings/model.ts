import { formatLkr } from '@/blynk/lib/money';
import type { Order } from '@/blynk/orders/types';
import { RATING_WORDS, TAG_LABELS, TIP_COPY } from './words';

export { TIP_COPY };

/*
 * Order ratings and rider tips (migration 055; docs/superpowers/plans/2026-10-24-groups-ratings-requests.md §B).
 * One rating per DELIVERED order by its customer, within 14 days of delivery, changeable for 24 h:
 * POST/GET /orders/:id/rating { stars, tags?, comment? }. A tip at checkout (`rider_tip_lkr`, cash with
 * the order) or, after delivery and only if there is no tip yet, from the Blynk Wallet
 * (POST /orders/:id/tip { amount_lkr }). The server decides everything again; this is what the app
 * shows and sends. No React here.
 */

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { const x = Number(v.trim()); return Number.isFinite(x) ? x : 0; }
  return 0;
};
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- tags

export const RATING_TAGS = ['ON_TIME', 'LATE', 'FRIENDLY_RIDER', 'RUDE_RIDER', 'FRESH', 'DAMAGED', 'MISSING_ITEM', 'WRONG_ITEM', 'GOOD_PACKING'] as const;
export type RatingTag = (typeof RATING_TAGS)[number];

/** The contract's tags in the customer's words (the label follows the language: read it while rendering). */
const tagCopy = (tag: RatingTag, emoji: string, good: boolean) => ({ emoji, good, get label(): string { return TAG_LABELS[tag]; } });
export const TAG_COPY: Record<RatingTag, { label: string; emoji: string; good: boolean }> = {
  ON_TIME: tagCopy('ON_TIME', '⏱️', true),
  FRIENDLY_RIDER: tagCopy('FRIENDLY_RIDER', '😊', true),
  FRESH: tagCopy('FRESH', '🥬', true),
  GOOD_PACKING: tagCopy('GOOD_PACKING', '📦', true),
  LATE: tagCopy('LATE', '🐢', false),
  RUDE_RIDER: tagCopy('RUDE_RIDER', '😕', false),
  DAMAGED: tagCopy('DAMAGED', '💔', false),
  MISSING_ITEM: tagCopy('MISSING_ITEM', '🔍', false),
  WRONG_ITEM: tagCopy('WRONG_ITEM', '🔄', false),
};

export const GOOD_TAGS: RatingTag[] = ['ON_TIME', 'FRIENDLY_RIDER', 'FRESH', 'GOOD_PACKING'];
export const PROBLEM_TAGS: RatingTag[] = ['LATE', 'MISSING_ITEM', 'WRONG_ITEM', 'DAMAGED', 'RUDE_RIDER'];

export const isRatingTag = (t: unknown): t is RatingTag => typeof t === 'string' && (RATING_TAGS as readonly string[]).includes(t);

/** The chips offered for a star count: 4-5 what went well, 1-2 what went wrong, 3 both (problems first). */
export function tagsFor(stars: number): RatingTag[] {
  if (!validStars(stars)) return [];
  if (stars >= 4) return GOOD_TAGS;
  if (stars <= 2) return PROBLEM_TAGS;
  return [...PROBLEM_TAGS, ...GOOD_TAGS];
}

/** After the stars change: only the picked tags still offered stay. */
export function keepTags(tags: readonly RatingTag[], stars: number): RatingTag[] {
  const offered = tagsFor(stars);
  return tags.filter((t) => offered.includes(t));
}

export function toggleTag(tags: readonly RatingTag[], tag: RatingTag): RatingTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/** The word under the stars. */
export const starWord = (stars: number): string => RATING_WORDS.starWords[validStars(stars) ? stars : 0];

export const validStars = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;

// ---------------------------------------------------------------- the rating

export const COMMENT_MAX = 500;
export const RATE_WINDOW_DAYS = 14;
export const EDIT_WINDOW_HOURS = 24;

export interface RatingBody { stars: number; tags?: RatingTag[]; comment?: string }

/** What POST /orders/:id/rating gets: null while no star is picked. Tags deduped, the comment trimmed and capped. */
export function ratingBody(input: { stars: number; tags?: readonly RatingTag[]; comment?: string | null }): RatingBody | null {
  if (!validStars(input.stars)) return null;
  const tags = [...new Set(keepTags((input.tags ?? []).filter(isRatingTag), input.stars))];
  const comment = (input.comment ?? '').trim().slice(0, COMMENT_MAX);
  return { stars: input.stars, ...(tags.length ? { tags } : {}), ...(comment ? { comment } : {}) };
}

export interface OrderRating {
  stars: number;
  tags: RatingTag[];
  comment: string | null;
  createdAt: Date | null;
  /** When it can no longer be changed (the server's, else created + 24 h). */
  editableUntil: Date | null;
}

/** One rating row from the API (unknown tags dropped); null when there is none. */
export function parseRating(raw: unknown): OrderRating | null {
  const r = obj(raw);
  if (!r) return null;
  const stars = num(r.stars);
  if (!validStars(stars)) return null;
  const createdAt = date(r.created_at) ?? date(r.updated_at);
  const until = date(r.editable_until) ?? date(r.can_edit_until) ?? (createdAt ? new Date(createdAt.getTime() + EDIT_WINDOW_HOURS * HOUR) : null);
  const comment = typeof r.comment === 'string' && r.comment.trim() ? r.comment.trim() : null;
  return { stars, tags: Array.isArray(r.tags) ? r.tags.filter(isRatingTag) : [], comment, createdAt, editableUntil: until };
}

export interface RatingAnswer {
  rating: OrderRating | null;
  /** A tip already on the order (at checkout or from the wallet), in LKR; 0 = none. */
  tip: number;
}

/** GET / POST /orders/:id/rating data: `{ rating }` (or the row itself), with the order's tip when sent. */
export function parseRatingAnswer(raw: unknown): RatingAnswer {
  const d = obj(raw);
  if (!d) return { rating: null, tip: 0 };
  const rating = 'rating' in d ? parseRating(d.rating) : parseRating(d);
  const tipObj = obj(d.tip);
  const tip = Math.max(0, num(tipObj ? tipObj.amount_lkr ?? tipObj.amount : d.tip ?? d.tip_lkr ?? d.rider_tip ?? d.rider_tip_lkr));
  return { rating, tip };
}

/** When the order was delivered: the delivery row, the order's own field, else its history. */
export function deliveredAt(order: Pick<Order, 'delivery' | 'history'> & { delivered_at?: string | null }): Date | null {
  return date(order.delivery?.delivered_at) ?? date(order.delivered_at)
    ?? date([...(order.history ?? [])].reverse().find((h) => h.new_status === 'DELIVERED')?.created_at);
}

/** A new rating is still taken: DELIVERED and (when the time is known) within 14 days. */
export function canRate(order: Pick<Order, 'order_status' | 'delivery' | 'history'> & { delivered_at?: string | null }, now: Date = new Date()): boolean {
  if (order.order_status !== 'DELIVERED') return false;
  const at = deliveredAt(order);
  return !at || now.getTime() - at.getTime() <= RATE_WINDOW_DAYS * DAY;
}

export const canEditRating = (r: OrderRating | null, now: Date = new Date()): boolean =>
  !!r && !!r.editableUntil && now.getTime() < r.editableUntil.getTime();

/**
 * What the card shows: nothing (not delivered, or too late to rate and never rated), the stars to
 * ask, or the rating given (changeable for 24 h).
 */
export type RatingStage = 'hidden' | 'ask' | 'rated-editable' | 'rated';
export function ratingStage(order: Parameters<typeof canRate>[0], rating: OrderRating | null, now: Date = new Date()): RatingStage {
  if (order.order_status !== 'DELIVERED') return 'hidden';
  if (rating) return canEditRating(rating, now) ? 'rated-editable' : 'rated';
  return canRate(order, now) ? 'ask' : 'hidden';
}

// ---------------------------------------------------------------- tips

/** After delivery, from the Blynk Wallet. */
export const WALLET_TIP_OPTIONS = [50, 100, 200] as const;
/** The most a tip can be (custom at checkout). */
export const TIP_MAX = 1000;

/** The tip on the order (`rider_tip`, NUMERIC: a number or a string), 0 when none. */
export function riderTipOf(order: unknown): number {
  const o = obj(order);
  if (!o) return 0;
  return Math.max(0, Math.round(num(o.rider_tip ?? o.rider_tip_lkr) * 100) / 100);
}

/** The wallet tips this customer can give: none once tipped, while the wallet is off, or above the balance. */
export function walletTipChoices(wallet: { enabled: boolean; balance: number } | null, alreadyTipped: number): number[] {
  if (!wallet || !wallet.enabled || alreadyTipped > 0) return [];
  return WALLET_TIP_OPTIONS.filter((a) => a <= wallet.balance + 1e-6);
}

/** checkout-info `tip_options`: whole LKR amounts 1..1000, deduped and sorted; [] = tips are off (or an older server). */
export function checkoutTipOptions(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const list = raw.map(num).filter((n) => Number.isInteger(n) && n > 0 && n <= TIP_MAX);
  return [...new Set(list)].sort((a, b) => a - b);
}

/** A typed custom tip: whole rupees, 1..1000. Empty = no tip. */
export function parseCustomTip(text: string): { amount: number; error: string | null } {
  const t = text.replace(/[,\s]/g, '').replace(/^LKR/i, '');
  if (!t) return { amount: 0, error: null };
  if (!/^\d+$/.test(t)) return { amount: 0, error: TIP_COPY.wholeAmount };
  const n = Number(t);
  if (n === 0) return { amount: 0, error: null };
  if (n > TIP_MAX) return { amount: 0, error: TIP_COPY.tooMuch(formatLkr(TIP_MAX)) };
  return { amount: n, error: null };
}

/**
 * The tip this checkout carries: only while checkout-info offers tips and the order is paid in
 * cash (the rider collects it with the order); always 0..1000 whole rupees.
 */
export function checkoutTip(picked: number, opts: { options: readonly number[]; cash: boolean }): number {
  if (!opts.options.length || !opts.cash) return 0;
  if (!Number.isFinite(picked) || picked <= 0) return 0;
  return Math.min(TIP_MAX, Math.round(picked));
}

/** To Pay with the tip on top (null while the fee is unknown). */
export function totalWithTip(toPay: number | null, tip: number): number | null {
  if (toPay === null) return null;
  return Math.round((toPay + Math.max(0, tip)) * 100) / 100;
}

// ---------------------------------------------------------------- the one-time prompt

export const PROMPT_KEY = 'blynk.app.rating-prompted.v1';
const PROMPT_KEEP = 30;

/**
 * The order to ask about when the app opens: the newest DELIVERED order still in its rating window
 * that this customer has not been asked about yet (only the newest - never a queue of old ones).
 */
export function promptCandidate<O extends Parameters<typeof canRate>[0] & { id: string; created_at?: string; placed_at?: string | null }>(
  orders: readonly O[], seen: readonly string[], now: Date = new Date(),
): O | null {
  const delivered = orders.filter((o) => o.order_status === 'DELIVERED');
  const at = (o: O) => (deliveredAt(o) ?? date(o.placed_at) ?? date(o.created_at))?.getTime() ?? 0;
  const newest = [...delivered].sort((a, b) => at(b) - at(a))[0];
  if (!newest || seen.includes(newest.id) || !canRate(newest, now)) return null;
  return newest;
}

/** The orders already asked about (per customer), newest last. */
export function readPrompted(raw: string | null, userId: string): string[] {
  try {
    const all = JSON.parse(raw || '{}') as Record<string, unknown>;
    const list = all && typeof all === 'object' ? all[userId] : null;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The stored value after asking about `orderId` (kept short). */
export function withPrompted(raw: string | null, userId: string, orderId: string): string {
  let all: Record<string, unknown> = {};
  try { const p = JSON.parse(raw || '{}'); if (p && typeof p === 'object' && !Array.isArray(p)) all = p; } catch { /* start over */ }
  const list = readPrompted(raw, userId).filter((x) => x !== orderId);
  list.push(orderId);
  return JSON.stringify({ ...all, [userId]: list.slice(-PROMPT_KEEP) });
}
