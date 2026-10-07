import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { cash as cashApi, riders as ridersApi } from '../api/resources';
import type { CashHandin, CashReconciliation, ReconciliationStatus, RiderOption } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/orders';

/**
 * Rider cash (More -> Cash; backend migration 019). Riders collect cash on
 * delivery; staff record what each rider hands in. Per rider and Sri Lanka
 * day: collected (settled deliveries), handed in, and the difference -
 * short in red, over in amber. Only an admin may delete a hand-in (the API
 * refuses Operations).
 */

/** Today in Sri Lanka (UTC+05:30 all year), YYYY-MM-DD. */
export function colomboToday(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function differenceText(difference: number, status: ReconciliationStatus): string {
  if (status === 'BALANCED') return 'Balanced';
  return `${status === 'SHORT' ? 'Short' : 'Over'} ${formatMoney(Math.abs(difference))}`;
}

export function Cash() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => colomboToday());
  const [data, setData] = useState<CashReconciliation | null>(null);
  const [handins, setHandins] = useState<CashHandin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ riderId?: string } | null>(null);
  const [deleting, setDeleting] = useState<CashHandin | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      const [recon, list] = await Promise.all([cashApi.reconciliation(date), cashApi.handins(date)]);
      setData(recon);
      setHandins(list);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load cash.'));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(h: CashHandin) {
    setDeleting(null);
    try {
      await cashApi.remove(h.id);
      setNotice('Hand-in deleted.');
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the hand-in.'));
    }
  }

  return (
    <div className="page">
      <PageHeader title="Cash" description="Cash each rider collected against what they handed in, per day." />

      <div className="cash-toolbar">
        <label className="field">
          <span className="field__label">Day</span>
          <input
            className="input"
            type="date"
            value={date}
            max={colomboToday()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
        <button type="button" className="button" onClick={() => setRecording({})}>
          Record hand-in
        </button>
      </div>

      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <Spinner label="Loading cash" /> : null}

      {data ? (
        data.riders.length === 0 ? (
          <EmptyState title="No cash this day" message="No rider collected or handed in cash on this day." />
        ) : (
          <>
            <ul className="cat-list" aria-label="Cash by rider">
              {data.riders.map((r) => (
                <li key={r.rider_id} className={`cat-row cat-row--flat cash-row cash-row--${r.status.toLowerCase()}`}>
                  <div className="cat-row__main">
                    <p className="cat-row__title">{r.rider_name ?? r.rider_phone ?? 'Rider'}</p>
                    <p className="cat-row__meta">
                      Collected <span className="mono">{formatMoney(r.collected)}</span> ({r.deliveries}{' '}
                      {r.deliveries === 1 ? 'delivery' : 'deliveries'}) · Handed in{' '}
                      <span className="mono">{formatMoney(r.handed_in)}</span>
                    </p>
                    <p className={`cash-diff cash-diff--${r.status.toLowerCase()}`}>{differenceText(r.difference, r.status)}</p>
                  </div>
                  <button
                    type="button"
                    className="button button--ghost"
                    aria-label={`Record hand-in for ${r.rider_name ?? 'rider'}`}
                    onClick={() => setRecording({ riderId: r.rider_id })}
                  >
                    Record
                  </button>
                </li>
              ))}
            </ul>
            <section className="card" aria-label="All riders">
              <p className="card__row">
                <span className="card__label">Collected</span>
                <span className="card__value mono">{formatMoney(data.totals.collected)}</span>
              </p>
              <p className="card__row">
                <span className="card__label">Handed in</span>
                <span className="card__value mono">{formatMoney(data.totals.handed_in)}</span>
              </p>
              <p className="card__row">
                <span className="card__label">Difference</span>
                <span className={`card__value cash-diff cash-diff--${data.totals.status.toLowerCase()}`}>
                  {differenceText(data.totals.difference, data.totals.status)}
                </span>
              </p>
            </section>
          </>
        )
      ) : null}

      {data && handins.length > 0 ? (
        <section className="card" aria-labelledby="handins-title">
          <h2 className="section-label" id="handins-title">
            Hand-ins this day
          </h2>
          <ul className="cash-handins" aria-label="Hand-ins">
            {handins.map((h) => (
              <li key={h.id} className="cash-handins__row">
                <span>
                  <strong>{h.rider_name ?? 'Rider'}</strong> <span className="mono">{formatMoney(h.amount)}</span>
                  {h.note ? ` – ${h.note}` : ''}
                </span>
                {user?.role === 'ADMIN' ? (
                  <button
                    type="button"
                    className="button button--ghost"
                    aria-label={`Delete hand-in of ${formatMoney(h.amount)}`}
                    onClick={() => setDeleting(h)}
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recording ? (
        <HandinDialog
          date={date}
          riderId={recording.riderId}
          onClose={() => setRecording(null)}
          onSaved={async (h) => {
            setRecording(null);
            setNotice(`${formatMoney(h.amount)} from ${h.rider_name ?? 'the rider'} recorded.`);
            if (h.handin_date !== date) setDate(h.handin_date);
            else await load();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete hand-in"
          message={`Delete ${formatMoney(deleting.amount)} from ${deleting.rider_name ?? 'this rider'}? Record it again if the amount was wrong.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </div>
  );
}

/** A rider in the hand-in picker: "(inactive)" when they can no longer deliver. */
export function cashRiderLabel(r: RiderOption): string {
  const name = r.full_name ?? r.phone ?? 'Rider';
  return r.is_active === false ? `${name} (inactive)` : name;
}

/** Active riders first (as the API sorts them), then inactive ones by name. */
export function cashRiderOrder(riders: ReadonlyArray<RiderOption>): RiderOption[] {
  const active = riders.filter((r) => r.is_active !== false);
  const inactive = riders
    .filter((r) => r.is_active === false)
    .sort((a, b) => cashRiderLabel(a).localeCompare(cashRiderLabel(b)));
  return [...active, ...inactive];
}

function HandinDialog({
  date,
  riderId,
  onClose,
  onSaved,
}: {
  date: string;
  riderId?: string;
  onClose(): void;
  onSaved(h: CashHandin): void;
}) {
  const [riders, setRiders] = useState<RiderOption[] | null>(null);
  const [rider, setRider] = useState(riderId ?? '');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(date);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'rider' | 'amount' | 'day' | 'form', string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Inactive riders too: one switched off today may still owe the cash
    // they collected. Active first, then inactive ones (marked so).
    ridersApi
      .listForCash()
      .then((all) => setRiders(cashRiderOrder(Array.isArray(all) ? all : [])))
      .catch(() => setRiders([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const value = Number(amount);
    if (!rider) next.rider = 'Choose the rider.';
    if (!(amount.trim() && value > 0)) next.amount = 'Enter the amount handed in.';
    if (!day || day > colomboToday()) next.day = 'Choose today or an earlier day.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      onSaved(await cashApi.record({ rider_id: rider, amount: Number(value.toFixed(2)), handin_date: day, note: note.trim() || undefined }));
    } catch (err) {
      setErrors({ form: errorMessage(err, 'Could not record the hand-in.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Record hand-in">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Record hand-in</h2>
        <label className="field">
          <span className="field__label">Rider</span>
          <select className="input" value={rider} onChange={(e) => setRider(e.target.value)} disabled={riders === null}>
            <option value="">{riders === null ? 'Loading riders…' : 'Choose a rider'}</option>
            {(riders ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {cashRiderLabel(r)}
              </option>
            ))}
          </select>
          {errors.rider ? <span className="field__error">{errors.rider}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">Amount (LKR)</span>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {errors.amount ? <span className="field__error">{errors.amount}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">Day</span>
          <input className="input" type="date" value={day} max={colomboToday()} onChange={(e) => setDay(e.target.value)} />
          {errors.day ? <span className="field__error">{errors.day}</span> : null}
        </label>
        <label className="field">
          <span className="field__label">Note (optional)</span>
          <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        {errors.form ? (
          <p className="field__error" role="alert">
            {errors.form}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Record'}
          </button>
        </div>
      </form>
    </div>
  );
}
