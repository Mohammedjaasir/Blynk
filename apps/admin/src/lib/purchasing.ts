/*
 * Reorder suggestions and purchase orders (owner, 2026-10-25; migration 058). Pure helpers shared by
 * the Admin pages: labels, selection, the request bodies and the receive form. Server:
 * backend/api/src/modules/purchasing. Money is LKR.
 */
export type PoStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
export type ReorderReason = 'OUT' | 'LOW' | 'WONT_LAST' | 'FAST';

export const PO_STATUSES: readonly PoStatus[] = ['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'];

export const STATUS_LABEL: Record<PoStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PARTIAL: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

/** Status chip tone (the Badge tones the apps already have). */
export const STATUS_TONE: Record<PoStatus, 'active' | 'inactive' | 'muted' | 'offer'> = {
  DRAFT: 'muted',
  SENT: 'offer',
  PARTIAL: 'offer',
  RECEIVED: 'active',
  CANCELLED: 'inactive',
};

export const REASON_LABEL: Record<ReorderReason, string> = {
  OUT: 'Out of stock',
  LOW: 'Low',
  WONT_LAST: "Won't last",
  FAST: 'Fast mover',
};

export interface ReorderItem {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  display_name: string;
  sku: string;
  unit: string;
  pack_size: string | null;
  category_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
  units_sold: number;
  avg_daily_units: number;
  days_of_stock_left: number | null;
  on_order: number;
  in_draft: number;
  buy_multiple: number | null;
  suggested_quantity: number;
  last_cost: number;
  estimated_cost: number;
  reasons: ReorderReason[];
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
}

export interface ReorderGroup {
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  items: ReorderItem[];
  estimated_cost: number;
}

export interface ReorderSuggestions {
  params: { days: number; cover_days: number; lead_days: number; period: { from: string; to: string } };
  rule: string;
  suppliers: ReorderGroup[];
  totals: { products: number; out: number; units: number; estimated_cost: number };
}

export interface PoLine {
  id: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  unit: string | null;
  ordered_qty: number;
  received_qty: number;
  remaining_qty: number;
  unit_cost: number;
  line_total: number;
  note: string | null;
  stock_counted: boolean;
  stock_on_hand: number | null;
}

export interface PurchaseOrderSummary {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  status: PoStatus;
  notes: string | null;
  expected_on: string | null;
  created_by_name: string | null;
  sent_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  line_count: number;
  units_ordered: number;
  units_received: number;
  cost_ordered: number;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  status: PoStatus;
  notes: string | null;
  expected_on: string | null;
  created_by_name: string | null;
  sent_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  lines: PoLine[];
  totals: { lines: number; units_ordered: number; units_received: number; cost_ordered: number; cost_received: number };
  share: { text: string; whatsapp_url: string | null };
}

export interface ReceiveResult {
  purchase_order: PurchaseOrder;
  received: { item_id: string; name: string; received_qty: number; stock_added: boolean; stock_on_hand: number | null; note: string | null }[];
  skipped: { item_id: string; name: string; received_qty: number; note: string | null }[];
}

export interface OrderLineBody {
  product_id: string;
  variant_id?: string | null;
  ordered_qty: number;
  unit_cost?: number;
  note?: string | null;
}

// ------------------------------------------------------------ suggestions

/** The line's key: the size when it is one (a product can have several size lines). */
export const itemKey = (i: Pick<ReorderItem, 'product_id' | 'variant_id'>): string => `${i.product_id}:${i.variant_id ?? ''}`;

export const supplierKey = (g: Pick<ReorderGroup, 'supplier_id'>): string => g.supplier_id ?? 'none';

export const daysLeftText = (days: number | null): string => (days === null ? 'No sales' : days < 1 ? 'Under a day' : `${days} days`);

export const perDayText = (avg: number): string => (avg === 0 ? '-' : `${avg}/day`);

export const clampQty = (n: number): number => Math.max(0, Math.min(100_000, Math.round(n) || 0));

/** Every suggested line starts ticked, at its suggested quantity. */
export function initialSelection(data: ReorderSuggestions): { qty: Record<string, number>; picked: Record<string, boolean> } {
  const qty: Record<string, number> = {};
  const picked: Record<string, boolean> = {};
  for (const g of data.suppliers) {
    for (const i of g.items) {
      qty[itemKey(i)] = i.suggested_quantity;
      picked[itemKey(i)] = true;
    }
  }
  return { qty, picked };
}

export interface ItemFilter {
  text: string;
  reason: ReorderReason | 'ALL';
}

export function matchesFilter(i: ReorderItem, f: ItemFilter): boolean {
  if (f.reason !== 'ALL' && !i.reasons.includes(f.reason)) return false;
  const q = f.text.trim().toLowerCase();
  return !q || `${i.display_name} ${i.sku} ${i.category_name}`.toLowerCase().includes(q);
}

/** The ticked lines of a group with a quantity above 0, as the create-order body. */
export function orderBodyFor(
  g: ReorderGroup,
  qty: Record<string, number>,
  picked: Record<string, boolean>,
  extra: { supplier_id?: string | null } = {}
) {
  const lines: OrderLineBody[] = g.items
    .filter((i) => picked[itemKey(i)] && (qty[itemKey(i)] ?? 0) > 0)
    .map((i) => ({ product_id: i.product_id, variant_id: i.variant_id, ordered_qty: qty[itemKey(i)]! }));
  return { supplier_id: extra.supplier_id !== undefined ? extra.supplier_id : g.supplier_id, lines };
}

export const lineCostOf = (i: ReorderItem, qty: number): number => Math.round(i.last_cost * qty * 100) / 100;

// ------------------------------------------------------------ orders

export const canEditLines = (s: PoStatus) => s === 'DRAFT';
export const canSend = (s: PoStatus) => s === 'DRAFT';
export const canReceive = (s: PoStatus) => s === 'SENT' || s === 'PARTIAL';
export const canCancel = (s: PoStatus) => s === 'DRAFT' || s === 'SENT' || s === 'PARTIAL';
export const hasShareText = (s: PoStatus) => s !== 'CANCELLED';

export const progressText = (o: Pick<PurchaseOrderSummary, 'units_received' | 'units_ordered'>) => `${o.units_received} of ${o.units_ordered} received`;

export interface ReceiveEntry {
  /** What arrived now (text from the input). */
  qty: string;
  /** Cost per unit paid (text from the input). */
  cost: string;
  updateCost: boolean;
}

/** The receive form starts with what is still missing, at the line's cost. */
export function receiveDefaults(po: Pick<PurchaseOrder, 'lines'>): Record<string, ReceiveEntry> {
  return Object.fromEntries(po.lines.map((l) => [l.id, { qty: String(l.remaining_qty), cost: l.unit_cost.toFixed(2), updateCost: false }]));
}

const wholeNumber = (s: string): number | null => (/^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : null);
const moneyValue = (s: string): number | null => (/^\d{1,8}(\.\d{1,2})?$/.test(s.trim()) ? Number(s.trim()) : null);

export type ReceiveBodyResult =
  | { ok: true; body: { lines: { item_id: string; received_qty: number; unit_cost?: number; update_product_cost?: boolean }[]; close_short?: boolean } }
  | { ok: false; error: string };

/**
 * The receive request from the form: lines with nothing arrived are left out; the cost is sent only
 * when it differs from the line's cost (or "update product cost" is ticked).
 */
export function receiveBody(po: Pick<PurchaseOrder, 'lines'>, entries: Record<string, ReceiveEntry>, closeShort: boolean): ReceiveBodyResult {
  const lines: { item_id: string; received_qty: number; unit_cost?: number; update_product_cost?: boolean }[] = [];
  for (const l of po.lines) {
    const e = entries[l.id];
    if (!e) continue;
    const qty = e.qty.trim() === '' ? 0 : wholeNumber(e.qty);
    if (qty === null) return { ok: false, error: `Enter a whole number for ${l.name}.` };
    if (qty === 0) continue;
    const cost = moneyValue(e.cost);
    if (cost === null) return { ok: false, error: `Enter a valid cost for ${l.name} (at most 2 decimals).` };
    const line: { item_id: string; received_qty: number; unit_cost?: number; update_product_cost?: boolean } = { item_id: l.id, received_qty: qty };
    if (cost !== l.unit_cost || e.updateCost) line.unit_cost = cost;
    if (e.updateCost) {
      if (!(cost > 0)) return { ok: false, error: `Enter the cost of ${l.name} to update the product cost.` };
      line.update_product_cost = true;
    }
    lines.push(line);
  }
  if (lines.length === 0 && !closeShort) return { ok: false, error: 'Enter what arrived for at least one product.' };
  return { ok: true, body: { lines: lines.length ? lines : po.lines.slice(0, 1).map((l) => ({ item_id: l.id, received_qty: 0 })), ...(closeShort ? { close_short: true } : {}) } };
}

/** "27 Oct 2026" from a day or an ISO time. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

export const supplierLabel = (name: string | null) => name ?? 'No supplier yet';

/** The ticked lines of a group as plain text to copy / send before an order exists ("Order for X:" then "10 x Sugar"). */
export function suggestionText(g: ReorderGroup, qty: Record<string, number>, picked: Record<string, boolean>): string {
  const lines = g.items.filter((i) => picked[itemKey(i)] && (qty[itemKey(i)] ?? 0) > 0).map((i) => `${qty[itemKey(i)]} x ${i.display_name}`);
  return [`Order for ${g.supplier_name ?? 'supplier'}:`, ...lines].join('\n');
}
