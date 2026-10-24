import type { LatLng, LocationStatus, Seller } from '../api/types';

/** Where the map opens when Blynk's store location is not known: the Dharga Town clock tower. */
export const FALLBACK_STORE: LatLng = { lat: 6.441313, lng: 80.011437 };

/** A generous box around Sri Lanka; the server checks the same rule (400 on latitude/longitude). */
const SRI_LANKA = { minLat: 5.7, maxLat: 10.0, minLng: 79.3, maxLng: 82.1 } as const;

export function insideSriLanka(p: LatLng): boolean {
  return p.lat >= SRI_LANKA.minLat && p.lat <= SRI_LANKA.maxLat && p.lng >= SRI_LANKA.minLng && p.lng <= SRI_LANKA.maxLng;
}

/** Straight-line distance in km (haversine). */
export function kmBetween(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "850 m" under a kilometre, else "2.4 km". */
export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return '-';
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

function point(lat: number | null | undefined, lng: number | null | undefined): LatLng | null {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

export interface ShopLocation {
  status: LocationStatus;
  /** The approved point (delivery charges are worked out from here). */
  approved: LatLng | null;
  /** A point waiting for Admin, or the one Admin turned down. */
  pending: LatLng | null;
  approvedNote: string | null;
  pendingNote: string | null;
  rejectReason: string | null;
  approvedKm: number | null;
  pendingKm: number | null;
}

/**
 * The seller's location in one shape. An API that predates the approval step
 * (only latitude/longitude, no location_status) counts a saved point as approved.
 */
export function shopLocation(seller: Seller): ShopLocation {
  const approved = point(seller.latitude, seller.longitude);
  const pending = point(seller.pending_latitude, seller.pending_longitude);
  const status: LocationStatus = seller.location_status ?? (approved ? 'APPROVED' : 'NONE');
  return {
    status,
    approved,
    pending,
    approvedNote: seller.location_note ?? null,
    pendingNote: seller.pending_location_note ?? null,
    rejectReason: seller.location_reject_reason ?? null,
    approvedKm: typeof seller.distance_km_from_store === 'number' ? seller.distance_km_from_store : null,
    pendingKm: typeof seller.pending_distance_km_from_store === 'number' ? seller.pending_distance_km_from_store : null,
  };
}

/** Where the map opens: the waiting pin, else the approved one, else the Blynk store. */
export function mapStart(location: ShopLocation, store: LatLng | null): LatLng {
  if ((location.status === 'PENDING' || location.status === 'REJECTED') && location.pending) return location.pending;
  return location.approved ?? location.pending ?? store ?? FALLBACK_STORE;
}

/** The note box starts with the note that goes with the point shown. */
export function startNote(location: ShopLocation): string {
  if ((location.status === 'PENDING' || location.status === 'REJECTED') && location.pending) {
    return location.pendingNote ?? location.approvedNote ?? '';
  }
  return location.approvedNote ?? '';
}

/** Two points closer than ~1 m are the same pin. */
export function samePoint(a: LatLng | null, b: LatLng | null): boolean {
  if (!a || !b) return false;
  return kmBetween(a, b) < 0.001;
}

/** Round to 6 decimals (~10 cm) before sending. */
export function roundPoint(p: LatLng): LatLng {
  return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
}

/** One position from the browser, or a rejection (denied / unavailable / timeout / unsupported). */
export function locateOnce(timeout = 12_000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    const geo = (globalThis as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (!geo) {
      reject(Object.assign(new Error('unsupported'), { code: 0 }));
      return;
    }
    try {
      geo.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => reject(e),
        { enableHighAccuracy: true, timeout, maximumAge: 30_000 }
      );
    } catch (e) {
      reject(e);
    }
  });
}

/** What to tell the seller when the browser could not give a position. */
export function geoMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 1) {
    return 'Location is blocked for this site. Allow location in your browser settings, or move the map by hand.';
  }
  if (code === 2) return 'Could not find where you are right now. Move the map by hand so the pin sits on your shop.';
  if (code === 3) return 'Finding your location took too long. Try again, or move the map by hand.';
  return 'This browser cannot share your location. Move the map by hand so the pin sits on your shop.';
}
