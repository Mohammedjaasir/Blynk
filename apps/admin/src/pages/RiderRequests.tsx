import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { riderApplications } from '../api/resources';
import { riderDocuments, type RiderApplicationWithDocuments, type RiderDocumentBlocking } from '../api/riderDocuments';
import type { RiderApprovalStatus } from '../api/types';
import { PageHeader } from '../components/Layout';
import { RiderPayFields, useRiderPayDefaults } from '../components/RiderPayFields';
import { DocumentAlertBadge, RiderDocumentsPanel, RiderDocumentsReview, useRiderDocumentAlerts } from '../components/RiderDocuments';
import { ConfirmDialog, EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { blockingText } from '../lib/riderDocuments';
import { newPayDraft, payDraftToInput, payLabel, type PayDraft, type PayDraftErrors } from '../lib/riderPay';

/**
 * Rider requests (migration 029). New riders apply in the Rider app; an Admin
 * (or Operations, in their app) approves or rejects them here. An approved
 * rider gets an SMS and can then sign in with their phone number.
 *
 * Approving picks the rider type (owner, 2026-10-09): Company (salaried,
 * Blynk keeps the delivery charge) or Commission (a % of the standard
 * delivery fee - the store default, or the rider's own %). Change it later
 * under Rider earnings -> Rider pay.
 *
 * Rider documents (owner, 2026-10-10): each applicant's Vehicle book (CR),
 * Revenue licence, Insurance certificate, Driving licence (and any custom
 * documents) show as thumbnails; staff open them full screen to verify or
 * reject. Approve stays off until every required document is verified;
 * "Approve anyway" needs a reason and is recorded in the audit log. A
 * waiting or rejected request can be deleted. Approved riders keep a
 * Documents button and an expiring-insurance badge.
 */

const TABS: { status: RiderApprovalStatus; label: string }[] = [
  { status: 'PENDING', label: 'Waiting' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
];

export const VEHICLE_LABEL: Record<string, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  BICYCLE: 'Bicycle',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
};

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});
const fmt = (iso: string | null) => (iso ? when.format(new Date(iso)) : '—');

/** "+94771234567" -> "077 123 4567". */
export const readablePhone = (phone: string | null) => {
  if (!phone) return '—';
  const local = phone.startsWith('+94') ? `0${phone.slice(3)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
};

const REASON_MAX = 500;
/** "Approve anyway" reason (owner, 2026-10-10): the API wants at least 3 characters. */
const OVERRIDE_REASON_MIN = 3;

/** An older API sends no document fields: nothing blocks Approve then. */
const isBlocked = (app: RiderApplicationWithDocuments) => app.documents_verified === false;

export function RiderRequests() {
  const toast = useToast();
  const [status, setStatus] = useState<RiderApprovalStatus>('PENDING');
  const [rows, setRows] = useState<RiderApplicationWithDocuments[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<{ app: RiderApplicationWithDocuments; override: boolean } | null>(null);
  const [rejecting, setRejecting] = useState<RiderApplicationWithDocuments | null>(null);
  const [deleting, setDeleting] = useState<RiderApplicationWithDocuments | null>(null);
  const [docsFor, setDocsFor] = useState<RiderApplicationWithDocuments | null>(null);
  const [reason, setReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const { defaults, defaultPercent, defaultModel } = useRiderPayDefaults();
  const [draft, setDraft] = useState<PayDraft>(() => newPayDraft(null));
  const [payErrors, setPayErrors] = useState<PayDraftErrors>({});
  const alerts = useRiderDocumentAlerts(status === 'APPROVED');

  /** `soft` keeps the table on screen (refresh after a document action). */
  const load = useCallback(
    async (soft = false) => {
      if (!soft) setRows(null);
      try {
        const page = await riderApplications.list(status);
        setRows(page.applications as RiderApplicationWithDocuments[]);
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Could not load rider requests.'));
        if (!soft) setRows([]);
      }
    },
    [status]
  );

  useEffect(() => {
    void load();
  }, [load]);

  function startApproving(app: RiderApplicationWithDocuments, override = false) {
    // Company is the API's default when no type is sent (owner, 2026-10-09).
    setDraft(newPayDraft(defaults));
    setPayErrors({});
    setOverrideReason('');
    setOverrideError(undefined);
    setApproving({ app, override });
  }

  async function approve(app: RiderApplicationWithDocuments, override: boolean) {
    const read = payDraftToInput(draft);
    if ('errors' in read) {
      setPayErrors(read.errors);
      return;
    }
    setPayErrors({});
    const why = overrideReason.trim();
    if (override && why.length < OVERRIDE_REASON_MIN) {
      setOverrideError('Say why this rider is approved without verified documents (at least 3 characters).');
      return;
    }
    setOverrideError(undefined);
    setBusy(true);
    try {
      if (override) {
        await riderDocuments.approveWithOverride(app.id, { ...read.input, override_documents: true, override_reason: why });
      } else {
        await riderApplications.approve(app.id, read.input);
      }
      toast.success(`${app.full_name ?? 'The rider'} is approved and gets an SMS to sign in.`);
      setApproving(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DOCUMENTS_NOT_VERIFIED') {
        const blocking = (err.details as { blocking?: RiderDocumentBlocking[] } | undefined)?.blocking ?? [];
        toast.error(`Verify the documents first${blocking.length ? `: ${blockingText(blocking)}` : ''}.`);
        setApproving(null);
        await load(true);
      } else if (err instanceof ApiError && err.code === 'OVERRIDE_ADMIN_ONLY') {
        toast.error('Only an Admin can approve a rider without verified documents.');
      } else {
        toast.error(errorMessage(err, 'Could not approve the rider.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function reject(app: RiderApplicationWithDocuments) {
    const text = reason.trim();
    if (!text) return;
    setBusy(true);
    try {
      await riderApplications.reject(app.id, text);
      toast.success(`${app.full_name ?? 'The application'} was rejected.`);
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reject the application.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(app: RiderApplicationWithDocuments) {
    setBusy(true);
    try {
      await riderDocuments.deleteApplication(app.id);
      toast.success(`${app.full_name ?? 'The request'} was deleted with its documents.`);
      setDeleting(null);
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'APPLICATION_APPROVED'
          ? 'This rider is already approved, so the request cannot be deleted.'
          : errorMessage(err, 'Could not delete the request.')
      );
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  const deleteButton = (app: RiderApplicationWithDocuments) => (
    <button type="button" className="button button--sm button--ghost" onClick={() => setDeleting(app)}>
      Delete
    </button>
  );

  return (
    <>
      <PageHeader
        title="Rider requests"
        description="Riders apply in the Blynk Rider app. Check their documents, then approve them here; they get an SMS and sign in with their phone number."
        actions={
          <div className="segmented" role="group" aria-label="Show">
            {TABS.map((tab) => (
              <button
                key={tab.status}
                type="button"
                className={tab.status === status ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={tab.status === status}
                onClick={() => setStatus(tab.status)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading rider requests" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState
            title={status === 'PENDING' ? 'No rider requests waiting' : status === 'APPROVED' ? 'No approved riders yet' : 'No rejected requests'}
            message={status === 'PENDING' ? 'New applications from the Rider app appear here.' : undefined}
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Rider requests">
            <thead>
              <tr>
                <th scope="col">Rider</th>
                <th scope="col">Phone</th>
                <th scope="col">Vehicle</th>
                <th scope="col">Applied</th>
                {status === 'PENDING' ? <th scope="col">Documents</th> : null}
                {status === 'APPROVED' ? <th scope="col">Pay</th> : null}
                {status === 'PENDING' ? <th scope="col">Decision</th> : <th scope="col">Reviewed</th>}
                {status !== 'PENDING' ? <th scope="col">Documents</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <tr key={app.id}>
                  <td>
                    <div className="cell__primary">{app.full_name ?? '—'}</div>
                    {app.emergency_contact_phone ? (
                      <div className="cell__secondary">Emergency: {readablePhone(app.emergency_contact_phone)}</div>
                    ) : null}
                    {status === 'APPROVED' && alerts.byRider.get(app.id) ? (
                      <div className="rd-row-badges">
                        <DocumentAlertBadge alerts={alerts.byRider.get(app.id)} />
                      </div>
                    ) : null}
                  </td>
                  <td className="mono">{readablePhone(app.phone)}</td>
                  <td>
                    {VEHICLE_LABEL[app.vehicle_type] ?? app.vehicle_type}
                    {app.vehicle_registration_number ? <div className="cell__secondary mono">{app.vehicle_registration_number}</div> : null}
                  </td>
                  <td>{fmt(app.applied_at)}</td>
                  {status === 'PENDING' ? (
                    <td>
                      <RiderDocumentsReview
                        documents={app.documents}
                        requirements={app.document_requirements}
                        riderName={app.full_name}
                        onChanged={() => load(true)}
                      />
                    </td>
                  ) : null}
                  {status === 'APPROVED' ? <td>{payLabel(app.pay_type, app.commission_percent, defaultPercent, app.pay_model, defaultModel)}</td> : null}
                  {status === 'PENDING' ? (
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--sm"
                          disabled={isBlocked(app)}
                          title={isBlocked(app) ? 'Verify every required document first' : undefined}
                          onClick={() => startApproving(app)}
                        >
                          Approve
                        </button>
                        {isBlocked(app) ? (
                          <button type="button" className="button button--sm button--ghost" onClick={() => startApproving(app, true)}>
                            Approve anyway
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="button button--sm button--ghost"
                          onClick={() => {
                            setReason('');
                            setRejecting(app);
                          }}
                        >
                          Reject
                        </button>
                        {deleteButton(app)}
                      </div>
                      {isBlocked(app) ? (
                        <p className="rd-blocking" data-testid={`blocking-${app.id}`}>
                          Not verified yet: {blockingText(app.documents_blocking) || 'required documents'}.
                        </p>
                      ) : null}
                    </td>
                  ) : (
                    <td>
                      {fmt(app.reviewed_at)}
                      {app.reviewed_by_name ? <div className="cell__secondary">by {app.reviewed_by_name}</div> : null}
                      {app.rejection_reason ? <div className="cell__secondary">Reason: {app.rejection_reason}</div> : null}
                    </td>
                  )}
                  {status !== 'PENDING' ? (
                    <td>
                      <div className="row-actions">
                        <button type="button" className="button button--sm button--ghost" onClick={() => setDocsFor(app)}>
                          Documents
                        </button>
                        {status === 'REJECTED' ? deleteButton(app) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approving ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label={approving.override ? 'Approve without verified documents?' : 'Approve this rider?'}>
          <form
            className="modal__panel"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void approve(approving.app, approving.override);
            }}
          >
            <h2 className="modal__title">{approving.override ? 'Approve without verified documents?' : 'Approve this rider?'}</h2>
            <p className="modal__message">
              {`${approving.app.full_name ?? 'This rider'} (${readablePhone(approving.app.phone)}) can then sign in to the Rider app and receive deliveries. They get an SMS.`}
            </p>
            {approving.override ? (
              <>
                <p className="rd-warning rd-warning--danger">
                  Not verified: {blockingText(approving.app.documents_blocking) || 'required documents'}. Approving anyway is
                  recorded in the audit log with your name and the reason.
                </p>
                <label className="field">
                  <span className="field__label">Reason for approving anyway (recorded in the audit log)</span>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={REASON_MAX}
                    value={overrideReason}
                    onChange={(e) => {
                      setOverrideReason(e.target.value);
                      setOverrideError(undefined);
                    }}
                  />
                  {overrideError ? <span className="field__error">{overrideError}</span> : null}
                </label>
              </>
            ) : null}
            <RiderPayFields draft={draft} defaults={defaults} errors={payErrors} onChange={setDraft} />
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setApproving(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className={approving.override ? 'button button--danger' : 'button'}
                disabled={busy || (approving.override && overrideReason.trim().length < OVERRIDE_REASON_MIN)}
              >
                {busy ? 'Approving…' : approving.override ? 'Approve anyway' : 'Approve'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {rejecting ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Reject rider request">
          <div className="modal__panel">
            <h2 className="modal__title">Reject {rejecting.full_name ?? 'this request'}?</h2>
            <label className="field">
              <span className="field__label">Reason (sent to the rider)</span>
              <textarea
                id="reject-reason"
                className="input"
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={busy || !reason.trim()}
                onClick={() => void reject(rejecting)}
              >
                {busy ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this request?"
          message={`${deleting.full_name ?? 'This request'} (${readablePhone(deleting.phone)}) and every uploaded document are removed for good. Their account stays, so they can apply again.`}
          confirmLabel={busy ? 'Deleting…' : 'Delete request'}
          destructive
          onConfirm={() => {
            if (!busy) void remove(deleting);
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}

      {docsFor ? (
        <RiderDocumentsPanel
          riderId={docsFor.id}
          riderName={docsFor.full_name}
          onClose={() => setDocsFor(null)}
          onChanged={() => {
            alerts.reload();
            void load(true);
          }}
        />
      ) : null}
    </>
  );
}
