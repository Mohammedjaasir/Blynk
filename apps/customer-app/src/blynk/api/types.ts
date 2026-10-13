export interface Product {
  id: string; category_id: string; category_name: string; name: string; slug: string;
  description: string | null; unit: string; pack_size: string | null;
  image_url: string | null; image_focal_x: number | null; image_focal_y: number | null;
  selling_price: number; offer_price: number | null; offer_ends_at: string | null;
  offer_kind: 'PRODUCT' | 'CATEGORY' | 'LKR_OFF' | null; is_available: boolean;
}
export interface Category {
  id: string; name: string; slug: string; description: string | null; image_url: string | null;
  display_order: number; parent_id: string | null; offer_percent: number | null; offer_ends_at: string | null;
}
export interface HomeGroup { id: string | null; name: string; sort_order: number; categories: Category[] }
export interface Promotion {
  id: string; title: string | null; subtitle: string | null; image_url: string | null;
  background_type: 'SOLID' | 'GRADIENT' | 'IMAGE' | 'ARTWORK';
  background_color: string | null; background_color_end: string | null;
  background_image_url: string | null; background_focal_x: number; background_focal_y: number;
  cta_label: string | null;
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null; cta_destination_value: string | null;
  display_order: number;
}
export interface ComboItem {
  product_id: string; name: string; slug: string | null; unit: string | null; pack_size: string | null;
  image_url: string | null; image_focal_x: number; image_focal_y: number; quantity: number;
  selling_price: number; unit_price: number; is_available: boolean;
}
export interface Combo {
  id: string; name: string; description: string | null; image_url: string | null; price: number;
  items_total: number; saving: number; ends_at: string | null; is_available: boolean; items: ComboItem[];
}
export interface Pagination { page: number; limit: number; total: number; total_pages: number }
export interface StoreInfo {
  delivery_fee_lkr: number | null; delivery_fee_mode: 'FLAT' | 'DISTANCE_TIERS';
  /** Name of the active dark store, e.g. "Dharga Town Central Dark Store"; null when none is set up. */
  hub_name?: string | null;
  radius_km: number | null; coupons_enabled: boolean; show_offer_savings: boolean;
  new_customer_free_deliveries: { enabled: boolean; count: number; since: string };
  delivery_hours: { start: string; end: string; timezone: string };
  is_open_now: boolean; closed_kind: 'OPEN' | 'OUTSIDE_HOURS' | 'CLOSED_DAY' | 'HOLIDAY' | 'CLOSED_NOW';
  closed_reason: string | null; next_open_at: string | null; reopens_at?: string | null; delivery_slots_enabled: boolean;
  doctors_require_sign_in: boolean;
}
