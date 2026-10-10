import type { DashboardRange, OrderMapRange, PurchaseItem } from '../api/insights';

/**
 * Pure helpers for the sales dashboard, delivery map and purchase list
 * (owner, 2026-10-10). No React here, so each rule is unit-tested on its own.
 */

export const DASHBOARD_RANGE_LABEL: Record<DashboardRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  this_month: 'This month',
};

/** What each range is compared with (the server's rule, in words). */
export const COMPARED_WITH: Record<DashboardRange, string> = {
  today: 'vs yesterday',
  yesterday: 'vs the day before',
  this_week: 'vs the same days last week',
  this_month: 'vs the same days last month',
};

export const ORDER_MAP_RANGE_LABEL: Record<OrderMapRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  this_month: 'This month',
  last_30_days: '30 days',
  last_90_days: '90 days',
};

/** Status breakdown order: the live pipeline first, then how orders ended. */
export const STATUS_ORDER = [
  'PLACED',
  'ITEM_UNAVAILABLE',
  'PACKED',
  'OUT_FOR_DELIVERY',
  'CUSTOMER_UNAVAILABLE',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
] as const;

export interface Change {
  text: string;
  tone: 'up' | 'down' | 'flat';
  /** Screen-reader wording. */
  label: string;
}

/** "↑ 12%", "↓ 5%", "0%", or "—" when there is nothing earlier to compare with. */
export function changeOf(pct: number | null): Change {
  if (pct === null) return { text: '—', tone: 'flat', label: 'nothing to compare with' };
  if (pct === 0) return { text: '0%', tone: 'flat', label: 'no change' };
  const abs = Math.abs(pct);
  const shown = abs >= 100 ? Math.round(abs).toString() : abs.toFixed(abs % 1 === 0 ? 0 : 1);
  return pct > 0
    ? { text: `↑ ${shown}%`, tone: 'up', label: `up ${shown} percent` }
    : { text: `↓ ${shown}%`, tone: 'down', label: `down ${shown} percent` };
}

export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** The busiest hour, or null when there were no orders. */
export function peakHour(hours: { hour: number; orders: number }[]): { hour: number; orders: number } | null {
  const best = hours.reduce<{ hour: number; orders: number } | null>((b, h) => (h.orders > (b?.orders ?? 0) ? h : b), null);
  return best;
}

// ------------------------------------------------------------ purchase list

/** The suggestion rule, as the server applies it (purchase-list.ts). */
export function suggestedQuantity(threshold: number, available: number): number {
  return Math.max(1, threshold * 2 - available);
}

export interface PurchaseLine {
  item: PurchaseItem;
  quantity: number;
}

/** "Sugar (1 kg)" - the name plus the pack, so the supplier sends the right size. */
export function lineName(item: Pick<PurchaseItem, 'product_name' | 'product_unit' | 'pack_size'>): string {
  const pack = item.pack_size || item.product_unit;
  return pack && !item.product_name.toLowerCase().includes(pack.toLowerCase()) ? `${item.product_name} (${pack})` : item.product_name;
}

/**
 * WhatsApp-friendly order text:
 *   Blynk order for Lanka Wholesale:
 *   10 × Sugar (1 kg)
 *   6 × Dhal (500 g)
 * Lines with quantity 0 are skipped.
 */
export function purchaseText(supplierName: string | null, lines: PurchaseLine[]): string {
  const kept = lines.filter((l) => l.quantity > 0);
  const head = `Blynk order for ${supplierName ?? 'supplier'}:`;
  return [head, ...kept.map((l) => `${l.quantity} × ${lineName(l.item)}`)].join('\n');
}

/** A wa.me link with the text filled in; to the supplier's number when it is known. */
export function whatsappUrl(text: string, phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The purchase list as CSV (Excel opens it), lines with quantity 0 skipped. */
export function purchaseCsv(lines: PurchaseLine[]): string {
  const header = ['Supplier', 'Product', 'SKU', 'Unit', 'Available', 'Low-stock level', 'Quantity', 'Unit cost (LKR)', 'Estimated cost (LKR)'];
  const rows = lines
    .filter((l) => l.quantity > 0)
    .map((l) => [
      l.item.supplier_name ?? 'No supplier yet',
      l.item.product_name,
      l.item.product_sku,
      l.item.pack_size || l.item.product_unit,
      l.item.quantity_available,
      l.item.low_stock_threshold,
      l.quantity,
      l.item.unit_cost.toFixed(2),
      (l.item.unit_cost * l.quantity).toFixed(2),
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const lineCost = (lines: PurchaseLine[]) => Number(lines.reduce((s, l) => s + l.item.unit_cost * l.quantity, 0).toFixed(2));

// --------------------------------------------------------------- order map

/** A ring of points around the hub, for drawing the service radius (GeoJSON order: lng, lat). */
export function circlePolygon(lat: number, lng: number, radiusKm: number, steps = 64): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    pts.push([Number((lng + dLng * Math.cos(a)).toFixed(6)), Number((lat + dLat * Math.sin(a)).toFixed(6))]);
  }
  return pts;
}

export const ZONE_LABEL = { inside: 'Inside', near_edge: 'Near the edge', outside: 'Outside' } as const;

/** One line for the owner on whether the radius looks right. */
export function radiusAdvice(t: { orders: number; near_edge: number; outside: number }, radiusKm: number, edgeKm: number): string {
  if (t.orders === 0) return 'No orders in this period.';
  const edgeShare = (t.near_edge + t.outside) / t.orders;
  if (t.outside > 0) {
    return `${t.outside} ${t.outside === 1 ? 'order was' : 'orders were'} outside the ${radiusKm} km radius.`;
  }
  if (edgeShare >= 0.2) {
    return `${Math.round(edgeShare * 100)}% of orders came from the last ${edgeKm} km - demand reaches the edge; a bigger radius may pay.`;
  }
  return `Most orders come from well inside the ${radiusKm} km radius.`;
}
