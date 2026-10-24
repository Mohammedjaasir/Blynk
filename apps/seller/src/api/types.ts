/** Shapes of the seller API (see docs/superpowers/plans/2026-10-24-seller-portal.md). */

export type SellerStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface Seller {
  id: string;
  shop_name: string;
  contact_name: string | null;
  address: string | null;
  note: string | null;
  status: SellerStatus;
  rejection_reason: string | null;
  commission_percent: number;
  created_at: string;
  /*
   * The shop's location on the map. Blynk works out customers' delivery
   * charges for this seller's products from the APPROVED point; a new pin
   * waits (pending_*) until Admin approves it. All optional: an API without
   * the location change simply leaves them out.
   */
  /** The approved point (used for delivery charges). */
  latitude?: number | null;
  longitude?: number | null;
  location_note?: string | null;
  /** A pin the seller sent that Admin has not approved yet. */
  pending_latitude?: number | null;
  pending_longitude?: number | null;
  pending_location_note?: string | null;
  location_status?: LocationStatus;
  location_reject_reason?: string | null;
  /** Road-free distance from the Blynk store to the approved point. */
  distance_km_from_store?: number | null;
  pending_distance_km_from_store?: number | null;
}

export type LocationStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface LatLng {
  lat: number;
  lng: number;
}

/** The public store info (GET /store); only the part the seller portal uses. */
export interface StoreInfo {
  store_location?: LatLng | null;
  hub_name?: string | null;
}

export interface SellerMe {
  seller: Seller;
  counts: { products: number; pending: number };
}

export interface AuthUser {
  id: string;
  phone: string | null;
  full_name: string | null;
  email: string | null;
  role: string;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface ProductPayload {
  name: string;
  category_id: string;
  unit: string;
  pack_size?: string | null;
  description?: string | null;
  image_url?: string | null;
  barcode?: string | null;
}

export type SubmissionKind = 'NEW' | 'EDIT';
export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export interface Submission {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  product_id: string | null;
  payload: ProductPayload;
  seller_price: number;
  approved_selling_price: number | null;
  reject_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface SellerProduct {
  /** `submission:<uuid>` for a product that exists only as a submission. */
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit: string | null;
  pack_size: string | null;
  description: string | null;
  image_url: string | null;
  barcode: string | null;
  is_active: boolean;
  is_available: boolean;
  seller_price: number;
  /** What customers pay; null while the product is not live. */
  selling_price: number | null;
  /** null when Blynk does not track stock for the product. */
  stock_on_hand: number | null;
  units_sold: number;
  live: boolean;
  pending: Submission | null;
  last_rejected: Submission | null;
}

export interface ProductInput extends ProductPayload {
  seller_price: number;
}

export interface StatementLine {
  product_id: string;
  name: string;
  units: number;
  gross: number;
}

export interface StatementPayout {
  id: string;
  amount: number;
  note: string | null;
  paid_on: string;
}

export interface Statement {
  commission_percent: number;
  gross: number;
  commission: number;
  earned: number;
  paid: number;
  due: number;
  lines: StatementLine[];
  payouts: StatementPayout[];
}

/*
 * Seller requests (stock notes, payout requests) and insights. Create actions are
 * for APPROVED shops only; until the database change is live every route answers
 * 503 SELLER_REQUESTS_NOT_READY and the portal leaves these parts out.
 */

export type StockNoteStatus = 'SENT' | 'RECEIVED' | 'CANCELLED';

/** "I am bringing N of this product to the Blynk store on this day." */
export interface StockNote {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  /** YYYY-MM-DD */
  expected_on: string;
  note: string | null;
  status: StockNoteStatus;
  /** What Blynk counted when it arrived (may differ from quantity). */
  received_quantity: number | null;
  received_at: string | null;
  created_at: string;
}

export interface StockNoteInput {
  product_id: string;
  /** 1 - 10000 */
  quantity: number;
  /** YYYY-MM-DD */
  expected_on: string;
  note?: string;
}

export type PayoutMethod = 'BANK' | 'CASH';
export type PayoutRequestStatus = 'REQUESTED' | 'PAID' | 'DECLINED';

export interface PayoutRequest {
  id: string;
  amount: number;
  method: PayoutMethod;
  bank_details: string | null;
  note: string | null;
  status: PayoutRequestStatus;
  decline_reason: string | null;
  created_at: string;
  handled_at: string | null;
}

export interface PayoutRequestInput {
  amount: number;
  method: PayoutMethod;
  bank_details?: string;
  note?: string;
}

export type InsightDays = 7 | 30;

export interface InsightProduct {
  product_id: string;
  name: string;
  image_url: string | null;
  units: number;
  units_prev_period: number;
  gross: number;
  stock_on_hand: number | null;
  days_of_stock_left: number | null;
  restock_suggested: boolean;
}

export interface Insights {
  period: { from: string; to: string };
  top: InsightProduct[];
  totals: { units: number; gross: number; units_prev: number };
}

export interface ProfileInput {
  shop_name: string;
  contact_name?: string;
  address?: string;
  note?: string;
}

/**
 * Sending a shop pin: PUT /seller/profile with the (required) shop name and the point; the
 * other profile fields are left out, so they stay as they are. The pin then waits for Admin.
 * latitude + longitude null withdraws a waiting pin (the approved one stays).
 * Only the location card sends these: the details form must never include them, because
 * sending the approved point back cancels a waiting request and null + null withdraws it.
 */
export interface LocationInput {
  shop_name: string;
  latitude: number | null;
  longitude: number | null;
  location_note?: string | null;
}
