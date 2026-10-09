import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { reports as reportsApi, riders as ridersApi } from '../api/resources';
import type { RiderEarningsRange, RiderEarningsReport, RiderEarningsRow, RiderOption, RiderPay, RiderPayType } from '../api/types';
import { PageHeader } from '../components/Layout';
import { RiderPayFields, useDefaultCommission } from '../components/RiderPayFields';
import { Badge, EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { colomboDate, formatDay } from '../lib/coupons';
import { formatMoney } from '../lib/orders';
import { formatPercent, parsePercent, payLabel } from '../lib/riderPay';
import { readablePhone } from './RiderRequests';

/**
 * Rider earnings and rider pay (owner, 2026-10-09).
 *
 * Riders are COMPANY riders (salaried: no per-delivery commission, Blynk
 * keeps the delivery charge) or COMMISSION riders, who earn a % of the
 * STANDARD delivery fee - the store default (Settings) or their own % - and
 * keep that share out of the COD cash they collect. The report (GET
 * /admin/reports/rider-earnings) splits each rider's delivery charges into
 * the rider's share and Blynk's, with the product margin on their orders.
 *
 * "Rider pay" below lists every rider profile (GET /admin/riders?
 * include_inactive=true - staff who can deliver too, not only Rider-app
 * applicants) and is where a rider's type and own % are changed (PATCH
 * /admin/riders/:id/pay). It lives here, next to the money it drives.
 */

export const EARNINGS_RANGE_LABEL: Record<RiderEarningsRange, string> = {
  today: 'Today',
  this_week: 'This week',
  custom: 'Custom',
};

const day = (date: string) => formatDay(`${date}T12:00:00+05:30`);

/** "Company" or "Commission · 80%" (the % in force for the period). */
export function earningsTypeLabel(row: Pick<RiderEarningsRow, 'pay_type' | 'effective_percent' | 'commission_percent'>): string {
  if (row.pay_type !== 'COMMISSION') return 'Company';
  const pct = row.effective_percent ?? row.commission_percent;
  return typeof pct === 'number' ? `Commission · ${formatPercent(pct)}%` : 'Commission';
}

export function RiderEarnings() {
  const today = colomboDate();
  const [range, setRange] = useState<RiderEarningsRange>('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<RiderEarningsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const customError =
    range !== 'custom'
      ? null
      : !from || !to
        ? 'Choose both days.'
        : from > to
          ? 'The first day must be on or before the last day.'
          : to > today
            ? 'Choose today or an earlier day.'
            : null;

  useEffect(() => {
    if (customError) {
      setReport(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setReport(null);
    setError(null);
    reportsApi
      .riderEarnings(range, range === 'custom' ? { from, to } : undefined)
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load rider earnings.')));
    return () => {
      cancelled = true;
    };
  }, [range, from, to, customError, version]);

  const period = report
    ? report.range.from === report.range.to
      ? day(report.range.from)
      : `${day(report.range.from)} – ${day(report.range.to)}`
    : null;

  return (
    <>
      <PageHeader
        title="Rider earnings"
        description={`${period ? `${period}, ` : ''}Sri Lanka time. Commission is a share of the standard delivery fee; company riders earn none.`}
        actions={
          <>
            <div className="segmented" role="group" aria-label="Period">
              {(Object.keys(EARNINGS_RANGE_LABEL) as RiderEarningsRange[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === range ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={option === range}
                  onClick={() => setRange(option)}
                >
                  {EARNINGS_RANGE_LABEL[option]}
                </button>
              ))}
            </div>
            {range === 'custom' ? (
              <>
                <input
                  className="input"
                  type="date"
                  aria-label="From"
                  value={from}
                  max={today}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <input
                  className="input"
                  type="date"
                  aria-label="To"
                  value={to}
                  max={today}
                  onChange={(e) => setTo(e.target.value)}
                />
              </>
            ) : null}
          </>
        }
      />

      {customError ? <p className="field__error">{customError}</p> : null}
      {error ? <p className="field__error">{error}</p> : null}
      {!report && !error && !customError ? <Spinner label="Loading rider earnings" /> : null}

      {report ? <EarningsReport report={report} /> : null}

      <RiderPaySection onChanged={() => setVersion((v) => v + 1)} />
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

function EarningsReport({ report }: { report: RiderEarningsReport }) {
  const t = report.totals;
  return (
    <>
      <div className="figures" aria-label="Rider earnings totals">
        <Stat value={String(t.deliveries)} label="Deliveries" />
        <Stat value={formatMoney(t.delivery_charges)} label="Delivery charges" />
        <Stat value={formatMoney(t.rider_share)} label="Rider share" />
        <Stat value={formatMoney(t.blynk_delivery_share)} label="Blynk delivery share" />
        <Stat value={formatMoney(t.product_margin)} label="Product margin" />
        <Stat value={formatMoney(t.cash_to_hand_in)} label="Cash to hand in" />
      </div>

      {report.riders.length === 0 ? (
        <EmptyState title="No deliveries in this period" message="Riders appear here once they deliver an order." />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Earnings by rider">
            <thead>
              <tr>
                <th scope="col">Rider</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">
                  Deliveries
                </th>
                <th scope="col" className="num">
                  Delivery charges
                </th>
                <th scope="col" className="num">
                  Rider share
                </th>
                <th scope="col" className="num">
                  Blynk share
                </th>
                <th scope="col" className="num">
                  Product margin
                </th>
                <th scope="col" className="num">
                  Cash kept
                </th>
                <th scope="col" className="num">
                  To hand in
                </th>
              </tr>
            </thead>
            <tbody>
              {report.riders.map((r) => (
                <tr key={r.rider_id}>
                  <td>
                    <div className="cell__primary">{r.rider_name ?? 'Rider'}</div>
                    {r.rider_phone ? <div className="cell__secondary mono">{readablePhone(r.rider_phone)}</div> : null}
                  </td>
                  <td>{earningsTypeLabel(r)}</td>
                  <td className="num mono">{r.deliveries}</td>
                  <td className="num mono">
                    {formatMoney(r.delivery_charges)}
                    {r.customer_delivery_fees !== r.delivery_charges ? (
                      <div className="cell__secondary">customers paid {formatMoney(r.customer_delivery_fees)}</div>
                    ) : null}
                  </td>
                  <td className="num mono">{formatMoney(r.rider_share)}</td>
                  <td className="num mono">{formatMoney(r.blynk_delivery_share)}</td>
                  <td className="num mono">{formatMoney(r.product_margin)}</td>
                  <td className="num mono">{formatMoney(r.cash_kept)}</td>
                  <td className="num mono">{formatMoney(r.cash_to_hand_in)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">All riders</th>
                <td />
                <td className="num mono">{t.deliveries}</td>
                <td className="num mono">{formatMoney(t.delivery_charges)}</td>
                <td className="num mono">{formatMoney(t.rider_share)}</td>
                <td className="num mono">{formatMoney(t.blynk_delivery_share)}</td>
                <td className="num mono">{formatMoney(t.product_margin)}</td>
                <td className="num mono">{formatMoney(t.cash_kept)}</td>
                <td className="num mono">{formatMoney(t.cash_to_hand_in)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="form__note">
        Delivery charges are counted at the standard fee, so free deliveries still earn a commission rider their share.
        Default commission: {formatPercent(report.default_percent)}% (Settings).
      </p>
    </>
  );
}

/** Every rider's type and own %, with "Change pay" (owner, 2026-10-09). */
function RiderPaySection({ onChanged }: { onChanged(): void }) {
  const toast = useToast();
  const [riders, setRiders] = useState<RiderOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RiderOption | null>(null);
  const [defaultPercent, setDefaultPercent] = useDefaultCommission();

  const load = useCallback(async () => {
    try {
      const all = await ridersApi.listForCash();
      setRiders(Array.isArray(all) ? all : []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the riders.'));
      setRiders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function saved(rider: RiderOption, pay: RiderPay) {
    setEditing(null);
    setDefaultPercent(pay.default_percent);
    setRiders((list) =>
      (list ?? []).map((r) => (r.id === rider.id ? { ...r, pay_type: pay.pay_type, commission_percent: pay.commission_percent } : r))
    );
    toast.success(`${rider.full_name ?? 'The rider'} is now ${payLabel(pay.pay_type, pay.commission_percent, pay.default_percent)}.`);
    onChanged();
  }

  return (
    <section className="attention rider-pay" aria-label="Rider pay">
      <h2 className="section-label">Rider pay</h2>
      <p className="form__note">
        Company riders are salaried; Blynk keeps the delivery charge. Commission riders earn a share of the standard delivery
        fee{defaultPercent === null ? '' : ` (default ${formatPercent(defaultPercent)}%)`} and keep it from the cash they collect.
      </p>
      {error ? <p className="field__error">{error}</p> : null}
      {riders === null ? (
        <Spinner label="Loading riders" />
      ) : riders.length === 0 ? (
        error ? null : <EmptyState title="No riders yet" message="Approved riders and staff who can deliver appear here." />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Rider pay">
            <thead>
              <tr>
                <th scope="col">Rider</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {riders.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell__primary">{r.full_name ?? 'Rider'}</div>
                    {r.phone ? <div className="cell__secondary mono">{readablePhone(r.phone)}</div> : null}
                  </td>
                  <td>{payLabel(r.pay_type, r.commission_percent, defaultPercent)}</td>
                  <td>
                    {r.is_active === false ? <Badge tone="inactive">Inactive</Badge> : <Badge tone="active">Active</Badge>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Change pay for ${r.full_name ?? 'rider'}`}
                      onClick={() => setEditing(r)}
                    >
                      Change pay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <RiderPayDialog
          rider={editing}
          defaultPercent={defaultPercent}
          onClose={() => setEditing(null)}
          onSaved={(pay) => saved(editing, pay)}
        />
      ) : null}
    </section>
  );
}

function RiderPayDialog({
  rider,
  defaultPercent,
  onClose,
  onSaved,
}: {
  rider: RiderOption;
  defaultPercent: number | null;
  onClose(): void;
  onSaved(pay: RiderPay): void;
}) {
  const [payType, setPayType] = useState<RiderPayType>(rider.pay_type ?? 'COMPANY');
  const [percent, setPercent] = useState(
    typeof rider.commission_percent === 'number' ? formatPercent(rider.commission_percent) : ''
  );
  const [percentError, setPercentError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    let commission: number | null = null;
    if (payType === 'COMMISSION') {
      const parsed = parsePercent(percent, true);
      if ('error' in parsed) {
        setPercentError(parsed.error);
        return;
      }
      commission = parsed.percent;
    }
    setPercentError(undefined);
    setFormError(null);
    setSaving(true);
    try {
      onSaved(await ridersApi.setPay(rider.id, { pay_type: payType, commission_percent: commission }));
    } catch (err) {
      const detail =
        err instanceof ApiError && err.code === 'VALIDATION_ERROR'
          ? (err.details as Array<{ message?: string }> | undefined)?.[0]?.message
          : undefined;
      setFormError(detail ?? errorMessage(err, 'Could not change the rider pay.'));
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Change rider pay">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Change pay for {rider.full_name ?? 'this rider'}</h2>
        <RiderPayFields
          payType={payType}
          percent={percent}
          defaultPercent={defaultPercent}
          error={percentError}
          onPayType={(next) => {
            setPayType(next);
            setPercentError(undefined);
          }}
          onPercent={setPercent}
        />
        <p className="form__note">Applies to deliveries completed from now on; past deliveries keep what they earned.</p>
        {formError ? <p className="field__error">{formError}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
