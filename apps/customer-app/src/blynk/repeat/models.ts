/*
 * Buy again + repeat baskets (owner, 2026-10-24; contract: docs/superpowers/plans/2026-10-24-buy-again-repeat.md).
 * The shapes the customer API answers with, read leniently: amounts may arrive as strings
 * (Postgres NUMERIC), unknown fields are ignored and a malformed row is dropped, never thrown.
 * Pure: no React, no network.
 */

export type Frequency = 'DAILY' | 'WEEKLY' | 'BIWEEKLY';
export type BasketStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';
export type RunStatus = 'PLACED' | 'SKIPPED' | 'FAILED';

/** GET /me/buy-again: one product the customer has had delivered (last 180 days, best first). */
export interface BuyAgainEntry {
  productId: string;
  variantId: string | null;
  timesBought: number;
  lastBoughtAt: string | null;
  lastQuantity: number;
}

/** One line of a repeat basket. */
export interface BasketItem {
  product_id: string;
  variant_id: string | null;
  /** 1-20. */
  quantity: number;
}

export interface BasketRun {
  runAt: string | null;
  status: RunStatus;
  orderId: string | null;
  reason: string | null;
}

export interface BasketEstimate {
  itemsTotal: number;
  availableLines: number;
  unavailableLines: number;
}

export interface RepeatBasket {
  id: string;
  name: string;
  items: BasketItem[];
  frequency: Frequency;
  /** 0 = Sunday ... 6 = Saturday; null for DAILY. */
  weekday: number | null;
  /** 'HH:MM' Colombo time the order is placed. */
  placeAt: string;
  addressId: string | null;
  notes: string | null;
  status: BasketStatus;
  skipNext: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastOrderId: string | null;
  lastRun: BasketRun | null;
  estimate: BasketEstimate | null;
}

export const MAX_BASKETS = 5;
export const MAX_LINES = 30;
export const MAX_LINE_QTY = 20;
export const NAME_MAX = 40;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export const clampLineQty = (n: number) => Math.max(1, Math.min(MAX_LINE_QTY, Math.floor(Number.isFinite(n) ? n : 1)));

/** `data` of GET /me/buy-again. Anything that is not that answer reads as no products. */
export function parseBuyAgain(raw: unknown): BuyAgainEntry[] {
  const r = obj(raw);
  const out: BuyAgainEntry[] = [];
  for (const it of Array.isArray(r?.items) ? (r!.items as unknown[]) : []) {
    const e = obj(it);
    const productId = str(e?.product_id);
    if (!e || !productId) continue;
    out.push({
      productId,
      variantId: str(e.variant_id),
      timesBought: Math.max(1, Math.floor(num(e.times_bought) ?? 1)),
      lastBoughtAt: str(e.last_bought_at),
      lastQuantity: Math.max(1, Math.floor(num(e.last_quantity) ?? 1)),
    });
  }
  return out;
}

const FREQ: readonly Frequency[] = ['DAILY', 'WEEKLY', 'BIWEEKLY'];
const STATUS: readonly BasketStatus[] = ['ACTIVE', 'PAUSED', 'CANCELLED'];
const RUN: readonly RunStatus[] = ['PLACED', 'SKIPPED', 'FAILED'];

function parseItems(v: unknown): BasketItem[] {
  const out: BasketItem[] = [];
  for (const it of Array.isArray(v) ? v : []) {
    const e = obj(it);
    const product_id = str(e?.product_id);
    if (!e || !product_id) continue;
    out.push({ product_id, variant_id: str(e.variant_id), quantity: clampLineQty(num(e.quantity) ?? 1) });
  }
  return out;
}

function parseRun(v: unknown): BasketRun | null {
  const e = obj(v);
  const status = typeof e?.status === 'string' && (RUN as readonly string[]).includes(e.status) ? (e.status as RunStatus) : null;
  if (!e || !status) return null;
  return { runAt: str(e.run_at), status, orderId: str(e.order_id), reason: str(e.reason) };
}

function parseEstimate(v: unknown): BasketEstimate | null {
  const e = obj(v);
  const total = num(e?.items_total);
  if (!e || total === null) return null;
  return {
    itemsTotal: Math.max(0, total),
    availableLines: Math.max(0, Math.floor(num(e.available_lines) ?? 0)),
    unavailableLines: Math.max(0, Math.floor(num(e.unavailable_lines) ?? 0)),
  };
}

/** One basket row; null for anything without an id or a known schedule. */
export function parseBasket(raw: unknown): RepeatBasket | null {
  const r = obj(raw);
  const id = str(r?.id);
  const frequency = typeof r?.frequency === 'string' && (FREQ as readonly string[]).includes(r.frequency) ? (r.frequency as Frequency) : null;
  const placeAt = str(r?.place_at);
  if (!r || !id || !frequency || !placeAt || !/^\d{1,2}:\d{2}/.test(placeAt)) return null;
  const wd = num(r.weekday);
  const status = typeof r.status === 'string' && (STATUS as readonly string[]).includes(r.status) ? (r.status as BasketStatus) : 'ACTIVE';
  return {
    id,
    name: str(r.name) ?? 'My basket',
    items: parseItems(r.items),
    frequency,
    weekday: wd !== null && wd >= 0 && wd <= 6 ? Math.floor(wd) : null,
    placeAt: placeAt.slice(0, 5).padStart(5, '0'),
    addressId: str(r.address_id),
    notes: str(r.notes),
    status,
    skipNext: r.skip_next === true,
    nextRunAt: str(r.next_run_at),
    lastRunAt: str(r.last_run_at),
    lastOrderId: str(r.last_order_id),
    lastRun: parseRun(r.last_run),
    estimate: parseEstimate(r.estimate),
  };
}

/** `data` of GET /me/repeat-baskets: the not-cancelled baskets. */
export function parseBasketList(raw: unknown): RepeatBasket[] {
  const r = obj(raw);
  return (Array.isArray(r?.baskets) ? (r!.baskets as unknown[]) : [])
    .map(parseBasket)
    .filter((b): b is RepeatBasket => !!b && b.status !== 'CANCELLED');
}
