import { Generated, ColumnType } from 'kysely';

export type UserRole = 'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN';
export type InventoryTrackingMode = 'UNTRACKED' | 'TRACKED';
export type InventoryAdjustmentType =
  | 'PURCHASE_RESTOCK'
  | 'ORDER_RESERVATION'
  | 'ORDER_FULFILLMENT'
  | 'ORDER_CANCELLATION_RESTORE'
  | 'DAMAGE_WRITE_OFF'
  | 'INVENTORY_AUDIT_ADJUSTMENT';

export type OrderStatus =
  | 'PLACED'
  | 'PACKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'CUSTOMER_UNAVAILABLE'
  | 'ITEM_UNAVAILABLE';

export type ItemFulfillmentStatus =
  | 'PENDING'
  | 'SOURCED'
  | 'PACKED'
  | 'UNAVAILABLE'
  | 'SUBSTITUTED';

export type PaymentMethod = 'COD' | 'ONLINE';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type DeliveryAssignmentStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'ARRIVED_AT_CUSTOMER'
  | 'DELIVERED'
  | 'FAILED'
  | 'REJECTED';

export type NotificationChannel = 'SMS' | 'WHATSAPP' | 'IN_APP' | 'EMAIL';
export type NotificationStatus = 'QUEUED' | 'PROCESSING' | 'SENT' | 'DELIVERED' | 'FAILED';

export interface SystemConfigurationsTable {
  key: string;
  value: unknown;
  description: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DarkStoresTable {
  id: Generated<string>;
  code: string;
  name: string;
  city: string;
  address_line: string;
  latitude: ColumnType<number, number | string, number | string>;
  longitude: ColumnType<number, number | string, number | string>;
  radius_km: ColumnType<number, number | string, number | string>;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ServiceAreasTable {
  id: Generated<string>;
  dark_store_id: string;
  area_name: string;
  center_latitude: ColumnType<number, number | string, number | string>;
  center_longitude: ColumnType<number, number | string, number | string>;
  radius_meters: number;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  phone: string;
  email: string | null;
  full_name: string | null;
  role: Generated<UserRole>;
  is_active: Generated<boolean>;
  phone_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OtpVerificationsTable {
  id: Generated<string>;
  phone: string;
  otp_hash: string;
  purpose: Generated<string>;
  attempts_count: Generated<number>;
  max_attempts: Generated<number>;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Generated<Date>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  device_info: string | null;
  ip_address: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface CustomerAddressesTable {
  id: Generated<string>;
  user_id: string;
  label: Generated<string>;
  recipient_name: string;
  recipient_phone: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postal_code: string | null;
  latitude: ColumnType<number, number | string, number | string>;
  longitude: ColumnType<number, number | string, number | string>;
  delivery_instructions: string | null;
  is_default: Generated<boolean>;
  is_deleted: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CategoriesTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  display_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProductsTable {
  id: Generated<string>;
  category_id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  unit: string;
  pack_size: string | null;
  image_url: string | null;
  purchase_cost: ColumnType<number, number | string, number | string>;
  custom_markup_percent: ColumnType<number | null, number | string | null, number | string | null>;
  is_available: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InventoryTable {
  id: Generated<string>;
  dark_store_id: string;
  product_id: string;
  tracking_mode: Generated<InventoryTrackingMode>;
  quantity_on_hand: Generated<number>;
  quantity_reserved: Generated<number>;
  low_stock_threshold: Generated<number>;
  updated_at: Generated<Date>;
}

export interface InventoryAdjustmentsTable {
  id: Generated<string>;
  inventory_id: string;
  adjustment_type: InventoryAdjustmentType;
  quantity_delta: number;
  previous_quantity: number;
  new_quantity: number;
  reference_order_id: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
}

export interface OrdersTable {
  id: Generated<string>;
  order_number: string;
  idempotency_key: string;
  customer_id: string;
  dark_store_id: string;
  order_status: Generated<OrderStatus>;
  payment_method: Generated<PaymentMethod>;
  payment_status: Generated<PaymentStatus>;
  subtotal_amount: ColumnType<number, number | string, number | string>;
  delivery_fee: ColumnType<number, number | string, number | string>;
  total_amount: ColumnType<number, number | string, number | string>;
  scheduled_for: Date | null;
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  delivery_postal_code: string | null;
  delivery_latitude: ColumnType<number, number | string, number | string>;
  delivery_longitude: ColumnType<number, number | string, number | string>;
  delivery_instructions: string | null;
  cancellation_reason: string | null;
  cancelled_by_user_id: string | null;
  cancelled_at: Date | null;
  customer_notes: string | null;
  internal_notes: string | null;
  placed_at: Generated<Date>;
  packed_at: Date | null;
  dispatched_at: Date | null;
  delivered_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrderItemsTable {
  id: Generated<string>;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  unit_snapshot: string;
  unit_selling_price: ColumnType<number, number | string, number | string>;
  estimated_unit_cost: ColumnType<number, number | string, number | string>;
  actual_unit_cost: ColumnType<number | null, number | string | null, number | string | null>;
  markup_percentage_applied: ColumnType<number, number | string, number | string>;
  quantity: number;
  subtotal: ColumnType<number, number | string, number | string>;
  item_status: Generated<ItemFulfillmentStatus>;
  created_at: Generated<Date>;
}

export interface OrderStatusHistoryTable {
  id: Generated<string>;
  order_id: string;
  old_status: OrderStatus | null;
  new_status: OrderStatus;
  changed_by_user_id: string | null;
  reason_or_notes: string | null;
  created_at: Generated<Date>;
}

export interface PaymentsTable {
  id: Generated<string>;
  order_id: string;
  payment_method: Generated<PaymentMethod>;
  payment_status: Generated<PaymentStatus>;
  amount: ColumnType<number, number | string, number | string>;
  transaction_reference: string | null;
  gateway_response: unknown | null;
  paid_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RidersTable {
  id: Generated<string>;
  user_id: string;
  dark_store_id: string;
  vehicle_type: Generated<string>;
  vehicle_registration_number: string;
  emergency_contact_phone: string | null;
  is_available: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DeliveriesTable {
  id: Generated<string>;
  order_id: string;
  rider_id: string;
  assignment_status: Generated<DeliveryAssignmentStatus>;
  cod_collected_amount: ColumnType<number, number | string | undefined, number | string>;
  handover_notes: string | null;
  assigned_at: Generated<Date>;
  accepted_at: Date | null;
  picked_up_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  user_id: string | null;
  order_id: string | null;
  idempotency_key: string | null;
  channel: NotificationChannel;
  notification_type: string;
  recipient: string;
  payload: unknown;
  status: Generated<NotificationStatus>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  locked_at: Date | null;
  locked_by: string | null;
  provider_name: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: Date | null;
  failed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: unknown | null;
  new_values: unknown | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface ProductCatalogView {
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
  purchase_cost: ColumnType<number, number | string, number | string>;
  custom_markup_percent: ColumnType<number | null, number | string | null, number | string | null>;
  effective_markup_percent: ColumnType<number, number | string, number | string>;
  calculated_selling_price: ColumnType<number, number | string, number | string>;
  is_available: boolean;
  is_active: boolean;
}

export interface SuppliersTable {
  id: Generated<string>;
  name: string;
  code: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SourcingRecordsTable {
  id: Generated<string>;
  order_id: string;
  order_item_id: string;
  product_id: string;
  supplier_id: string | null;
  quantity_sourced: number;
  estimated_unit_cost: ColumnType<number, number | string, number | string>;
  actual_unit_cost: ColumnType<number, number | string, number | string>;
  sourcing_status: Generated<ItemFulfillmentStatus>;
  notes: string | null;
  sourced_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PromotionsTable {
  id: Generated<string>;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  background_type: 'SOLID' | 'GRADIENT' | 'IMAGE';
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  cta_label: string | null;
  cta_destination_type: 'CATEGORY' | 'PRODUCT' | 'CATALOG' | null;
  cta_destination_value: string | null;
  display_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  system_configurations: SystemConfigurationsTable;
  dark_stores: DarkStoresTable;
  service_areas: ServiceAreasTable;
  users: UsersTable;
  otp_verifications: OtpVerificationsTable;
  refresh_tokens: RefreshTokensTable;
  customer_addresses: CustomerAddressesTable;
  categories: CategoriesTable;
  products: ProductsTable;
  promotions: PromotionsTable;
  inventory: InventoryTable;
  inventory_adjustments: InventoryAdjustmentsTable;
  suppliers: SuppliersTable;
  sourcing_records: SourcingRecordsTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  order_status_history: OrderStatusHistoryTable;
  payments: PaymentsTable;
  riders: RidersTable;
  deliveries: DeliveriesTable;
  notifications: NotificationsTable;
  audit_logs: AuditLogsTable;
  v_product_catalog: ProductCatalogView;
}
