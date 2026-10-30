import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  MAP_STYLE_URL,
  fetchRoadRoute,
  formatRouteSummary,
  shouldReroute,
  type LatLng,
  type RoadRoute,
} from '../lib/route';

/**
 * The delivery map (2026-09-28): the customer's pin, the rider's own live
 * position from the phone's GPS, and the road route between them from the
 * self-hosted OSRM (via the Blynk API). Free and open source throughout:
 * MapLibre GL + OpenFreeMap tiles, no key.
 *
 * - The route is re-asked only after moving REROUTE_AFTER_M, not per GPS fix.
 * - No route (routing down, no road) never blocks delivery: the pins stay and
 *   a line says the route is unavailable.
 * - A phone that cannot draw WebGL maps gets a plain message instead.
 *
 * Seller orders (owner, 2026-10-30): with `pickup` (the seller's shop, while
 * the rider has not collected the goods yet) the map draws the road route
 * SHOP -> CUSTOMER - the leg the rider is about to drive - with the shop's
 * orange pin beside the customer's green one, and still shows the rider's own
 * dot. The rider -> customer route is not asked for then (the rider is going
 * to the shop first; Google Maps navigation to the shop is its own button).
 * Once the goods are picked up the screen drops `pickup` and the map goes back
 * to rider -> customer.
 */
export function DeliveryMap({
  destination,
  pickup = null,
  followMe = true,
}: {
  destination: LatLng;
  pickup?: LatLng | null;
  followMe?: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const lastFrom = useRef<LatLng | null>(null);
  const fitted = useRef(false);
  // The route drawn last, kept so a route that arrives before the style has loaded is drawn on load.
  const drawn = useRef<RoadRoute | null>(null);
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeState, setRouteState] = useState<'waiting' | 'ok' | 'unavailable'>('waiting');
  const [mapFailed, setMapFailed] = useState(false);
  const pickupLat = pickup?.lat ?? null;
  const pickupLng = pickup?.lng ?? null;

  const draw = (r: RoadRoute) => {
    drawn.current = r;
    const src = map.current?.getSource('route') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: r.coordinates },
    });
  };

  // The map and the customer's pin (and the shop's, for a seller order).
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [destination.lng, destination.lat],
        zoom: 14,
        attributionControl: { compact: true },
      });
    } catch {
      setMapFailed(true);
      return;
    }
    map.current = m;
    new maplibregl.Marker({ color: '#0c831f' }).setLngLat([destination.lng, destination.lat]).addTo(m);
    if (pickupLat !== null && pickupLng !== null) {
      new maplibregl.Marker({ color: '#f59e0b' }).setLngLat([pickupLng, pickupLat]).addTo(m);
      // Both ends in view from the start; the rider's own fix widens it when it arrives.
      m.fitBounds(
        [
          [Math.min(pickupLng, destination.lng), Math.min(pickupLat, destination.lat)],
          [Math.max(pickupLng, destination.lng), Math.max(pickupLat, destination.lat)],
        ],
        { padding: 56, maxZoom: 16, duration: 0 },
      );
    }
    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#12151f', 'line-width': 8 },
      });
      m.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffe141', 'line-width': 5 },
      });
      if (drawn.current) draw(drawn.current);
    });
    return () => {
      m.remove();
      map.current = null;
      meMarker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination.lat, destination.lng, pickupLat, pickupLng]);

  // Seller order: the road route from the shop to the customer, asked once.
  useEffect(() => {
    if (pickupLat === null || pickupLng === null) return;
    let alive = true;
    drawn.current = null;
    setRoute(null);
    setRouteState('waiting');
    fetchRoadRoute({ lat: pickupLat, lng: pickupLng }, destination)
      .then((r) => {
        if (!alive) return;
        setRoute(r);
        setRouteState('ok');
        draw(r);
      })
      .catch(() => {
        if (alive) setRouteState('unavailable');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination.lat, destination.lng, pickupLat, pickupLng]);

  // The rider's own position, and (without a shop leg) the route from it.
  useEffect(() => {
    if (!followMe || !('geolocation' in navigator)) return;
    // Held for the cleanup: stop the same watcher that was started.
    const geo = navigator.geolocation;
    const watch = geo.watchPosition(
      async (pos) => {
        const me: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const m = map.current;
        if (m) {
          if (!meMarker.current) {
            const dot = document.createElement('div');
            dot.className = 'map-me';
            dot.setAttribute('aria-label', 'You');
            meMarker.current = new maplibregl.Marker({ element: dot }).setLngLat([me.lng, me.lat]).addTo(m);
          } else {
            meMarker.current.setLngLat([me.lng, me.lat]);
          }
          if (!fitted.current) {
            fitted.current = true;
            const lngs = [me.lng, destination.lng, ...(pickupLng !== null ? [pickupLng] : [])];
            const lats = [me.lat, destination.lat, ...(pickupLat !== null ? [pickupLat] : [])];
            m.fitBounds(
              [
                [Math.min(...lngs), Math.min(...lats)],
                [Math.max(...lngs), Math.max(...lats)],
              ],
              { padding: 56, maxZoom: 16, duration: 0 },
            );
          }
        }
        if (pickupLat !== null) return; // the shop -> customer leg is on the map
        if (!shouldReroute(lastFrom.current, me)) return;
        lastFrom.current = me;
        try {
          const r = await fetchRoadRoute(me, destination);
          setRoute(r);
          setRouteState('ok');
          draw(r);
        } catch {
          setRouteState('unavailable');
        }
      },
      () => setRouteState((s) => (s === 'ok' ? s : 'waiting')),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => geo.clearWatch(watch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followMe, destination.lat, destination.lng, pickupLat, pickupLng]);

  if (mapFailed) {
    return (
      <p className="map-note">
        The map can't be shown on this phone. Use the {pickup ? 'addresses' : 'address'} below.
      </p>
    );
  }

  const seller = pickup !== null;
  return (
    <section className="delivery-map" aria-label={seller ? 'Route from the shop to the customer' : 'Route to the customer'}>
      <div ref={container} className="delivery-map__canvas" data-testid="delivery-map" />
      <p className="delivery-map__summary" role="status">
        {routeState === 'ok' && route
          ? seller
            ? `Shop to customer: ${formatRouteSummary(route)}`
            : formatRouteSummary(route)
          : routeState === 'unavailable'
            ? seller
              ? 'Route unavailable - the orange pin is the shop, the green pin the customer.'
              : 'Route unavailable - follow the pin.'
            : seller
              ? 'Finding the route…'
              : 'Finding your location…'}
      </p>
    </section>
  );
}
