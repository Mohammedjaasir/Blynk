import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { loadMapLibre, MAP_ATTRIBUTION, MAP_STYLE } from '@/blynk/address/maplibre';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';
import type { RiderPoint } from './model';
import { TRACKING_WORDS } from './words';

/*
 * The tracking map (web only): MapLibre GL from the CDN with the OpenFreeMap style, exactly the
 * approach of the address screen (src/blynk/address/maplibre.ts). The door is an ink pin, the
 * rider a yellow disc with an arrow that turns with the heading (grey while STALE), and the road
 * route an ink line. The camera keeps both in view until the customer moves the map.
 */

type Pt = { lat: number; lng: number };

type MlMarker = {
  setLngLat(ll: [number, number]): MlMarker;
  addTo(m: unknown): MlMarker;
  setRotation(deg: number): MlMarker;
  remove(): void;
  getElement(): HTMLElement;
};
type GeoSource = { setData(d: unknown): void };
type TrackMap = {
  on(ev: string, fn: (e?: unknown) => void): void;
  once(ev: string, fn: (e?: unknown) => void): void;
  addSource(id: string, src: unknown): void;
  getSource(id: string): GeoSource | undefined;
  addLayer(layer: unknown): void;
  fitBounds(b: [[number, number], [number, number]], o?: Record<string, unknown>): void;
  easeTo(o: Record<string, unknown>): void;
  isStyleLoaded(): boolean;
  resize(): void;
  remove(): void;
  touchZoomRotate: { disableRotation(): void };
  keyboard: { disableRotation(): void };
};
type MlLib = {
  Map: new (o: Record<string, unknown>) => TrackMap;
  Marker: new (o: Record<string, unknown>) => MlMarker;
};

const DOOR_SVG =
  '<svg width="30" height="40" viewBox="0 0 32 46"><path d="M16 1a15 15 0 0115 15c0 7.5-5.4 13.3-12 14.7L16 35l-3-4.3C6.4 29.3 1 23.5 1 16A15 15 0 0116 1z" fill="#1A1D2E" stroke="#fff" stroke-width="1.8"/><path d="M10 17.5l6-5 6 5V23h-4v-3.5h-4V23h-4z" fill="#FFE141"/></svg>';
const riderSvg = (stale: boolean) =>
  `<svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="15" fill="${stale ? '#C9CAD3' : '#FFE141'}" stroke="#1A1D2E" stroke-width="2"/><path d="M19 9l6 14-6-3.6-6 3.6z" fill="#1A1D2E"/></svg>`;

function el(html: string, label: string): HTMLElement {
  const d = (globalThis as { document: Document }).document.createElement('div');
  d.innerHTML = html;
  d.setAttribute('aria-label', label);
  d.style.lineHeight = '0';
  return d;
}

const TWEEN_MS = 900;

export function TrackingMap({
  destination, rider, stale, heading, route, height,
}: {
  destination: Pt;
  rider: RiderPoint | null;
  stale: boolean;
  heading: number | null;
  route: [number, number][];
  height: number | '100%';
}) {
  const host = useRef<View>(null);
  const map = useRef<TrackMap | null>(null);
  const lib = useRef<MlLib | null>(null);
  const riderMarker = useRef<MlMarker | null>(null);
  const shown = useRef<Pt | null>(null);
  const anim = useRef<number | null>(null);
  const userMoved = useRef(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const web = Platform.OS === 'web';

  // create the map once per attempt
  useEffect(() => {
    if (!web) return;
    let alive = true;
    loadMapLibre()
      .then((ml0) => {
        const ml = ml0 as unknown as MlLib;
        const container = host.current as unknown as HTMLElement | null;
        if (!alive || !container) return;
        lib.current = ml;
        const m = new ml.Map({
          container,
          style: MAP_STYLE,
          center: [destination.lng, destination.lat],
          zoom: 15,
          minZoom: 10,
          maxZoom: 18,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: false,
        });
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();
        m.on('dragstart', () => { userMoved.current = true; });
        m.on('zoomstart', (e) => { if ((e as { originalEvent?: unknown } | undefined)?.originalEvent) userMoved.current = true; });
        new ml.Marker({ element: el(DOOR_SVG, TRACKING_WORDS.doorLabel), anchor: 'bottom' })
          .setLngLat([destination.lng, destination.lat])
          .addTo(m);
        m.once('load', () => {
          if (!alive) return;
          m.addSource('route', { type: 'geojson', data: lineOf([]) });
          m.addLayer({
            id: 'route-casing', type: 'line', source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#FFFFFF', 'line-width': 8 },
          });
          m.addLayer({
            id: 'route-line', type: 'line', source: 'route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': C.brandInk, 'line-width': 4.5 },
          });
          setState('ready');
        });
        map.current = m;
      })
      .catch(() => { if (alive) setState('failed'); });
    return () => {
      alive = false;
      if (anim.current !== null) cancelAnimationFrame(anim.current);
      riderMarker.current?.remove();
      riderMarker.current = null;
      shown.current = null;
      map.current?.remove();
      map.current = null;
    };
    // the destination of an order never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, web]);

  // the rider: add, glide to the new point, turn, grey while stale
  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!m || !ml || state !== 'ready') return;
    if (!rider) {
      riderMarker.current?.remove();
      riderMarker.current = null;
      shown.current = null;
      return;
    }
    if (!riderMarker.current) {
      riderMarker.current = new ml.Marker({ element: el(riderSvg(stale), TRACKING_WORDS.riderLabel), rotationAlignment: 'map' })
        .setLngLat([rider.lng, rider.lat])
        .addTo(m);
      shown.current = { lat: rider.lat, lng: rider.lng };
    } else {
      riderMarker.current.getElement().innerHTML = riderSvg(stale);
      const from = shown.current ?? { lat: rider.lat, lng: rider.lng };
      const to = { lat: rider.lat, lng: rider.lng };
      const start = performance.now();
      if (anim.current !== null) cancelAnimationFrame(anim.current);
      const step = (t: number) => {
        const k = Math.min(1, (t - start) / TWEEN_MS);
        const e = 1 - (1 - k) ** 3;
        const p = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e };
        shown.current = p;
        riderMarker.current?.setLngLat([p.lng, p.lat]);
        anim.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    }
    if (heading !== null) riderMarker.current.setRotation(heading);
    if (!userMoved.current) {
      const lats = [destination.lat, rider.lat];
      const lngs = [destination.lng, rider.lng];
      m.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 56, maxZoom: 16.5, duration: 700 },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider?.lat, rider?.lng, rider?.capturedAt, stale, heading, state]);

  // the road line
  useEffect(() => {
    if (state !== 'ready') return;
    map.current?.getSource('route')?.setData(lineOf(route));
  }, [route, state]);

  const recenter = () => {
    userMoved.current = false;
    const m = map.current;
    if (!m) return;
    if (rider) {
      const lats = [destination.lat, rider.lat];
      const lngs = [destination.lng, rider.lng];
      m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 56, maxZoom: 16.5, duration: 500 });
    } else {
      m.easeTo({ center: [destination.lng, destination.lat], zoom: 15, duration: 500 });
    }
  };

  if (!web) {
    return (
      <View style={[styles.box, { height }, styles.center]}>
        <Text style={styles.note}>{TRACKING_WORDS.mapOnWeb}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.box, { height }]}>
      <View key={attempt} ref={host} style={{ width: '100%', height: '100%' }} />
      {state === 'loading' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color={C.brandInk} /></View>
      )}
      {state === 'failed' && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Text style={styles.note}>{TRACKING_WORDS.mapFailed}</Text>
          <PressScale onPress={() => { setState('loading'); setAttempt((n) => n + 1); }} style={styles.retry}>
            <Text style={styles.retryTxt}>{TRACKING_WORDS.tryAgain}</Text>
          </PressScale>
        </View>
      )}
      {state === 'ready' && (
        <Pressable onPress={recenter} style={styles.recenter} accessibilityRole="button" accessibilityLabel={TRACKING_WORDS.recenter}>
          <Text style={styles.recenterTxt}>⌖</Text>
        </Pressable>
      )}
      <Text style={styles.attr} pointerEvents="none">{MAP_ATTRIBUTION}</Text>
    </View>
  );
}

function lineOf(points: [number, number][]) {
  return {
    type: 'FeatureCollection',
    features: points.length >= 2
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(([lat, lng]) => [lng, lat]) } }]
      : [],
  };
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', backgroundColor: '#EFEBE3' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  note: { fontFamily: F.medium, fontSize: 13, color: C.sub, textAlign: 'center' },
  retry: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, backgroundColor: C.brand },
  retryTxt: { fontFamily: F.semi, fontSize: 13, color: C.brandInk },
  recenter: {
    position: 'absolute', right: 10, top: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line,
  },
  recenterTxt: { fontSize: 20, color: C.brandInk, lineHeight: 22 },
  attr: {
    position: 'absolute', left: 6, bottom: 4, fontFamily: F.regular, fontSize: 9.5, color: '#55555C',
    backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4, borderRadius: 3,
  },
});
