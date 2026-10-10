import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { insights, type OrderMap as OrderMapData, type OrderMapRange } from '../api/insights';
import { PageHeader } from '../components/Layout';
import { Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { ORDER_MAP_RANGE_LABEL, ZONE_LABEL, circlePolygon, radiusAdvice } from '../lib/insights';
import { formatMoney } from '../lib/orders';
import { MAP_STYLE_URL } from '../lib/route';

/**
 * Delivery heat map (owner, 2026-10-10): where orders come from. The API
 * sends only ~150 m grid cells with counts and revenue - no names, phones
 * or exact points. Drawn on the same MapLibre + OpenFreeMap stack as the
 * delivery map: the hub, the service radius as a circle, and one bubble
 * per cell (bigger and warmer = more orders). Under it: inside / near the
 * edge / outside counts and the busiest areas.
 */
export function OrderMap() {
  const [range, setRange] = useState<OrderMapRange>('last_30_days');
  const [status, setStatus] = useState<'delivered' | 'all'>('delivered');
  const [data, setData] = useState<OrderMapData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    insights
      .orderMap(range, status)
      .then((d) => live && setData(d))
      .catch((err) => live && setError(errorMessage(err, 'Could not load the map.')));
    return () => {
      live = false;
    };
  }, [range, status]);

  return (
    <div className="page">
      <PageHeader title="Delivery map" description={`Orders on a ${data?.cell_meters ?? 150} m grid. No customer names or exact addresses.`} />

      <div className="dash-ranges dash-ranges--scroll" role="group" aria-label="Period">
        {(Object.keys(ORDER_MAP_RANGE_LABEL) as OrderMapRange[]).map((r) => (
          <button key={r} type="button" className={r === range ? 'dash-range is-selected' : 'dash-range'} aria-pressed={r === range} onClick={() => setRange(r)}>
            {ORDER_MAP_RANGE_LABEL[r]}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Which orders">
        {(
          [
            ['delivered', 'Delivered'],
            ['all', 'All orders'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={value === status ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={value === status}
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading the map" /> : null}

      {data ? (
        <>
          <HeatMap data={data} />

          <section className="section" aria-labelledby="map-radius">
            <h2 className="section-label" id="map-radius">
              Service radius · {data.store.radius_km} km
            </h2>
            <div className="map-zones">
              <Zone tone="inside" value={data.totals.inside} label={`Inside (over ${data.edge_km} km from the edge)`} />
              <Zone tone="near_edge" value={data.totals.near_edge} label={`Near the edge (last ${data.edge_km} km)`} />
              <Zone tone="outside" value={data.totals.outside} label="Outside the radius" />
            </div>
            <p className="dash-compare" role="status">
              {radiusAdvice(data.totals, data.store.radius_km, data.edge_km)}
              {data.totals.farthest_km !== null ? ` Farthest: ${data.totals.farthest_km} km.` : ''}
            </p>
          </section>

          <section className="section" aria-labelledby="map-busiest">
            <h2 className="section-label" id="map-busiest">
              Busiest areas
            </h2>
            {data.busiest.length === 0 ? (
              <p className="quiet">No orders in this period.</p>
            ) : (
              <ol className="cat-list map-busiest">
                {data.busiest.map((c, i) => (
                  <li key={`${c.lat},${c.lng}`} className="cat-row cat-row--flat">
                    <span className="map-busiest__rank">{i + 1}</span>
                    <div className="cat-row__main">
                      <p className="cat-row__title">{c.area ?? 'Unnamed area'}</p>
                      <p className="cat-row__meta">
                        {c.distance_km} km from the store · {ZONE_LABEL[c.zone]}
                      </p>
                    </div>
                    <div className="map-busiest__figures">
                      <span className="map-busiest__orders">
                        {c.orders} {c.orders === 1 ? 'order' : 'orders'}
                      </span>
                      <span className="cat-row__meta">{formatMoney(c.revenue)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Zone({ tone, value, label }: { tone: 'inside' | 'near_edge' | 'outside'; value: number; label: string }) {
  return (
    <div className={`map-zone map-zone--${tone}`}>
      <span className="map-zone__value">{value}</span>
      <span className="map-zone__label">{label}</span>
    </div>
  );
}

/** The cells as GeoJSON points, weighted by orders (0..1 against the busiest cell). */
function cellsGeoJson(data: OrderMapData) {
  const max = Math.max(1, ...data.cells.map((c) => c.orders));
  return {
    type: 'FeatureCollection' as const,
    features: data.cells.map((c) => ({
      type: 'Feature' as const,
      properties: { orders: c.orders, weight: c.orders / max },
      geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
    })),
  };
}

function radiusGeoJson(data: OrderMapData) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(data.store.lat, data.store.lng, data.store.radius_km)] },
  };
}

function HeatMap({ data }: { data: OrderMapData }) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const latest = useRef(data);
  latest.current = data;
  const [failed, setFailed] = useState(false);
  const { lat, lng, radius_km } = data.store;

  // The map, the hub and the radius: once per store.
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [lng, lat],
        zoom: 12,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    map.current = m;
    new maplibregl.Marker({ color: '#12151f' }).setLngLat([lng, lat]).addTo(m);
    m.on('load', () => {
      loaded.current = true;
      const d = latest.current;
      m.addSource('radius', { type: 'geojson', data: radiusGeoJson(d) });
      m.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#0c831f', 'fill-opacity': 0.05 } });
      m.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#0c831f', 'line-width': 2, 'line-dasharray': [2, 2] } });
      m.addSource('cells', { type: 'geojson', data: cellsGeoJson(d) });
      m.addLayer({
        id: 'cells',
        type: 'circle',
        source: 'cells',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 0, 6, 1, 22],
          'circle-color': ['interpolate', ['linear'], ['get', 'weight'], 0, '#ffe141', 0.5, '#f59f00', 1, '#d9480f'],
          'circle-opacity': 0.75,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      });
      m.addLayer({
        id: 'cell-counts',
        type: 'symbol',
        source: 'cells',
        layout: { 'text-field': ['to-string', ['get', 'orders']], 'text-size': 11, 'text-font': ['Noto Sans Bold'] },
        paint: { 'text-color': '#12151f' },
      });
    });
    const dLat = radius_km / 111.32;
    const dLng = radius_km / (111.32 * Math.cos((lat * Math.PI) / 180));
    m.fitBounds(
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat + dLat],
      ],
      { padding: 24, duration: 0 }
    );
    return () => {
      m.remove();
      map.current = null;
      loaded.current = false;
    };
  }, [lat, lng, radius_km]);

  // New figures (another range or status): just the bubbles change.
  useEffect(() => {
    if (!loaded.current) return;
    const src = map.current?.getSource('cells') as maplibregl.GeoJSONSource | undefined;
    src?.setData(cellsGeoJson(data));
  }, [data]);

  if (failed) {
    return <p className="map-note">The map can't be shown on this phone. The busiest areas are listed below.</p>;
  }
  return (
    <section className="order-map" aria-label="Order heat map">
      <div ref={container} className="order-map__canvas" data-testid="order-map" />
      <p className="order-map__legend">
        <span className="order-map__dot" aria-hidden="true" /> more orders = bigger, warmer bubble ·{' '}
        <span className="order-map__ring" aria-hidden="true" /> {radius_km} km service radius
      </p>
    </section>
  );
}
