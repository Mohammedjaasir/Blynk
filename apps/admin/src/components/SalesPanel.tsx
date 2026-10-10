import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { insights, type DashboardFigures, type DashboardProduct, type DashboardRange, type SalesDashboard } from '../api/insights';

import { errorMessage } from '../lib/apiErrors';
import { COMPARED_WITH, DASHBOARD_RANGE_LABEL, STATUS_ORDER, changeOf } from '../lib/insights';
import { STATUS_LABEL, formatMoney, type OrderStatus } from '../lib/orders';
import { HourChart } from '../pages/Sales';
import { Spinner } from './ui';

/**
 * The sales dashboard on the Admin Dashboard (owner, 2026-10-10) - the same
 * GET /admin/reports/dashboard the Operations app shows on the phone.
 * Orders placed in the range (Sri Lanka days); revenue, cash and the
 * average basket count DELIVERED orders (the Sales report's definitions).
 * Each figure is compared with the same stretch just before (↑/↓ %).
 * Loads on its own: if it fails, the rest of the Dashboard still shows.
 */
export function SalesPanel() {
  const [range, setRange] = useState<DashboardRange>('today');
  const [data, setData] = useState<SalesDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, [range]);

  return (
    <section className="attention sales-panel" aria-labelledby="sales-panel-title">
      <div className="sales-panel__head">
        <h2 className="section-label" id="sales-panel-title">
          Sales
        </h2>
        <div className="segmented" role="group" aria-label="Sales period">
          {(Object.keys(DASHBOARD_RANGE_LABEL) as DashboardRange[]).map((r) => (
            <button
              key={r}
              type="button"
              className={r === range ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={r === range}
              onClick={() => setRange(r)}
            >
              {DASHBOARD_RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading sales" /> : null}

      {data ? (
        <>
          <p className="cell__secondary">
            Sri Lanka time, compared {COMPARED_WITH[data.range]}. Revenue and cash count delivered orders.
          </p>
          <PanelFigures data={data} />

          <div className="sales-panel__grid">
            <div>
              <h3 className="sales-panel__sub">Orders by status</h3>
              <StatusBars byStatus={data.orders_by_status} total={data.order_count} />
            </div>
            <div>
              <h3 className="sales-panel__sub">Peak hours</h3>
              <HourChart hours={data.orders_by_hour} />
            </div>
          </div>

          <div className="sales-panel__grid">
            <TopBars title="Top products by quantity" rows={data.top_by_quantity} metric="quantity" />
            <TopBars title="Top products by revenue" rows={data.top_by_revenue} metric="revenue" />
          </div>

          <p className="sales-panel__links">
            <Link className="link" to="/sales">
              Full sales report
            </Link>
            <Link className="link" to="/order-map">
              Delivery map
            </Link>
          </p>
        </>
      ) : null}
    </section>
  );
}

const FIGURES: { key: keyof DashboardFigures; label: string; money?: boolean }[] = [
  { key: 'order_count', label: 'Orders' },
  { key: 'delivered_revenue', label: 'Delivered sales', money: true },
  { key: 'cash_collected', label: 'Cash collected', money: true },
  { key: 'average_basket', label: 'Average basket', money: true },
];

function PanelFigures({ data }: { data: SalesDashboard }) {
  return (
    <div className="figures" aria-label="Sales figures">
      {FIGURES.map((f) => {
        const change = changeOf(data.change[f.key]);
        return (
          <div key={f.key} className="figure figure--change">
            <span className="figure__value figure__value--sm">{f.money ? formatMoney(data[f.key]) : data[f.key]}</span>
            <span className="figure__label">{f.label}</span>
            <span className={`change change--${change.tone}`} aria-label={`${f.label} ${change.label}`}>
              {change.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatusBars({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  if (total === 0) return <p className="attention__clear">No orders in this period.</p>;
  return (
    <ul className="bar-list" aria-label="Orders by status">
      {STATUS_ORDER.filter((s) => (byStatus[s] ?? 0) > 0).map((s) => {
        const n = byStatus[s] ?? 0;
        return (
          <li key={s} className="bar-list__row">
            <span className="bar-list__label">{STATUS_LABEL[s as OrderStatus] ?? s}</span>
            <span className="bar-list__track" aria-hidden="true">
              <span className={`bar-list__fill bar-list__fill--${s.toLowerCase()}`} style={{ width: `${(n / total) * 100}%` }} />
            </span>
            <span className="bar-list__value mono">{n}</span>
          </li>
        );
      })}
    </ul>
  );
}

function TopBars({ title, rows, metric }: { title: string; rows: DashboardProduct[]; metric: 'quantity' | 'revenue' }) {
  const max = Math.max(1, ...rows.map((r) => r[metric]));
  return (
    <div>
      <h3 className="sales-panel__sub">{title}</h3>
      {rows.length === 0 ? (
        <p className="attention__clear">Nothing delivered yet.</p>
      ) : (
        <ol className="bar-list" aria-label={title}>
          {rows.map((p) => (
            <li key={p.product_id} className="bar-list__row">
              <span className="bar-list__label">{p.name}</span>
              <span className="bar-list__track" aria-hidden="true">
                <span className="bar-list__fill bar-list__fill--top" style={{ width: `${(p[metric] / max) * 100}%` }} />
              </span>
              <span className="bar-list__value mono">{metric === 'quantity' ? p.quantity : formatMoney(p.revenue)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
