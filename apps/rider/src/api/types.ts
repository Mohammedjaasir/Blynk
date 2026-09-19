/**
 * Shapes of the Blynk API responses the Rider app reads. They mirror the
 * backend's rider repository (modules/riders/rider.repository.ts) exactly:
 * the rider receives what it needs to deliver and nothing else - no costs,
 * suppliers, inventory, internal notes or other customers.
 */
export type Role = 'CUSTOMER' | 'RIDER' | 'PACKING_STAFF' | 'ADMIN';

export interface AuthUser {
  id: string;
  phone: string;
  full_name: string | null;
  role: Role;
}

/** deliveries.assignment_status - the existing enum, nothing added. */
export type AssignmentStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'PICKED_UP'
  | 'ARRIVED_AT_CUSTOMER'
  | 'DELIVERED'
  | 'FAILED'
  | 'REJECTED';

/** orders.order_status - the existing enum, nothing added. */
export type OrderStatus =
  | 'PLACED'
  | 'PACKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'CUSTOMER_UNAVAILABLE'
  | 'ITEM_UNAVAILABLE';

export interface DeliverySummary {
  delivery_id: string;
  order_id: string;
  assignment_status: AssignmentStatus;
  assigned_at: string;
  accepted_at: string | null;
  picked_up_at: string | null;
  order_number: string;
  order_status: OrderStatus;
  total_amount: number;
  payment_method: 'COD' | 'ONLINE';
  payment_status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  delivery_recipient_name: string;
  delivery_recipient_phone: string;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  delivery_instructions: string | null;
}

export interface DeliveryItem {
  id: string;
  product_name_snapshot: string;
  quantity: number;
  item_status: string;
}

export interface DeliveryDetail extends DeliverySummary {
  rider_id: string;
  cod_collected_amount: number;
  delivered_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  items: DeliveryItem[];
}

export interface CodSettlement {
  delivery_id: string;
  order_id: string;
  order_status: 'DELIVERED';
  payment_status: 'PAID';
  cod_collected_amount: number;
  delivered_at: string;
}
