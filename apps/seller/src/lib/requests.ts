import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import type { InsightProduct, PayoutRequest } from '../api/types';
import type { ChipTone } from './products';
import { errorMessage } from './apiErrors';
import { formatNumber } from './format';

/**
 * Payment requests and best sellers need a database change on the
 * server. Until it is live every route answers 503 SELLER_REQUESTS_NOT_READY;
 * an older API without the routes answers 404. Either way the portal leaves
 * the part out instead of showing an error.
 */
export function isRequestsNotReady(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'SELLER_REQUESTS_NOT_READY';
}

/** A list could not load because the feature is not there yet (not a real failure). */
export function isFeatureOff(err: unknown): boolean {
  return isRequestsNotReady(err) || (err instanceof ApiError && err.status === 404);
}

export const NOT_READY_MESSAGE = 'This is not switched on yet. Please try again in a little while.';
export const PAYOUT_OPEN_MESSAGE =
  'You already have a payment request waiting. Blynk will handle that one first - you can withdraw it to ask again.';
export const AMOUNT_OVER_DUE_MESSAGE = 'That is more than Blynk owes you. Ask for the amount due or less.';

/** A refused payment request in plain words. */
export function requestMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (isRequestsNotReady(err)) return NOT_READY_MESSAGE;
    if (err.code === 'PAYOUT_REQUEST_OPEN') return PAYOUT_OPEN_MESSAGE;
    if (err.code === 'AMOUNT_OVER_DUE') return AMOUNT_OVER_DUE_MESSAGE;
    if (err.code === 'SELLER_NOT_APPROVED') return 'Blynk has not approved your shop yet, so this cannot be sent.';
  }
  return errorMessage(err, fallback);
}

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  /** Not available on this server yet: render nothing (or a quiet line). */
  | { state: 'off' }
  | { state: 'error'; message: string };

/**
 * Loads one of the seller-request lists. 503 SELLER_REQUESTS_NOT_READY and 404
 * become `off`; anything else is an `error` the screen can offer to retry.
 * `enabled: false` skips the request (and stays `off`).
 */
export function useSellerRequest<T>(
  load: () => Promise<T>,
  fallback: string,
  enabled = true
): Loadable<T> & { reload(): Promise<void> } {
  const [value, setValue] = useState<Loadable<T>>(enabled ? { state: 'loading' } : { state: 'off' });
  const loadRef = useRef(load);
  loadRef.current = load;
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) {
      setValue({ state: 'off' });
      return;
    }
    try {
      const data = await loadRef.current();
      if (live.current) setValue({ state: 'ready', data });
    } catch (err) {
      if (!live.current) return;
      setValue(isFeatureOff(err) ? { state: 'off' } : { state: 'error', message: errorMessage(err, fallback) });
    }
  }, [enabled, fallback]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...value, reload };
}

// --------------------------------------------------------- payout requests
export const METHOD_LABEL: Record<PayoutRequest['method'], string> = {
  BANK: 'Bank transfer',
  CASH: 'Cash at the store',
};

export function payoutChip(request: PayoutRequest): { label: string; tone: ChipTone } {
  switch (request.status) {
    case 'PAID':
      return { label: 'Paid', tone: 'ok' };
    case 'DECLINED':
      return { label: 'Not paid', tone: 'bad' };
    case 'REQUESTED':
      return { label: 'Waiting for Blynk', tone: 'wait' };
    default:
      return { label: 'Withdrawn', tone: 'off' };
  }
}

// ---------------------------------------------------------------- insights
export type Trend = { kind: 'up' | 'down' | 'flat' | 'new'; label: string };

/** Units this period against the period before, in words. */
export function trendOf(units: number, prev: number): Trend {
  const now = Number(units) || 0;
  const before = Number(prev) || 0;
  if (before <= 0) return now > 0 ? { kind: 'new', label: 'New' } : { kind: 'flat', label: 'Same' };
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return { kind: 'flat', label: 'Same' };
  return change > 0 ? { kind: 'up', label: `+${change}%` } : { kind: 'down', label: `${change}%` };
}

/** "12 left · about 4 days" for a best seller. */
export function stockLine(item: InsightProduct): string {
  if (item.stock_on_hand === null || item.stock_on_hand === undefined) return 'Stock not counted';
  if (item.stock_on_hand <= 0) return 'Out of stock';
  const left = `${formatNumber(item.stock_on_hand)} left`;
  const days = item.days_of_stock_left;
  if (days === null || days === undefined || !Number.isFinite(Number(days))) return left;
  const d = Math.max(0, Math.floor(Number(days)));
  return d < 1 ? `${left} · runs out today` : `${left} · about ${d} day${d === 1 ? '' : 's'}`;
}
