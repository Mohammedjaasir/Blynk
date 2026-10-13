/*
 * Live order tracking. For the order screen (agent c1 / the parent):
 *
 *   import { LiveTracking, isTrackable } from '@/blynk/tracking';
 *   {isTrackable(order) && (
 *     <LiveTracking
 *       orderId={order.id}
 *       destination={{ lat: order.delivery_latitude, lng: order.delivery_longitude }}
 *       riderName={order.rider_contact?.first_name}
 *     />
 *   )}
 *
 * Unmounting closes the stream; a logout closes every stream (stopAllTracking).
 */
export { LiveTracking, isTrackable, destinationOf, onTheWayText, MAP_SECTION_TITLE } from './LiveTracking';
export { useLiveTracking, stopAllTracking } from './useLiveTracking';
