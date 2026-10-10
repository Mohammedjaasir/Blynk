import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { riderDocuments, riders as ridersApi } from '../api/resources';
import type { PayParams, RiderDocumentAlert, RiderOption, RiderPay } from '../api/types';
import { PageHeader } from '../components/Layout';
import { RiderPayFields, useRiderPayDefaults } from '../components/RiderPayFields';
import { RiderAdjustSheet } from '../components/RiderAdjustments';
import { RiderDocumentsSheet } from '../components/RiderDocuments';
import { EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import {
  describePay,
  payDraftFrom,
  payDraftToInput,
  payModelLabel,
  type PayDraft,
  type PayDraftErrors,
} from '../lib/riderPay';

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
 *
 * Rider documents (owner, 2026-10-10): "Documents" opens the rider's
 * vehicle book, revenue licence, insurance and driving licence (verify /
 * reject again, e.g. a renewed insurance), and each row shows an
 * "Insurance expired" / "Insurance expiring soon" badge (or a softer
 * "Documents expiring" one) from `GET /admin/rider-documents/alerts`,
 * matched on riders.id - the same id this list's rows carry.
 *
 * Rider pay controls (owner, 2026-10-10): Change pay also picks a commission
 * rider's model - the store default, or their own % / fixed LKR / distance
 * pay with an optional minimum - and "Adjust pay" records a deduction or
 * extra pay with a reason (kept from that day's cash).
 */
export function Riders() {
  const [rows, setRows] = useState<RiderOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { defaultPercent, defaultModel, learn } = useRiderPayDefaults();
  const [editing, setEditing] = useState<RiderOption | null>(null);
  const [adjusting, setAdjusting] = useState<RiderOption | null>(null);
  const [alerts, setAlerts] = useState<RiderDocumentAlert[]>([]);
  const [docsFor, setDocsFor] = useState<RiderOption | null>(null);

  // Expiry badges (owner, 2026-10-10). A failure only hides the badges.
  function loadAlerts() {
    riderDocuments
      .alerts()
      .then((d) => setAlerts(d.alerts ?? []))
      .catch(() => undefined);
  }
  useEffect(loadAlerts, []);

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
    // The store default (useRiderPayDefaults) labels riders without their own pay.
    return () => {
      cancelled = true;
    };
  }, []);

  function saved(rider: RiderOption, pay: RiderPay) {
    setEditing(null);
    learn(pay);
    setRows((list) =>
      (list ?? []).map((r) =>
        r.id === rider.id
          ? { ...r, pay_type: pay.pay_type, commission_percent: pay.commission_percent, pay_model: pay.pay_model ?? null }
          : r
      )
    );
    setNotice(
      `${rider.full_name ?? rider.phone ?? 'The rider'} is now ${payModelLabel(
        pay.pay_type,
        pay.commission_percent,
        pay.default_percent,
        pay.pay_model,
        pay.default_model ?? defaultModel
      )}.`
    );
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
                    {payModelLabel(r.pay_type, r.commission_percent, defaultPercent, r.pay_model, defaultModel)}
                  </span>
                </p>
                <DocumentBadges alerts={alerts.filter((a) => a.rider_id === r.id)} />
              </div>
              <div className="cat-row__actions">
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  aria-label={`Documents for ${r.full_name ?? r.phone ?? 'rider'}`}
                  onClick={() => setDocsFor(r)}
                >
                  Documents
                </button>
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  aria-label={`Change pay for ${r.full_name ?? r.phone ?? 'rider'}`}
                  onClick={() => setEditing(r)}
                >
                  Change pay
                </button>
                {/* Deductions / extra pay with a reason (owner, 2026-10-10). */}
                <button
                  type="button"
                  className="button button--sm button--ghost"
                  aria-label={`Adjust pay for ${r.full_name ?? r.phone ?? 'rider'}`}
                  onClick={() => setAdjusting(r)}
                >
                  Adjust pay
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <RiderPayDialog rider={editing} onClose={() => setEditing(null)} onSaved={(pay) => saved(editing, pay)} />
      ) : null}
      {adjusting ? (
        <RiderAdjustSheet
          riderId={adjusting.id}
          name={adjusting.full_name ?? adjusting.phone ?? 'Rider'}
          onClose={() => setAdjusting(null)}
        />
      ) : null}
      {docsFor ? (
        <RiderDocumentsSheet
          riderId={docsFor.id}
          name={docsFor.full_name ?? docsFor.phone ?? 'Rider'}
          onClose={() => setDocsFor(null)}
          onChanged={loadAlerts}
        />
      ) : null}
    </div>
  );
}

/** Insurance first and loudest; any other expiring document gets a softer
 * badge (owner, 2026-10-10). */
function DocumentBadges({ alerts }: { alerts: RiderDocumentAlert[] }) {
  if (alerts.length === 0) return null;
  const insurance = alerts.filter((a) => a.is_insurance);
  const others = alerts.filter((a) => !a.is_insurance);
  const insuranceExpired = insurance.some((a) => a.expiry_state === 'EXPIRED');
  return (
    <p className="rdoc-badges">
      {insurance.length > 0 ? (
        <span className={`rdoc-badge ${insuranceExpired ? 'rdoc-badge--bad' : 'rdoc-badge--warn'}`}>
          {insuranceExpired ? 'Insurance expired' : 'Insurance expiring soon'}
        </span>
      ) : null}
      {others.length > 0 ? (
        <span className="rdoc-badge rdoc-badge--soft" title={others.map((a) => a.label).join(', ')}>
          {others.some((a) => a.expiry_state === 'EXPIRED') ? 'Documents expired' : 'Documents expiring'}
        </span>
      ) : null}
    </p>
  );
}

/** Change a rider's type and own % (owner, 2026-10-09) - and, for a
 * commission rider, their pay model (owner, 2026-10-10). Loads the current
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
  const { defaults: storeDefaults } = useRiderPayDefaults();
  const [pay, setPay] = useState<RiderPay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PayDraft | null>(null);
  const [errors, setErrors] = useState<PayDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The pay's own default_model (new API) wins over the separately loaded store default.
  const defaults: PayParams | null =
    pay?.default_model ?? (pay && storeDefaults ? { ...storeDefaults, percent: pay.default_percent } : storeDefaults);

  useEffect(() => {
    let live = true;
    ridersApi
      .pay(rider.id)
      .then((p) => {
        if (!live) return;
        setPay(p);
        setDraft(payDraftFrom(p, p.default_model ?? null));
      })
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load this rider’s pay.')));
    return () => {
      live = false;
    };
  }, [rider.id]);

  async function save() {
    if (!draft) return;
    const built = payDraftToInput(draft);
    if ('errors' in built) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      // COMPANY keeps sending commission_percent: null, as it always has.
      onSaved(
        await ridersApi.updatePay(
          rider.id,
          built.input.pay_type === 'COMPANY' ? { pay_type: 'COMPANY', commission_percent: null } : built.input
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
        ) : !pay || !draft ? (
          <Spinner label="Loading pay" />
        ) : (
          <>
            {pay.effective ? (
              <p className="quiet" data-testid="pay-now">
                Now: {describePay(pay.effective)}
              </p>
            ) : null}
            <RiderPayFields
              draft={draft}
              onChange={(next) => {
                setDraft(next);
                setErrors({});
              }}
              defaults={defaults}
              errors={errors}
            />
          </>
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
