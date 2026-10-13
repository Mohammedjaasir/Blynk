/*
 * MapLibre GL JS, loaded on the address screen only (never bundled): the same CDN build and
 * OpenFreeMap "liberty" style the Flutter web shop used. Web only.
 */
export const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
export const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const MAP_ZOOM = { start: 16, min: 10, max: 18 } as const;
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors';

/** The small part of the maplibre-gl API this app uses. */
export type LngLat = { lng: number; lat: number };
export type MlMap = {
  on(ev: string, fn: (e?: unknown) => void): void;
  once(ev: string, fn: (e?: unknown) => void): void;
  getCenter(): LngLat;
  easeTo(o: { center?: [number, number]; zoom?: number; duration?: number; padding?: Padding }): void;
  jumpTo(o: { center?: [number, number]; zoom?: number }): void;
  setPadding(p: Padding): void;
  resize(): void;
  remove(): void;
  touchZoomRotate: { disableRotation(): void };
  dragRotate: { disable(): void };
  keyboard: { disableRotation(): void };
};
export type Padding = { top: number; bottom: number; left: number; right: number };
type MapLibre = {
  Map: new (o: Record<string, unknown>) => MlMap;
  AttributionControl: new (o: Record<string, unknown>) => unknown;
};

let loading: Promise<MapLibre> | null = null;

/** Add the script and stylesheet once; resolves with the global `maplibregl`. */
export function loadMapLibre(): Promise<MapLibre> {
  const w = globalThis as unknown as { maplibregl?: MapLibre; document?: Document };
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  if (loading) return loading;
  const doc = w.document;
  if (!doc) return Promise.reject(new Error('No document: the map needs a browser.'));
  loading = new Promise<MapLibre>((resolve, reject) => {
    if (!doc.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const css = doc.createElement('link');
      css.rel = 'stylesheet';
      css.href = MAPLIBRE_CSS;
      doc.head.appendChild(css);
    }
    const s = doc.createElement('script');
    s.src = MAPLIBRE_JS;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => (w.maplibregl ? resolve(w.maplibregl) : reject(new Error('maplibre-gl did not load')));
    s.onerror = () => { s.remove(); reject(new Error('maplibre-gl did not load')); };
    doc.head.appendChild(s);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

export type Fix = { lat: number; lng: number };

/** One high-accuracy position from the browser (about 10 s), or a rejection on denial / error / no support. */
export function locateOnce(timeout = 10_000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    const geo = (globalThis as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (!geo) { reject(new Error('unsupported')); return; }
    try {
      geo.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => reject(e),
        { enableHighAccuracy: true, timeout, maximumAge: 30_000 },
      );
    } catch (e) {
      reject(e);
    }
  });
}
