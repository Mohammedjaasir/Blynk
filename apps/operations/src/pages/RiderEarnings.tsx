import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { riders as ridersApi } from '../api/resources';
import type { EarningsRange, RiderAdjustment, RiderEarningsFigures, RiderEarningsReport, RiderEarningsRow } from '../api/types';
import { PageHeader } from '../components/Layout';
import { RiderAdjustSheet } from '../components/RiderAdjustments';
import { EmptyState, Spinner } from '../components/ui';
import '../components/rider-pay.css';
import { formatColomboDate } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/orders';
import { formatDay } from '../lib/riderDocuments';
import {
  ADJUSTMENT_REASON_LABEL,
  BONUS_KINDS,
  BONUS_KIND_LABEL,
  PAY_MODEL_LABEL,
  describePay,
  formatPercent,
  signedMoney,
} from '../lib/riderPay';
import { colomboToday } from './Cash';

/**
 * Rider earnings (More -> Rider earnings, Riders -> Earnings;
 * `GET /admin/reports/rider-earnings`). Per rider: deliveries, delivery
 * charges on the standard-fee basis, the rider's share, Blynk's share of the
 * delivery charges and the product margin. Company riders are salaried
 * (owner, 2026-10-09): their rider share is always 0 and Blynk keeps the
 * whole delivery charge.
 *
 * Rider pay controls (owner, 2026-10-10): each rider (and the totals) also
 * shows the base pay, bonuses (by kind), deductions and extra pay, the total
 * earnings and what Blynk still owes the rider (`payable_to_rider`), plus the
 * range's adjustments with reason and note. "Adjust pay" opens the same
 * sheet as Riders. The new figures are optional - an older API leaves them
 * out and the cards read as before.
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
  const [adjusting, setAdjusting] = useState<{ id: string; name: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
    // `reloadKey` refreshes after an adjustment (owner, 2026-10-10).
  }, [range, from, to, customInvalid, reloadKey]);

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
            {report.default_model && report.default_model.model !== 'PERCENT'
              ? ` · Store default pay ${describePay(report.default_model)}`
              : ''}
          </p>
          <Totals totals={report.totals} />
          {report.riders.length === 0 ? (
            <EmptyState title="No deliveries in this range" />
          ) : (
            <ul className="earnings-list" aria-label="Earnings by rider">
              {report.riders.map((r) => (
                <RiderCard
                  key={r.rider_id}
                  row={r}
                  onAdjust={() => setAdjusting({ id: r.rider_id, name: r.rider_name ?? r.rider_phone ?? 'Rider' })}
                />
              ))}
            </ul>
          )}
          {report.adjustments && report.adjustments.length > 0 ? <AdjustmentsList adjustments={report.adjustments} /> : null}
        </>
      ) : null}

      {adjusting ? (
        <RiderAdjustSheet
          riderId={adjusting.id}
          name={adjusting.name}
          onClose={() => setAdjusting(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
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
        {/* Rider pay controls (owner, 2026-10-10) - only from an API that sends them. */}
        {totals.total_earnings !== undefined ? (
          <>
            <div className="figure">
              <dt className="figure__label">Base pay</dt>
              <dd className="figure__value">{formatMoney(totals.base_earnings ?? 0)}</dd>
            </div>
            <div className="figure">
              <dt className="figure__label">Bonuses</dt>
              <dd className="figure__value">{formatMoney((totals.delivery_bonuses ?? 0) + (totals.day_bonuses ?? 0))}</dd>
            </div>
            <div className="figure">
              <dt className="figure__label">Deductions</dt>
              <dd className="figure__value">{signedMoney(-(totals.deductions ?? 0))}</dd>
            </div>
            <div className="figure">
              <dt className="figure__label">Extra pay</dt>
              <dd className="figure__value">{signedMoney(totals.additions ?? 0)}</dd>
            </div>
            <div className="figure">
              <dt className="figure__label">Total earnings</dt>
              <dd className="figure__value">{formatMoney(totals.total_earnings)}</dd>
            </div>
            {(totals.payable_to_rider ?? 0) > 0 ? (
              <div className="figure">
                <dt className="figure__label">Blynk owes riders</dt>
                <dd className="figure__value rpay-owed">{formatMoney(totals.payable_to_rider ?? 0)}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
    </section>
  );
}

function RiderCard({ row, onAdjust }: { row: RiderEarningsRow; onAdjust(): void }) {
  const company = row.pay_type === 'COMPANY';
  const name = row.rider_name ?? row.rider_phone ?? 'Rider';
  const bonuses = (row.delivery_bonuses ?? 0) + (row.day_bonuses ?? 0);
  const breakdown = BONUS_KINDS.filter((k) => (row.bonus_breakdown?.[k] ?? 0) > 0);
  return (
    <li className="card earnings-card" aria-label={name}>
      <div className="earnings-card__head">
        <p className="cat-row__title">{name}</p>
        <span className={`pay-tag pay-tag--${row.pay_type.toLowerCase()}`}>
          {company
            ? 'Company rider'
            : row.pay_model === 'FIXED' || row.pay_model === 'DISTANCE'
              ? `Commission · ${PAY_MODEL_LABEL[row.pay_model]}`
              : `Commission · ${formatPercent(row.effective_percent ?? 0)}`}
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
      {row.total_earnings !== undefined ? (
        <div className="rpay-card-pay" aria-label={`Pay for ${name}`}>
          <p className="card__row">
            <span className="card__label">Base pay</span>
            <span className="card__value mono">{formatMoney(row.base_earnings ?? 0)}</span>
          </p>
          {bonuses > 0 ? (
            <>
              <p className="card__row">
                <span className="card__label">Bonuses</span>
                <span className="card__value mono">{signedMoney(bonuses)}</span>
              </p>
              {breakdown.length ? (
                <ul className="rpay-breakdown" aria-label={`Bonuses for ${name}`}>
                  {breakdown.map((k) => (
                    <li key={k}>
                      {BONUS_KIND_LABEL[k]} {formatMoney(row.bonus_breakdown?.[k] ?? 0)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          {(row.deductions ?? 0) > 0 ? (
            <p className="card__row">
              <span className="card__label">Deductions</span>
              <span className="card__value mono rpay-minus">{signedMoney(-(row.deductions ?? 0))}</span>
            </p>
          ) : null}
          {(row.additions ?? 0) > 0 ? (
            <p className="card__row">
              <span className="card__label">Extra pay</span>
              <span className="card__value mono rpay-plus">{signedMoney(row.additions ?? 0)}</span>
            </p>
          ) : null}
          <p className="card__row">
            <span className="card__label">Total earnings</span>
            <span className="card__value mono">{formatMoney(row.total_earnings)}</span>
          </p>
          {(row.payable_to_rider ?? 0) > 0 ? (
            <p className="card__row">
              <span className="card__label">Blynk owes rider</span>
              <span className="card__value mono rpay-owed">{formatMoney(row.payable_to_rider ?? 0)}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {!company && row.cash_kept > 0 ? (
        <p className="quiet">
          Cash: keeps {formatMoney(row.cash_kept)}, hands in {formatMoney(row.cash_to_hand_in)} of{' '}
          {formatMoney(row.cash_collected)} collected.
        </p>
      ) : null}
      <div className="cat-row__actions">
        <button type="button" className="button button--sm button--ghost" aria-label={`Adjust pay for ${name}`} onClick={onAdjust}>
          Adjust pay
        </button>
      </div>
    </li>
  );
}

/** The range's deductions and extra pay, newest first (owner, 2026-10-10). */
function AdjustmentsList({ adjustments }: { adjustments: RiderAdjustment[] }) {
  return (
    <section className="card" aria-labelledby="earnings-adjustments-title">
      <h2 className="section-label" id="earnings-adjustments-title">
        Adjustments
      </h2>
      <ul className="rpay-adjustments" aria-label="Adjustments in this range">
        {adjustments.map((a) => (
          <li key={a.id} className="rpay-adjustment">
            <div className="rpay-adjustment__main">
              <p className="rpay-adjustment__line">
                {a.rider_name ?? 'Rider'}{' '}
                <span className={a.amount_lkr < 0 ? 'mono rpay-minus' : 'mono rpay-plus'}>{signedMoney(a.amount_lkr)}</span>{' '}
                <span className="pay-tag pay-tag--company">{ADJUSTMENT_REASON_LABEL[a.reason] ?? a.reason}</span>
              </p>
              <p className="cat-row__meta">
                {formatDay(a.adjustment_date)}
                {a.created_by_name ? ` · by ${a.created_by_name}` : ''}
              </p>
              {a.note ? <p className="cat-row__meta">“{a.note}”</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
