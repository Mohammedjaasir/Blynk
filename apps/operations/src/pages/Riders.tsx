import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { riders as ridersApi, settings } from '../api/resources';
import type { RiderOption, RiderPay, RiderPayType } from '../api/types';
import { PageHeader } from '../components/Layout';
import { RiderPayFields } from '../components/RiderPayFields';
import { EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { parseOwnPercent, payLabel } from '../lib/riderPay';

/**
 * Rider roster (task F7, plan §14). Reuses `riders.listActive()`
 * (`GET /admin/riders`) - active riders only (the API's own filter), each
 * with its `open_deliveries` count and vehicle.
 *
 * Rider pay (owner, 2026-10-09): each rider shows their type - "Company"
 * (salaried, no per-delivery commission) or "Commission · 80%" (their own %
 * or the store default) - and staff can change it here via
 * `PATCH /admin/riders/:id/pay`. That is the only change this screen makes:
 * the backend still has no create/activate/deactivate rider endpoint, so no
 * such control is offered (rider accounts come in through Rider requests).
 */
export function Riders() {
  const [rows, setRows] = useState<RiderOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [defaultPercent, setDefaultPercent] = useState<number | null>(null);
  const [editing, setEditing] = useState<RiderOption | null>(null);

  useEffect(() => {
    let cancelled = false;
    ridersApi
      .listActive()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Could not load riders.'));
        setRows([]);
      });
    // The store default % labels commission riders without their own %.
    settings.riderCommission
      .get()
      .then((s) => !cancelled && setDefaultPercent(s.default_percent))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function saved(rider: RiderOption, pay: RiderPay) {
    setEditing(null);
    setDefaultPercent(pay.default_percent);
    setRows((list) =>
      (list ?? []).map((r) =>
        r.id === rider.id ? { ...r, pay_type: pay.pay_type, commission_percent: pay.commission_percent } : r
      )
    );
    setNotice(`${rider.full_name ?? rider.phone ?? 'The rider'} is now ${payLabel(pay.pay_type, pay.commission_percent, pay.default_percent)}.`);
  }

  return (
    <div className="page">
      <PageHeader
        title="Riders"
        description="Active riders, their delivery load and how they are paid. Rider accounts are currently provisioned outside this app."
        actions={
          <Link className="button button--ghost" to="/more/earnings">
            Earnings
          </Link>
        }
      />

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading riders" />
      ) : rows.length === 0 ? (
        <EmptyState title="No active riders" />
      ) : (
        <ul className="cat-list">
          {rows.map((r) => (
            <li key={r.id} className="cat-row cat-row--flat">
              <div className="cat-row__main">
                <p className="cat-row__title">{r.full_name ?? r.phone ?? 'Rider'}</p>
                <p className="cat-row__meta">
                  {r.vehicle_type} · <span className="mono">{r.vehicle_registration_number}</span>
                </p>
                <p className="cat-row__meta">
                  {r.open_deliveries === 0
                    ? 'No open deliveries'
                    : `${r.open_deliveries} open ${r.open_deliveries === 1 ? 'delivery' : 'deliveries'}`}
                </p>
                <p className="cat-row__meta">
                  <span className={`pay-tag pay-tag--${(r.pay_type ?? 'COMPANY').toLowerCase()}`}>
                    {payLabel(r.pay_type, r.commission_percent, defaultPercent)}
                  </span>
                </p>
              </div>
              <div className="cat-row__actions">
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  aria-label={`Change pay for ${r.full_name ?? r.phone ?? 'rider'}`}
                  onClick={() => setEditing(r)}
                >
                  Change pay
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <RiderPayDialog rider={editing} onClose={() => setEditing(null)} onSaved={(pay) => saved(editing, pay)} />
      ) : null}
    </div>
  );
}

/** Change a rider's type and own % (owner, 2026-10-09). Loads the current
 * pay first so the dialog never guesses. */
function RiderPayDialog({
  rider,
  onClose,
  onSaved,
}: {
  rider: RiderOption;
  onClose(): void;
  onSaved(pay: RiderPay): void;
}) {
  const [pay, setPay] = useState<RiderPay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payType, setPayType] = useState<RiderPayType>(rider.pay_type ?? 'COMPANY');
  const [percent, setPercent] = useState('');
  const [percentError, setPercentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    ridersApi
      .pay(rider.id)
      .then((p) => {
        if (!live) return;
        setPay(p);
        setPayType(p.pay_type);
        setPercent(p.commission_percent != null ? String(p.commission_percent) : '');
      })
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load this rider’s pay.')));
    return () => {
      live = false;
    };
  }, [rider.id]);

  async function save() {
    let own: number | null = null;
    if (payType === 'COMMISSION') {
      const parsed = parseOwnPercent(percent);
      if ('error' in parsed) {
        setPercentError(parsed.error);
        return;
      }
      own = parsed.value;
    }
    setPercentError(null);
    setFormError(null);
    setSaving(true);
    try {
      onSaved(
        await ridersApi.updatePay(
          rider.id,
          payType === 'COMMISSION' ? { pay_type: 'COMMISSION', commission_percent: own } : { pay_type: 'COMPANY', commission_percent: null }
        )
      );
    } catch (err) {
      setFormError(errorMessage(err, 'Could not change the rider’s pay.'));
    } finally {
      setSaving(false);
    }
  }

  const name = rider.full_name ?? rider.phone ?? 'this rider';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Rider pay">
      <div className="modal__panel">
        <h2 className="modal__title">Pay for {name}</h2>
        {loadError ? (
          <p className="field__error" role="alert">
            {loadError}
          </p>
        ) : !pay ? (
          <Spinner label="Loading pay" />
        ) : (
          <RiderPayFields
            payType={payType}
            onPayType={(next) => {
              setPayType(next);
              setPercentError(null);
            }}
            percent={percent}
            onPercent={setPercent}
            defaultPercent={pay.default_percent}
            error={percentError}
          />
        )}
        {formError ? (
          <p className="field__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" disabled={saving || !pay} onClick={() => void save()}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
