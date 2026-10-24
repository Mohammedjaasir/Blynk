import { ApiError, apiRequest } from './client';
import { errorMessage } from '../lib/apiErrors';

/**
 * Staff APIs for repeat baskets (migration 054), ratings + rider tips (055) and
 * product requests (056): docs/superpowers/plans/2026-10-24-buy-again-repeat.md
 * section 2 and 2026-10-24-groups-ratings-requests.md sections B and C.
 * ADMIN (and OPERATIONS in Blynk Ops). Every endpoint answers 503
 * `<FEATURE>_NOT_READY` until its migration has been run in Coolify.
 */

// ------------------------------------------------------------ repeat baskets
export type RepeatBasketStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';
export type RepeatFrequency = 'DAILY' | 'WEEKLY' | 'BIWEEKLY';
export type RepeatRunStatus = 'PLACED' | 'SKIPPED' | 'FAILED';

export interface RepeatBasketRun {
  run_at: string;
  status: RepeatRunStatus;
  order_id: string | null;
  order_number?: string | null;
  reason: string | null;
}

export interface RepeatBasketLine {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  product_name?: string | null;
}

/** A row of GET /admin/repeat-baskets. Customer fields are read flat or from `customer`. */
export interface AdminRepeatBasket {
  id: string;
  name: string;
  status: RepeatBasketStatus;
  frequency: RepeatFrequency;
  /** 0 = Sunday; WEEKLY/BIWEEKLY only. */
  weekday: number | null;
  /** 'HH:MM', Colombo time the order is placed. */
  place_at: string;
  skip_next?: boolean;
  next_run_at: string | null;
  last_run_at?: string | null;
  last_order_id?: string | null;
  last_run?: RepeatBasketRun | null;
  user_id?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer?: { id?: string; full_name?: string | null; phone?: string | null } | null;
  items_count?: number;
  items?: RepeatBasketLine[];
  notes?: string | null;
  created_at?: string;
}

export const repeatBaskets = {
  /** Every basket, or those with one status. */
  list: (status?: RepeatBasketStatus) =>
    apiRequest<{ baskets?: AdminRepeatBasket[]; repeat_baskets?: AdminRepeatBasket[] }>(
      // The API pages at 50 by default; 200 is its most per page.
      `/admin/repeat-baskets?${status ? `status=${status}&` : ''}limit=200`
    ).then((d) => d.baskets ?? d.repeat_baskets ?? []),
  /** Pause, resume or cancel (audited REPEAT_BASKET_UPDATED). */
  setStatus: (id: string, status: RepeatBasketStatus) =>
    apiRequest<{ basket: AdminRepeatBasket }>(`/admin/repeat-baskets/${id}`, { method: 'PATCH', body: { status } }).then(
      (d) => d.basket
    ),
};

// ------------------------------------------------------------------ ratings
export type RatingTag =
  | 'ON_TIME'
  | 'LATE'
  | 'FRIENDLY_RIDER'
  | 'RUDE_RIDER'
  | 'FRESH'
  | 'DAMAGED'
  | 'MISSING_ITEM'
  | 'WRONG_ITEM'
  | 'GOOD_PACKING';

/** A row of GET /admin/ratings (newest first). */
export interface AdminRating {
  order_id: string;
  order_number: string;
  /** backend ratings.service presentStaffRating: `customer` and `rider` objects (flat names read too). */
  customer?: { id?: string; name?: string | null; phone?: string | null } | null;
  rider?: { id: string; name: string | null } | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  rider_id?: string | null;
  rider_name?: string | null;
  stars: number;
  tags: string[];
  comment: string | null;
  created_at: string;
  /** Cash tip at checkout, and the tip paid from the wallet after delivery. */
  rider_tip?: number | string | null;
  rider_tip_wallet?: number | string | null;
}

export interface RatingsSummary {
  average: number | null;
  count: number;
  /** Ratings per star, 1 to 5. */
  per_star: Record<1 | 2 | 3 | 4 | 5, number>;
  top_tags: Array<{ tag: string; count: number }>;
  per_rider: Array<{ rider_id: string | null; rider_name: string | null; average: number; count: number }>;
  /** Tips on orders delivered in the period; null when the API does not send them. */
  tips: { total: number; orders_tipped: number } | null;
}

export interface RatingsFilter {
  stars_max?: number;
  rider_id?: string;
  /** YYYY-MM-DD, Colombo days. */
  from?: string;
  to?: string;
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/**
 * The summary in one shape. The contract names the figures but not the keys,
 * so per-star counts are read as an object keyed 1-5 or a list of { stars, count }.
 */
export function normalizeRatingsSummary(raw: unknown): RatingsSummary {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const perStar: RatingsSummary['per_star'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const starsRaw = s.per_star ?? s.stars ?? s.by_stars ?? s.star_counts;
  if (Array.isArray(starsRaw)) {
    for (const row of starsRaw as Array<Record<string, unknown>>) {
      const star = num(row.stars ?? row.star);
      if (star >= 1 && star <= 5) perStar[star as 1] = num(row.count) || 0;
    }
  } else if (starsRaw && typeof starsRaw === 'object') {
    for (const star of [1, 2, 3, 4, 5] as const) perStar[star] = num((starsRaw as Record<string, unknown>)[star]) || 0;
  }
  const average = num(s.average ?? s.average_stars);
  const tags = Array.isArray(s.top_tags) ? (s.top_tags as Array<Record<string, unknown>>) : [];
  const riders = Array.isArray(s.per_rider) ? (s.per_rider as Array<Record<string, unknown>>) : [];
  return {
    average: Number.isFinite(average) ? average : null,
    count: num(s.count ?? s.total) || 0,
    per_star: perStar,
    top_tags: tags.map((t) => ({ tag: String(t.tag ?? ''), count: num(t.count) || 0 })),
    per_rider: riders.map((r) => ({
      rider_id: (r.rider_id as string | null | undefined) ?? null,
      rider_name: (r.rider_name as string | null | undefined) ?? null,
      average: num(r.average ?? r.average_stars) || 0,
      count: num(r.count) || 0,
    })),
    tips:
      s.tips && typeof s.tips === 'object'
        ? {
            total: num((s.tips as Record<string, unknown>).total) || 0,
            orders_tipped: num((s.tips as Record<string, unknown>).orders_tipped) || 0,
          }
        : null,
  };
}

export const ratings = {
  list: (filter: RatingsFilter = {}) => {
    const q = new URLSearchParams();
    if (filter.stars_max) q.set('stars_max', String(filter.stars_max));
    if (filter.from) q.set('from', filter.from);
    if (filter.to) q.set('to', filter.to);
    if (filter.rider_id) q.set('rider_id', filter.rider_id);
    const qs = q.toString();
    return apiRequest<{ ratings: AdminRating[] }>(`/admin/ratings${qs ? `?${qs}` : ''}`).then((d) => d.ratings ?? []);
  },
  summary: (days: number) =>
    apiRequest<{ summary?: unknown } & Record<string, unknown>>(`/admin/ratings/summary?days=${days}`).then((d) =>
      normalizeRatingsSummary(d.summary ?? d)
    ),
};

// --------------------------------------------------------- product requests
export type ProductRequestStatus = 'NEW' | 'PLANNED' | 'ADDED' | 'DECLINED';
export type ProductRequestSort = 'popular' | 'newest';

export interface ProductRequestRow {
  id: string;
  name: string;
  note: string | null;
  created_at: string;
  /** Signed-in requester; null for a guest. */
  customer?: { id?: string; name?: string | null; phone?: string | null } | null;
  guest?: boolean;
  customer_name?: string | null;
  phone?: string | null;
  photo_url?: string | null;
}

/** One group of GET /admin/product-requests: same-named requests (normalised key). */
export interface ProductRequestGroup {
  key: string;
  name: string;
  /** Distinct people who asked (a guest counts as one). */
  count: number;
  /** Every request, repeats included. */
  requests_total?: number;
  last_requested_at: string;
  status: ProductRequestStatus;
  category_name: string | null;
  product_id?: string | null;
  product_name?: string | null;
  staff_note?: string | null;
  requests: ProductRequestRow[];
}

export const productRequests = {
  list: (params: { status?: ProductRequestStatus; sort?: ProductRequestSort } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.sort) q.set('sort', params.sort);
    const qs = q.toString();
    return apiRequest<{ groups?: ProductRequestGroup[]; product_requests?: ProductRequestGroup[]; requests?: ProductRequestGroup[] }>(
      `/admin/product-requests${qs ? `?${qs}` : ''}`
    ).then((d) => d.groups ?? d.product_requests ?? d.requests ?? []);
  },
  /** Applies to the whole group; ADDED with a product tells the requesters it is in. */
  update: (key: string, body: { status: ProductRequestStatus; product_id?: string; staff_note?: string }) =>
    apiRequest<unknown>(`/admin/product-requests/${encodeURIComponent(key)}`, { method: 'PATCH', body: { ...body } }),
};

// ------------------------------------------------------------------ errors
const MIGRATION: Record<string, string> = {
  REPEAT_NOT_READY: '054',
  RATINGS_NOT_READY: '055',
  PRODUCT_REQUESTS_NOT_READY: '056',
};

/** "Switched on after migration 054 is run" for a 503 *_NOT_READY; else the usual words. */
export function featureErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code && err.code.endsWith('_NOT_READY')) {
    const migration = MIGRATION[err.code];
    return `Not switched on yet: run ${migration ? `database migration ${migration}` : 'the database migration'} in Coolify first.`;
  }
  return errorMessage(err, fallback);
}
