export interface Product {
  id: string; category_id: string; category_name: string; name: string; slug: string;
  description: string | null; unit: string; pack_size: string | null;
  image_url: string | null; image_focal_x: number | null; image_focal_y: number | null;
  selling_price: number; offer_price: number | null; offer_ends_at: string | null;
  offer_kind: 'PRODUCT' | 'CATEGORY' | 'LKR_OFF' | null; is_available: boolean;
  /*
   * Variants, stock and lead time (migration 045; docs/api/catalog-variants-stock-leadtime.md).
   * Optional: an older server (and the design mock) leaves them out, which means "no variants,
   * same day". is_available already means "orderable now" (switched on and not sold out).
   */
  /** The customer must pick a size/pack; the order line then carries variant_id. */
  has_variants?: boolean;
  variant_count?: number;
  /** What one unit costs now (offers included); for variants the cheapest / dearest available one. */
  price_min?: number;
  price_max?: number;
  /** 0 = same day. N = can be delivered from today + N days. */
  delivery_lead_days?: number;
  /** YYYY-MM-DD (Asia/Colombo) of the first delivery day when delivery_lead_days > 0. */
  earliest_delivery_date?: string | null;
  /** Only on GET /catalog/products/:id: the active variants in staff order ([] without variants). */
  variants?: ProductVariant[];
  /**
   * MRP (migration 048; docs/api/catalog-mrp.md): sent only when it is above what the customer
   * pays now, else null (absent on an older server). With sizes: the cheapest size's.
   */
  mrp?: number | null;
  /**
   * Migration 050 (owner, 2026-10-18): Admin / Ops' per-product "show offer price cut"; false
   * hides the struck "was" price and the saving for this product. Absent (older server) = on.
   */
  show_offer_cut?: boolean;
}
/** One size/pack of a product ("50 g", "3 pack"), as GET /catalog/products/:id lists it. */
export interface ProductVariant {
  id: string; label: string; sku: string | null; barcode: string | null; sort_order: number;
  selling_price: number; offer_price: number | null; offer_ends_at: string | null; offer_kind: 'PRODUCT' | 'CATEGORY' | null;
  /** offer_price ?? selling_price: exactly what the basket charges now. */
  price: number;
  /** False = sold out or switched off (shown greyed out). */
  is_available: boolean;
  /** This size's MRP when above `price` (migration 048), else null / absent. */
  mrp?: number | null;
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
  /**
   * What the destination resolves to (2026-10-14, docs/api/catalog-tools.md). null: no destination
   * or it no longer exists (the banner is not tappable). Absent on an older backend.
   */
  cta_target?: PromotionTarget | null;
  display_order: number;
}
export type PromotionTargetLevel = 'MAIN' | 'CATEGORY' | 'SUB_CATEGORY' | 'PRODUCT' | 'CATALOG';
export interface PromotionTarget {
  level: PromotionTargetLevel;
  id: string | null; slug: string | null; name: string | null;
  /** SUB_CATEGORY: its parent category (the screen whose sidebar it sits in). */
  parent_id: string | null; parent_slug: string | null; parent_name: string | null;
  is_active: boolean | null;
}
export interface ComboItem {
  product_id: string; name: string; slug: string | null; unit: string | null; pack_size: string | null;
  image_url: string | null; image_focal_x: number; image_focal_y: number; quantity: number;
  selling_price: number; unit_price: number; is_available: boolean;
  /** Migration 045: the combo holds this size of the product (null = the product itself). */
  variant_id?: string | null; variant_label?: string | null;
}
export interface Combo {
  id: string; name: string; description: string | null; image_url: string | null; price: number;
  items_total: number; saving: number; ends_at: string | null; is_available: boolean; items: ComboItem[];
  /** Migration 045: the longest lead time of its items (0 / absent = same day). */
  delivery_lead_days?: number;
}
export interface Pagination { page: number; limit: number; total: number; total_pages: number }
/** GET /store and GET /orders/checkout-info `online_payment` (never any credential). */
export interface OnlinePaymentInfo {
  enabled: boolean; provider: string; methods_note: string | null; payment_window_minutes: number;
}
export interface StoreInfo {
  delivery_fee_lkr: number | null; delivery_fee_mode: 'FLAT' | 'DISTANCE_TIERS';
  /** The lowest delivery fee (per-km tiers: the first km's), for "From LKR 100" before an address is known. */
  delivery_fee_from_lkr?: number | null;
  /** Name of the active dark store, e.g. "Dharga Town Central Dark Store"; null when none is set up. */
  hub_name?: string | null;
  radius_km: number | null; coupons_enabled: boolean; show_offer_savings: boolean;
  /** Where the radius is measured from (the active dark store); absent on an older server. */
  store_location?: { lat: number; lng: number } | null;
  /** PayHere (docs/api/payhere.md): "Pay online" is offered only while enabled. Absent = off. */
  online_payment?: OnlinePaymentInfo;
  new_customer_free_deliveries: { enabled: boolean; count: number; since: string };
  delivery_hours: { start: string; end: string; timezone: string };
  /** The weekly hours as set in Admin / Ops (each day open/close or closed); absent on an older API. */
  hours?: { same_every_day: boolean; days: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { closed: boolean; open: string; close: string }>> };
  is_open_now: boolean; closed_kind: 'OPEN' | 'OUTSIDE_HOURS' | 'CLOSED_DAY' | 'HOLIDAY' | 'CLOSED_NOW';
  closed_reason: string | null; next_open_at: string | null; reopens_at?: string | null; delivery_slots_enabled: boolean;
  doctors_require_sign_in: boolean;
  /** Doctor channelling shown to customers (2026-10-14). false: hide the doctors section. Absent on an older backend. */
  doctors_enabled?: boolean;
  /**
   * Home promo band, set in Admin and Ops (docs/promo-surfaces.md). null = hidden (off or
   * outside its schedule); missing (an older API) = the band's built-in look.
   */
  promo_band?: PublicPromoBand | null;
  /**
   * Home hero banner, set in Admin and Ops (docs/promo-surfaces.md §3). An object = their
   * custom words while live; null or missing (an older API) = the automatic banner.
   */
  hero_banner?: PublicHeroBanner | null;
  /**
   * Blynk Points (owner, 2026-10-14: points instead of free delivery): the public earn rule
   * while Admin / Ops have the program on; null = off; missing = an older API (off).
   */
  points_program?: PublicPointsProgram | null;
  /**
   * The app's other words and Home's aisle colours as set in Admin / Ops (owner, 2026-10-18:
   * "make sure each and everything was editable from the admin"). Only the fields staff set;
   * anything missing keeps the app's own (src/blynk/lib/appTexts.ts).
   */
  app_texts?: PublicAppTexts;
}

export interface PublicAppTexts {
  home_explore_title?: string; home_aisle_offer?: string; home_band_kicker?: string;
  home_band_title_offers?: string; home_band_title_aisles?: string; home_footer_title?: string; home_footer_sub?: string;
  aisle_banner_title?: string; aisle_banner_sub?: string;
  cart_header_pill?: string; cart_burst_top?: string; cart_burst_bottom?: string; cart_burst_big?: string;
  cart_burst_line_1?: string; cart_burst_line_2?: string; cart_bar_line?: string; cart_basket_title?: string; cart_bill_note?: string;
  pay_online_coming_soon?: string; placed_title?: string; placed_sub?: string;
  home_aisle_lines?: string[]; login_headlines?: string[];
  home_under_amount?: number;
  /** Surface colours (#RRGGBB): the Home banner's top/bottom, the offers band, the cart header, the cart bar and its strip. */
  hero_bg_top?: string; hero_bg_bottom?: string; home_band_bg?: string;
  cart_header_bg?: string; cart_bar_bg?: string; cart_bar_strip_bg?: string;
  /** Home's offer tiles: the price text colour and the fade behind it (#RRGGBB). */
  vs_text?: string; vs_shade?: string;
  /** Category id -> #RRGGBB card colour. */
  aisle_colors?: Record<string, string>;
}

/** GET /store `points_program`. */
export interface PublicPointsProgram {
  enabled: boolean;
  earn_points: number;
  earn_per_lkr: number;
  lkr_per_point: number;
  min_redeem_points: number;
}

/** Where a promo surface goes when tapped: the same resolved target a promotion carries. */
export type PromoTarget = PromotionTarget;

/** GET /store `promo_band`: the band as the app should draw it now. */
export interface PublicPromoBand {
  lines: string[];
  ticks: string[];
  background: string;
  colors: { start: string; end: string; text: string };
  item: { kind: 'NONE' | 'ILLUSTRATED' | 'IMAGE'; illustration: string | null; image_url: string | null };
  mascot: 'WAVE' | 'RIDE' | 'OFF';
  cta_target: PromoTarget | null;
  ends_at: string | null;
}

/** GET /store `hero_banner`: the custom hero banner (tokens {min_price} / {free_count} / {points_rule} are filled in by the app). */
export interface PublicHeroBanner {
  mode: 'CUSTOM';
  title: [string, string];
  lines: string[];
  cta_label: string;
  /** Where the button goes; null = the app's own (scroll to the aisles). */
  cta_target: PromoTarget | null;
  items: string[];
  /** More slides after the main one, each with its own words (owner, 2026-10-23); missing = an older API. */
  slides?: { title: [string, string]; line: string | null; item: string | null }[];
  ends_at: string | null;
}
