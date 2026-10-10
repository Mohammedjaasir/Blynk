import { useEffect, useState } from 'react';
import { insights, type OrderMap as OrderMapData, type OrderMapCell, type OrderMapRange } from '../api/insights';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { ORDER_MAP_RANGE_LABEL, ZONE_LABEL, radiusAdvice } from '../lib/insights';
import { formatMoney } from '../lib/orders';

/**
 * Delivery heat map (owner, 2026-10-10): where orders come from. The API
 * sends only ~150 m grid cells with counts and revenue - no names, phones
 * or exact points. Admin has no map library, so this is a plain SVG plot
 * in kilometres around the store: the service radius, the "near the edge"
 * band, and one bubble per cell (bigger and warmer = more orders). The
 * Operations app shows the same data on a street map.
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
    <>
      <PageHeader
        title="Delivery map"
        description={`Where orders come from, on a ${data?.cell_meters ?? 150} m grid. No customer names or exact addresses.`}
        actions={
          <>
            <div className="segmented" role="group" aria-label="Period">
              {(Object.keys(ORDER_MAP_RANGE_LABEL) as OrderMapRange[]).map((r) => (
                <button key={r} type="button" className={r === range ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={r === range} onClick={() => setRange(r)}>
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
                <button key={value} type="button" className={value === status ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={value === status} onClick={() => setStatus(value)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading the map" /> : null}

      {data ? (
        <>
          <div className="figures" aria-label="Orders and the service radius">
            <Stat value={String(data.totals.orders)} label="Orders" />
            <Stat value={formatMoney(data.totals.revenue)} label="Delivered revenue" />
            <Stat value={String(data.totals.inside)} label="Inside" />
            <Stat value={String(data.totals.near_edge)} label={`Last ${data.edge_km} km`} />
            <Stat value={String(data.totals.outside)} label={`Outside ${data.store.radius_km} km`} />
          </div>
          <p className="form__note" role="status">
            {radiusAdvice(data.totals, data.store.radius_km, data.edge_km)}
            {data.totals.farthest_km !== null ? ` Farthest: ${data.totals.farthest_km} km.` : ''}
          </p>

          <div className="order-map">
            <GridMap data={data} />
            <section className="attention order-map__list">
              <h2 className="section-label">Busiest areas</h2>
              {data.busiest.length === 0 ? (
                <EmptyState title="No orders" message="Nothing was ordered in this period." />
              ) : (
                <div className="table-wrap">
                  <table className="table" aria-label="Busiest areas">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Area</th>
                        <th scope="col" className="num">
                          Orders
                        </th>
                        <th scope="col" className="num">
                          Revenue
                        </th>
                        <th scope="col" className="num">
                          From store
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.busiest.map((c, i) => (
                        <tr key={`${c.lat},${c.lng}`}>
                          <td className="mono">{i + 1}</td>
                          <td>
                            {c.area ?? 'Unnamed area'}
                            <span className={`zone-tag zone-tag--${c.zone}`}>{ZONE_LABEL[c.zone]}</span>
                          </td>
                          <td className="num mono">{c.orders}</td>
                          <td className="num mono">{formatMoney(c.revenue)}</td>
                          <td className="num mono">{c.distance_km} km</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="figure">
      <span className="figure__value figure__value--sm">{value}</span>
      <span className="figure__label">{label}</span>
    </div>
  );
}

const KM_PER_DEG = 111.32;

/** Kilometres east/north of the store (equirectangular - plenty at a few km). */
export function toKm(store: { lat: number; lng: number }, p: { lat: number; lng: number }) {
  return {
    x: (p.lng - store.lng) * KM_PER_DEG * Math.cos((store.lat * Math.PI) / 180),
    y: (p.lat - store.lat) * KM_PER_DEG,
  };
}

const heat = (w: number) => (w > 0.66 ? '#d9480f' : w > 0.33 ? '#f59f00' : '#fcc419');

function GridMap({ data }: { data: OrderMapData }) {
  const r = data.store.radius_km;
  const points = data.cells.map((c) => ({ c, ...toKm(data.store, c) }));
  const reach = Math.max(r * 1.15, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)) + 0.4));
  const max = Math.max(1, ...data.cells.map((c) => c.orders));
  const ticks = Array.from({ length: Math.floor(reach) * 2 + 1 }, (_, i) => i - Math.floor(reach));
  const label = `Map of ${data.totals.orders} orders in ${data.totals.cells} areas around the store; ${data.totals.outside} outside the ${r} km radius.`;
  const bubble = (c: OrderMapCell) => 0.12 + (c.orders / max) * Math.max(0.25, reach / 14);

  return (
    <figure className="grid-map">
      <svg viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`} role="img" aria-label={label}>
        <rect x={-reach} y={-reach} width={reach * 2} height={reach * 2} className="grid-map__bg" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={t} y1={-reach} x2={t} y2={reach} className="grid-map__grid" />
            <line x1={-reach} y1={t} x2={reach} y2={t} className="grid-map__grid" />
          </g>
        ))}
        <circle cx={0} cy={0} r={r} className="grid-map__radius" />
        <circle cx={0} cy={0} r={Math.max(0, r - data.edge_km)} className="grid-map__edge" />
        {points.map(({ c, x, y }) => (
          <circle
            key={`${c.lat},${c.lng}`}
            data-testid="map-cell"
            data-orders={c.orders}
            cx={x}
            cy={-y}
            r={bubble(c)}
            fill={heat(c.orders / max)}
            className="grid-map__cell"
          >
            <title>{`${c.area ?? 'Area'}: ${c.orders} ${c.orders === 1 ? 'order' : 'orders'}, ${formatMoney(c.revenue)}, ${c.distance_km} km`}</title>
          </circle>
        ))}
        <rect x={-0.12} y={-0.12} width={0.24} height={0.24} className="grid-map__hub" />
        <text x={0} y={-r - 0.12} className="grid-map__label" textAnchor="middle">
          {r} km
        </text>
        <text x={0.2} y={0.42} className="grid-map__label">
          {data.store.name}
        </text>
      </svg>
      <figcaption className="cell__secondary">
        Each square of the grid is 1 km; north is up. Solid ring: the {r} km service radius. Dashed ring: the last {data.edge_km} km.
      </figcaption>
    </figure>
  );
}
