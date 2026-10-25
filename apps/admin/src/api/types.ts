import type { ActiveDelivery, ItemsSummary, OrderStatus } from '../lib/orders';
import type { PaymentMethod, PaymentStatus } from '../lib/payments';
import type { CustomerAudience } from '../lib/customerGroups';

/** Shapes returned by the Blynk API - mirrors of the backend DTOs. */

export type UserRole =
  | 'CUSTOMER'
  | 'ADMIN'
  | 'PACKING_STAFF'
  | 'RIDER'
  | 'OPERATIONS'
  | 'SUPPORT';

/** Roles an existing account can be moved between (backend migration 014). */
export type StaffRole = 'PACKING_STAFF' | 'OPERATIONS';

/** Roles a new account can be created with (an ADMIN may create all four). */
export type CreatableRole = 'ADMIN' | 'OPERATIONS' | 'PACKING_STAFF' | 'RIDER';

/** GET /admin/staff row. ADMIN rows come back with read_only: true. */
export interface StaffAccount {
  id: string;
  full_name: string | null;
  email: string | null;
  /** null for Admin and Inventory accounts: they have no phone (backend migration 028). */
  phone: string | null;
  role: CreatableRole;
  has_password: boolean;
  disabled: boolean;
  read_only: boolean;
  created_at: string;
  /** "Can deliver" (staff riders): the account's rider profile, null when none. */
  rider?: StaffRider | null;
}

/** An account's rider profile: a Rider's own, or an Operations/Admin "Can deliver" one. */
export interface StaffRider {
  id: string;
  is_active: boolean;
  vehicle_type: string;
  vehicle_registration_number: string;
  emergency_contact_phone?: string | null;
}

export type VehicleType = 'MOTORCYCLE' | 'SCOOTER' | 'BICYCLE' | 'THREE_WHEELER' | 'CAR';

export interface StaffRiderInput {
  can_deliver: boolean;
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
}

export interface CreateStaffInput {
  full_name: string;
  email: string;
  password: string;
  role: CreatableRole;
  /** Operations and Rider accounts only (required for them); Admin and Inventory have none. */
  phone?: string;
  /** Rider accounts only. */
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
  emergency_contact_phone?: string | null;
}

export interface UpdateStaffInput {
  full_name?: string;
  role?: StaffRole;
  /** Needed when moving an account to Operations (400 PHONE_REQUIRED otherwise). */
  phone?: string;
  password?: string;
  disabled?: boolean;
  /** Rider accounts only. */
  vehicle_type?: VehicleType;
  vehicle_registration_number?: string;
  emergency_contact_phone?: string | null;
}

export interface AuthUser {
  id: string;
  /** null for accounts without a phone (Admin, Inventory: backend migration 028). */
  phone: string | null;
  full_name: string | null;
  email: string | null;
  role: UserRole;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  /** Live, non-deleted products in this category (GET /admin/categories). */
  product_count?: number;
  /**
   * Products listed here only through an extra category (migration 060); null = the migration has
   * not run yet (the product form hides "Also show in"). Absent on an older server.
   */
  extra_product_count?: number | null;
  /** The Home tile group it sits in (null = unassigned). */
  group_id?: string | null;
  group_sort_order?: number;
  /** The category this one sits inside (null = top level). One level only. */
  parent_id?: string | null;
  /**
   * Category offer (owner, 2026-10-09; migration 033): % off every product in
   * this category and its sub-categories, with an optional end (ISO).
   * `offer_active` is true only while it runs right now.
   */
  offer_percent?: number | null;
  offer_ends_at?: string | null;
  offer_active?: boolean;
  /**
   * Category markup (migration 044; owner, 2026-10-13): the markup % for
   * MARKUP products here without their own; null = the parent's, else the
   * global default.
   */
  markup_percent?: number | null;
  /** MARKUP products without a custom markup that follow this category (its sub-categories' too, when they have none). */
  markup_product_count?: number;
}

/**
 * Arrange (owner, 2026-10-10): one row of a category's "Arrange products"
 * list (`GET /admin/categories/:id/product-order`), in the order customers
 * see them. `display_order` null = not arranged (A-Z after the arranged).
 */
export interface ArrangeProduct {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  image_focal_x: number;
  image_focal_y: number;
  selling_price: number;
  is_active: boolean;
  is_available: boolean;
  display_order: number | null;
}

export interface CategoryProductOrder {
  category: { id: string; name: string; parent_id: string | null };
  products: ArrangeProduct[];
}

/** A category as listed inside a group (GET /admin/category-groups). */
export interface GroupCategory {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  is_active: boolean;
  group_id: string | null;
  /** The group's stored list position; kept for compatibility, no longer the
   * display order (owner, 2026-10-10). */
  group_sort_order: number;
  /** Arrange order (Categories -> Arrange), which the group lists by. Absent on an older API. */
  display_order?: number;
}

/** A titled row of category tiles on the customer Home, e.g. "Grocery & Kitchen". */
export interface CategoryGroup {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** In Arrange order (display_order, name; owner, 2026-10-10). */
  categories: GroupCategory[];
}

/** GET /admin/category-groups: groups in order, plus live categories in no group. */
export interface CategoryGroupsOverview {
  groups: CategoryGroup[];
  unassigned: GroupCategory[];
}

/** DELETE /admin/category-groups/:id - its categories become unassigned. */
export interface CategoryGroupDeleteResult {
  group_id: string;
  released_category_count: number;
}

// ------------------------------------------------------ category import
/**
 * Import categories (owner, 2026-10-14; backend catalog.category-import.ts).
 * Main = a category group (home section), Category = a top-level category
 * (a tile), Sub-category = a child category (the sidebar inside it).
 */
export type CategoryImportAction = 'create' | 'update' | 'keep';

export interface CategoryImportNode {
  name: string;
  id: string | null;
  action: CategoryImportAction;
  changes: string[];
  /** Whether customers will see it (an existing item keeps its own state). */
  active: boolean;
  warnings: string[];
  /** Text line or sheet row it came from. */
  source: number;
}
export interface CategoryImportSubNode extends CategoryImportNode {
  display_order: number;
}
export interface CategoryImportCategoryNode extends CategoryImportNode {
  display_order: number;
  sub_categories: CategoryImportSubNode[];
}
export interface CategoryImportMainNode extends CategoryImportNode {
  sort_order: number;
  categories: CategoryImportCategoryNode[];
}

export interface CategoryImportIssue {
  line: number | null;
  message: string;
}

export interface CategoryImportCounts {
  create: number;
  update: number;
  keep: number;
}

export interface CategoryImportResult {
  dry_run: boolean;
  summary: {
    mains: CategoryImportCounts;
    categories: CategoryImportCounts;
    sub_categories: CategoryImportCounts;
    /** Existing groups/categories not in the list, kept after the listed ones. */
    others_reordered: number;
  };
  tree: CategoryImportMainNode[];
  warnings: string[];
  errors: CategoryImportIssue[];
  ignored_lines: CategoryImportIssue[];
}

/** One spreadsheet row (keys are matched loosely by the API); `row` = the sheet row. */
export type CategoryImportSheetRow = Record<string, string | number> & { row: number };

export type CategoryImportInput = { text: string } | { rows: CategoryImportSheetRow[] };

/** GET /admin/categories/import/template. */
export interface CategoryImportTemplate {
  text: string;
  columns: string[];
}

/** GET /admin/products/remove-images/preview (owner, 2026-10-14; ADMIN only). */
export interface RemoveImagesPreview {
  products: number;
  combos: number;
  /** Distinct uploaded files the cleared links point at. */
  files: number;
  files_on_disk: number;
  /** Links to images hosted elsewhere (cleared, nothing to delete). */
  external_links: number;
}

/** POST /admin/products/remove-images {confirm: "REMOVE"}. */
export interface RemoveImagesResult {
  products_cleared: number;
  combos_cleared: number;
  files_deleted: number;
  files_missing: number;
  files_kept_in_use: number;
}

/** GET /admin/products/remove-all/preview (owner, 2026-10-14; ADMIN only). */
export interface RemoveAllProductsPreview {
  /** Live (not yet deleted) products. */
  products: number;
  variants: number;
  products_with_images: number;
  /** Active combo packs holding one of them (switched off). */
  combos: number;
  /** Active home banners opening one of them (switched off). */
  promotions: number;
  /** Hero banner / promo band buttons opening one of them (fall back on their own). */
  banners_linked: number;
  stock_alerts: number;
  /** Orders still in progress that hold one of them (kept; still packed and delivered). */
  open_orders: number;
  products_in_open_orders: number;
  /** What "Also delete product images" would clear. */
  images: RemoveImagesPreview;
}

/** POST /admin/products/remove-all {confirm: "DELETE ALL PRODUCTS", also_remove_images}. */
export interface RemoveAllProductsResult {
  products_removed: number;
  variants_removed: number;
  combos_switched_off: number;
  promotions_switched_off: number;
  stock_alerts_cleared: number;
  open_orders_kept: number;
  images: RemoveImagesResult | null;
}

/** DELETE /admin/products/:id - HARD when never ordered, SOFT (hidden) otherwise. */
export interface ProductDeleteResult {
  product_id: string;
  mode: 'HARD' | 'SOFT';
}

/** DELETE /admin/categories/:id */
export interface CategoryDeleteResult {
  category_id: string;
  moved_product_count: number;
  mode: 'HARD' | 'SOFT';
}

/** One per-km tier (owner, 2026-10-10): km 1..n in order; the last row repeats. */
export interface KmTier {
  km: number;
  lkr: number;
}

/**
 * FLAT: everyone pays fee_lkr; DISTANCE_TIERS: per-km tiers on the road distance (owner, 2026-10-10);
 * BASE_PER_KM: a base fee for the first base_km, then per_km_lkr for each extra started km (owner, 2026-10-25).
 */
export type DeliveryFeeMode = 'FLAT' | 'DISTANCE_TIERS' | 'BASE_PER_KM';

/** GET/PATCH /admin/settings/delivery-fee */
export interface DeliveryFeeSetting {
  fee_lkr: number;
  /** Per-km tiers (owner, 2026-10-10). Optional: an API from before them leaves these out (= FLAT). */
  fee_mode?: DeliveryFeeMode;
  /** May be [] when never set. */
  tiers?: KmTier[];
  /** null = no cap. */
  max_fee_lkr?: number | null;
  /** "Base + per km" (owner, 2026-10-25): always sent by the new API (defaults 120 / 2 / 40); optional for an older one. */
  base_lkr?: number;
  base_km?: number;
  per_km_lkr?: number;
  updated_at: string | null;
}

/** PATCH /admin/settings/delivery-fee - at least one field (owner, 2026-10-10). */
export interface DeliveryFeeInput {
  fee_lkr?: number;
  fee_mode?: DeliveryFeeMode;
  tiers?: KmTier[];
  max_fee_lkr?: number | null;
  base_lkr?: number;
  base_km?: number;
  per_km_lkr?: number;
}

/** GET/PATCH /admin/settings/delivery-radius (owner, 2026-10-25): the active store's service radius. */
export interface DeliveryRadiusSetting {
  radius_km: number;
  store_name: string;
}

/** GET/PATCH /admin/settings/checkout - checkout switches (owner, 2026-10-08). */
export interface CheckoutSettings {
  coupons_enabled: boolean;
  /**
   * Free deliveries for every customer (owner, 2026-10-09): `count` free
   * deliveries per customer, counting only orders placed on or after `since`
   * (ISO). PATCH may omit `since` to keep the stored one.
   */
  new_customer_free_deliveries: { enabled: boolean; count: number; since: string };
  /** The customer app shows "Save LKR X" on offers (owner, 2026-10-10).
   * Optional: a backend from before the switch leaves it out (= off). */
  show_offer_savings?: boolean;
  /**
   * Free delivery when the item subtotal (after item offers, before coupons)
   * is at least `min_subtotal_lkr` (owner, 2026-10-12). Optional: a backend
   * from before it leaves it out (= off).
   */
  basket_free_delivery?: BasketFreeDeliverySetting;
  /**
   * "Allow ordering for someone else" and "Send delivery code to receiver"
   * (owner, 2026-10-12). Optional: a backend from before it leaves it out.
   */
  order_for_someone_else?: OrderForSomeoneElseSetting;
  /**
   * Small-order fee (owner, 2026-10-25): items under `min_subtotal_lkr` pay `fee_lkr` on top of delivery. Off by
   * default. Optional: a backend from before it leaves it out.
   */
  small_order_fee?: SmallOrderFeeSetting;
  /** false until migration 063 has been run by hand; switching the fee on then answers 409 SMALL_ORDER_FEE_NOT_READY. */
  small_order_fee_ready?: boolean;
  updated_at: string | null;
}

export interface BasketFreeDeliverySetting {
  enabled: boolean;
  min_subtotal_lkr: number;
}

export interface SmallOrderFeeSetting {
  enabled: boolean;
  min_subtotal_lkr: number;
  fee_lkr: number;
}

export interface OrderForSomeoneElseSetting {
  enabled: boolean;
  send_code_to_receiver: boolean;
}

/** GET/PATCH /admin/settings/customer-sms-language (owner, 2026-10-12). */
export type CustomerSmsLanguageMode = 'ENGLISH_ONLY' | 'CUSTOMER_CHOICE' | 'ALWAYS_SINHALA' | 'ALWAYS_TAMIL';
export type SmsLanguageCode = 'si' | 'ta' | 'en';

export interface CustomerSmsLanguageSetting {
  mode: CustomerSmsLanguageMode;
  /** CUSTOMER_CHOICE: the language for customers who never picked one. */
  fallback: SmsLanguageCode;
  updated_at: string | null;
  /** The "on the way" SMS in each language, as it goes out, with its SMS parts. */
  samples?: Array<{ lang: SmsLanguageCode; text: string; parts: number }>;
}

/** One spreadsheet row sent to POST /admin/products/import. */
export interface ImportRow {
  row?: number;
  name: string;
  /** A name or slug; "Rice & Flour > Rice" picks a sub-category. */
  category: string;
  /** Optional: the sub-category (sidebar item) inside `category` (owner, 2026-10-14). */
  sub_category?: string | null;
  /** Migration 060: extra categories (names or slugs separated by ';'); blank = unchanged. */
  extra_categories?: string | null;
  unit: string;
  pack_size?: string | null;
  /** The purchase cost (the older header cost_price is read into this). null = blank: allowed with a selling_price (owner, 2026-10-21) - 0 for a new product, unchanged for an existing one. */
  purchase_cost: number | null;
  /** Given = FIXED at exactly this price (migration 044). */
  selling_price?: number | null;
  /** Given = MARKUP with this custom markup; neither = category/parent/global markup. */
  markup_percent?: number | null;
  sku: string;
  barcode?: string | null;
  description?: string | null;
  tracked?: 'yes' | 'no' | boolean | null;
  opening_stock?: number | null;
  image_url?: string | null;
  /** Variant rows (migration 045): the product's SKU; the row is then a variant of it. */
  parent_sku?: string | null;
  /** Variant rows: the variant's label, e.g. "100 g". */
  variant?: string | null;
  /** Product rows: whole days 0..30 before it can be delivered; null = unchanged / 0 for new. */
  delivery_lead_days?: number | null;
  /** Migration 048: the product's / size's MRP; null = none (new) / unchanged (existing). */
  mrp?: number | null;
}

export type ImportStatus = 'created' | 'updated' | 'skipped' | 'error';

/** The price an import row gives the product (migration 044). */
export interface ImportRowPricing {
  pricing_mode: PricingMode;
  pricing_source: PricingSource | VariantPricingSource;
  purchase_cost: number;
  selling_price: number;
  /** MARKUP: the markup used; FIXED: the implied markup over cost (null when the cost is 0). */
  effective_markup_percent: number | null;
  /** Both price cells were empty on an existing SKU: its current pricing is kept. */
  kept_current?: boolean;
  /** Migration 048: the MRP after this row, the price before the cap, and whether it capped. */
  mrp?: number | null;
  computed_selling_price?: number;
  mrp_capped?: boolean;
}

export interface ImportResultRow {
  row: number;
  sku: string | null;
  status: ImportStatus;
  /** Migration 045: 'variant' for a variant row, with its parent SKU and label. */
  kind?: 'product' | 'variant';
  parent_sku?: string;
  variant?: string;
  variant_id?: string;
  product_id?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
  /** Non-error rows: the resulting selling price and its source. */
  pricing?: ImportRowPricing;
  /** Non-blocking notes, e.g. a fixed price below the purchase cost. */
  warnings?: string[];
}

export interface ImportResponse {
  dry_run: boolean;
  summary: { created: number; updated: number; skipped: number; errors: number };
  /** Migration 048: rows whose selling price is capped at their MRP. */
  mrp_capped?: number;
  results: ImportResultRow[];
}

/** How a product's selling price is set (migration 044; owner, 2026-10-13). */
export type PricingMode = 'MARKUP' | 'FIXED';
/** Where a product's selling price comes from. */
export type PricingSource = 'FIXED' | 'PRODUCT_MARKUP' | 'CATEGORY_MARKUP' | 'PARENT_CATEGORY_MARKUP' | 'GLOBAL_MARKUP';
/** A variant's price source (migration 045): its own markup comes first in the chain. */
export type VariantPricingSource = 'VARIANT_MARKUP' | PricingSource;

/**
 * Stock as staff see it (migration 045; product or variant). Customers never
 * see a count, only whether they can order.
 */
export interface StaffStock {
  inventory_id: string | null;
  tracked: boolean;
  on_hand: number;
  reserved: number;
  /** Units in orders not yet packed. */
  in_open_orders: number;
  /** What customers can still order; null when untracked. */
  sellable: number | null;
  low_stock_threshold: number;
  is_low_stock: boolean;
  is_out_of_stock: boolean;
}

/** One size / pack of a product (migration 045; GET /admin/products/:id/variants). */
export interface StaffVariant {
  id: string;
  product_id: string;
  label: string;
  sku: string | null;
  barcode: string | null;
  sort_order: number;
  is_active: boolean;
  is_available: boolean;
  purchase_cost: number;
  pricing_mode: PricingMode;
  fixed_selling_price: number | null;
  custom_markup_percent: number | null;
  product_markup_percent?: number | null;
  category_markup_percent?: number | null;
  parent_category_markup_percent?: number | null;
  global_markup_percent?: number | null;
  effective_markup_percent: number | null;
  pricing_source: VariantPricingSource;
  /** What customers pay before offers (capped at the MRP). */
  selling_price: number;
  price_warning?: { code: 'SELLING_BELOW_COST'; message: string } | null;
  /** Migration 048: the size's own MRP (null = none), the price before the cap, and whether it capped. */
  mrp?: number | null;
  computed_selling_price?: number;
  mrp_capped?: boolean;
  offer_price: number | null;
  offer_ends_at: string | null;
  offer_active?: boolean;
  customer_price?: number;
  is_orderable?: boolean;
  stock: StaffStock;
  created_at?: string;
  updated_at?: string;
}

/** DELETE /admin/products/:id/variants/:variantId. */
export interface VariantDeleteResult {
  product_id: string;
  variant_id: string;
  /** HARD = removed (never ordered); SOFT = archived (kept for order history). */
  mode: 'HARD' | 'SOFT';
}

/** PUT /admin/inventory/:productId/stock body. */
export interface SetStockInput {
  variant_id?: string | null;
  tracked: boolean;
  stock_count?: number;
  low_stock_threshold?: number;
  reason?: string;
}

/** PUT /admin/inventory/:productId/stock answer. */
export interface SetStockResult {
  product_id: string;
  variant_id: string | null;
  stock: StaffStock;
}

/** GET|PATCH /admin/settings/default-markup. */
export interface DefaultMarkupSetting {
  markup_percent: number;
  updated_at: string | null;
  /** MARKUP products priced by the global default now. */
  products_using: number;
}

/**
 * Admin product row - includes the internal cost fields the customer never
 * sees. Stock tracking is deliberately absent: tracking_mode lives on the
 * inventory table, which belongs to the Inventory application.
 */
export interface AdminProduct {
  id: string;
  category_id: string;
  category_name?: string;
  /** Migration 060: the other categories it is also listed in (ids, then names with paths); false = hide the field. */
  extra_category_ids?: string[];
  extra_categories?: Array<{ id: string; name: string; path: string }>;
  extra_categories_ready?: boolean;
  name: string;
  slug: string;
  sku: string;
  barcode: string | null;
  unit: string;
  pack_size: string | null;
  description: string | null;
  image_url: string | null;
  purchase_cost: number;
  custom_markup_percent: number | null;
  /**
   * Selling-price modes (migration 044; owner, 2026-10-13). Optional: an API
   * from before them leaves these out (= MARKUP).
   */
  pricing_mode?: PricingMode;
  /** Kept (ignored) while the product is in MARKUP mode. */
  fixed_selling_price?: number | null;
  category_markup_percent?: number | null;
  parent_category_markup_percent?: number | null;
  global_markup_percent?: number | null;
  /** MARKUP: the markup used; FIXED: the implied markup over cost (null when the cost is 0, negative below cost). */
  effective_markup_percent?: number | null;
  pricing_source?: PricingSource;
  /** The regular selling price. */
  calculated_selling_price?: number;
  selling_price?: number;
  /** A selling price below the purchase cost (a warning; saving is allowed). */
  price_warning?: { code: 'SELLING_BELOW_COST'; message: string } | null;
  /**
   * MRP (migration 048; owner, 2026-10-14): the Maximum Retail Price (null =
   * none). selling_price is capped at it; computed_selling_price is what the
   * markup / fixed price gives, mrp_capped says the cap applied.
   */
  mrp?: number | null;
  computed_selling_price?: number;
  mrp_capped?: boolean;
  /**
   * Offer price (owner, 2026-10-09): a reduced price customers pay, as
   * stored, with an optional end (ISO). `offer_active` is true only while it
   * applies now (set, not ended, below the selling price).
   */
  offer_price?: number | null;
  offer_ends_at?: string | null;
  offer_active?: boolean;
  /** The category offer running on this product (own category or parent; owner, 2026-10-09). */
  category_offer_percent?: number | null;
  category_offer_ends_at?: string | null;
  /** What a customer pays right now: the lower of the product and category offers. */
  customer_price?: number;
  is_available: boolean;
  is_active: boolean;
  updated_at?: string;
  /** Migration 045: whole days before it can be delivered (0 = same day). */
  delivery_lead_days?: number;
  /** Migration 050: the app shows the struck "was" price and the saving (default true). */
  show_offer_cut?: boolean;
  has_variants?: boolean;
  is_orderable?: boolean;
  variant_count?: number;
  active_variant_count?: number;
  /** Regular selling prices of the active variants (the product's own price without variants). */
  price_min?: number;
  price_max?: number;
  /** The product-level stock (meaningful without variants). */
  stock?: StaffStock;
  /** Detail / create / update answers only. */
  variants?: StaffVariant[];
}

/** Why a combo is not shown to customers (owner, 2026-10-09). */
export type ComboNotLiveReason = 'INACTIVE' | 'ENDED' | 'ITEM_INACTIVE' | 'NOT_CHEAPER';

/** One product in a combo pack, per pack (GET /admin/combos). */
export interface ComboItem {
  product_id: string;
  name: string;
  slug: string | null;
  sku: string | null;
  unit: string | null;
  pack_size: string | null;
  image_url: string | null;
  image_focal_x?: number;
  image_focal_y?: number;
  quantity: number;
  /** The product's regular price. */
  selling_price: number;
  /** What one unit costs on its own today (offers included). */
  unit_price: number;
  is_active: boolean;
  is_available: boolean;
  in_stock: boolean;
  /** Tracked units free to sell; null = untracked. */
  stock_available: number | null;
}

/** A combo pack as staff see it (owner, 2026-10-09; migration 033). */
export interface Combo {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
  ends_at: string | null;
  display_order: number;
  created_at?: string;
  updated_at?: string;
  items: ComboItem[];
  /** What one pack's items cost on their own today. */
  items_total: number;
  /** items_total - price, never below 0. */
  saving: number;
  /** Shown to customers and orderable. */
  is_live: boolean;
  /** Live and every item in stock. */
  is_available: boolean;
  not_live_reason: ComboNotLiveReason | null;
}

/** POST /admin/combos; PATCH takes any subset (items replaces the whole list). */
export interface ComboInput {
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  is_active: boolean;
  ends_at?: string | null;
  display_order: number;
  items: Array<{ product_id: string; quantity: number }>;
}

/** What the customer catalog endpoint returns (no cost or markup). */
export interface CustomerProduct {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  selling_price: number;
  is_available: boolean;
}

export interface Promotion {
  id: string;
  title: string;
  subtitle: string | null;
  /** Foreground promotional/product visual. */
  image_url: string | null;
  /**
   * ARTWORK (backend promotion.schema.ts): a finished banner in
   * background_image_url, drawn full-bleed with no scrim, headline or
   * subtitle. The title is still required - it is the slide's accessibility
   * label in the customer app.
   */
  background_type: 'SOLID' | 'GRADIENT' | 'IMAGE' | 'ARTWORK';
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  /** Crop anchor for the background image, 0-100 (migration 009); 50 = centre. */
  background_focal_x?: number;
  background_focal_y?: number;
  cta_label: string | null;
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null;
  cta_destination_value: string | null;
  /**
   * What the destination points at (owner, 2026-10-14). null = no
   * destination, or it no longer exists. Absent on an older API.
   */
  cta_target?: PromotionTarget | null;
  display_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * A promotion's resolved destination (backend promotion.targets.ts):
 * MAIN = a category group (stored CATALOG + group id), CATALOG = the whole
 * catalog, CATEGORY / SUB_CATEGORY = stored CATEGORY + slug, PRODUCT = id.
 */
/**
 * Home promo band (owner, 2026-10-14; backend modules/configuration/promo-band.ts,
 * docs/promo-surfaces.md): GET|PATCH /admin/settings/promo-band.
 */
export type PromoBandBackground = 'YELLOW' | 'YELLOW_SOFT' | 'CREAM' | 'WHITE' | 'INK' | 'GREEN';
export type PromoBandTextColor = 'INK' | 'WHITE' | 'YELLOW' | 'BROWN' | 'GREEN';
export type PromoBandMascot = 'WAVE' | 'RIDE' | 'OFF';
export type PromoBandItemKind = 'NONE' | 'ILLUSTRATED' | 'IMAGE';
export interface PromoBandFields {
  enabled: boolean;
  lines: string[];
  ticks: string[];
  background: PromoBandBackground;
  /** null = automatic (the most readable colour). */
  text_color: PromoBandTextColor | null;
  item_kind: PromoBandItemKind;
  item_illustration: string | null;
  item_image_url: string | null;
  mascot: PromoBandMascot;
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null;
  cta_destination_value: string | null;
  starts_at: string | null;
  ends_at: string | null;
}
export interface PromoBandSetting extends PromoBandFields {
  cta_target: PromotionTarget | null;
  status: 'LIVE' | 'OFF' | 'SCHEDULED' | 'ENDED';
  updated_at: string | null;
}

/**
 * Home hero banner (backend modules/configuration/hero-banner.ts,
 * docs/promo-surfaces.md §3): GET|PATCH /admin/settings/hero-banner.
 * AUTO = the app's automatic words; CUSTOM = these.
 */
export type HeroBannerMode = 'AUTO' | 'CUSTOM';
export type HeroBannerItem = 'milk' | 'bread' | 'apple' | 'carrot' | 'egg' | 'broccoli' | 'banana' | 'diaper' | 'soap' | 'biscuit' | 'bottle';
/** One more slide after the main banner (owner, 2026-10-23): its own words; line '' / item null = the main ones. */
export interface HeroBannerSlide {
  title_1: string;
  title_2: string;
  line: string;
  item: HeroBannerItem | null;
}
export interface HeroBannerFields {
  mode: HeroBannerMode;
  title_1: string;
  title_2: string;
  /** 1-4 rolling sub-lines; tokens {min_price}, {free_count} and {points_rule}. */
  lines: string[];
  cta_label: string;
  /** null = the app's own (scroll down to the aisles). */
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null;
  cta_destination_value: string | null;
  items: HeroBannerItem[];
  /** Up to 4 more slides, shown one after another. */
  slides: HeroBannerSlide[];
  starts_at: string | null;
  ends_at: string | null;
}
export interface HeroBannerSetting extends HeroBannerFields {
  cta_target: PromotionTarget | null;
  status: 'AUTO' | 'LIVE' | 'SCHEDULED' | 'ENDED';
  updated_at: string | null;
}

export interface PromotionTarget {
  level: 'MAIN' | 'CATEGORY' | 'SUB_CATEGORY' | 'PRODUCT' | 'CATALOG';
  id: string | null;
  slug: string | null;
  name: string | null;
  parent_id: string | null;
  parent_slug: string | null;
  parent_name: string | null;
  is_active: boolean | null;
}

export interface Paginated<T> {
  products: T[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ------------------------------------------------------------- orders
/** A row of GET /admin/orders (the staff Orders board). */
export interface BoardOrder {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  total_amount: number;
  /** Blynk Wallet (docs/api/wallet.md): what the wallet paid; total_amount stays what is still to pay. Absent on an older API. */
  wallet_amount_used?: number;
  placed_at: string;
  updated_at: string;
  scheduled_for: string | null;
  /** Slot end (migration 036); null on older orders - show just the start (owner, 2026-10-10). */
  scheduled_until?: string | null;
  delivery_recipient_name: string;
  delivery_address_line1: string;
  delivery_city: string;
  items_summary: ItemsSummary;
  active_delivery: ActiveDelivery | null;
  /** Absent on an older API. */
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus | string;
  /** Online orders only (migration 047): when an unpaid order is cancelled. */
  payment_expires_at?: string | null;
  /** Migration 054: the repeat basket this order was placed from ("Repeat" tag); null/absent otherwise. */
  repeat_basket_id?: string | null;
}

/** The customer's rating of a delivered order (migration 055), as staff see it. */
export interface OrderRatingInfo {
  stars: number;
  tags?: string[] | null;
  comment?: string | null;
  created_at?: string | null;
}

export interface OrderItemRow {
  id: string;
  product_name_snapshot: string;
  quantity: number;
  item_status: 'PENDING' | 'SOURCED' | 'PACKED' | 'UNAVAILABLE' | 'SUBSTITUTED';
  /**
   * Admin detail only. Read to tell a substitution with a recorded cost from
   * one without (what blocks packing); never rendered.
   */
  actual_unit_cost?: number | string | null;
  product_id?: string | null;
  /** The order combo line this item belongs to; null for a loose item (owner, 2026-10-09). */
  order_combo_id?: string | null;
  /** Migration 045: the variant ordered (null without variants) and its label then. */
  variant_id?: string | null;
  variant_label_snapshot?: string | null;
  /** The unit then; equals the variant label on variant lines. */
  unit_snapshot?: string | null;
}

/** One combo pack line of an order; its items point at it by order_combo_id. */
export interface OrderCombo {
  id: string;
  order_id: string;
  combo_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  /** One pack's items at their own prices. */
  items_regular_total: number;
}

export interface OrderHistoryRow {
  id: string;
  old_status: OrderStatus | null;
  new_status: OrderStatus;
  reason_or_notes: string | null;
  created_at: string;
}

/** order.payment in the admin order detail (gateway fields only for online orders). */
export interface OrderPayment {
  gateway?: 'PAYHERE' | null;
  gateway_payment_id?: string | null;
  gateway_status_code?: number | string | null;
  /** e.g. "VISA". */
  gateway_method?: string | null;
  gateway_status_message?: string | null;
  /** Money arrived for a cancelled/expired order, the amount did not match, or a chargeback. */
  refund_required?: boolean;
  failed_at?: string | null;
  [key: string]: unknown;
}

/** Who made an order's delivery free, what the fee was and why (POST /admin/orders/:id/waive-delivery-fee). */
export interface DeliveryFeeWaiver {
  original_fee: number;
  reason: string | null;
  waived_by_name: string | null;
  waived_at: string;
}

/** GET /admin/orders/:id - only the fields the Orders panel shows. */
export interface OrderDetail {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus | string;
  /** Online orders only (migration 047): an AWAITING_PAYMENT order is cancelled after this. */
  payment_expires_at?: string | null;
  /** The payment row with the PayHere fields (docs/api/payhere.md section 2); absent on an older API. */
  payment?: OrderPayment | null;
  subtotal_amount: number;
  delivery_fee: number;
  /** Small-order fee (owner, 2026-10-25; migration 063): 0 / absent when none. Included in total_amount. */
  small_order_fee?: number;
  /** Coupon discount (backend migration 018); total = subtotal + delivery fee - discount. */
  discount_amount?: number;
  coupon_code?: string | null;
  /** Birthday gift (owner, 2026-10-09): when > 0 it is the whole discount_amount and coupon_code is null. */
  birthday_discount_amount?: number;
  total_amount: number;
  /** Blynk Wallet (docs/api/wallet.md): what the wallet paid; total_amount stays what is still to pay. Absent on an older API. */
  wallet_amount_used?: number;
  placed_at: string;
  scheduled_for: string | null;
  /** Slot end (migration 036); null on older orders (owner, 2026-10-10). */
  scheduled_until?: string | null;
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  /** Migration 024: a second number from the address; null when none was given. */
  delivery_alternate_phone?: string | null;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  delivery_instructions: string | null;
  /** Migration 042 (owner, 2026-10-12): the receiver above is someone the buyer ordered for. */
  ordered_for_someone_else?: boolean;
  /** Migration 042: "Elderly / needs help - knock and wait, carry items inside". */
  delivery_needs_help?: boolean;
  /** Migration 043: why the delivery was free (NEW_CUSTOMER / BASKET_THRESHOLD), null when charged. */
  free_delivery_reason?: 'NEW_CUSTOMER' | 'BASKET_THRESHOLD' | null;
  /** "Make delivery free" (owner, 2026-10-21): staff waived this order's fee; null when not, absent on an older API. */
  delivery_fee_waiver?: DeliveryFeeWaiver | null;
  cancellation_reason: string | null;
  items: OrderItemRow[];
  /** Combo pack lines (owner, 2026-10-09); absent on older API responses. */
  combos?: OrderCombo[];
  history: OrderHistoryRow[];
  delivery: { id: string; assignment_status: string; rider_name?: string | null } | null;
  /** Migration 054: the repeat basket this order came from; null/absent otherwise. */
  repeat_basket_id?: string | null;
  /** Migration 055: the rider tip added at checkout (LKR; 0 = none), collected with cash on delivery. */
  rider_tip?: number | string | null;
  /** Migration 055: the tip paid from the Blynk Wallet after delivery (LKR; 0 = none). */
  rider_tip_wallet?: number | string | null;
  /** Migration 055: the customer's rating; null = not rated, absent on an older API. */
  rating?: OrderRatingInfo | null;
}

/** GET /admin/riders */
export interface RiderOption {
  id: string;
  full_name: string | null;
  /** null for an Admin who can deliver: admins have no phone (backend migration 028). */
  phone: string | null;
  vehicle_type: string;
  vehicle_registration_number: string;
  open_deliveries: number;
  /** False only in GET /admin/riders?include_inactive=true: the rider can no longer deliver. */
  is_active?: boolean;
  /** Rider pay (backend migration 032, owner 2026-10-09). */
  pay_type?: RiderPayType;
  /** The rider's own commission %; null = the store default. */
  commission_percent?: number | null;
  /** The rider's own pay model; null = follows the store default (owner, 2026-10-10). */
  pay_model?: PayModel | null;
}

/**
 * Rider pay (owner, 2026-10-09): a COMPANY rider is salaried - no
 * per-delivery commission, Blynk keeps the delivery charge. A COMMISSION
 * rider earns a % of the STANDARD delivery fee (store default, or their own
 * override) and keeps that share out of the COD cash they collect.
 */
export type RiderPayType = 'COMPANY' | 'COMMISSION';

// ------------------------------------------------- rider pay controls
// Rider pay controls (owner, 2026-10-10): "give the option in ops and admin
// to control the rider app charges" - fixed / % / distance pay, bonuses and
// incentives, deductions and extra pay.

/** PERCENT: % of the standard delivery fee; FIXED: LKR per delivery; DISTANCE: base + LKR per km. */
export type PayModel = 'PERCENT' | 'FIXED' | 'DISTANCE';
/** How DISTANCE pay counts the km (owner, 2026-10-10): LINEAR = base + LKR per km; TIERS = per-km tiers (base / per km ignored). */
export type DistanceMode = 'LINEAR' | 'TIERS';
/** +LKR per delivery, or +% of the delivery's base earning. */
export type BoostMode = 'FIXED' | 'PERCENT';
export type BonusKind = 'PEAK_BOOST' | 'RAIN_BOOST' | 'LONG_DISTANCE' | 'DAILY_TARGET';
export type AdjustmentReason = 'CASH_SHORT' | 'DAMAGED_ITEM' | 'LATE' | 'BONUS' | 'OTHER';

/** A complete pay model (store default or a rider's effective one). */
export interface PayParams {
  model: PayModel;
  percent: number;
  fixed_lkr: number;
  base_lkr: number;
  per_km_lkr: number;
  /** Optional floor per delivery (any model); null = no floor. */
  min_lkr: number | null;
  /** (owner, 2026-10-10) Optional: an API from before per-km tiers leaves these out (= LINEAR). */
  distance_mode?: DistanceMode;
  /** May be [] when never set. */
  km_tiers?: KmTier[];
}

/** days 1=Mon..7=Sun; "HH:MM", start < end, end may be "24:00". */
export interface PeakWindow {
  days: number[];
  start: string;
  end: string;
}

export interface PeakBoostRule {
  enabled: boolean;
  mode: BoostMode;
  amount: number;
  windows: PeakWindow[];
}

export interface DailyTargetTier {
  deliveries: number;
  amount_lkr: number;
}

export interface DailyTargetRule {
  enabled: boolean;
  tiers: DailyTargetTier[];
}

export interface LongDistanceRule {
  enabled: boolean;
  over_km: number;
  amount_lkr: number;
}

export interface BonusRules {
  /** false: automatic bonuses are for COMMISSION riders only; true: COMPANY riders get them too. */
  company_riders: boolean;
  peak: PeakBoostRule;
  daily_target: DailyTargetRule;
  long_distance: LongDistanceRule;
}

export interface RainBoost {
  on: boolean;
  mode: BoostMode;
  amount: number;
  /** ISO; the boost stops by itself at this time. */
  auto_off_at: string | null;
  turned_on_at: string | null;
  /** on && (auto_off_at null || now < auto_off_at) */
  active: boolean;
}

/** GET /admin/settings/rider-pay (and every PATCH under it). */
export interface RiderPaySettings {
  /** default_model.percent is the same value as GET /admin/settings/rider-commission. */
  default_model: PayParams;
  bonus_rules: BonusRules;
  rain_boost: RainBoost;
}

/** PATCH /admin/settings/rider-pay/model - omitted = keep. */
export interface RiderPayModelInput {
  model: PayModel;
  percent?: number;
  fixed_lkr?: number;
  base_lkr?: number;
  per_km_lkr?: number;
  min_lkr?: number | null;
  /** (owner, 2026-10-10) DISTANCE + TIERS needs km_tiers (sent or stored). */
  distance_mode?: DistanceMode;
  km_tiers?: KmTier[];
}

/** PATCH /admin/settings/rider-pay/bonuses - each section a complete object. */
export type RiderPayBonusesInput = Partial<BonusRules>;

/** PATCH /admin/settings/rider-pay/rain-boost */
export interface RainBoostInput {
  on: boolean;
  mode?: BoostMode;
  amount?: number;
  auto_off_at?: string | null;
}

/** GET/PATCH /admin/riders/:id/pay */
export interface RiderPay {
  rider_id: string;
  pay_type: RiderPayType;
  /** The rider's own override, or null (store default). */
  commission_percent: number | null;
  /** The % in force: a number for COMMISSION, null for COMPANY. */
  effective_percent: number | null;
  default_percent: number;
  /** Rider's own model; null = follows the store default model (owner, 2026-10-10). */
  pay_model?: PayModel | null;
  /** null each = the store default value. */
  own?: {
    fixed_lkr: number | null;
    base_lkr: number | null;
    per_km_lkr: number | null;
    min_lkr: number | null;
    /** (owner, 2026-10-10) null = the store default's; absent on an API from before per-km tiers. */
    distance_mode?: DistanceMode | null;
    km_tiers?: KmTier[] | null;
  };
  /** What a new delivery pays this rider now; null for COMPANY. */
  effective?: PayParams | null;
  default_model?: PayParams;
}

/** Body of PATCH /admin/riders/:id/pay and (optionally) the approve call. */
export interface RiderPayInput {
  pay_type: RiderPayType;
  commission_percent?: number | null;
  /** (owner, 2026-10-10) null = follows the store default model. */
  pay_model?: PayModel | null;
  fixed_lkr?: number | null;
  base_lkr?: number | null;
  per_km_lkr?: number | null;
  min_lkr?: number | null;
  /** (owner, 2026-10-10) null = the store default's; kept only when pay_model is DISTANCE. */
  distance_mode?: DistanceMode | null;
  km_tiers?: KmTier[] | null;
}

/** A deduction (negative) or extra pay (positive) for a rider (owner, 2026-10-10). */
export interface RiderAdjustment {
  id: string;
  rider_id: string;
  rider_name: string | null;
  /** Signed: negative = deduction, positive = extra pay; never 0. */
  amount_lkr: number;
  reason: AdjustmentReason;
  note: string | null;
  /** YYYY-MM-DD (Asia/Colombo) - the day's cash it settles against. */
  adjustment_date: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /admin/riders/:id/adjustments; PATCH takes any of these. */
export interface RiderAdjustmentInput {
  amount_lkr: number;
  reason: AdjustmentReason;
  note?: string | null;
  adjustment_date?: string;
}

/** GET/PATCH /admin/settings/rider-commission */
export interface RiderCommissionSetting {
  default_percent: number;
  updated_at: string | null;
}

/** Rider trips (owner, 2026-10-10): how many orders one rider may carry at
 * once (1 = no trips) and the max straight-line km between their drop-offs
 * before staff must confirm. GET|PATCH /admin/settings/rider-trips. */
export interface RiderTripsSetting {
  max_active_deliveries: number;
  max_dropoff_distance_km: number;
  updated_at: string | null;
}

/** Doctors need sign-in (owner, 2026-10-10): when on (the default), a guest
 * must log in or create an account with their phone number before the
 * customer app shows clinics and doctors. GET|PATCH
 * /admin/settings/doctors-access. */
export interface DoctorsAccessSetting {
  require_sign_in: boolean;
  /**
   * Show doctor channelling to customers (owner, 2026-10-14). Off: the
   * customer apps hide doctors and new bookings are refused; existing
   * appointments stay visible and cancellable. Absent on an older API = on.
   */
  show_to_customers?: boolean;
  updated_at: string | null;
}

/** PayHere online payments (migration 047): GET|PATCH /admin/settings/payment-gateway. The secret is never returned. */
export type PaymentGatewayMode = 'sandbox' | 'live';
export interface PaymentGatewaySetting {
  provider: 'PAYHERE';
  enabled: boolean;
  mode: PaymentGatewayMode;
  merchant_id: string | null;
  merchant_secret_set: boolean;
  merchant_secret_masked: string | null;
  merchant_secret_updated_at: string | null;
  allowed_methods: string | null;
  payment_window_minutes: number;
  encryption_key_configured: boolean;
  ready: boolean;
  checkout_url: string;
  notify_url: string;
  return_url: string;
  cancel_url: string;
  can_edit_credentials: boolean;
  updated_at: string | null;
}
/** PATCH body: any subset; mode / merchant_id / merchant_secret are Admin only. */
export type PaymentGatewayInput = {
  enabled?: boolean;
  allowed_methods?: string | null;
  payment_window_minutes?: number;
  mode?: PaymentGatewayMode;
  merchant_id?: string;
  merchant_secret?: string;
};
/** POST /admin/settings/payment-gateway/test-hash - nothing is sent to PayHere. */
export interface PaymentGatewayTestHash {
  merchant_id: string;
  order_id: string;
  amount: string;
  currency: string;
  hash: string;
  mode: PaymentGatewayMode;
}

/** In-app updates (owner, 2026-10-12): GET|PATCH /admin/settings/app-updates. */
export type AppUpdateMode = 'optional' | 'required' | 'automatic';
export interface AppUpdatePolicySetting {
  min_version_code: number;
  mode: AppUpdateMode;
  notes: string;
}
export interface AppUpdatesSetting {
  ops: AppUpdatePolicySetting;
  rider: AppUpdatePolicySetting;
  updated_at: string | null;
}

/** GET/PATCH /admin/settings/app-share-links - a temporary public download
 * link per staff app (owner, 2026-10-12). `path` is relative to the API base. */
export interface AppShareLink {
  active: boolean;
  path: string | null;
  hours: number | null;
  created_at: string | null;
  expires_at: string | null;
}
export interface AppShareLinks {
  ops: AppShareLink;
  rider: AppShareLink;
  updated_at: string | null;
}

/** GET/PATCH /admin/settings/birthday-offer - X% off ONE order in the
 * customer's birthday week, plus a birthday SMS (owner, 2026-10-09). */
export interface BirthdayOfferSetting {
  enabled: boolean;
  percent: number;
  sms_enabled: boolean;
  /** May contain {percent}. */
  sms_text: string;
  /** sms_text with {percent} filled in - what customers receive. */
  sms_preview: string;
  sms_parts: number;
  /** Days either side of the birthday (3). */
  window_days: number;
  updated_at: string | null;
}

export interface BirthdayOfferInput {
  enabled?: boolean;
  percent?: number;
  sms_enabled?: boolean;
  sms_text?: string;
}

/** One row of GET /admin/birthdays. */
export interface BirthdayCustomer {
  id: string;
  full_name: string | null;
  phone: string;
  date_of_birth: string;
  /** This occurrence of the birthday, YYYY-MM-DD. */
  birthday: string;
  /** Negative: the birthday was a few days ago, still in its gift week. */
  days_until: number;
  turning: number;
  favourite_categories: { id: string; name: string }[];
  favourites_note: string | null;
  offer_used: boolean;
}

export interface BirthdaysResult {
  today: string;
  customers: BirthdayCustomer[];
}

export type RiderEarningsRange = 'today' | 'this_week' | 'custom';

export interface RiderEarningsFigures {
  deliveries: number;
  /** Standard-fee basis - what the commission is a % of. */
  delivery_charges: number;
  /** What customers actually paid (0 on free deliveries). */
  customer_delivery_fees: number;
  rider_share: number;
  blynk_delivery_share: number;
  cash_collected: number;
  cash_kept: number;
  cash_to_hand_in: number;
  product_sales: number;
  product_cost: number;
  product_margin: number;
  coupon_discount: number;
  // Rider pay controls (owner, 2026-10-10). Optional: an older API lacks them.
  /** Sum of each delivery's base pay (model + floor). */
  base_earnings?: number;
  /** Peak + rain + long-distance bonuses on those deliveries. */
  delivery_bonuses?: number;
  /** Daily-target bonuses. */
  day_bonuses?: number;
  /** Positive adjustments. */
  additions?: number;
  /** Negative adjustments, as a positive number. */
  deductions?: number;
  /** additions - deductions (signed). */
  adjustments?: number;
  /** base_earnings + delivery_bonuses + day_bonuses + adjustments */
  total_earnings?: number;
  bonus_breakdown?: Record<BonusKind, number>;
  /** What Blynk still owes (earnings + extras the day's cash could not cover). */
  payable_to_rider?: number;
}

export interface RiderEarningsRow extends RiderEarningsFigures {
  rider_id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pay_type: RiderPayType;
  commission_percent: number | null;
  effective_percent: number | null;
  /** Effective model now; null for COMPANY (owner, 2026-10-10). */
  pay_model?: PayModel | null;
}

/** GET /admin/reports/rider-earnings */
export interface RiderEarningsReport {
  range: { from: string; to: string; timezone: string };
  default_percent: number;
  riders: RiderEarningsRow[];
  totals: RiderEarningsFigures;
  /** The range's pay adjustments, newest first (owner, 2026-10-10). */
  adjustments?: RiderAdjustment[];
  /** The store default pay model (owner, 2026-10-10). */
  default_model?: PayParams;
}

/** One order a rider already carries (GET /admin/riders/suggestions). */
export interface TripStop {
  order_id: string;
  order_number: string;
  assignment_status: string;
  /** Straight line between that drop-off and this order's; null when a pin is missing. */
  dropoff_distance_km: number | null;
}

/**
 * GET /admin/riders/suggestions?order_id= (backend rider trips, 2026-09-30):
 * the RiderOption fields plus load, distance to the store and trip. Best
 * first; one (or none) is `suggested`. Never a rider's coordinates.
 */
export interface RiderSuggestion extends RiderOption {
  at_capacity: boolean;
  last_seen_at: string | null;
  location_known: boolean;
  distance_km: number | null;
  trip: TripStop[];
  trip_within_distance: boolean;
  suggested: boolean;
}

export interface RiderSuggestions {
  order_id: string;
  rules: { max_active_deliveries: number; max_dropoff_distance_km: number; location_fresh_minutes: number };
  riders: RiderSuggestion[];
}

// ------------------------------------------------------------ feedback
export type FeedbackCategory = 'APP' | 'DELIVERY' | 'PRODUCTS' | 'OTHER';
export type FeedbackStatus = 'NEW' | 'READ';

/** A row of GET /admin/feedback (backend migration 013). */
export interface FeedbackItem {
  id: string;
  rating: number | null;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  created_at: string;
  user_id: string;
  full_name: string | null;
  phone: string;
}

export interface FeedbackPage {
  feedback: FeedbackItem[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ------------------------------------------------------------- coupons
/** Backend migration 018. ADMIN only. */
export type CouponType = 'FIXED' | 'PERCENT' | 'FREE_DELIVERY';

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: CouponType;
  discount_value: number;
  max_discount: number | null;
  min_subtotal: number | null;
  first_order_only: boolean;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  per_customer_limit: number;
  is_active: boolean;
  usage_count: number;
  created_at: string;
}

export interface CouponInput {
  code?: string;
  description?: string | null;
  discount_type: CouponType;
  discount_value?: number;
  max_discount?: number | null;
  min_subtotal?: number | null;
  first_order_only?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  usage_limit?: number | null;
  per_customer_limit?: number;
  is_active?: boolean;
}

// --------------------------------------------------------------- sales
export type SalesRange = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days';

export interface SalesProduct {
  product_id: string;
  name: string;
  quantity: number;
  revenue: number;
}

/** GET /admin/reports/sales. */
export interface SalesReport {
  range: { from: string; to: string; timezone: string };
  order_count: number;
  delivered_count: number;
  delivered_revenue: number;
  average_basket: number;
  cancelled_count: number;
  discount_given: number;
  delivery_fees: number;
  top_by_quantity: SalesProduct[];
  top_by_revenue: SalesProduct[];
  orders_by_hour: { hour: number; orders: number }[];
}

// ----------------------------------------------------------- customers
export type CustomerSort = 'recent' | 'spend' | 'orders' | 'name';

export interface CustomerRow {
  id: string;
  full_name: string | null;
  phone: string;
  email: string | null;
  is_active: boolean;
  created_at: string;
  orders_count: number;
  delivered_count: number;
  delivered_spend: number;
  last_order_at: string | null;
  /** Language the customer picked in the app for SMS; null = never picked. */
  sms_language: SmsLanguage | null;
  /** false = the customer turned "Offers by SMS" off. */
  sms_offers: boolean;
  /** Optional profile (owner, 2026-10-09): YYYY-MM-DD, a calendar day. */
  date_of_birth?: string | null;
  /** Owner, 2026-10-11: saved addresses, and the default (else newest) one as one line. */
  addresses_count?: number;
  default_address?: string | null;
}

/** GET /admin/customers/export: every customer, by name (ADMIN only). */
export interface CustomerExportRow {
  full_name: string | null;
  phone: string;
  is_active: boolean;
  created_at: string;
  orders_count: number;
  delivered_spend: number;
  last_order_at: string | null;
  sms_language: SmsLanguage | null;
  sms_offers: boolean;
}

export interface CustomerOrderRow {
  id: string;
  order_number: string;
  order_status: OrderStatus;
  payment_method?: PaymentMethod;
  payment_status: PaymentStatus | string;
  subtotal_amount: number;
  delivery_fee: number;
  /** Small-order fee (owner, 2026-10-25): 0 / absent when none. */
  small_order_fee?: number;
  discount_amount: number;
  total_amount: number;
  /** Blynk Wallet (docs/api/wallet.md): what the wallet paid; total_amount stays what is still to pay. Absent on an older API. */
  wallet_amount_used?: number;
  coupon_code: string | null;
  /** Birthday gift (owner, 2026-10-09); 0 / absent when none. */
  birthday_discount_amount?: number;
  placed_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  item_count: number;
}

export interface CustomerDetail {
  customer: CustomerRow & {
    last_login_at: string | null;
    /** Optional profile the customer saves in the app (owner, 2026-10-09). */
    favourite_categories?: { id: string; name: string }[];
    favourites_note?: string | null;
  };
  orders: CustomerOrderRow[];
  pagination: Paginated<unknown>['pagination'];
}

// ---------------------------------------------------------------- cash
/** Backend migration 019. ADMIN and OPERATIONS. */
export interface CashHandin {
  id: string;
  rider_id: string;
  rider_name: string | null;
  amount: number;
  handin_date: string;
  note: string | null;
  recorded_by_name: string | null;
  created_at: string;
}

export type ReconciliationStatus = 'SHORT' | 'OVER' | 'BALANCED';

export interface RiderReconciliation {
  rider_id: string;
  rider_name: string | null;
  rider_phone: string | null;
  deliveries: number;
  handins: number;
  collected: number;
  handed_in: number;
  /** handed_in - expected_handin since rider pay (negative = short). */
  difference: number;
  status: ReconciliationStatus;
  /** Rider pay (owner, 2026-10-09). */
  pay_type?: RiderPayType;
  /** Commission share the rider keeps out of the cash (0 for a company rider). */
  kept_share?: number;
  /** max(0, collected - kept_share - day_bonuses - adjustments): what the rider should hand in. */
  expected_handin?: number;
  /** Daily-target bonuses kept from the day's cash (owner, 2026-10-10). */
  day_bonuses?: number;
  /** Signed: extra pay (+) kept from the cash, deductions (-) added to the hand-in. */
  adjustments?: number;
  /** What the day's cash could not cover: Blynk owes the rider this. */
  payable_to_rider?: number;
}

export interface CashReconciliation {
  date: string;
  timezone: string;
  riders: RiderReconciliation[];
  totals: {
    collected: number;
    handed_in: number;
    difference: number;
    status: ReconciliationStatus;
    kept_share?: number;
    expected_handin?: number;
    day_bonuses?: number;
    adjustments?: number;
    payable_to_rider?: number;
  };
}

// ------------------------------------------------------------ sms offers
/** Backend migration 027. ADMIN and OPERATIONS. */
export type SmsLanguage = 'si' | 'ta' | 'en';

/** The audience word offers were sent with before customer groups (2026-10-24); history rows can still carry it. */
export type SmsOfferAudience = 'ALL' | 'ORDERED_30D' | 'ORDERED_90D' | 'NEVER_ORDERED';

export interface SmsOfferInput {
  /** Customer group (docs/superpowers/plans/2026-10-24-groups-ratings-requests.md section A). */
  audience: CustomerAudience;
  fallback_language: SmsLanguage;
  messages: Partial<Record<SmsLanguage, string>>;
}

/** POST /admin/sms-offers/estimate. */
export interface SmsOfferEstimate {
  audience: SmsOfferAudience | CustomerAudience;
  recipients: number;
  /** Recipients per language, after the fallback. */
  by_language: Record<SmsLanguage, number>;
  /** Customers who never picked a language (they get the fallback). */
  without_language: number;
  opted_out: number;
  /** SMS parts one recipient costs, opt-out line included. */
  parts_per_sms: Partial<Record<SmsLanguage, number>>;
  sms_parts_total: number;
  /** Languages with recipients but no text (only ever enabled ones). */
  missing_languages: SmsLanguage[];
  /** Languages offers are written in right now (backend SMS_OFFER_LANGUAGES); ['en'] at launch. */
  languages: SmsLanguage[];
}

export interface SmsOfferSent {
  id: string;
  created_at: string;
  recipients: number;
  sms_parts_total: number;
}

export interface SmsOfferTestResult {
  /** The number the test went to, masked. */
  sent_to: string;
  sms_parts: number;
}

export interface SmsOffer {
  id: string;
  audience: SmsOfferAudience | CustomerAudience;
  /** The customer group it went to (2026-10-24); null/absent when sent to one of the original audiences. */
  audience_group?: CustomerAudience | null;
  fallback_language: SmsLanguage;
  message_si: string | null;
  message_ta: string | null;
  message_en: string | null;
  recipient_count: number;
  sms_parts_total: number;
  created_at: string;
  sent_by_name: string | null;
  sent_by_role: string | null;
}

// ---------------------------------------------------------------------------
// Rider applications (migration 029): riders apply in the Rider app; Admin or
// Operations approve or reject them here.
export type RiderApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RiderApplication {
  /** riders.id */
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string;
  vehicle_registration_number: string | null;
  emergency_contact_phone: string | null;
  approval_status: RiderApprovalStatus;
  applied_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  rejection_reason: string | null;
  /** Rider pay (owner, 2026-10-09); meaningful once approved. */
  pay_type?: RiderPayType;
  /** Own commission %, null = the store default. */
  commission_percent?: number | null;
  /** Own pay model; null = follows the store default (owner, 2026-10-10). */
  pay_model?: PayModel | null;
}

export interface RiderApplicationPage {
  applications: RiderApplication[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ---------------------------------------------------------------------------
// Dental doctors (owner, 2026-10-09). The same /admin/dental/doctors
// endpoints the Operations app uses (ADMIN or OPERATIONS). A doctor's
// specialty is free text since migration 030 (2-64 characters).
export type DentalSpecialty = string;

/** Quick picks in the Add/Edit doctor form - the specialty can be any text. */
export const DENTAL_SPECIALTY_SUGGESTIONS = [
  // Any kind of doctor, not only dentists (owner, 2026-10-10: "we can add
  // other doctors also"). Staff can still type any specialty.
  'General physician',
  'Pediatrician',
  'Gynecologist',
  'Dentist',
  'Eye specialist',
  'ENT specialist',
  'Skin specialist',
  'Cardiologist',
] as const;

export interface DentalDoctor {
  id: string;
  full_name: string;
  specialty: DentalSpecialty;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Visible ratings (migration 023): the list endpoint sends them,
   * create/update responses do not. */
  rating_average?: number | null;
  rating_count?: number;
}

export interface DentalDoctorInput {
  full_name?: string;
  specialty?: DentalSpecialty;
  photo_url?: string | null;
  bio?: string | null;
  is_active?: boolean;
}

// ------------------------------------------------------- store schedule
/** Store schedule (owner, 2026-10-10: "the timing will be decided by ops
 * and admin"). All times Asia/Colombo; "HH:MM" is 24h on 15-minute steps. */
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface DayHours {
  closed: boolean;
  open: string;
  close: string;
}

export interface StoreHours {
  same_every_day: boolean;
  days: Record<DayKey, DayHours>;
  updated_at: string | null;
}

export interface StoreClosure {
  closed: boolean;
  reason: string | null;
  reopens_at: string | null;
  closed_at: string | null;
  updated_at: string | null;
}

export interface StoreHoliday {
  /** YYYY-MM-DD */
  date: string;
  reason: string | null;
}

export interface DeliverySlotSettings {
  enabled: boolean;
  slot_minutes: 30 | 60 | 120;
  /** 1 = today and tomorrow. */
  days_ahead: 1 | 2 | 3;
  max_orders_per_slot: number;
  min_lead_minutes: number;
}

export type ClosedKind = 'OPEN' | 'OUTSIDE_HOURS' | 'CLOSED_DAY' | 'HOLIDAY' | 'CLOSED_NOW';

export interface StoreStatus {
  is_open_now: boolean;
  closed_kind: ClosedKind;
  closed_reason: string | null;
  reopens_at: string | null;
  next_open_at: string | null;
  today_hours: { open: string; close: string } | null;
}

/** GET /admin/settings/store-schedule, and what every schedule PATCH returns. */
export interface StoreSchedule {
  hours: StoreHours;
  closure: StoreClosure;
  holidays: StoreHoliday[];
  delivery_slots: DeliverySlotSettings & { updated_at: string | null };
  /**
   * (owner, 2026-10-10) "Send offer/birthday texts on closed days". true
   * (default): offer, test and birthday SMS still go out on a closed weekday
   * (8 AM - 9 PM), a holiday or while closed now; false: only while the store
   * is open. Missing from a server older than this = true.
   */
  sms?: StoreSmsSettings & { updated_at: string | null };
  status: StoreStatus;
}

export interface StoreSmsSettings {
  sms_on_closed_days: boolean;
}

export type StoreHoursInput =
  | { same_every_day: true; open: string; close: string }
  | { same_every_day: false; days: Record<DayKey, DayHours> };

export type StoreClosureInput = { closed: true; reason: string; reopens_at?: string | null } | { closed: false };

/**
 * The Rider map (owner, 2026-10-25): `GET /admin/riders/live` (ADMIN, OPERATIONS). Riders are the
 * active ones (the assign list); `position` is the last point the Rider app reported, which exists
 * only while a delivery has been on the road, so a rider with no recent delivery has none.
 */
export interface LiveRiderDelivery {
  order_id: string;
  order_number: string;
  assignment_status: string;
  dropoff: { lat: number; lng: number } | null;
}
export interface LiveRider {
  id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string;
  status: 'FREE' | 'ON_TRIP';
  open_deliveries: number;
  /** How many more orders this rider may take before the trip cap. */
  capacity_left: number;
  position: { lat: number; lng: number; accuracy_m: number | null; captured_at: string; age_seconds: number } | null;
  deliveries: LiveRiderDelivery[];
}
export interface LiveWaitingOrder {
  order_id: string;
  order_number: string;
  order_status: string;
  waiting_seconds: number;
  address: string;
  dropoff: { lat: number; lng: number } | null;
}
export interface LiveRiderMap {
  server_time: string;
  store: { lat: number; lng: number; radius_km: number } | null;
  rules: { max_active_deliveries: number; max_dropoff_distance_km: number };
  auto_assign: { enabled: boolean; wait_seconds: number; max_distance_km: number };
  riders: LiveRider[];
  unassigned_orders: LiveWaitingOrder[];
}

/** Automatic rider assignment (owner, 2026-10-25): GET|PUT /admin/settings/rider-auto-assign. Off by default. */
export interface RiderAutoAssignSetting {
  enabled: boolean;
  wait_seconds: number;
  max_distance_km: number;
  updated_at: string | null;
}
