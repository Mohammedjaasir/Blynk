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
  /** Migration 024: a second number from the address; null when none was given. */
  delivery_alternate_phone?: string | null;
  delivery_address_line1: string;
  delivery_address_line2: string | null;
  delivery_city: string;
  /** The customer's pin. NUMERIC columns can arrive as strings; see lib/route.ts toLatLng. */
  delivery_latitude?: number | string | null;
  delivery_longitude?: number | string | null;
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

/** Proof of delivery: the 4-digit code the customer shows in their Blynk app. */
export const DELIVERY_CODE_LENGTH = 4;

/** error.details on a 422 WRONG_DELIVERY_CODE from collect-cod. */
export interface WrongDeliveryCodeDetails {
  attempts_remaining: number;
}

/** error.details on a 429 DELIVERY_CODE_LOCKED from collect-cod. */
export interface DeliveryCodeLockedDetails {
  locked_until: string;
  retry_after_seconds: number;
}

/** GET /riders/me/day - the signed-in rider's own counts and cash (no pay amounts). */
export interface DayTotals {
  completed: number;
  /** Closed as failed ("can't deliver", or the store marked it failed). */
  failed: number;
  /** The store recorded that the customer could not be reached. */
  customer_unavailable: number;
  /** Cash taken at the door, LKR. */
  cash_collected: number;
}

export interface RiderDayDelivery {
  delivery_id: string;
  order_number: string;
  outcome: 'DELIVERED' | 'FAILED' | 'CUSTOMER_UNAVAILABLE';
  at: string;
  cash_collected: number;
}

export interface RiderDay {
  timezone: 'Asia/Colombo';
  today: DayTotals & { date: string };
  /** Monday to Sunday. */
  week: DayTotals & { starts_on: string };
  /** Newest first. */
  deliveries_today: RiderDayDelivery[];
}
