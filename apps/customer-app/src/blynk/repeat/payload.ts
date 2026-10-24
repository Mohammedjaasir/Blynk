import { ApiError } from '@/blynk/api/client';
import type { Product } from '@/blynk/api/types';
import { effectivePrice } from '@/blynk/lib/pricing';
import type { OrderItem } from '@/blynk/orders/types';
import { clampLineQty, MAX_LINES, NAME_MAX, type BasketItem, type Frequency, type RepeatBasket } from './models';

/*
 * What the repeat basket screens send (POST / PATCH /me/repeat-baskets) and the summary they show
 * before sending. Only loose items repeat (combo packs do not); a line is 1-20, at most 30 lines.
 * Pure.
 */

type CartLineLike = { product: Pick<Product, 'id'>; quantity: number; variant?: { id: string } | null };

/** Merges lines of the same product + size, clamps quantities, keeps the first 30. */
export function normaliseItems(items: BasketItem[]): BasketItem[] {
  const out: BasketItem[] = [];
  const at = new Map<string, number>();
  for (const it of items) {
    if (!it.product_id || !(it.quantity > 0)) continue;
    const key = `${it.product_id}:${it.variant_id ?? ''}`;
    const i = at.get(key);
    if (i !== undefined) out[i] = { ...out[i], quantity: clampLineQty(out[i].quantity + it.quantity) };
    else {
      at.set(key, out.length);
      out.push({ product_id: it.product_id, variant_id: it.variant_id ?? null, quantity: clampLineQty(it.quantity) });
    }
  }
  return out.slice(0, MAX_LINES);
}

/** The cart's loose lines as basket items (design-mock lines are never sent). */
export function itemsFromCart(lines: CartLineLike[]): BasketItem[] {
  return normaliseItems(lines
    .filter((l) => !l.product.id.startsWith('demo-'))
    .map((l) => ({ product_id: l.product.id, variant_id: l.variant?.id ?? null, quantity: l.quantity })));
}

/** A delivered order's loose lines, without the ones the store could not supply or replaced. */
export function itemsFromOrder(items: Pick<OrderItem, 'product_id' | 'variant_id' | 'quantity' | 'item_status' | 'order_combo_id'>[]): BasketItem[] {
  return normaliseItems(items
    .filter((it) => !it.order_combo_id && it.item_status !== 'UNAVAILABLE' && it.item_status !== 'SUBSTITUTED')
    .map((it) => ({ product_id: it.product_id, variant_id: it.variant_id ?? null, quantity: it.quantity })));
}

/** The order "Repeat this basket" applies to: delivered, with at least one loose line left. */
export const canRepeatOrder = (o: { order_status: string; items: Parameters<typeof itemsFromOrder>[0] }) =>
  o.order_status === 'DELIVERED' && itemsFromOrder(o.items).length > 0;

export interface Estimate { total: number; available: number; unavailable: number; units: number }

/**
 * About what the basket costs at today's prices: catalogue prices (offers included), or for a size
 * `fallback(item)` (the price it last had), since the catalogue list carries no size prices.
 * Lines whose product is gone or sold out are counted as unavailable and not priced.
 */
export function estimate(items: BasketItem[], products: Product[], fallback: (it: BasketItem) => number | null = () => null, now = new Date()): Estimate {
  const byId = new Map(products.map((p) => [p.id, p] as const));
  let total = 0, available = 0, unavailable = 0, units = 0;
  for (const it of items) {
    const p = byId.get(it.product_id);
    if (!p || !p.is_available) { unavailable++; continue; }
    const unit = it.variant_id ? fallback(it) ?? effectivePrice(p, now) : effectivePrice(p, now);
    total += unit * it.quantity;
    available++;
    units += it.quantity;
  }
  return { total: Math.round(total * 100) / 100, available, unavailable, units };
}

export interface ScheduleChoice {
  frequency: Frequency;
  /** 0-6 (0 = Sunday); ignored for DAILY. */
  weekday: number | null;
  placeAt: string;
  addressId: string;
  /** 'YYYY-MM-DD'; omitted = the server's first possible day. */
  startDate?: string | null;
  name?: string | null;
  notes?: string | null;
}

const cleanName = (n: string | null | undefined) => {
  const t = (n ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return t || null;
};

/** POST /me/repeat-baskets body. */
export function createBody(items: BasketItem[], c: ScheduleChoice): Record<string, unknown> {
  const body: Record<string, unknown> = {
    items: normaliseItems(items),
    frequency: c.frequency,
    place_at: c.placeAt,
    address_id: c.addressId,
  };
  if (c.frequency !== 'DAILY' && c.weekday !== null) body.weekday = c.weekday;
  const name = cleanName(c.name);
  if (name) body.name = name;
  const notes = (c.notes ?? '').trim().slice(0, 300);
  if (notes) body.notes = notes;
  if (c.startDate && /^\d{4}-\d{2}-\d{2}$/.test(c.startDate)) body.start_date = c.startDate;
  return body;
}

/** PATCH body with only what changed (null = nothing to send). */
export function patchBody(before: RepeatBasket, next: Partial<ScheduleChoice> & { items?: BasketItem[] }): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  if (next.items) {
    const items = normaliseItems(next.items);
    const same = items.length === before.items.length && items.every((it, i) => {
      const b = before.items[i];
      return b && b.product_id === it.product_id && (b.variant_id ?? null) === it.variant_id && b.quantity === it.quantity;
    });
    if (!same) body.items = items;
  }
  const freq = next.frequency ?? before.frequency;
  if (next.frequency && next.frequency !== before.frequency) body.frequency = next.frequency;
  if (freq !== 'DAILY') {
    const wd = next.weekday !== undefined ? next.weekday : before.weekday;
    if (wd !== null && (wd !== before.weekday || body.frequency)) body.weekday = wd;
  }
  if (next.placeAt && next.placeAt !== before.placeAt) body.place_at = next.placeAt;
  if (next.addressId && next.addressId !== before.addressId) body.address_id = next.addressId;
  const name = next.name !== undefined ? cleanName(next.name) : null;
  if (name && name !== before.name) body.name = name;
  return Object.keys(body).length ? body : null;
}

/** Address choice: the saved address the order went to (same street and town, or within 30 m), else the default, else the first. */
export function matchAddress<A extends { id: string; address_line1: string; city: string; latitude: number; longitude: number; is_default: boolean }>(
  list: A[] | null | undefined,
  order?: { line1?: string | null; city?: string | null; lat?: number | string | null; lng?: number | string | null } | null,
): A | null {
  if (!list?.length) return null;
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (order) {
    const lat = Number(order.lat), lng = Number(order.lng);
    const hit = list.find((a) => (norm(a.address_line1) && norm(a.address_line1) === norm(order.line1) && norm(a.city) === norm(order.city))
      || (Number.isFinite(lat) && Number.isFinite(lng) && order.lat != null && Math.abs(a.latitude - lat) < 0.0003 && Math.abs(a.longitude - lng) < 0.0003));
    if (hit) return hit;
  }
  return list.find((a) => a.is_default) ?? list[0];
}

/** Repeat baskets are shown: the GET /store switch is on and no call answered REPEAT_NOT_READY. */
export const repeatOn = (store: { repeat_baskets_enabled?: boolean } | null, sawNotReady: boolean, demo = false) =>
  !demo && store?.repeat_baskets_enabled === true && !sawNotReady;

/** The 503 every repeat endpoint answers until migration 054 is run: the feature hides itself. */
export const isNotReady = (e: unknown) => e instanceof ApiError && e.status === 503 && e.code === 'REPEAT_NOT_READY';

/** The customer's words for a refused repeat basket call. */
export function repeatErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (e.code) {
    case 'BASKET_LIMIT': return 'You can have up to 5 repeat baskets. Cancel one to add another.';
    case 'PLACE_AT_OUTSIDE_HOURS': return 'That time is outside our opening hours on that day. Pick another time.';
    case 'BASKET_NOT_FOUND': return 'This repeat basket no longer exists.';
    case 'REPEAT_NOT_READY': return 'Repeat baskets are not available yet. Please try again later.';
    case 'VALIDATION_ERROR': return 'Please check the details and try again.';
    default: return e.message || 'Something went wrong. Please try again.';
  }
}
