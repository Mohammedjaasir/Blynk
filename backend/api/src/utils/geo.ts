/**
 * Calculates the great-circle distance between two geographic coordinates
 * using the standard Haversine formula (Earth mean radius R = 6371 km).
 *
 * Used to enforce the 4.00 km delivery radius around the dark store without PostGIS.
 */
export function calculateHaversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (
    lat1 < -90 ||
    lat1 > 90 ||
    lat2 < -90 ||
    lat2 > 90 ||
    lon1 < -180 ||
    lon1 > 180 ||
    lon2 < -180 ||
    lon2 > 180
  ) {
    throw new Error('Coordinates out of range: latitude must be in [-90, 90], longitude in [-180, 180]');
  }

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth's mean radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Number(distance.toFixed(3));
}

/**
 * Validates whether a delivery coordinate falls within the permitted radius of a store hub.
 */
export function isWithinDeliveryRadius(
  storeLat: number,
  storeLon: number,
  customerLat: number,
  customerLon: number,
  maxRadiusKm: number = 4.00
): { isWithin: boolean; distanceKm: number } {
  const distanceKm = calculateHaversineKm(storeLat, storeLon, customerLat, customerLon);
  return {
    isWithin: distanceKm <= maxRadiusKm,
    distanceKm,
  };
}
