import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';
import { parseBasket, parseBasketList, parseBuyAgain, type BuyAgainEntry, type RepeatBasket } from './models';
import { isNotReady } from './payload';

/*
 * Signed-in buy again + repeat basket calls (Bearer; authed() refreshes once on a 401). Every
 * repeat endpoint answers 503 REPEAT_NOT_READY until migration 054 is run: the first such answer
 * switches the feature off for this session (gate.ts), so nothing half-works.
 */

let notReadyHandler: (() => void) | null = null;
/** gate.ts listens here (kept out of this file so the calls stay free of React). */
export function onRepeatNotReady(fn: (() => void) | null) { notReadyHandler = fn; }

async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isNotReady(e)) notReadyHandler?.();
    throw e;
  }
}

const one = (raw: { basket?: unknown } | null | undefined): RepeatBasket => {
  const b = parseBasket(raw?.basket);
  if (!b) throw new ApiError('The repeat basket came back incomplete. Please try again.', 500, 'BAD_BASKET');
  return b;
};

/** GET /me/buy-again. */
export async function fetchBuyAgain(signal?: AbortSignal): Promise<BuyAgainEntry[]> {
  return parseBuyAgain(await authed((t) => apiGet<unknown>('/me/buy-again', t, signal)));
}

/** GET /me/repeat-baskets (not cancelled). */
export async function listBaskets(signal?: AbortSignal): Promise<RepeatBasket[]> {
  return parseBasketList(await guard(authed((t) => apiGet<unknown>('/me/repeat-baskets', t, signal))));
}

/** POST /me/repeat-baskets (body from payload.ts createBody). */
export async function createBasket(body: Record<string, unknown>): Promise<RepeatBasket> {
  return one(await guard(authed((t) => apiPost<{ basket?: unknown }>('/me/repeat-baskets', body, t))));
}

/** PATCH /me/repeat-baskets/:id (fields, or `status: 'ACTIVE' | 'PAUSED'`). */
export async function updateBasket(id: string, body: Record<string, unknown>): Promise<RepeatBasket> {
  return one(await guard(authed((t) => apiPatch<{ basket?: unknown }>(`/me/repeat-baskets/${encodeURIComponent(id)}`, body, t))));
}

/** POST /me/repeat-baskets/:id/skip-next: toggles skipping the next run. */
export async function toggleSkipNext(id: string): Promise<RepeatBasket> {
  return one(await guard(authed((t) => apiPost<{ basket?: unknown }>(`/me/repeat-baskets/${encodeURIComponent(id)}/skip-next`, {}, t))));
}

/** DELETE /me/repeat-baskets/:id: the basket is cancelled. */
export async function cancelBasket(id: string): Promise<RepeatBasket | null> {
  const r = await guard(authed((t) => apiDelete<{ basket?: unknown } | null>(`/me/repeat-baskets/${encodeURIComponent(id)}`, t)));
  return parseBasket(r?.basket);
}
