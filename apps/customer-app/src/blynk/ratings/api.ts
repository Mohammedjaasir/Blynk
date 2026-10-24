import { ApiError, apiGet, apiPost } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';
import { noteNotReady } from '@/blynk/lib/featureGate';
import { parseRatingAnswer, ratingBody, type RatingAnswer, type RatingTag } from './model';
import { RATING_WORDS } from './words';

/*
 * Signed-in rating and tip calls (migration 055). Every call notes a 503 RATINGS_NOT_READY (the
 * feature then hides until the next start). Never called in the design mock.
 */

const path = (orderId: string, tail: string) => `/orders/${encodeURIComponent(orderId)}/${tail}`;

/** GET /orders/:id/rating: the rating given (null = none yet; a 404 is "none" too) and any tip on the order. */
export async function fetchRating(orderId: string, signal?: AbortSignal): Promise<RatingAnswer> {
  try {
    return parseRatingAnswer(await authed((t) => apiGet<unknown>(path(orderId, 'rating'), t, signal)));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code !== 'ORDER_NOT_FOUND') return { rating: null, tip: 0 };
    noteNotReady(e, 'ratings');
    throw e;
  }
}

/** POST /orders/:id/rating (a new rating, or a change within 24 h). */
export async function sendRating(orderId: string, input: { stars: number; tags?: RatingTag[]; comment?: string | null }): Promise<RatingAnswer> {
  const body = ratingBody(input);
  if (!body) throw new ApiError(RATING_WORDS.pickStars, 400, 'VALIDATION_ERROR');
  try {
    const answer = parseRatingAnswer(await authed((t) => apiPost<unknown>(path(orderId, 'rating'), body, t)));
    // an answer without the row still means it was saved: show what was sent
    return answer.rating ? answer : { ...answer, rating: { stars: body.stars, tags: body.tags ?? [], comment: body.comment ?? null, createdAt: new Date(), editableUntil: new Date(Date.now() + 24 * 3_600_000) } };
  } catch (e) {
    noteNotReady(e, 'ratings');
    throw e;
  }
}

/** POST /orders/:id/tip: from the Blynk Wallet, once per order. 409 WALLET_LOW = the balance does not cover it. */
export async function sendWalletTip(orderId: string, amountLkr: number): Promise<{ tip: number; balance: number | null }> {
  try {
    const raw = await authed((t) => apiPost<unknown>(path(orderId, 'tip'), { amount_lkr: amountLkr }, t));
    const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const w = (d.wallet && typeof d.wallet === 'object' ? d.wallet : {}) as Record<string, unknown>;
    const bal = Number(w.balance ?? d.wallet_balance ?? d.balance);
    return { tip: amountLkr, balance: Number.isFinite(bal) ? bal : null };
  } catch (e) {
    noteNotReady(e, 'ratings');
    throw e;
  }
}

export const isWalletLow = (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === 'WALLET_LOW';
/** A tip is already on the order (another device, or the checkout tip). */
export const isAlreadyTipped = (e: unknown) => e instanceof ApiError && e.status === 409 && e.code !== 'WALLET_LOW';
