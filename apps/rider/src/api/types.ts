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

/** The vehicles a rider can apply with (POST /riders/applications). */
export type VehicleType = 'MOTORCYCLE' | 'SCOOTER' | 'BICYCLE' | 'THREE_WHEELER' | 'CAR';

/** POST /riders/applications - no session; the SMS code proves the phone. */
export interface RiderApplicationInput {
  phone: string;
  otp: string;
  /** 2-128 characters. */
  full_name: string;
  vehicle_type: VehicleType;
  /** Required for every vehicle type except BICYCLE; left out when empty. */
  vehicle_registration_number?: string;
  /** Left out when the rider gives none. */
  emergency_contact_phone?: string;
}

export interface RiderApplication {
  status: 'PENDING';
  full_name: string;
  phone: string;
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
  /**
   * Scheduled delivery slots (migration 036; owner, 2026-10-10): the slot
   * start the customer picked, ISO; null for an ASAP order.
   */
  scheduled_for?: string | null;
  /** The slot end, ISO; null for ASAP orders and for older scheduled orders (owner, 2026-10-10). */
  scheduled_until?: string | null;
}

export interface DeliveryItem {
  id: string;
  product_name_snapshot: string;
  quantity: number;
  item_status: string;
  /**
   * Combo packs (migration 033; owner, 2026-10-09): an item packed for a
   * combo names it; loose items have none of these.
   */
  order_combo_id?: string;
  combo_name?: string;
  combo_quantity?: number;
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

/**
 * GET /riders/me/earnings (owner, 2026-10-09): a rider is either a COMPANY
 * rider (salaried - no per-delivery earnings) or a COMMISSION rider who earns
 * commission_percent of each delivered order's standard delivery fee, even
 * when the customer got the delivery free. A commission rider keeps that
 * share out of the COD cash collected and hands in the rest. Counts are
 * delivered deliveries only. For COMPANY riders earnings and cash_to_keep are
 * 0 and cash_to_hand_in equals cash_collected.
 */
export type RiderPayType = 'COMPANY' | 'COMMISSION';

export interface EarningsTotals {
  deliveries: number;
  /** Standard delivery fees of those deliveries, LKR. */
  delivery_charges: number;
  /** The rider's share, LKR (0 for COMPANY riders). */
  earnings: number;
  cash_collected: number;
  cash_to_keep: number;
  cash_to_hand_in: number;
  /*
   * Staff-controlled pay (owner, 2026-10-10): `earnings` is now the total incl.
   * bonuses and adjustments. All optional - an older API leaves them out.
   */
  /** Sum of each delivery's base pay (pay model + floor). */
  base_earnings?: number;
  /** Peak + rain + long-distance bonuses on those deliveries. */
  delivery_bonuses?: number;
  /** Daily-target bonuses. */
  day_bonuses?: number;
  /** delivery_bonuses + day_bonuses. */
  bonuses?: number;
  /** Positive staff adjustments (extra pay). */
  additions?: number;
  /** Negative staff adjustments, as a positive number. */
  deductions?: number;
  /** additions - deductions (signed). */
  adjustments?: number;
  /** What Blynk still owes the rider (extras the day's cash could not cover). */
  payable_to_rider?: number;
}

/** Rider pay models and bonuses (owner, 2026-10-10). */
export type PayModel = 'PERCENT' | 'FIXED' | 'DISTANCE';
/** +LKR per delivery, or +% of the delivery's base earning. */
export type BoostMode = 'FIXED' | 'PERCENT';
export type BonusKind = 'PEAK_BOOST' | 'RAIN_BOOST' | 'LONG_DISTANCE' | 'DAILY_TARGET';
export type AdjustmentReason = 'CASH_SHORT' | 'DAMAGED_ITEM' | 'LATE' | 'BONUS' | 'OTHER';

/** A rider's effective pay model (owner, 2026-10-10). */
export interface PayParams {
  model: PayModel;
  /** PERCENT: % of the order's standard delivery fee. */
  percent: number;
  /** FIXED: LKR per delivery. */
  fixed_lkr: number;
  /** DISTANCE: base LKR per delivery. */
  base_lkr: number;
  /** DISTANCE: + LKR per km of road distance store -> drop-off. */
  per_km_lkr: number;
  /** Optional floor per delivery (any model); null = no floor. */
  min_lkr: number | null;
}

/** Today's bonuses grouped by kind, only non-zero (owner, 2026-10-10). */
export interface EarningsBonusLine {
  kind: BonusKind;
  amount_lkr: number;
  count: number;
}

/** A staff adjustment: negative = deduction, positive = extra pay (owner, 2026-10-10). */
export interface EarningsAdjustmentLine {
  id: string;
  amount_lkr: number;
  reason: AdjustmentReason;
  note: string | null;
}

/** Boosts running now (owner, 2026-10-10). */
export interface RiderBoosts {
  /** Automatic bonuses apply to this rider (COMMISSION, or COMPANY when staff switch that on). */
  applies: boolean;
  rain: { active: boolean; mode: BoostMode; amount: number; until: string | null };
  peak: { active_now: boolean; mode: BoostMode; amount: number };
}

export interface RiderEarnings {
  timezone: 'Asia/Colombo';
  pay_type: RiderPayType;
  /** Effective share for COMMISSION riders, e.g. 80; null for COMPANY riders. */
  commission_percent: number | null;
  today: EarningsTotals & {
    date: string;
    /** Grouped by kind, only non-zero (owner, 2026-10-10; absent on an older API). */
    bonus_lines?: EarningsBonusLine[];
    /** Today's staff adjustments (owner, 2026-10-10; absent on an older API). */
    adjustment_lines?: EarningsAdjustmentLine[];
  };
  /** Monday to Sunday. */
  week: EarningsTotals & { starts_on: string };
  /** Effective pay model, null for COMPANY riders (owner, 2026-10-10; absent on an older API). */
  pay_model?: PayParams | null;
  /** Boosts running now (owner, 2026-10-10; absent on an older API). */
  boosts?: RiderBoosts;
}
