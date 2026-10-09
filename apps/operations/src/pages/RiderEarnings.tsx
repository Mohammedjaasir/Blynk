import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { riders as ridersApi } from '../api/resources';
import type { EarningsRange, RiderEarningsFigures, RiderEarningsReport, RiderEarningsRow } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner } from '../components/ui';
import { formatColomboDate } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/orders';
import { formatPercent } from '../lib/riderPay';
import { colomboToday } from './Cash';

/**
 * Rider earnings (More -> Rider earnings, Riders -> Earnings;
 * `GET /admin/reports/rider-earnings`). Per rider: deliveries, delivery
 * charges on the standard-fee basis, the rider's share, Blynk's share of the
 * delivery charges and the product margin. Company riders are salaried
 * (owner, 2026-10-09): their rider share is always 0 and Blynk keeps the
 * whole delivery charge.
 */

const RANGES: { value: EarningsRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'custom', label: 'Custom' },
];

/** "YYYY-MM-DD" (a Sri Lanka day) -> "9 Oct 2026". */
const dayLabel = (day: string) => formatColomboDate(`${day}T00:00:00+05:30`);

export function RiderEarnings() {
  const [range, setRange] = useState<EarningsRange>('today');
  const [from, setFrom] = useState(() => colomboToday());
  const [to, setTo] = useState(() => colomboToday());
  const [report, setReport] = useState<RiderEarningsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customInvalid = range === 'custom' && (!from || !to || from > to);

  useEffect(() => {
    if (customInvalid) {
      setReport(null);
      return;
    }
    let live = true;
    setReport(null);
    setError(null);
    ridersApi
      .earnings(range, from, to)
      .then((r) => live && setReport(r))
      .catch((err) => live && setError(errorMessage(err, 'Could not load rider earnings.')));
    return () => {
      live = false;
    };
    // `from`/`to` only change while the custom range shows its date inputs.
  }, [range, from, to, customInvalid]);

  return (
    <div className="page">
      <Link to="/more/riders" className="link">
        ← Riders
      </Link>
      <PageHeader title="Rider earnings" description="Delivery charges split between riders and Blynk, and the product margin on their deliveries." />

      <div className="segmented" role="group" aria-label="Range">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            className={r.value === range ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={r.value === range}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === 'custom' ? (
        <div className="cash-toolbar earnings-dates">
          <label className="field">
            <span className="field__label">From</span>
            <input
              className="input"
              type="date"
              value={from}
              max={colomboToday()}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">To</span>
            <input
              className="input"
              type="date"
              value={to}
              max={colomboToday()}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {customInvalid ? <p className="field__error-text">Choose a From day on or before the To day.</p> : null}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {!report && !error && !customInvalid ? <Spinner label="Loading earnings" /> : null}

      {report ? (
        <>
          <p className="quiet">
            {report.range.from === report.range.to
              ? dayLabel(report.range.from)
              : `${dayLabel(report.range.from)} – ${dayLabel(report.range.to)}`}
            {' · '}Store default commission {formatPercent(report.default_percent)}
          </p>
          <Totals totals={report.totals} />
          {report.riders.length === 0 ? (
            <EmptyState title="No deliveries in this range" />
          ) : (
            <ul className="earnings-list" aria-label="Earnings by rider">
              {report.riders.map((r) => (
                <RiderCard key={r.rider_id} row={r} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}

function Totals({ totals }: { totals: RiderEarningsFigures }) {
  return (
    <section aria-label="All riders">
      <dl className="figures earnings-figures">
        <div className="figure">
          <dt className="figure__label">Deliveries</dt>
          <dd className="figure__value">{totals.deliveries}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Delivery charges</dt>
          <dd className="figure__value">{formatMoney(totals.delivery_charges)}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Rider share</dt>
          <dd className="figure__value">{formatMoney(totals.rider_share)}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Blynk delivery share</dt>
          <dd className="figure__value">{formatMoney(totals.blynk_delivery_share)}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Product margin</dt>
          <dd className="figure__value">{formatMoney(totals.product_margin)}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Customers paid for delivery</dt>
          <dd className="figure__value">{formatMoney(totals.customer_delivery_fees)}</dd>
        </div>
      </dl>
    </section>
  );
}

function RiderCard({ row }: { row: RiderEarningsRow }) {
  const company = row.pay_type === 'COMPANY';
  const name = row.rider_name ?? row.rider_phone ?? 'Rider';
  return (
    <li className="card earnings-card" aria-label={name}>
      <div className="earnings-card__head">
        <p className="cat-row__title">{name}</p>
        <span className={`pay-tag pay-tag--${row.pay_type.toLowerCase()}`}>
          {company ? 'Company rider' : `Commission · ${formatPercent(row.effective_percent ?? 0)}`}
        </span>
      </div>
      <p className="card__row">
        <span className="card__label">Deliveries</span>
        <span className="card__value mono">{row.deliveries}</span>
      </p>
      <p className="card__row">
        <span className="card__label">Delivery charges</span>
        <span className="card__value mono">{formatMoney(row.delivery_charges)}</span>
      </p>
      <p className="card__row">
        <span className="card__label">Rider share</span>
        <span className="card__value mono">{formatMoney(row.rider_share)}</span>
      </p>
      <p className="card__row">
        <span className="card__label">Blynk delivery share</span>
        <span className="card__value mono">{formatMoney(row.blynk_delivery_share)}</span>
      </p>
      <p className="card__row">
        <span className="card__label">Product margin</span>
        <span className="card__value mono">{formatMoney(row.product_margin)}</span>
      </p>
      {!company && row.cash_kept > 0 ? (
        <p className="quiet">
          Cash: keeps {formatMoney(row.cash_kept)}, hands in {formatMoney(row.cash_to_hand_in)} of{' '}
          {formatMoney(row.cash_collected)} collected.
        </p>
      ) : null}
    </li>
  );
}
