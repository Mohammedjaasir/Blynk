import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { LatLng } from '../api/types';
import { MAP_ATTRIBUTION, MAP_STYLE, MAP_ZOOM, loadMapLibre, type MlMap } from '../lib/maplibre';

export interface ShopMapHandle {
  /** Glide the map so `p` sits under the centre pin. */
  flyTo(p: LatLng): void;
}

export type MapStatus = 'loading' | 'ready' | 'failed';

export interface ShopMapProps {
  /** Where the map opens (read once, when the map is made). */
  start: LatLng;
  /** The Blynk store, drawn as a yellow dot. */
  store: LatLng | null;
  /** The approved shop point, drawn as a small ink dot while a new pin waits. */
  approved?: LatLng | null;
  /** The centre of the map as it moves (the point under the pin). */
  onMove(center: LatLng): void;
  onMoving?(moving: boolean): void;
  onStatus?(status: MapStatus): void;
  label: string;
}

function pointFeature(p: LatLng) {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } };
}

/**
 * The MapLibre map behind the fixed centre pin. Kept tiny and separate so the
 * tests can stand in a fake (jsdom has no WebGL).
 */
export const ShopMap = forwardRef<ShopMapHandle, ShopMapProps>(function ShopMap(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useImperativeHandle(
    ref,
    () => ({
      flyTo(p: LatLng) {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 17), duration: 900 });
      },
    }),
    []
  );

  useEffect(() => {
    let alive = true;
    let map: MlMap | null = null;
    const { start } = latest.current;
    latest.current.onStatus?.('loading');
    loadMapLibre()
      .then((ml) => {
        if (!alive || !box.current) return;
        map = new ml.Map({
          container: box.current,
          style: MAP_STYLE,
          center: [start.lng, start.lat],
          zoom: MAP_ZOOM.start,
          minZoom: MAP_ZOOM.min,
          maxZoom: MAP_ZOOM.max,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: false,
        });
        const m = map;
        m.addControl(new ml.AttributionControl({ compact: true, customAttribution: MAP_ATTRIBUTION }), 'bottom-left');
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();
        m.on('movestart', () => latest.current.onMoving?.(true));
        m.on('move', () => {
          const c = m.getCenter();
          latest.current.onMove({ lat: c.lat, lng: c.lng });
        });
        m.on('moveend', () => {
          const c = m.getCenter();
          latest.current.onMove({ lat: c.lat, lng: c.lng });
          latest.current.onMoving?.(false);
        });
        // Show the map as soon as its style is in (the tiles stream in after); the dots wait for 'load'.
        m.once('styledata', () => {
          if (!alive) return;
          // Start the attribution folded to its (i) button so it does not cover the map's own buttons.
          box.current?.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
          latest.current.onStatus?.('ready');
        });
        m.once('load', () => {
          if (!alive) return;
          const { store, approved } = latest.current;
          try {
            if (approved) {
              m.addSource('shop-approved', { type: 'geojson', data: pointFeature(approved) });
              m.addLayer({
                id: 'shop-approved',
                type: 'circle',
                source: 'shop-approved',
                paint: { 'circle-radius': 6, 'circle-color': '#1A1D2E', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5 },
              });
            }
            if (store) {
              m.addSource('blynk-store', { type: 'geojson', data: pointFeature(store) });
              m.addLayer({
                id: 'blynk-store-halo',
                type: 'circle',
                source: 'blynk-store',
                paint: { 'circle-radius': 16, 'circle-color': '#FFE141', 'circle-opacity': 0.28 },
              });
              m.addLayer({
                id: 'blynk-store',
                type: 'circle',
                source: 'blynk-store',
                paint: { 'circle-radius': 7, 'circle-color': '#FFE141', 'circle-stroke-color': '#1A1D2E', 'circle-stroke-width': 2 },
              });
            }
          } catch {
            /* the dots are a guide only; the pin works without them */
          }
          latest.current.onStatus?.('ready');
        });
        mapRef.current = m;
      })
      .catch(() => {
        if (alive) latest.current.onStatus?.('failed');
      });
    return () => {
      alive = false;
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  return <div ref={box} className="shopmap" role="region" aria-label={props.label} />;
});
