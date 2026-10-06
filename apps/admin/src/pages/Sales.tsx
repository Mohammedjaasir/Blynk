import { errorMessage } from '../lib/apiErrors';
import { useEffect, useState } from 'react';
import { reports as reportsApi } from '../api/resources';
import type { SalesProduct, SalesRange, SalesReport } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner } from '../components/ui';
import { formatDay } from '../lib/coupons';
import { formatMoney } from '../lib/orders';

/**
 * Daily sales for the owner. Days are Sri Lanka days (Asia/Colombo), and
 * every figure is over orders placed in the range; revenue, the average
 * basket, discounts and delivery fees count delivered orders only.
 */

export const RANGE_LABEL: Record<SalesRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
};

export function Sales() {
  const [range, setRange] = useState<SalesRange>('today');
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    reportsApi
      .sales(range)
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load sales.')));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const period = report
    ? report.range.from === report.range.to
      ? formatDay(`${report.range.from}T12:00:00+05:30`)
      : `${formatDay(`${report.range.from}T12:00:00+05:30`)} – ${formatDay(`${report.range.to}T12:00:00+05:30`)}`
    : null;

  return (
    <>
      <PageHeader
        title="Sales"
        description={period ? `${period}, Sri Lanka time. Revenue counts delivered orders.` : 'Sri Lanka time. Revenue counts delivered orders.'}
        actions={
          <div className="segmented" role="group" aria-label="Period">
            {(Object.keys(RANGE_LABEL) as SalesRange[]).map((option) => (
              <button
                key={option}
                type="button"
                className={option === range ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={option === range}
                onClick={() => setRange(option)}
              >
                {RANGE_LABEL[option]}
              </button>
            ))}
          </div>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}
      {!report && !error ? <Spinner label="Loading sales" /> : null}

      {report ? (
        <>
          <div className="figures" aria-label="Sales figures">
            <Stat value={String(report.order_count)} label="Orders" />
            <Stat value={formatMoney(report.delivered_revenue)} label="Delivered revenue" />
            <Stat value={formatMoney(report.average_basket)} label="Average basket" />
            <Stat value={String(report.cancelled_count)} label="Cancelled" />
            <Stat value={formatMoney(report.discount_given)} label="Discounts given" />
            <Stat value={formatMoney(report.delivery_fees)} label="Delivery fees" />
          </div>

          <section className="attention">
            <h2 className="section-label">Orders by hour</h2>
            <HourChart hours={report.orders_by_hour} />
          </section>

          <div className="sales-tops">
            <TopTable title="Best sellers by quantity" rows={report.top_by_quantity} />
            <TopTable title="Best sellers by revenue" rows={report.top_by_revenue} />
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

function TopTable({ title, rows }: { title: string; rows: SalesProduct[] }) {
  return (
    <section className="attention">
      <h2 className="section-label">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState title="Nothing delivered yet" message="Products appear here once orders are delivered." />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label={title}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.product_id}>
                  <td className="mono">{i + 1}</td>
                  <td>{p.name}</td>
                  <td className="num mono">{p.quantity}</td>
                  <td className="num mono">{formatMoney(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 24 bars in plain SVG, one per Sri Lanka hour; the tallest bar fills the height. */
export function HourChart({ hours }: { hours: { hour: number; orders: number }[] }) {
  const max = Math.max(1, ...hours.map((h) => h.orders));
  const total = hours.reduce((s, h) => s + h.orders, 0);
  const W = 24 * 20;
  const H = 120;
  const busiest = hours.reduce((best, h) => (h.orders > best.orders ? h : best), hours[0] ?? { hour: 0, orders: 0 });
  const label =
    total === 0
      ? 'No orders in this period.'
      : `Orders by hour of day. Busiest: ${String(busiest.hour).padStart(2, '0')}:00 with ${busiest.orders}.`;
  return (
    <figure className="hour-chart">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={label} preserveAspectRatio="none">
        <line x1="0" y1={H} x2={W} y2={H} className="hour-chart__axis" />
        {hours.map((h) => {
          const height = (h.orders / max) * (H - 6);
          return (
            <g key={h.hour}>
              <rect
                data-testid={`hour-${h.hour}`}
                data-orders={h.orders}
                x={h.hour * 20 + 3}
                y={H - height}
                width={14}
                height={height}
                className="hour-chart__bar"
              >
                <title>{`${String(h.hour).padStart(2, '0')}:00 – ${h.orders} ${h.orders === 1 ? 'order' : 'orders'}`}</title>
              </rect>
              {h.hour % 3 === 0 ? (
                <text x={h.hour * 20 + 10} y={H + 14} className="hour-chart__tick" textAnchor="middle">
                  {String(h.hour).padStart(2, '0')}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="cell__secondary">{label}</figcaption>
    </figure>
  );
}
