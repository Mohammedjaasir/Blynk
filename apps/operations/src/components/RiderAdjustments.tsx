import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { riders as ridersApi } from '../api/resources';
import type { AdjustmentReason, RiderAdjustment, RiderAdjustmentInput } from '../api/types';
import { catalogErrorMessage } from '../lib/catalog';
import { formatMoney } from '../lib/orders';
import { formatDay } from '../lib/riderDocuments';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABEL,
  MAX_ADJUSTMENT_DAYS_BACK,
  MAX_ADJUSTMENT_LKR,
  MAX_ADJUSTMENT_NOTE,
  numberText,
  parseAmount,
  signedMoney,
} from '../lib/riderPay';
import { addDays } from '../lib/slots';
import { colomboToday } from '../pages/Cash';
import { DatePicker } from './DatePicker';
import { ConfirmDialog, Spinner } from './ui';
import './rider-pay.css';

/**
 * "Adjust pay" (owner, 2026-10-10): a deduction or extra pay for one rider,
 * with a reason (Cash short, Damaged item, Late, Bonus, Other), an optional
 * note and the day whose cash it settles against (today by default, never
 * in the future, at most 400 days back). A deduction is sent as a negative
 * amount. The sheet also lists the rider's adjustments of the last 30 days
 * to edit or delete (with a confirm). Every change is audited server-side.
 * Opened from Riders and from Rider earnings.
 */
type Kind = 'DEDUCTION' | 'EXTRA';
const RECENT_DAYS = 30;

export function RiderAdjustSheet({
  riderId,
  name,
  onClose,
  onChanged,
}: {
  riderId: string;
  name: string;
  onClose(): void;
  /** After any add / edit / delete - e.g. to reload the earnings report. */
  onChanged?(): void;
}) {
  const today = colomboToday();
  const [kind, setKind] = useState<Kind>('DEDUCTION');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<AdjustmentReason | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<RiderAdjustment | null>(null);
  const [errors, setErrors] = useState<Partial<Record<'amount' | 'reason' | 'date', string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<RiderAdjustment[] | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RiderAdjustment | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      const list = await ridersApi.adjustments({ rider_id: riderId, from: addDays(colomboToday(), -RECENT_DAYS), to: colomboToday() });
      setRecent(Array.isArray(list) ? list : []);
      setRecentError(null);
    } catch (err) {
      setRecent([]);
      setRecentError(catalogErrorMessage(err));
    }
  }, [riderId]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  function reset() {
    setEditing(null);
    setKind('DEDUCTION');
    setAmount('');
    setReason(null);
    setNote('');
    setDate(colomboToday());
    setErrors({});
    setFormError(null);
  }

  function startEdit(a: RiderAdjustment) {
    setNotice(null);
    setEditing(a);
    setKind(a.amount_lkr < 0 ? 'DEDUCTION' : 'EXTRA');
    setAmount(numberText(Math.abs(a.amount_lkr)));
    setReason(a.reason);
    setNote(a.note ?? '');
    setDate(a.adjustment_date);
    setErrors({});
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const next: typeof errors = {};
    const parsed = parseAmount(amount, { max: MAX_ADJUSTMENT_LKR, positive: true, what: 'the amount' });
    if ('error' in parsed) next.amount = parsed.error;
    if (!reason) next.reason = 'Pick a reason.';
    const now = colomboToday();
    if (!date || date > now) next.date = 'Pick today or an earlier day.';
    else if (date < addDays(now, -MAX_ADJUSTMENT_DAYS_BACK)) next.date = `Pick a day within the last ${MAX_ADJUSTMENT_DAYS_BACK} days.`;
    setErrors(next);
    if (Object.keys(next).length || 'error' in parsed || !reason) return;
    const value = parsed.value ?? 0;
    const signed = kind === 'DEDUCTION' ? -value : value;
    const text = note.trim();
    setFormError(null);
    setSaving(true);
    try {
      if (editing) {
        await ridersApi.updateAdjustment(editing.id, { amount_lkr: signed, reason, note: text || null, adjustment_date: date });
        setNotice('Adjustment updated.');
      } else {
        const body: RiderAdjustmentInput = { amount_lkr: signed, reason, adjustment_date: date };
        if (text) body.note = text;
        await ridersApi.addAdjustment(riderId, body);
        setNotice(
          kind === 'DEDUCTION'
            ? `${formatMoney(value)} deducted from ${name}'s pay.`
            : `${formatMoney(value)} extra pay added for ${name}.`
        );
      }
      reset();
      onChanged?.();
      await loadRecent();
    } catch (err) {
      setFormError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: RiderAdjustment) {
    setDeleting(null);
    setNotice(null);
    try {
      await ridersApi.removeAdjustment(a.id);
      if (editing?.id === a.id) reset();
      setNotice('Adjustment deleted.');
      onChanged?.();
      await loadRecent();
    } catch (err) {
      setFormError(catalogErrorMessage(err));
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Adjust pay">
      <form className="modal__panel modal__panel--wide" onSubmit={submit} noValidate>
        <h2 className="modal__title">Adjust pay for {name}</h2>
        <p className="modal__message">
          Kept from that day&apos;s cash. If the cash cannot cover extra pay, Blynk owes the rider the rest.
        </p>

        <div className="segmented rpay-segmented" role="group" aria-label="Deduction or extra pay">
          {(
            [
              { id: 'DEDUCTION', text: 'Deduction' },
              { id: 'EXTRA', text: 'Extra pay' },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              className={o.id === kind ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={o.id === kind}
              onClick={() => setKind(o.id)}
            >
              {o.text}
            </button>
          ))}
        </div>

        <div className="field">
          <label className="field rpay-label">
            <span className="field__label">Amount (LKR)</span>
            <input
              className="input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={errors.amount ? true : undefined}
            />
          </label>
          <span className="field__hint">{kind === 'DEDUCTION' ? 'Taken off the rider’s pay.' : 'Added to the rider’s pay.'}</span>
          {errors.amount ? <span className="field__error-text">{errors.amount}</span> : null}
        </div>

        <div className="field">
          <span className="field__label" id="adjust-reason-label">
            Reason
          </span>
          <div className="specialty-chips" role="group" aria-labelledby="adjust-reason-label">
            {ADJUSTMENT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={r === reason ? 'specialty-chip is-selected' : 'specialty-chip'}
                aria-pressed={r === reason}
                onClick={() => setReason(r)}
              >
                {ADJUSTMENT_REASON_LABEL[r]}
              </button>
            ))}
          </div>
          {errors.reason ? <span className="field__error-text">{errors.reason}</span> : null}
        </div>

        <label className="field">
          <span className="field__label">Note (optional)</span>
          <textarea
            className="input"
            rows={2}
            maxLength={MAX_ADJUSTMENT_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <DatePicker
          label="Date"
          value={date}
          onChange={(v) => setDate(v ?? colomboToday())}
          today={today}
          min={addDays(today, -MAX_ADJUSTMENT_DAYS_BACK)}
          max={today}
          hint="The day whose cash it is kept from."
          error={errors.date}
        />

        {formError ? (
          <p className="field__error" role="alert">
            {formError}
          </p>
        ) : null}
        {notice ? (
          <p className="quiet quiet--ok" role="status">
            {notice}
          </p>
        ) : null}

        <div className="modal__actions">
          {editing ? (
            <button type="button" className="button button--ghost" onClick={reset}>
              Cancel edit
            </button>
          ) : null}
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : editing ? 'Save changes' : kind === 'DEDUCTION' ? 'Deduct' : 'Add extra pay'}
          </button>
        </div>

        <section aria-labelledby="adjust-recent-title" className="rpay-recent">
          <h3 className="section-label" id="adjust-recent-title">
            Last {RECENT_DAYS} days
          </h3>
          {recent === null ? (
            <Spinner label="Loading adjustments" />
          ) : recentError ? (
            <p className="field__error-text">{recentError}</p>
          ) : recent.length === 0 ? (
            <p className="quiet">No adjustments yet.</p>
          ) : (
            <ul className="rpay-adjustments" aria-label="Recent adjustments">
              {recent.map((a) => (
                <li key={a.id} className={editing?.id === a.id ? 'rpay-adjustment is-editing' : 'rpay-adjustment'}>
                  <div className="rpay-adjustment__main">
                    <p className="rpay-adjustment__line">
                      <span className={a.amount_lkr < 0 ? 'mono rpay-minus' : 'mono rpay-plus'}>{signedMoney(a.amount_lkr)}</span>{' '}
                      <span className="pay-tag pay-tag--company">{ADJUSTMENT_REASON_LABEL[a.reason] ?? a.reason}</span>
                    </p>
                    <p className="cat-row__meta">
                      {formatDay(a.adjustment_date)}
                      {a.created_by_name ? ` · by ${a.created_by_name}` : ''}
                    </p>
                    {a.note ? <p className="cat-row__meta">“{a.note}”</p> : null}
                  </div>
                  <div className="rpay-adjustment__actions">
                    <button
                      type="button"
                      className="button button--sm button--ghost"
                      aria-label={`Edit ${signedMoney(a.amount_lkr)} on ${formatDay(a.adjustment_date)}`}
                      onClick={() => startEdit(a)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--sm button--ghost"
                      aria-label={`Delete ${signedMoney(a.amount_lkr)} on ${formatDay(a.adjustment_date)}`}
                      onClick={() => setDeleting(a)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </form>

      {deleting ? (
        <ConfirmDialog
          title="Delete adjustment"
          message={`Delete ${signedMoney(deleting.amount_lkr)} (${ADJUSTMENT_REASON_LABEL[deleting.reason] ?? deleting.reason}) on ${formatDay(
            deleting.adjustment_date
          )}? That day's cash is worked out again.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </div>
  );
}
