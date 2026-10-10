import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { reports as reportsApi, riderAdjustments as adjustmentsApi, riders as ridersApi } from '../api/resources';
import type {
  AdjustmentReason,
  PayModel,
  PayParams,
  RiderAdjustment,
  RiderEarningsRange,
  RiderEarningsReport,
  RiderEarningsRow,
  RiderOption,
  RiderPay,
} from '../api/types';
import { DatePicker } from '../components/DatePicker';
import { PageHeader } from '../components/Layout';
import { RiderPayFields, useRiderPayDefaults } from '../components/RiderPayFields';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { colomboDate, formatDay } from '../lib/coupons';
import { formatMoney } from '../lib/orders';
import {
  ADJUSTMENT_KIND_LABEL,
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABEL,
  MAX_ADJUSTMENT_DAYS_BACK,
  MAX_ADJUSTMENT_NOTE,
  OWN_MODEL_LABEL,
  bonusBreakdownText,
  bonusesOf,
  daysBetween,
  describePay,
  fillDraftBlanks,
  formatPercent,
  numberText,
  payDraftFrom,
  payDraftToInput,
  payLabel,
  signedAdjustment,
  signedMoney,
  type AdjustmentKind,
  type PayDraft,
  type PayDraftErrors,
} from '../lib/riderPay';
import { readablePhone } from './RiderRequests';
import '../components/riderDocuments.css';
import '../components/riderPay.css';

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
 *
 * Rider pay controls (owner, 2026-10-10): the report adds base pay, bonuses
 * (peak / rain / long distance / daily target), deductions and extra pay,
 * total earnings and what Blynk still owes the rider. "Adjust pay" records
 * a deduction or extra pay with a reason (POST /admin/riders/:id/adjustments)
 * and the range's adjustments can be edited or deleted. "Change pay" sets a
 * commission rider's own model (% / fixed / distance, optional minimum) or
 * "Store default".
 */

export const EARNINGS_RANGE_LABEL: Record<RiderEarningsRange, string> = {
  today: 'Today',
  this_week: 'This week',
  custom: 'Custom',
};

const day = (date: string) => formatDay(`${date}T12:00:00+05:30`);

/** "Company", "Commission · 80%" (the % in force for the period), or "Commission · Fixed" / "Commission · Distance". */
export function earningsTypeLabel(
  row: Pick<RiderEarningsRow, 'pay_type' | 'effective_percent' | 'commission_percent'> & { pay_model?: PayModel | null }
): string {
  if (row.pay_type !== 'COMMISSION') return 'Company';
  if (row.pay_model === 'FIXED' || row.pay_model === 'DISTANCE') return `Commission · ${OWN_MODEL_LABEL[row.pay_model]}`;
  const pct = row.effective_percent ?? row.commission_percent;
  return typeof pct === 'number' ? `Commission · ${formatPercent(pct)}%` : 'Commission';
}

/** Who the Adjust pay dialog is for, and the adjustment when editing one. */
type Adjusting = { riderId: string; riderName: string | null; existing?: RiderAdjustment };

export function RiderEarnings() {
  const toast = useToast();
  const today = colomboDate();
  const [range, setRange] = useState<RiderEarningsRange>('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<RiderEarningsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [adjusting, setAdjusting] = useState<Adjusting | null>(null);
  const [deleting, setDeleting] = useState<RiderAdjustment | null>(null);
  const payDefaults = useRiderPayDefaults();
  const reload = () => setVersion((v) => v + 1);

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

  async function removeAdjustment(a: RiderAdjustment) {
    setDeleting(null);
    try {
      await adjustmentsApi.remove(a.id);
      toast.success(`${ADJUSTMENT_REASON_LABEL[a.reason]} ${signedMoney(a.amount_lkr)} for ${a.rider_name ?? 'the rider'} deleted.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the adjustment.'));
    }
  }

  return (
    <>
      <PageHeader
        title="Rider earnings"
        description={`${period ? `${period}, ` : ''}Sri Lanka time. Commission riders earn their pay model plus bonuses; company riders earn none.`}
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

      {report ? (
        <EarningsReport
          report={report}
          onAdjust={(r) => setAdjusting({ riderId: r.rider_id, riderName: r.rider_name })}
        />
      ) : null}

      {report?.adjustments ? (
        <AdjustmentsList
          adjustments={report.adjustments}
          onEdit={(a) => setAdjusting({ riderId: a.rider_id, riderName: a.rider_name, existing: a })}
          onDelete={setDeleting}
        />
      ) : null}

      <RiderPaySection
        defaults={payDefaults}
        onChanged={reload}
        onAdjust={(r) => setAdjusting({ riderId: r.id, riderName: r.full_name })}
      />

      {adjusting ? (
        <AdjustPayDialog
          target={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={(a, edited) => {
            setAdjusting(null);
            toast.success(
              `${edited ? 'Updated: ' : ''}${a.amount_lkr < 0 ? 'Deduction' : 'Extra pay'} of ${formatMoney(Math.abs(a.amount_lkr))} for ${
                a.rider_name ?? adjusting.riderName ?? 'the rider'
              } on ${day(a.adjustment_date)}.`
            );
            reload();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this adjustment?"
          message={`${ADJUSTMENT_REASON_LABEL[deleting.reason]} ${signedMoney(deleting.amount_lkr)} for ${
            deleting.rider_name ?? 'this rider'
          } on ${day(deleting.adjustment_date)}. That day's cash and earnings are worked out again without it.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void removeAdjustment(deleting)}
        />
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

/** "+LKR 100 extra, −LKR 200 deducted" when a row has both; otherwise null. */
function adjustmentDetail(f: { additions?: number; deductions?: number }): string | null {
  const plus = f.additions ?? 0;
  const minus = f.deductions ?? 0;
  if (!(plus > 0 && minus > 0)) return null;
  return `${signedMoney(plus)} extra, ${signedMoney(-minus)} deducted`;
}

function AdjustmentsCell({ f }: { f: { adjustments?: number; additions?: number; deductions?: number } }) {
  const v = f.adjustments ?? 0;
  const detail = adjustmentDetail(f);
  return (
    <>
      <span className={v < 0 ? 'rp-amount--minus' : v > 0 ? 'rp-amount--plus' : undefined}>{v === 0 ? '—' : signedMoney(v)}</span>
      {detail ? <div className="cell__secondary">{detail}</div> : null}
    </>
  );
}

function EarningsReport({ report, onAdjust }: { report: RiderEarningsReport; onAdjust(row: RiderEarningsRow): void }) {
  const t = report.totals;
  // The rider pay controls' figures (owner, 2026-10-10); an older API lacks them.
  const detailed = typeof t.total_earnings === 'number';
  const defaultModel: PayParams | undefined = report.default_model;
  return (
    <>
      <div className="figures" aria-label="Rider earnings totals">
        <Stat value={String(t.deliveries)} label="Deliveries" />
        <Stat value={formatMoney(t.delivery_charges)} label="Delivery charges" />
        {detailed ? (
          <>
            <Stat value={formatMoney(t.base_earnings ?? 0)} label="Base pay" />
            <Stat value={formatMoney(bonusesOf(t))} label="Bonuses" />
            <Stat value={signedMoney(t.adjustments ?? 0)} label="Adjustments" />
            <Stat value={formatMoney(t.total_earnings ?? 0)} label="Total earnings" />
            <Stat value={formatMoney(t.payable_to_rider ?? 0)} label="Payable to riders" />
          </>
        ) : (
          <Stat value={formatMoney(t.rider_share)} label="Rider share" />
        )}
        <Stat value={formatMoney(t.blynk_delivery_share)} label="Blynk delivery share" />
        <Stat value={formatMoney(t.product_margin)} label="Product margin" />
        <Stat value={formatMoney(t.cash_to_hand_in)} label="Cash to hand in" />
      </div>
      {detailed && bonusBreakdownText(t.bonus_breakdown) ? (
        <p className="form__note" data-testid="bonus-breakdown">
          Bonuses: {bonusBreakdownText(t.bonus_breakdown)}.
        </p>
      ) : null}

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
                {detailed ? (
                  <>
                    <th scope="col" className="num">
                      Base pay
                    </th>
                    <th scope="col" className="num">
                      Bonuses
                    </th>
                    <th scope="col" className="num">
                      Adjustments
                    </th>
                    <th scope="col" className="num">
                      Total earnings
                    </th>
                  </>
                ) : (
                  <th scope="col" className="num">
                    Rider share
                  </th>
                )}
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
                {detailed ? (
                  <>
                    <th scope="col" className="num">
                      Payable to rider
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </>
                ) : null}
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
                  {detailed ? (
                    <>
                      <td className="num mono">{formatMoney(r.base_earnings ?? 0)}</td>
                      <td className="num mono">
                        {bonusesOf(r) > 0 ? formatMoney(bonusesOf(r)) : '—'}
                        {bonusBreakdownText(r.bonus_breakdown) ? (
                          <div className="cell__secondary">{bonusBreakdownText(r.bonus_breakdown)}</div>
                        ) : null}
                      </td>
                      <td className="num mono">
                        <AdjustmentsCell f={r} />
                      </td>
                      <td className="num mono">
                        <strong>{formatMoney(r.total_earnings ?? 0)}</strong>
                      </td>
                    </>
                  ) : (
                    <td className="num mono">{formatMoney(r.rider_share)}</td>
                  )}
                  <td className="num mono">{formatMoney(r.blynk_delivery_share)}</td>
                  <td className="num mono">{formatMoney(r.product_margin)}</td>
                  <td className="num mono">{formatMoney(r.cash_kept)}</td>
                  <td className="num mono">{formatMoney(r.cash_to_hand_in)}</td>
                  {detailed ? (
                    <>
                      <td className="num mono">
                        {(r.payable_to_rider ?? 0) > 0 ? <span className="rp-owes">{formatMoney(r.payable_to_rider ?? 0)}</span> : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          aria-label={`Adjust pay for ${r.rider_name ?? 'rider'}`}
                          onClick={() => onAdjust(r)}
                        >
                          Adjust pay
                        </button>
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">All riders</th>
                <td />
                <td className="num mono">{t.deliveries}</td>
                <td className="num mono">{formatMoney(t.delivery_charges)}</td>
                {detailed ? (
                  <>
                    <td className="num mono">{formatMoney(t.base_earnings ?? 0)}</td>
                    <td className="num mono">{formatMoney(bonusesOf(t))}</td>
                    <td className="num mono">
                      <AdjustmentsCell f={t} />
                    </td>
                    <td className="num mono">
                      <strong>{formatMoney(t.total_earnings ?? 0)}</strong>
                    </td>
                  </>
                ) : (
                  <td className="num mono">{formatMoney(t.rider_share)}</td>
                )}
                <td className="num mono">{formatMoney(t.blynk_delivery_share)}</td>
                <td className="num mono">{formatMoney(t.product_margin)}</td>
                <td className="num mono">{formatMoney(t.cash_kept)}</td>
                <td className="num mono">{formatMoney(t.cash_to_hand_in)}</td>
                {detailed ? (
                  <>
                    <td className="num mono">{(t.payable_to_rider ?? 0) > 0 ? formatMoney(t.payable_to_rider ?? 0) : '—'}</td>
                    <td />
                  </>
                ) : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="form__note">
        {detailed
          ? 'Total earnings = base pay + bonuses + adjustments. Bonuses and adjustments are kept from that day\'s cash; what the cash could not cover is payable to the rider. '
          : ''}
        Delivery charges are counted at the standard fee, so free deliveries still earn a commission rider their share.{' '}
        {defaultModel ? `Store default: ${describePay(defaultModel)}` : `Default commission: ${formatPercent(report.default_percent)}%`} (Settings).
      </p>
    </>
  );
}

/** The range's deductions and extra pay (owner, 2026-10-10), newest first. */
function AdjustmentsList({
  adjustments,
  onEdit,
  onDelete,
}: {
  adjustments: RiderAdjustment[];
  onEdit(a: RiderAdjustment): void;
  onDelete(a: RiderAdjustment): void;
}) {
  return (
    <section className="attention rp-adjustments" aria-label="Pay adjustments">
      <h2 className="section-label">Pay adjustments</h2>
      {adjustments.length === 0 ? (
        <p className="attention__clear">No deductions or extra pay in this period. Use "Adjust pay" on a rider to add one.</p>
      ) : (
        <ul className="attention__list" aria-label="Adjustments">
          {adjustments.map((a) => (
            <li key={a.id} className="attention__item">
              <span>
                <strong>{a.rider_name ?? 'Rider'}</strong>{' '}
                <span className={`mono ${a.amount_lkr < 0 ? 'rp-amount--minus' : 'rp-amount--plus'}`}>{signedMoney(a.amount_lkr)}</span>{' '}
                · {ADJUSTMENT_REASON_LABEL[a.reason]}
                {a.note ? ` – ${a.note}` : ''}
                <span className="cell__secondary">
                  {' '}
                  · {day(a.adjustment_date)}
                  {a.created_by_name ? ` · by ${a.created_by_name}` : ''}
                </span>
              </span>
              <span className="rp-adjustment__actions">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={`Edit ${ADJUSTMENT_REASON_LABEL[a.reason]} ${signedMoney(a.amount_lkr)} for ${a.rider_name ?? 'rider'}`}
                  onClick={() => onEdit(a)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={`Delete ${ADJUSTMENT_REASON_LABEL[a.reason]} ${signedMoney(a.amount_lkr)} for ${a.rider_name ?? 'rider'}`}
                  onClick={() => onDelete(a)}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Adjust pay (owner, 2026-10-10): a deduction or extra pay with a reason, an
 * optional note and the day whose cash it settles against (default today).
 * Edits an existing adjustment when `target.existing` is set.
 */
function AdjustPayDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Adjusting;
  onClose(): void;
  onSaved(a: RiderAdjustment, edited: boolean): void;
}) {
  const today = colomboDate();
  const existing = target.existing;
  const kindId = useId();
  const reasonId = useId();
  const [kind, setKind] = useState<AdjustmentKind>(existing && existing.amount_lkr > 0 ? 'EXTRA' : 'DEDUCTION');
  const [amount, setAmount] = useState(existing ? numberText(Math.abs(existing.amount_lkr)) : '');
  const [reason, setReason] = useState<AdjustmentReason | null>(existing?.reason ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [date, setDate] = useState(existing?.adjustment_date ?? today);
  const [errors, setErrors] = useState<{ amount?: string; reason?: string; date?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const signed = signedAdjustment(kind, amount);
    if ('error' in signed) next.amount = signed.error;
    if (!reason) next.reason = 'Pick a reason.';
    if (!date) next.date = 'Pick the day.';
    else if (date > today) next.date = 'Pick today or an earlier day.';
    else if (daysBetween(date, today) > MAX_ADJUSTMENT_DAYS_BACK) next.date = `Pick a day within the last ${MAX_ADJUSTMENT_DAYS_BACK} days.`;
    setErrors(next);
    if (Object.keys(next).length || 'error' in signed || !reason) return;
    setFormError(null);
    setSaving(true);
    const text = note.trim();
    try {
      const saved = existing
        ? await adjustmentsApi.update(existing.id, { amount_lkr: signed.value, reason, note: text || null, adjustment_date: date })
        : await adjustmentsApi.create(target.riderId, {
            amount_lkr: signed.value,
            reason,
            ...(text ? { note: text } : {}),
            adjustment_date: date,
          });
      onSaved(saved, Boolean(existing));
    } catch (err) {
      setFormError(errorMessage(err, 'Could not save the adjustment.'));
      setSaving(false);
    }
  }

  const who = target.riderName ?? 'this rider';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Adjust pay">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">{existing ? `Edit adjustment for ${who}` : `Adjust pay for ${who}`}</h2>
        <div className="field">
          <span className="field__label" id={kindId}>
            Type
          </span>
          <div className="segmented" role="group" aria-labelledby={kindId}>
            {(['DEDUCTION', 'EXTRA'] as AdjustmentKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={k === kind ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={k === kind}
                onClick={() => setKind(k)}
              >
                {ADJUSTMENT_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>
        <Field
          label="Amount (LKR)"
          hint={kind === 'DEDUCTION' ? 'Taken off the rider\'s earnings; added to that day\'s hand-in.' : 'Added to the rider\'s earnings; kept from that day\'s cash.'}
          error={errors.amount}
        >
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="field">
          <span className="field__label" id={reasonId}>
            Reason
          </span>
          <div className="rd-choices" role="group" aria-labelledby={reasonId}>
            {ADJUSTMENT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={r === reason ? 'rd-choice is-selected' : 'rd-choice'}
                aria-pressed={r === reason}
                onClick={() => setReason(r)}
              >
                {ADJUSTMENT_REASON_LABEL[r]}
              </button>
            ))}
          </div>
          {errors.reason ? <span className="field__error">{errors.reason}</span> : null}
        </div>
        <Field label="Note (optional)" hint={`Up to ${MAX_ADJUSTMENT_NOTE} characters.`}>
          <textarea className="input" rows={2} maxLength={MAX_ADJUSTMENT_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="field">
          <span className="field__label">Day</span>
          <DatePicker value={date} onChange={setDate} label="Day" today={today} max={today} markPast={false} invalid={Boolean(errors.date)} />
          {errors.date ? (
            <span className="field__error">{errors.date}</span>
          ) : (
            <span className="field__hint">The day's cash it settles against.</span>
          )}
        </div>
        {formError ? <p className="field__error">{formError}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={kind === 'DEDUCTION' ? 'button button--danger' : 'button'} disabled={saving}>
            {saving ? <Spinner label="Saving" /> : existing ? 'Save' : kind === 'DEDUCTION' ? 'Add deduction' : 'Add extra pay'}
          </button>
        </div>
      </form>
    </div>
  );
}

type PayDefaults = ReturnType<typeof useRiderPayDefaults>;

/** Every rider's type and pay, with "Change pay" and "Adjust pay" (owner, 2026-10-09 / 2026-10-10). */
function RiderPaySection({
  defaults,
  onChanged,
  onAdjust,
}: {
  defaults: PayDefaults;
  onChanged(): void;
  onAdjust(rider: RiderOption): void;
}) {
  const toast = useToast();
  const [riders, setRiders] = useState<RiderOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RiderOption | null>(null);
  const { defaultPercent, defaultModel, learn } = defaults;

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
    learn(pay);
    const model = pay.pay_model !== undefined ? pay.pay_model : null;
    setRiders((list) =>
      (list ?? []).map((r) =>
        r.id === rider.id ? { ...r, pay_type: pay.pay_type, commission_percent: pay.commission_percent, pay_model: model } : r
      )
    );
    toast.success(
      `${rider.full_name ?? 'The rider'} is now ${payLabel(pay.pay_type, pay.commission_percent, pay.default_percent, model, pay.default_model ?? defaultModel)}.`
    );
    onChanged();
  }

  return (
    <section className="attention rider-pay" aria-label="Rider pay">
      <h2 className="section-label">Rider pay</h2>
      <p className="form__note">
        Company riders are salaried; Blynk keeps the delivery charge. Commission riders earn the store default
        {defaultModel ? ` (${describePay(defaultModel)})` : defaultPercent === null ? '' : ` (default ${formatPercent(defaultPercent)}%)`} or
        their own pay, plus bonuses, and keep it from the cash they collect.
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
                  <td>{payLabel(r.pay_type, r.commission_percent, defaultPercent, r.pay_model, defaultModel)}</td>
                  <td>
                    {r.is_active === false ? <Badge tone="inactive">Inactive</Badge> : <Badge tone="active">Active</Badge>}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Change pay for ${r.full_name ?? 'rider'}`}
                        onClick={() => setEditing(r)}
                      >
                        Change pay
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Adjust pay for ${r.full_name ?? 'rider'}`}
                        onClick={() => onAdjust(r)}
                      >
                        Adjust pay
                      </button>
                    </div>
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
          defaults={defaults.defaults}
          onClose={() => setEditing(null)}
          onSaved={(pay) => saved(editing, pay)}
        />
      ) : null}
    </section>
  );
}

/**
 * Change pay (owner, 2026-10-09; models 2026-10-10): Company, or Commission
 * on the store default or an own % / fixed / distance pay with an optional
 * minimum. Opens from the row at once, then picks up the rider's own numbers
 * from GET /admin/riders/:id/pay unless staff already started editing.
 */
function RiderPayDialog({
  rider,
  defaults,
  onClose,
  onSaved,
}: {
  rider: RiderOption;
  defaults: PayParams | null;
  onClose(): void;
  onSaved(pay: RiderPay): void;
}) {
  const [draft, setDraft] = useState<PayDraft>(() =>
    payDraftFrom(
      { pay_type: rider.pay_type ?? 'COMPANY', commission_percent: rider.commission_percent ?? null, pay_model: rider.pay_model ?? null },
      defaults
    )
  );
  const [errors, setErrors] = useState<PayDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    ridersApi
      .getPay(rider.id)
      .then((pay) => {
        if (!live || touched.current || !pay?.pay_type) return;
        setDraft(payDraftFrom(pay, pay.default_model ?? defaults));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per dialog: the row is the starting point, the API only refines it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider.id]);

  // The store default may load after the dialog opened: fill blank boxes.
  useEffect(() => {
    if (defaults) setDraft((d) => fillDraftBlanks(d, defaults));
  }, [defaults]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const read = payDraftToInput(draft);
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      onSaved(await ridersApi.setPay(rider.id, read.input));
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
          draft={draft}
          defaults={defaults}
          errors={errors}
          onChange={(next) => {
            touched.current = true;
            setDraft(next);
          }}
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
