import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { calculateHaversineKm } from '../../utils/geo.js';

/**
 * Where a seller's shop is (migration 053). Owner, 2026-10-24: "coordinates should work by seller
 * place and delivery charge should charge by from that coordinates and admin can approve this".
 *
 *   - The seller pins the shop in the seller site (PUT /seller/profile). That writes the PENDING
 *     point (pending_latitude / pending_longitude / pending_location_note, location_status PENDING);
 *     the approved point stays in force until Admin decides.
 *   - Admin approves (pending -> latitude / longitude / location_note, status APPROVED) or rejects
 *     with a reason (status REJECTED; the approved point, if any, stays in force).
 *   - Only the APPROVED point is used for delivery: sellerPickupPoints() below.
 *
 * Migrations are run by hand in Coolify, so this code is live before the columns exist. Until they
 * do, every seller reads "no location", sellerPickupPoints() is empty, and saving or reviewing a
 * location is refused with 503 LOCATION_NOT_READY (never a 500). Checked once a minute until found,
 * then cached - running the migration turns it on without a restart (the hasOfferCutColumn pattern).
 */

/** Sri Lanka, generously (the API refuses a pin outside it). */
export const SRI_LANKA_BOUNDS = { minLat: 5.8, maxLat: 9.9, minLng: 79.5, maxLng: 81.95 } as const;
export const LOCATION_NOTE_MAX = 200;
export const LOCATION_REASON_MAX = 200;

export type LocationStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

const LOCATION_COLUMNS = [
  'latitude',
  'longitude',
  'location_note',
  'pending_latitude',
  'pending_longitude',
  'pending_location_note',
  'location_status',
  'location_reject_reason',
  'location_reviewed_at',
  'location_reviewed_by',
] as const;

let columns: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

export async function hasSellerLocationColumns(): Promise<boolean> {
  if (override !== null) return override;
  if (columns && (columns.ok || Date.now() - columns.at < 60_000)) return columns.ok;
  const r = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'sellers' AND column_name IN (${sql.join(LOCATION_COLUMNS.map((c) => sql`${c}`))})`.execute(db);
  columns = { ok: (r.rows[0]?.n ?? 0) >= LOCATION_COLUMNS.length, at: Date.now() };
  return columns.ok;
}

/** Tests only: pretend the columns are missing (false) or present (true); null = check the database again. */
export function setSellerLocationColumnsForTests(value: boolean | null): void {
  override = value;
  columns = null;
}

export const locationNotReady = () => new AppError('Shop location will be available shortly.', 503, 'LOCATION_NOT_READY');

export interface StoreLocation {
  lat: number;
  lng: number;
}

/** The active dark store's pin - the same store GET /store reports as `store_location`. */
export async function activeStoreLocation(): Promise<StoreLocation | null> {
  const store = await db
    .selectFrom('dark_stores')
    .select(['latitude', 'longitude'])
    .where('is_active', '=', true)
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();
  if (!store) return null;
  const lat = Number(store.latitude);
  const lng = Number(store.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// ----------------------------------------------------------------------------
// For delivery (Agent L, modules/orders)
// ----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SellerPickupPoint {
  seller_id: string;
  shop_name: string;
  lat: number;
  lng: number;
}

/**
 * For each product that belongs to a seller with an approved shop point: that point. Products
 * without a seller, or whose seller has no approved point, are absent. Only the APPROVED point
 * counts - a waiting (or rejected) change never moves the pickup. Empty (never an error) while
 * migration 053 has not run.
 */
export async function sellerPickupPoints(productIds: string[]): Promise<Map<string, SellerPickupPoint>> {
  const out = new Map<string, SellerPickupPoint>();
  const ids = [...new Set(productIds.filter((id) => typeof id === 'string' && UUID.test(id)))];
  if (ids.length === 0) return out;
  try {
    if (!(await hasSellerLocationColumns())) return out;
    const r = await sql<{ product_id: string; seller_id: string; shop_name: string; lat: number; lng: number }>`
      SELECT p.id AS product_id, s.id AS seller_id, s.shop_name, s.latitude::float8 AS lat, s.longitude::float8 AS lng
        FROM products p
        JOIN sellers s ON s.id = p.seller_id
       WHERE p.id = ANY(${ids}::uuid[])
         AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL`.execute(db);
    for (const row of r.rows) {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.set(row.product_id, { seller_id: row.seller_id, shop_name: row.shop_name, lat, lng });
    }
  } catch (err) {
    // A pickup point is an extra: a failure here falls back to "from the Blynk store", never a 500.
    logger.warn({ err }, 'Seller pickup points could not be read');
    return new Map();
  }
  return out;
}

// ----------------------------------------------------------------------------
// Presenting a seller's location
// ----------------------------------------------------------------------------

export interface SellerLocation {
  /** The approved point (what delivery uses). */
  latitude: number | null;
  longitude: number | null;
  location_note: string | null;
  /** The point waiting for Admin (or the one Admin rejected). */
  pending_latitude: number | null;
  pending_longitude: number | null;
  pending_location_note: string | null;
  location_status: LocationStatus;
  location_reject_reason: string | null;
  /** Straight-line km from the active Blynk store to the approved point, one decimal; null when unknown. */
  distance_km_from_store: number | null;
  /** The same for the pending point. */
  pending_distance_km_from_store: number | null;
}

export const NO_LOCATION: SellerLocation = {
  latitude: null,
  longitude: null,
  location_note: null,
  pending_latitude: null,
  pending_longitude: null,
  pending_location_note: null,
  location_status: 'NONE',
  location_reject_reason: null,
  distance_km_from_store: null,
  pending_distance_km_from_store: null,
};

/** What a presenter needs: whether migration 053 has run, and the store's pin. */
export interface LocationContext {
  columns: boolean;
  store: StoreLocation | null;
}

export async function locationContext(): Promise<LocationContext> {
  const [cols, store] = await Promise.all([hasSellerLocationColumns(), activeStoreLocation()]);
  return { columns: cols, store };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function distanceKm(lat: number | null, lng: number | null, store: StoreLocation | null): number | null {
  if (lat === null || lng === null || !store) return null;
  try {
    return Math.round(calculateHaversineKm(store.lat, store.lng, lat, lng) * 10) / 10;
  } catch {
    return null;
  }
}

const STATUSES: readonly LocationStatus[] = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'];

/** The location fields of a sellers row (which lacks them before migration 053). */
export function presentLocation(row: Record<string, unknown>, ctx: LocationContext): SellerLocation {
  if (!ctx.columns) return { ...NO_LOCATION };
  const lat = num(row.latitude);
  const lng = num(row.longitude);
  const pinned = lat !== null && lng !== null;
  const pLat = num(row.pending_latitude);
  const pLng = num(row.pending_longitude);
  const pendingPinned = pLat !== null && pLng !== null;
  const status = STATUSES.includes(row.location_status as LocationStatus) ? (row.location_status as LocationStatus) : 'NONE';
  return {
    latitude: pinned ? lat : null,
    longitude: pinned ? lng : null,
    location_note: text(row.location_note),
    pending_latitude: pendingPinned ? pLat : null,
    pending_longitude: pendingPinned ? pLng : null,
    pending_location_note: text(row.pending_location_note),
    location_status: status,
    location_reject_reason: text(row.location_reject_reason),
    distance_km_from_store: pinned ? distanceKm(lat, lng, ctx.store) : null,
    pending_distance_km_from_store: pendingPinned ? distanceKm(pLat, pLng, ctx.store) : null,
  };
}

/** The location columns for a raw `FROM sellers s` query: NULLs until migration 053 has run. */
export const locationSelect = (ok: boolean) =>
  ok
    ? sql`s.latitude::float8 AS latitude, s.longitude::float8 AS longitude, s.location_note,
          s.pending_latitude::float8 AS pending_latitude, s.pending_longitude::float8 AS pending_longitude,
          s.pending_location_note, s.location_status, s.location_reject_reason`
    : sql`NULL::float8 AS latitude, NULL::float8 AS longitude, NULL::text AS location_note,
          NULL::float8 AS pending_latitude, NULL::float8 AS pending_longitude, NULL::text AS pending_location_note,
          'NONE'::text AS location_status, NULL::text AS location_reject_reason`;
