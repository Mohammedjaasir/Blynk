import type { StoreInfo } from '../api/types';

/** "08:00" -> "8 AM", "21:30" -> "9:30 PM". Returns null for anything that is not HH:MM. */
export function formatClock(hhmm: string | undefined | null): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min ? `:${m[2]}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "8 AM – 9 PM" from the store's delivery hours, or null when the store has not loaded. */
export function formatHours(store: StoreInfo | null): string | null {
  const a = formatClock(store?.delivery_hours?.start), b = formatClock(store?.delivery_hours?.end);
  return a && b ? `${a} – ${b}` : null;
}

/** "Groceries delivered within 4 km", or null when the radius is not known. */
export function radiusText(store: StoreInfo | null): string | null {
  const r = store?.radius_km;
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? `Groceries delivered within ${r} km` : null;
}

export const formatOfferEnd = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Colombo' });

/** "Delivery fee: LKR 100" (flat) / null when the fee depends on the address or is unknown. */
export function flatFee(store: StoreInfo | null): number | null {
  return store?.delivery_fee_mode === 'FLAT' && typeof store.delivery_fee_lkr === 'number' && Number.isFinite(store.delivery_fee_lkr)
    ? store.delivery_fee_lkr
    : null;
}

/** Number of free deliveries on offer, or 0 when the switch is off. */
export function freeDeliveryCount(store: StoreInfo | null): number {
  const f = store?.new_customer_free_deliveries;
  return f?.enabled && typeof f.count === 'number' && f.count > 0 ? f.count : 0;
}

/**
 * Whether an offer's struck price and "Save LKR n" may show. Owner, 2026-10-18: "it should
 * enable always" - no longer reads Admin's show_offer_savings; an active offer always shows
 * what it saves.
 */
export function offerSavingsOn(store?: StoreInfo | null): boolean {
  return true;
}

/**
 * What the bill says for delivery: a plain number (the flat fee, or 0 while free deliveries
 * apply - no "FREE" wording; owner, 2026-10-16: "we are not giving free delivery, remove that
 * or replace with any other wordings"), or "Calculated at checkout" when the fee depends on the
 * address.
 */
export function deliveryFeeText(store: StoreInfo | null, format: (n: number) => string): string {
  if (freeDeliveryCount(store) > 0) return format(0);
  const flat = flatFee(store);
  return flat != null ? format(flat) : 'Calculated at checkout';
}

/** "Reopens Tue, 8 AM" from next_open_at / reopens_at (shown in Sri Lanka time); null when unknown. */
export function reopensText(store: StoreInfo | null, now: Date = new Date()): string | null {
  const iso = store?.reopens_at ?? store?.next_open_at;
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const tz = 'Asia/Colombo';
  const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: tz });
  const time = at.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const sameDay = day(at) === day(now);
  const weekday = at.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short' });
  return `Reopens ${sameDay ? 'today' : weekday}, ${time}`;
}
