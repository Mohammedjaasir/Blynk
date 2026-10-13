import type { Product, Category, StoreInfo } from '../api/types';
export const milk: Product = { id: 'p-milk', category_id: 'c-dairy', category_name: 'Dairy & Eggs', name: 'Kotmale Fresh Milk 1L', slug: 'kotmale-fresh-milk-1l', description: null, unit: '1 L', pack_size: null, image_url: null, image_focal_x: 50, image_focal_y: 50, selling_price: 540, offer_price: 513, offer_ends_at: null, offer_kind: 'CATEGORY', is_available: true };
export const sugar: Product = { ...milk, id: 'p-sugar', category_id: 'c-groc', category_name: 'Groceries', name: 'White Sugar 1KG', slug: 'white-sugar-1kg', unit: '1KG', selling_price: 253, offer_price: null, offer_kind: null };
export const dairy: Category = { id: 'c-dairy', name: 'Dairy & Eggs', slug: 'dairy-eggs', description: null, image_url: null, display_order: 0, parent_id: null, offer_percent: 5, offer_ends_at: null };
export const store: StoreInfo = { delivery_fee_lkr: null, delivery_fee_mode: 'DISTANCE_TIERS', radius_km: 4, coupons_enabled: false, show_offer_savings: false, new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' }, delivery_hours: { start: '08:00', end: '21:00', timezone: 'Asia/Colombo' }, is_open_now: true, closed_kind: 'OPEN', closed_reason: null, next_open_at: null, delivery_slots_enabled: false, doctors_require_sign_in: true };

/** A minimal in-memory Storage, standing in for the browser's localStorage. */
export class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
