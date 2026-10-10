import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { insights, type DashboardFigures, type DashboardProduct, type DashboardRange, type SalesDashboard as Dashboard } from '../api/insights';
import { PageHeader } from '../components/Layout';
import { Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { COMPARED_WITH, DASHBOARD_RANGE_LABEL, STATUS_ORDER, changeOf, hourLabel, peakHour } from '../lib/insights';
import { STATUS_LABEL, formatMoney } from '../lib/orders';
import type { OrderStatus } from '../api/types';

/**
 * Sales dashboard on the phone (owner, 2026-10-10). One call,
 * GET /admin/reports/dashboard, with the Sales report's definitions: orders
 * placed in the range (Sri Lanka days); revenue, cash and the average basket
 * count DELIVERED orders. Each figure is compared with the same stretch just
 * before (↑/↓ %). Charts are plain CSS/SVG - no chart library.
 */
export function SalesDashboard() {
  const [range, setRange] = useState<DashboardRange>('today');
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    insights
      .dashboard(range)
      .then((d) => live && setData(d))
      .catch((err) => live && setError(errorMessage(err, 'Could not load sales.')));
    return () => {
      live = false;
    };
  }, [range, reload]);

  return (
    <div className="page">
      <PageHeader
        title="Sales"
        description="Sri Lanka time. Revenue and cash count delivered orders."
        actions={
          <button type="button" className="button button--ghost" onClick={() => setReload((n) => n + 1)}>
            Refresh
          </button>
        }
      />

      <div className="dash-ranges" role="group" aria-label="Period">
        {(Object.keys(DASHBOARD_RANGE_LABEL) as DashboardRange[]).map((r) => (
          <button
            key={r}
            type="button"
            className={r === range ? 'dash-range is-selected' : 'dash-range'}
            aria-pressed={r === range}
            onClick={() => setRange(r)}
          >
            {DASHBOARD_RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading sales" /> : null}

      {data ? (
        <>
          <p className="dash-compare">Compared {COMPARED_WITH[data.range]}.</p>
          <DashFigures data={data} />

          <section className="section" aria-labelledby="dash-status">
            <h2 className="section-label" id="dash-status">
              Orders by status
            </h2>
            <StatusBars byStatus={data.orders_by_status} total={data.order_count} />
          </section>

          <section className="section" aria-labelledby="dash-hours">
            <h2 className="section-label" id="dash-hours">
              Peak hours
            </h2>
            <HourBars hours={data.orders_by_hour} />
          </section>

          <section className="section" aria-labelledby="dash-top">
            <h2 className="section-label" id="dash-top">
              Top products
            </h2>
            <TopList title="By quantity" rows={data.top_by_quantity} metric="quantity" />
            <TopList title="By revenue" rows={data.top_by_revenue} metric="revenue" />
          </section>

          <Link className="dash-link-card" to="/dashboard/map">
            <span className="dash-link-card__title">Delivery map</span>
            <span className="dash-link-card__meta">Where orders come from, and the service radius</span>
          </Link>
        </>
      ) : null}
    </div>
  );
}

const FIGURES: { key: keyof DashboardFigures; label: string; money?: boolean }[] = [
  { key: 'order_count', label: 'Orders' },
  { key: 'delivered_revenue', label: 'Delivered sales', money: true },
  { key: 'cash_collected', label: 'Cash collected', money: true },
  { key: 'average_basket', label: 'Average basket', money: true },
];

function DashFigures({ data, keys }: { data: Dashboard; keys?: (keyof DashboardFigures)[] }) {
  const shown = keys ? FIGURES.filter((f) => keys.includes(f.key)) : FIGURES;
  return (
    <div className="dash-figures">
      {shown.map((f) => {
        const value = data[f.key];
        const change = changeOf(data.change[f.key]);
        return (
          <div key={f.key} className="dash-figure">
            <span className="dash-figure__label">{f.label}</span>
            <span className="dash-figure__value">{f.money ? formatMoney(value) : value}</span>
            <span className={`dash-change dash-change--${change.tone}`} aria-label={`${f.label} ${change.label}`}>
              {change.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatusBars({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  const rows = STATUS_ORDER.filter((s) => (byStatus[s] ?? 0) > 0);
  if (total === 0) return <p className="quiet">No orders in this period.</p>;
  return (
    <ul className="dash-bars">
      {rows.map((s) => {
        const n = byStatus[s] ?? 0;
        return (
          <li key={s} className="dash-bar">
            <span className="dash-bar__label">{STATUS_LABEL[s as OrderStatus] ?? s}</span>
            <span className="dash-bar__track" aria-hidden="true">
              <span className={`dash-bar__fill dash-bar__fill--${s.toLowerCase()}`} style={{ width: `${(n / total) * 100}%` }} />
            </span>
            <span className="dash-bar__value">{n}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** 24 bars, one per Sri Lanka hour; the busiest is ink, the rest grey. */
export function HourBars({ hours }: { hours: { hour: number; orders: number }[] }) {
  const max = Math.max(1, ...hours.map((h) => h.orders));
  const peak = peakHour(hours);
  const W = 24 * 12;
  const H = 72;
  const caption = peak ? `Busiest at ${hourLabel(peak.hour)} with ${peak.orders} ${peak.orders === 1 ? 'order' : 'orders'}.` : 'No orders in this period.';
  return (
    <figure className="dash-hours">
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`Orders per hour. ${caption}`} preserveAspectRatio="none">
        <line x1="0" y1={H} x2={W} y2={H} className="dash-hours__axis" />
        {hours.map((h) => {
          const height = (h.orders / max) * (H - 4);
          return (
            <g key={h.hour}>
              <rect
                data-testid={`hour-${h.hour}`}
                data-orders={h.orders}
                x={h.hour * 12 + 2}
                y={H - height}
                width={8}
                height={height}
                rx={1.5}
                className={peak && h.hour === peak.hour ? 'dash-hours__bar is-peak' : 'dash-hours__bar'}
              >
                <title>{`${hourLabel(h.hour)} – ${h.orders}`}</title>
              </rect>
              {h.hour % 6 === 0 ? (
                <text x={h.hour * 12 + 6} y={H + 12} className="dash-hours__tick" textAnchor="middle">
                  {String(h.hour).padStart(2, '0')}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="dash-hours__caption">{caption}</figcaption>
    </figure>
  );
}

function TopList({ title, rows, metric }: { title: string; rows: DashboardProduct[]; metric: 'quantity' | 'revenue' }) {
  const max = Math.max(1, ...rows.map((r) => r[metric]));
  return (
    <div className="card dash-top">
      <p className="dash-top__title">{title}</p>
      {rows.length === 0 ? (
        <p className="quiet">Nothing delivered yet.</p>
      ) : (
        <ol className="dash-top__list" aria-label={`Top products ${title.toLowerCase()}`}>
          {rows.map((p) => (
            <li key={p.product_id} className="dash-top__row">
              <span className="dash-top__name">{p.name}</span>
              <span className="dash-top__value">{metric === 'quantity' ? `${p.quantity} sold` : formatMoney(p.revenue)}</span>
              <span className="dash-top__track" aria-hidden="true">
                <span className="dash-top__fill" style={{ width: `${(p[metric] / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The first thing on Home: today's orders, delivered sales and cash against
 * yesterday, opening the full dashboard. Shows nothing when the figures
 * cannot be read (e.g. a role without access), so Home is never blocked.
 */
export function SalesTodayCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    let live = true;
    insights
      .dashboard('today')
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (!data) return null;
  return (
    <section className="section dash-today" aria-labelledby="dash-today-title">
      <div className="dash-today__head">
        <h2 className="section-label" id="dash-today-title">
          Sales today
        </h2>
        <Link className="link" to="/dashboard">
          Open dashboard
        </Link>
      </div>
      <DashFigures data={data} keys={['order_count', 'delivered_revenue', 'cash_collected']} />
      <p className="dash-compare">Compared with yesterday.</p>
    </section>
  );
}
