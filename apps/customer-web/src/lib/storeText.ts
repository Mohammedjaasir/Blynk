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
