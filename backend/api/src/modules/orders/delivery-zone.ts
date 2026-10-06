import { isWithinDeliveryRadius } from '../../utils/geo.js';
import { AppError } from '../../middleware/error.middleware.js';
import { orderRepository, type DBConnection } from './order.repository.js';
import { db } from '../../database/connection.js';

/**
 * The service-zone check shared by checkout and the address book: the
 * coordinates must lie within the active dark store's radius_km. Throws the
 * same 422 DELIVERY_OUTSIDE_RADIUS (details { distance_km, max_radius_km })
 * in both places, so an address that saves is an address that can order.
 */
export async function assertWithinServiceZone(latitude: number, longitude: number, executor: DBConnection = db) {
  const store = await orderRepository.findActiveDarkStore(executor);
  if (!store) {
    throw new AppError('No active dark store hub found.', 500, 'STORE_UNAVAILABLE');
  }

  const { isWithin, distanceKm } = isWithinDeliveryRadius(
    Number(store.latitude),
    Number(store.longitude),
    Number(latitude),
    Number(longitude),
    Number(store.radius_km)
  );

  if (!isWithin) {
    throw new AppError(
      `Delivery address is outside the ${Number(store.radius_km).toFixed(2)} km service zone (${distanceKm} km away).`,
      422,
      'DELIVERY_OUTSIDE_RADIUS',
      { distance_km: distanceKm, max_radius_km: Number(store.radius_km) }
    );
  }
  return store;
}
