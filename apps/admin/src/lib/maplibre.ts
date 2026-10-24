/*
 * MapLibre GL JS for the Rider map, loaded on demand from the CDN (never bundled; Admin has no map
 * package) - the same build, OpenFreeMap "liberty" style and attribution the seller portal and the
 * customer app use (apps/seller/src/lib/maplibre.ts).
 */
export const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
export const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors';

/** The small part of the maplibre-gl API this app uses. */
export type MlBounds = [[number, number], [number, number]];
export interface MlMarker {
  setLngLat(ll: [number, number]): MlMarker;
  addTo(map: MlMap): MlMarker;
  remove(): MlMarker;
}
export interface MlGeoJsonSource {
  setData(data: unknown): void;
}
export interface MlMap {
  on(ev: string, fn: (e?: unknown) => void): void;
  once(ev: string, fn: (e?: unknown) => void): void;
  addSource(id: string, source: Record<string, unknown>): void;
  addLayer(layer: Record<string, unknown>): void;
  getSource(id: string): MlGeoJsonSource | undefined;
  addControl(control: unknown, position?: string): void;
  fitBounds(bounds: MlBounds, o?: { padding?: number; maxZoom?: number; duration?: number }): void;
  resize(): void;
  remove(): void;
}
export type MlMapOptions = Record<string, unknown>;
export interface MapLibre {
  Map: new (o: MlMapOptions) => MlMap;
  Marker: new (o?: { element?: HTMLElement }) => MlMarker;
  AttributionControl: new (o: Record<string, unknown>) => unknown;
  NavigationControl: new (o: Record<string, unknown>) => unknown;
}

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
    s.onerror = () => {
      s.remove();
      reject(new Error('maplibre-gl did not load'));
    };
    doc.head.appendChild(s);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
