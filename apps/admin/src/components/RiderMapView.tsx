import { useEffect, useRef, useState } from 'react';
import type { LiveRiderMap } from '../api/types';
import { circlePolygon } from '../lib/insights';
import { MAP_ATTRIBUTION, MAP_STYLE, loadMapLibre, type MlMap, type MlMarker, type MapLibre } from '../lib/maplibre';
import { shortNumber } from '../lib/orders';
import { allPoints, initials, riderName, riderPoint, riderTone, type LatLng } from '../lib/riderMap';
import './riderMap.css';

export type MapSelection = { kind: 'rider' | 'order'; id: string } | null;

/** Where the map opens when nothing is known (Colombo). */
const FALLBACK: LatLng = { lat: 6.9271, lng: 79.8612 };

interface Wanted {
  at: LatLng;
  className: string;
  text: string;
  label: string;
  kind: 'rider' | 'order';
  id: string;
}

/**
 * The Rider map (owner, 2026-10-25): MapLibre (loaded from the CDN like the seller portal's shop map -
 * Admin bundles no map package) with the OpenFreeMap style. The store (yellow), its delivery circle,
 * riders as labelled dots (initials) coloured free / on a trip / not seen lately, and orders as pins -
 * red while they wait for a rider, ink once a rider has them. Markers are small HTML buttons, so a click
 * selects them and a screen reader can name them. The map is made once; a refresh only moves the
 * markers, it never moves the camera.
 */
export function RiderMapView({
  data,
  selected,
  onSelect,
  focus,
}: {
  data: LiveRiderMap;
  selected: MapSelection;
  onSelect(selection: MapSelection): void;
  /** Bump to fly back to the store and its circle. */
  focus: number;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const markers = useRef(new Map<string, { marker: MlMarker; el: HTMLElement }>());
  const storeMarker = useRef<MlMarker | null>(null);
  const latest = useRef(data);
  latest.current = data;
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // The map, once.
  useEffect(() => {
    let alive = true;
    let map: MlMap | null = null;
    const live = markers.current;
    loadMapLibre()
      .then((ml) => {
        if (!alive || !box.current) return;
        const d = latest.current;
        const start = d.store ?? allPoints(d)[0] ?? FALLBACK;
        map = new ml.Map({
          container: box.current,
          style: MAP_STYLE,
          center: [start.lng, start.lat],
          zoom: 13,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
        });
        libRef.current = ml;
        mapRef.current = map;
        const m = map;
        m.addControl(new ml.AttributionControl({ compact: true, customAttribution: MAP_ATTRIBUTION }), 'bottom-left');
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        fitStore(m, d);
        m.on('load', () => {
          const s = latest.current.store;
          if (!alive || !s) return;
          m.addSource('delivery-circle', { type: 'geojson', data: circleFeature(s) });
          m.addLayer({ id: 'delivery-circle-fill', type: 'fill', source: 'delivery-circle', paint: { 'fill-color': '#0c831f', 'fill-opacity': 0.05 } });
          m.addLayer({
            id: 'delivery-circle-line',
            type: 'line',
            source: 'delivery-circle',
            paint: { 'line-color': '#0c831f', 'line-width': 2, 'line-dasharray': [2, 2] },
          });
        });
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      for (const { marker } of live.values()) marker.remove();
      live.clear();
      storeMarker.current = null;
      map?.remove();
      mapRef.current = null;
      libRef.current = null;
    };
  }, []);

  // The store's marker follows the store (it hardly ever moves).
  const store = data.store;
  const storeKey = store ? `${store.lat},${store.lng}` : '';
  useEffect(() => {
    const m = mapRef.current;
    const ml = libRef.current;
    if (!ready || !m || !ml || !store) return;
    const el = document.createElement('div');
    el.className = 'rmap-store';
    el.setAttribute('aria-label', 'Blynk store');
    const marker = new ml.Marker({ element: el }).setLngLat([store.lng, store.lat]).addTo(m);
    storeMarker.current = marker;
    return () => {
      marker.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, storeKey]);

  // Riders and orders: create, move or remove markers to match the data; the selected one is ringed.
  useEffect(() => {
    const m = mapRef.current;
    const ml = libRef.current;
    if (!ready || !m || !ml) return;
    const wanted = new Map<string, Wanted>();
    for (const r of data.riders) {
      const at = riderPoint(r);
      if (at) {
        const tone = riderTone(r);
        wanted.set(`rider:${r.id}`, {
          at,
          className: `rmap-dot rmap-dot--${tone}`,
          text: initials(riderName(r)),
          label: `${riderName(r)}, ${tone === 'stale' ? 'not seen lately' : tone === 'trip' ? 'on a trip' : 'free'}`,
          kind: 'rider',
          id: r.id,
        });
      }
      // The drop points of what a rider carries are on the map even when the rider has no position.
      for (const del of r.deliveries) {
        if (!del.dropoff) continue;
        wanted.set(`order:${del.order_id}`, {
          at: del.dropoff,
          className: 'rmap-pin rmap-pin--assigned',
          text: shortNumber(del.order_number),
          label: `Order ${del.order_number}, with ${riderName(r)}`,
          kind: 'order',
          id: del.order_id,
        });
      }
    }
    for (const o of data.unassigned_orders) {
      if (!o.dropoff) continue;
      wanted.set(`order:${o.order_id}`, {
        at: o.dropoff,
        className: 'rmap-pin rmap-pin--waiting',
        text: shortNumber(o.order_number),
        label: `Order ${o.order_number}, waiting for a rider`,
        kind: 'order',
        id: o.order_id,
      });
    }

    const have = markers.current;
    for (const [key, entry] of have) {
      if (!wanted.has(key)) {
        entry.marker.remove();
        have.delete(key);
      }
    }
    for (const [key, w] of wanted) {
      const isSelected = selected?.kind === w.kind && selected.id === w.id;
      let entry = have.get(key);
      if (!entry) {
        const el = document.createElement('div');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        const choose = () => pick.current({ kind: w.kind, id: w.id });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          choose();
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose();
          }
        });
        const marker = new ml.Marker({ element: el }).setLngLat([w.at.lng, w.at.lat]).addTo(m);
        entry = { marker, el };
        have.set(key, entry);
      } else {
        entry.marker.setLngLat([w.at.lng, w.at.lat]);
      }
      entry.el.className = `${w.className}${isSelected ? ' is-selected' : ''}`;
      entry.el.textContent = w.text;
      entry.el.setAttribute('aria-label', w.label);
    }
  }, [ready, data, selected]);

  // "Centre on the store".
  useEffect(() => {
    if (focus > 0 && mapRef.current) fitStore(mapRef.current, latest.current);
  }, [focus]);

  if (failed) return <p className="map-note">The map could not be loaded. The lists below have everything.</p>;
  return <div ref={box} className="rmap__canvas" data-testid="rider-map" />;
}

function circleFeature(s: { lat: number; lng: number; radius_km: number }) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(s.lat, s.lng, s.radius_km)] },
  };
}

/** Frame the store's delivery circle (the whole zone), or the points there are when there is no store pin. */
function fitStore(m: MlMap, d: LiveRiderMap) {
  if (d.store) {
    const dLat = d.store.radius_km / 111.32;
    const dLng = d.store.radius_km / (111.32 * Math.cos((d.store.lat * Math.PI) / 180));
    m.fitBounds(
      [
        [d.store.lng - dLng, d.store.lat - dLat],
        [d.store.lng + dLng, d.store.lat + dLat],
      ],
      { padding: 16, duration: 0 }
    );
    return;
  }
  const pts = allPoints(d);
  if (pts.length === 0) return;
  m.fitBounds(
    [
      [Math.min(...pts.map((p) => p.lng)), Math.min(...pts.map((p) => p.lat))],
      [Math.max(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lat))],
    ],
    { padding: 40, maxZoom: 15, duration: 0 }
  );
}
