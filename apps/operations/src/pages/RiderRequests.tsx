import { useCallback, useEffect, useState } from 'react';
import { riderApplications } from '../api/resources';
import type { RiderApplication, RiderApprovalStatus, StaffRiderDocument } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { RiderPayFields, useRiderPayDefaults } from '../components/RiderPayFields';
import { DocumentGrid, DocumentViewer, Switch } from '../components/RiderDocuments';
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/inventory';
import { newPayDraft, payDraftToInput, payModelLabel, type PayDraft, type PayDraftErrors } from '../lib/riderPay';
import { blockingLine, documentErrorMessage, documentSlots, type DocumentSlot } from '../lib/riderDocuments';

/**
 * Rider requests (backend migration 029). New riders apply in the Rider app;
 * Operations (or an Admin) approves or rejects them here. An approved rider
 * gets an SMS and can then sign in with their phone number.
 *
 * Approving also sets the rider type (owner, 2026-10-09): Company (salaried)
 * or Commission (a % of the standard delivery fee; blank = store default).
 * Rider pay controls (owner, 2026-10-10): a commission rider follows the
 * store default model or gets their own % / fixed LKR / distance pay with an
 * optional minimum - the same body as Riders -> Change pay.
 *
 * Rider documents (owner, 2026-10-10): each applicant shows their vehicle
 * book, revenue licence, insurance and driving licence (+ custom ones) as
 * thumbnails; staff open, verify or reject each one. Approve stays disabled
 * until the backend says every required document is verified
 * (`documents_verified`). Only an ADMIN may "Approve anyway" with a reason
 * (recorded server-side; OPERATIONS is refused by the backend too). A
 * PENDING/REJECTED request can be deleted with its documents.
 */

const TABS: { status: RiderApprovalStatus; label: string }[] = [
  { status: 'PENDING', label: 'Waiting' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
];

const VEHICLE_LABEL: Record<string, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  BICYCLE: 'Bicycle',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
};

/** "+94771234567" -> "077 123 4567". */
export const readablePhone = (phone: string | null) => {
  if (!phone) return '—';
  const local = phone.startsWith('+94') ? `0${phone.slice(3)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
};

const REASON_MAX = 500;
/** The backend's minimum for an override reason (owner, 2026-10-10). */
const OVERRIDE_REASON_MIN = 3;

export function RiderRequests() {
  const [status, setStatus] = useState<RiderApprovalStatus>('PENDING');
  const [rows, setRows] = useState<RiderApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<RiderApplication | null>(null);
  const [rejecting, setRejecting] = useState<RiderApplication | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { defaults: payDefaults } = useRiderPayDefaults();
  const [payDraft, setPayDraft] = useState<PayDraft>(() => newPayDraft(null));
  const [payErrors, setPayErrors] = useState<PayDraftErrors>({});
  // Rider documents (owner, 2026-10-10).
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [viewing, setViewing] = useState<{ appId: string; key: string } | null>(null);
  const [deleting, setDeleting] = useState<RiderApplication | null>(null);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [approveError, setApproveError] = useState<string | null>(null);

  /** `quiet` keeps the list on screen (after a document action) instead of a spinner. */
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setRows(null);
      try {
        const page = await riderApplications.list(status);
        setRows(page.applications);
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Could not load rider requests.'));
        if (!quiet) setRows([]);
      }
    },
    [status]
  );

  useEffect(() => {
    void load();
  }, [load]);

  function openApprove(app: RiderApplication, anyway = false) {
    // A new rider starts as Company - the backend's own default (owner, 2026-10-09).
    setPayDraft(newPayDraft(payDefaults));
    setPayErrors({});
    setOverride(anyway);
    setOverrideReason('');
    setApproveError(null);
    setApproving(app);
  }

  async function approve(app: RiderApplication) {
    const built = payDraftToInput(payDraft);
    if ('errors' in built) {
      setPayErrors(built.errors);
      return;
    }
    setPayErrors({});
    const pay = built.input;
    // Approve anyway (owner, 2026-10-10): ADMIN only, with a reason.
    const anyway = isAdmin && override && app.documents_verified !== true;
    if (anyway && overrideReason.trim().length < OVERRIDE_REASON_MIN) {
      setApproveError('Say why this rider is approved without verified documents.');
      return;
    }
    setApproveError(null);
    setBusy(true);
    try {
      if (anyway) await riderApplications.approveOverride(app.id, pay, overrideReason.trim());
      else await riderApplications.approve(app.id, pay);
      setNotice(`${app.full_name ?? 'The rider'} is approved and gets an SMS to sign in.`);
      setApproving(null);
      await load();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'DOCUMENTS_NOT_VERIFIED' || code === 'OVERRIDE_ADMIN_ONLY') {
        // Keep the dialog open with the reason; refresh the row behind it.
        setApproveError(documentErrorMessage(err, 'Could not approve the rider.'));
        void load(true);
      } else {
        setApproving(null);
        setError(documentErrorMessage(err, 'Could not approve the rider.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeRequest(app: RiderApplication) {
    setDeleting(null);
    setBusy(true);
    try {
      const result = await riderApplications.remove(app.id);
      const docs = result.documents_removed;
      setNotice(
        `${app.full_name ?? 'The request'} was deleted${docs > 0 ? ` with ${docs} ${docs === 1 ? 'document' : 'documents'}` : ''}. The account stays and can apply again.`
      );
      await load();
    } catch (err) {
      setError(documentErrorMessage(err, 'Could not delete the request.'));
    } finally {
      setBusy(false);
    }
  }

  /** After Verify/Reject: show the new status at once, then re-read the row
   * so `documents_verified` comes from the backend (owner, 2026-10-10). */
  function documentChanged(appId: string, document: StaffRiderDocument, message: string) {
    setRows((list) =>
      (list ?? []).map((a) =>
        a.id === appId ? { ...a, documents: (a.documents ?? []).map((d) => (d.id === document.id ? document : d)) } : a
      )
    );
    setNotice(message);
    void load(true);
  }

  async function reject(app: RiderApplication) {
    const text = reason.trim();
    if (!text) return;
    setBusy(true);
    try {
      await riderApplications.reject(app.id, text);
      setNotice(`${app.full_name ?? 'The application'} was rejected.`);
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      setRejecting(null);
      setError(errorMessage(err, 'Could not reject the application.'));
    } finally {
      setBusy(false);
    }
  }

  const viewingApp = viewing ? rows?.find((a) => a.id === viewing.appId) ?? null : null;
  const viewingSlot = viewingApp
    ? (documentSlots(viewingApp.documents, viewingApp.document_requirements).find(
        (s) => s.key === viewing?.key && s.document
      ) as (DocumentSlot & { document: StaffRiderDocument }) | undefined)
    : undefined;

  return (
    <div className="page">
      <PageHeader title="Rider requests" description="Riders apply in the Blynk Rider app. Approved riders get an SMS and sign in with their phone." />

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

      {notice ? (
        <div className="banner staff-notice" role="status">
          <p>{notice}</p>
          <button type="button" className="button button--ghost button--sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
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
        <ul className="cat-list" aria-label="Rider requests">
          {rows.map((app) => (
            <li key={app.id} className="cat-row cat-row--flat">
              <div className="cat-row__main">
                <p className="cat-row__title">{app.full_name ?? 'Rider'}</p>
                <p className="cat-row__meta">
                  <span className="mono">{readablePhone(app.phone)}</span>
                  {' · '}
                  {VEHICLE_LABEL[app.vehicle_type] ?? app.vehicle_type}
                  {app.vehicle_registration_number ? ` · ${app.vehicle_registration_number}` : ''}
                </p>
                {app.emergency_contact_phone ? (
                  <p className="cat-row__meta">Emergency: {readablePhone(app.emergency_contact_phone)}</p>
                ) : null}
                <p className="cat-row__meta">
                  Applied {app.applied_at ? formatDateTime(app.applied_at) : '—'}
                  {app.reviewed_at ? ` · Reviewed ${formatDateTime(app.reviewed_at)}` : ''}
                  {app.reviewed_by_name ? ` by ${app.reviewed_by_name}` : ''}
                </p>
                {app.rejection_reason ? <p className="cat-row__meta">Reason: {app.rejection_reason}</p> : null}
                {app.approval_status === 'APPROVED' && app.pay_type ? (
                  <p className="cat-row__meta">
                    <span className={`pay-tag pay-tag--${app.pay_type.toLowerCase()}`}>
                      {payModelLabel(app.pay_type, app.commission_percent, null, app.pay_model, null)}
                    </span>
                  </p>
                ) : null}
                {/* Rider documents (owner, 2026-10-10). */}
                <DocumentGrid
                  slots={documentSlots(app.documents, app.document_requirements)}
                  ariaLabel={`Documents of ${app.full_name ?? 'this rider'}`}
                  onOpen={(slot) => setViewing({ appId: app.id, key: slot.key })}
                />
                {status === 'PENDING' && app.documents_verified !== true ? (
                  <p className="rdoc-blocking">
                    {blockingLine(app.documents_blocking) ?? 'Verify the required documents before approving.'}
                  </p>
                ) : null}
              </div>
              {status === 'PENDING' ? (
                <div className="cat-row__actions">
                  <button
                    type="button"
                    className="button button--sm"
                    disabled={app.documents_verified !== true}
                    onClick={() => openApprove(app)}
                  >
                    Approve
                  </button>
                  {isAdmin && app.documents_verified !== true ? (
                    <button type="button" className="button button--sm button--ghost" onClick={() => openApprove(app, true)}>
                      Approve anyway…
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
                  <button type="button" className="button button--sm button--ghost" onClick={() => setDeleting(app)}>
                    Delete request
                  </button>
                </div>
              ) : status === 'REJECTED' ? (
                <div className="cat-row__actions">
                  <button type="button" className="button button--sm button--ghost" onClick={() => setDeleting(app)}>
                    Delete request
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {approving ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Approve this rider?">
          <div className="modal__panel">
            <h2 className="modal__title">Approve this rider?</h2>
            <p className="modal__message">
              {`${approving.full_name ?? 'This rider'} (${readablePhone(approving.phone)}) can then sign in to the Rider app and receive deliveries. They get an SMS.`}
            </p>
            <RiderPayFields
              draft={payDraft}
              onChange={(next) => {
                setPayDraft(next);
                setPayErrors({});
              }}
              defaults={payDefaults}
              errors={payErrors}
            />
            {/* Approve anyway (owner, 2026-10-10): ADMIN only, recorded with the reason. */}
            {isAdmin && approving.documents_verified !== true ? (
              <div className="rdoc-override">
                <div className="rdoc-override__head">
                  <span>Approve anyway</span>
                  <Switch label="Approve anyway" checked={override} onToggle={() => setOverride((v) => !v)} />
                </div>
                <p className="rdoc-override__warn">
                  {blockingLine(approving.documents_blocking, 'Not verified') ?? 'Some required documents are not verified.'}{' '}
                  Approving anyway is recorded with your name and reason.
                </p>
                {override ? (
                  <label className="field">
                    <span className="field__label">Reason (recorded)</span>
                    <textarea
                      className="input"
                      rows={2}
                      maxLength={REASON_MAX}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
            {approveError ? (
              <p className="field__error" role="alert">
                {approveError}
              </p>
            ) : null}
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setApproving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={isAdmin && override && approving.documents_verified !== true ? 'button button--danger' : 'button'}
                disabled={
                  busy ||
                  (approving.documents_verified !== true &&
                    !(isAdmin && override && overrideReason.trim().length >= OVERRIDE_REASON_MIN))
                }
                onClick={() => void approve(approving)}
              >
                {busy ? 'Approving…' : isAdmin && override && approving.documents_verified !== true ? 'Approve anyway' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejecting ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Reject rider request">
          <div className="modal__panel">
            <h2 className="modal__title">Reject {rejecting.full_name ?? 'this request'}?</h2>
            <label className="field">
              <span className="field__label">Reason (sent to the rider)</span>
              <textarea
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
          message={`${deleting.full_name ?? 'This rider'}'s request and every document they uploaded are deleted. The account stays, so they can apply again.`}
          confirmLabel="Delete request"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void removeRequest(deleting)}
        />
      ) : null}

      {viewingSlot && viewingApp ? (
        <DocumentViewer
          key={viewingSlot.document.id}
          slot={viewingSlot}
          ownerName={viewingApp.full_name}
          onClose={() => setViewing(null)}
          onChanged={(document, message) => documentChanged(viewingApp.id, document, message)}
        />
      ) : null}
    </div>
  );
}
