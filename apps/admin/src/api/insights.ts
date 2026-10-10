import { apiRequest } from './client';

/**
 * Sales dashboard, delivery heat map and purchase list (owner, 2026-10-10).
 * Kept in its own module (types + calls) so it does not collide with the
 * shared resources.ts / types.ts. Server: backend/api/src/modules/reports/
 * dashboard.service.ts, order-map.service.ts and inventory/purchase-list.ts.
 */

export type DashboardRange = 'today' | 'yesterday' | 'this_week' | 'this_month';
export type OrderMapRange = DashboardRange | 'last_30_days' | 'last_90_days';

export interface DashboardFigures {
  order_count: number;
  delivered_count: number;
  cancelled_count: number;
  /** total_amount of orders placed in the range that are now DELIVERED (the Sales report's revenue). */
  delivered_revenue: number;
  /** Cash riders recorded collecting for those delivered orders. */
  cash_collected: number;
  average_basket: number;
}

export interface DashboardProduct {
  product_id: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface SalesDashboard extends DashboardFigures {
  range: DashboardRange;
  timezone: string;
  period: { from: string; to: string };
  previous_period: { from: string; to: string };
  orders_by_status: Record<string, number>;
  previous: DashboardFigures;
  /** Percent change vs the previous period; null when the previous figure was 0. */
  change: Record<keyof DashboardFigures, number | null>;
  discount_given: number;
  delivery_fees: number;
  top_by_quantity: DashboardProduct[];
  top_by_revenue: DashboardProduct[];
  orders_by_hour: { hour: number; orders: number }[];
}

export type MapZone = 'inside' | 'near_edge' | 'outside';

export interface OrderMapCell {
  /** The ~150 m grid cell's centre - never an exact drop-off point. */
  lat: number;
  lng: number;
  orders: number;
  delivered: number;
  revenue: number;
  /** The town most of the cell's orders name. */
  area: string | null;
  distance_km: number;
  zone: MapZone;
}

export interface OrderMap {
  range: OrderMapRange;
  status: 'delivered' | 'all';
  timezone: string;
  period: { from: string; to: string };
  cell_meters: number;
  cell_degrees: number;
  edge_km: number;
  store: { name: string; lat: number; lng: number; radius_km: number };
  totals: {
    orders: number;
    revenue: number;
    inside: number;
    near_edge: number;
    outside: number;
    farthest_km: number | null;
    cells: number;
  };
  cells: OrderMapCell[];
  busiest: OrderMapCell[];
}

export interface PurchaseItem {
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit: string;
  pack_size: string | null;
  category_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
  target_level: number;
  stock_state: 'OUT' | 'LOW';
  suggested_quantity: number;
  unit_cost: number;
  estimated_cost: number;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
}

export interface PurchaseSupplierGroup {
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  items: PurchaseItem[];
  estimated_cost: number;
}

export interface PurchaseList {
  rule: string;
  items: PurchaseItem[];
  suppliers: PurchaseSupplierGroup[];
  totals: { products: number; out: number; units: number; estimated_cost: number };
}

export const insights = {
  /** GET /admin/reports/dashboard - ADMIN and OPERATIONS. */
  dashboard: (range: DashboardRange) => apiRequest<SalesDashboard>(`/admin/reports/dashboard?range=${range}`),
  /** GET /admin/reports/order-map - ADMIN and OPERATIONS; aggregates only. */
  orderMap: (range: OrderMapRange, status: 'delivered' | 'all') =>
    apiRequest<OrderMap>(`/admin/reports/order-map?${new URLSearchParams({ range, status }).toString()}`),
  /** GET /admin/inventory/purchase-list - ADMIN, OPERATIONS and Inventory staff. */
  purchaseList: () => apiRequest<PurchaseList>('/admin/inventory/purchase-list'),
};
