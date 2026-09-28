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
 */
export function DeliveryMap({ destination, followMe = true }: { destination: LatLng; followMe?: boolean }) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const lastFrom = useRef<LatLng | null>(null);
  const fitted = useRef(false);
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeState, setRouteState] = useState<'waiting' | 'ok' | 'unavailable'>('waiting');
  const [mapFailed, setMapFailed] = useState(false);

  // The map and the customer's pin.
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
    });
    return () => {
      m.remove();
      map.current = null;
      meMarker.current = null;
    };
  }, [destination.lat, destination.lng]);

  // The rider's own position, and the route from it.
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
            m.fitBounds(
              [
                [Math.min(me.lng, destination.lng), Math.min(me.lat, destination.lat)],
                [Math.max(me.lng, destination.lng), Math.max(me.lat, destination.lat)],
              ],
              { padding: 56, maxZoom: 16, duration: 0 },
            );
          }
        }
        if (!shouldReroute(lastFrom.current, me)) return;
        lastFrom.current = me;
        try {
          const r = await fetchRoadRoute(me, destination);
          setRoute(r);
          setRouteState('ok');
          const src = map.current?.getSource('route') as maplibregl.GeoJSONSource | undefined;
          src?.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: r.coordinates },
          });
        } catch {
          setRouteState('unavailable');
        }
      },
      () => setRouteState((s) => (s === 'ok' ? s : 'waiting')),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => geo.clearWatch(watch);
  }, [followMe, destination.lat, destination.lng]);

  if (mapFailed) {
    return <p className="map-note">The map can't be shown on this phone. Use the address below.</p>;
  }

  return (
    <section className="delivery-map" aria-label="Route to the customer">
      <div ref={container} className="delivery-map__canvas" data-testid="delivery-map" />
      <p className="delivery-map__summary" role="status">
        {routeState === 'ok' && route
          ? formatRouteSummary(route)
          : routeState === 'unavailable'
            ? 'Route unavailable - follow the pin.'
            : 'Finding your location…'}
      </p>
    </section>
  );
}
