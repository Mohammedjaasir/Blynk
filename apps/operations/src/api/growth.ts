import { apiRequest } from './client';

/**
 * Repeat baskets, order ratings + rider tips and product requests - the staff side
 * (contracts: docs/superpowers/plans/2026-10-24-buy-again-repeat.md §2 "Staff API" and
 * 2026-10-24-groups-ratings-requests.md §B, §C). ADMIN and OPERATIONS.
 *
 * Every endpoint answers 503 `<FEATURE>_NOT_READY` until its migration (054 / 055 / 056)
 * has been run in Coolify; the screens say so instead of failing.
 *
 * The contracts name the fields but not every envelope key, so each list read accepts
 * the obvious spellings (`{ baskets }`, `{ ratings }`, `{ groups }`, a bare array) and
 * every row goes through a small normaliser that tolerates a missing field.
 */

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** The first array among `keys` of `data`, or `data` itself when it is one. */
function listOf(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  const o = obj(data);
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
}
/** A person's name from `<prefix>_name` or a nested `{ full_name | name }`. */
function nameOf(row: Raw, prefix: string): string | null {
  const nested = obj(row[prefix]);
  return str(row[`${prefix}_name`]) ?? str(nested.full_name) ?? str(nested.name) ?? null;
}
function phoneOf(row: Raw, prefix: string): string | null {
  return str(row[`${prefix}_phone`]) ?? str(obj(row[prefix]).phone) ?? null;
}

// ------------------------------------------------------------ repeat baskets
export type RepeatStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';
export type RepeatFrequency = 'DAILY' | 'WEEKLY' | 'BIWEEKLY';

export interface RepeatRun {
  run_at: string | null;
  status: 'PLACED' | 'SKIPPED' | 'FAILED' | string;
  order_id: string | null;
  order_number: string | null;
  reason: string | null;
}

export interface StaffRepeatBasket {
  id: string;
  name: string;
  customer_name: string | null;
  customer_phone: string | null;
  items_count: number;
  frequency: RepeatFrequency | string;
  /** 0 = Sunday; WEEKLY / BIWEEKLY only. */
  weekday: number | null;
  /** 'HH:MM' Colombo time the order is placed. */
  place_at: string | null;
  status: RepeatStatus;
  skip_next: boolean;
  next_run_at: string | null;
  last_run: RepeatRun | null;
}

function toRun(v: unknown): RepeatRun | null {
  const r = obj(v);
  if (!Object.keys(r).length) return null;
  return {
    run_at: str(r.run_at),
    status: str(r.status) ?? 'PLACED',
    order_id: str(r.order_id),
    order_number: str(r.order_number),
    reason: str(r.reason),
  };
}

export function toRepeatBasket(v: unknown): StaffRepeatBasket {
  const r = obj(v);
  const items = Array.isArray(r.items) ? r.items : null;
  const status = str(r.status);
  return {
    id: String(r.id ?? ''),
    name: str(r.name) ?? 'My basket',
    customer_name: nameOf(r, 'customer') ?? nameOf(r, 'user'),
    customer_phone: phoneOf(r, 'customer') ?? phoneOf(r, 'user'),
    items_count: num(r.items_count) ?? num(r.item_count) ?? (items ? items.length : 0),
    frequency: str(r.frequency) ?? 'WEEKLY',
    weekday: num(r.weekday),
    place_at: str(r.place_at),
    status: status === 'PAUSED' || status === 'CANCELLED' ? status : 'ACTIVE',
    skip_next: r.skip_next === true,
    next_run_at: str(r.next_run_at),
    last_run: toRun(r.last_run),
  };
}

export const repeatBaskets = {
  list: (status?: RepeatStatus) =>
    apiRequest<unknown>(`/admin/repeat-baskets${status ? `?status=${status}` : ''}`).then((d) =>
      listOf(d, ['baskets', 'repeat_baskets', 'items']).map(toRepeatBasket)
    ),
  setStatus: (id: string, status: RepeatStatus) =>
    apiRequest<unknown>(`/admin/repeat-baskets/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }).then((d) => {
      const basket = obj(d).basket;
      return basket ? toRepeatBasket(basket) : null;
    }),
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

export interface OrderRating {
  order_id: string;
  order_number: string | null;
  stars: number;
  tags: string[];
  comment: string | null;
  created_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  rider_id: string | null;
  rider_name: string | null;
}

export function toRating(v: unknown): OrderRating {
  const r = obj(v);
  const order = obj(r.order);
  return {
    order_id: str(r.order_id) ?? str(order.id) ?? '',
    order_number: str(r.order_number) ?? str(order.order_number),
    stars: Math.max(0, Math.min(5, Math.round(num(r.stars) ?? 0))),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    comment: str(r.comment),
    created_at: str(r.created_at),
    customer_name: nameOf(r, 'customer'),
    customer_phone: phoneOf(r, 'customer'),
    rider_id: str(r.rider_id) ?? str(obj(r.rider).id),
    rider_name: nameOf(r, 'rider'),
  };
}

export interface RatingsSummary {
  days: number;
  average: number | null;
  count: number;
  /** Count per star, index 1-5 (0 unused). */
  per_star: number[];
  top_tags: { tag: string; count: number }[];
  per_rider: { rider_id: string | null; rider_name: string | null; average: number | null; count: number }[];
}

/** Per-star counts from `{ "1": n, ... }` or `[{ stars, count }]`. */
function starCounts(v: unknown): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  if (Array.isArray(v)) {
    for (const row of v) {
      const r = obj(row);
      const s = num(r.stars ?? r.star);
      if (s && s >= 1 && s <= 5) out[s] = num(r.count) ?? 0;
    }
  } else {
    const o = obj(v);
    for (let s = 1; s <= 5; s++) out[s] = num(o[String(s)]) ?? 0;
  }
  return out;
}

export function toRatingsSummary(v: unknown, days: number): RatingsSummary {
  const r = obj(v);
  const tagsRaw = r.top_tags ?? r.tags;
  const top_tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => ({ tag: String(obj(t).tag ?? t), count: num(obj(t).count) ?? 0 }))
    : Object.entries(obj(tagsRaw)).map(([tag, count]) => ({ tag, count: num(count) ?? 0 }));
  const ridersRaw = listOf(r.per_rider ?? r.riders, []);
  return {
    days: num(r.days) ?? days,
    average: num(r.average ?? r.average_stars ?? r.avg),
    count: num(r.count ?? r.total) ?? 0,
    per_star: starCounts(r.per_star ?? r.by_star ?? r.star_counts ?? r.stars),
    top_tags: top_tags.sort((a, b) => b.count - a.count),
    per_rider: ridersRaw.map((x) => {
      const p = obj(x);
      return {
        rider_id: str(p.rider_id) ?? str(obj(p.rider).id),
        rider_name: nameOf(p, 'rider'),
        average: num(p.average ?? p.average_stars ?? p.avg),
        count: num(p.count) ?? 0,
      };
    }),
  };
}

export interface RatingsQuery {
  stars_max?: number;
  from?: string;
  to?: string;
  rider_id?: string;
  order_id?: string;
}

export const ratings = {
  list: (query: RatingsQuery = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, String(v));
    const qs = q.toString();
    return apiRequest<unknown>(`/admin/ratings${qs ? `?${qs}` : ''}`).then((d) => listOf(d, ['ratings', 'items']).map(toRating));
  },
  summary: (days = 30) =>
    apiRequest<unknown>(`/admin/ratings/summary?days=${days}`).then((d) => toRatingsSummary(obj(d).summary ?? d, days)),
  /**
   * One order's rating: `order_id` is passed as a filter, and the rows are still
   * matched by order here, so an API that ignores the filter cannot show another
   * order's rating.
   */
  forOrder: (orderId: string) =>
    ratings.list({ order_id: orderId }).then((rows) => rows.find((r) => r.order_id === orderId) ?? null),
};

// --------------------------------------------------------- product requests
export type ProductRequestStatus = 'NEW' | 'PLANNED' | 'ADDED' | 'DECLINED';

export interface ProductRequestEntry {
  id: string;
  name: string;
  note: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string | null;
}

export interface ProductRequestGroup {
  key: string;
  name: string;
  count: number;
  last_requested_at: string | null;
  status: ProductRequestStatus;
  category_name: string | null;
  product_id: string | null;
  product_name: string | null;
  staff_note: string | null;
  requests: ProductRequestEntry[];
}

const REQUEST_STATUSES: ProductRequestStatus[] = ['NEW', 'PLANNED', 'ADDED', 'DECLINED'];

export function toRequestGroup(v: unknown): ProductRequestGroup {
  const r = obj(v);
  const requests = listOf(r.requests, []).map((x) => {
    const q = obj(x);
    return {
      id: String(q.id ?? ''),
      name: str(q.name) ?? '',
      note: str(q.note),
      customer_name: nameOf(q, 'customer') ?? nameOf(q, 'user'),
      customer_phone: phoneOf(q, 'customer') ?? phoneOf(q, 'user'),
      created_at: str(q.created_at),
    };
  });
  const status = str(r.status) as ProductRequestStatus | null;
  const name = str(r.name) ?? requests[0]?.name ?? String(r.key ?? '');
  return {
    key: String(r.key ?? name.trim().toLowerCase().replace(/\s+/g, ' ')),
    name,
    count: num(r.count) ?? requests.length,
    last_requested_at: str(r.last_requested_at),
    status: status && REQUEST_STATUSES.includes(status) ? status : 'NEW',
    category_name: str(r.category_name) ?? str(obj(r.category).name),
    product_id: str(r.product_id),
    product_name: str(r.product_name) ?? str(obj(r.product).name),
    staff_note: str(r.staff_note),
    requests,
  };
}

export const productRequests = {
  list: (query: { status?: ProductRequestStatus; sort?: 'popular' | 'newest' } = {}) => {
    const q = new URLSearchParams();
    if (query.status) q.set('status', query.status);
    if (query.sort) q.set('sort', query.sort);
    const qs = q.toString();
    return apiRequest<unknown>(`/admin/product-requests${qs ? `?${qs}` : ''}`).then((d) =>
      listOf(d, ['groups', 'requests', 'items']).map(toRequestGroup)
    );
  },
  /** Applies to the whole group (every request with this name key). */
  update: (key: string, body: { status: ProductRequestStatus; product_id?: string; staff_note?: string }) =>
    apiRequest<unknown>(`/admin/product-requests/${encodeURIComponent(key)}`, { method: 'PATCH', body }),
};
