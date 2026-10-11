import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  riderDocuments,
  type RiderDocumentAlert,
  type RiderDocumentRequirement,
  type RiderDocumentsForRider,
  type StaffRiderDocument,
} from '../api/riderDocuments';
import { errorMessage } from '../lib/apiErrors';
import {
  DOC_STATUS_LABEL,
  alertBadge,
  blockingText,
  documentItems,
  expiryChip,
  formatDay,
  isPdf,
  statusTone,
  type DocItem,
} from '../lib/riderDocuments';
import { DocumentViewer } from './DocumentViewer';
import { StaffDocumentDialog } from './RiderDocumentUpload';
import { Spinner } from './ui';
import { useDocumentPage } from './usePrivateFile';
import './riderDocuments.css';

/**
 * Rider documents review (owner, 2026-10-10: "Ops and Admin verify them
 * before approval; give all the options to control to ops and admin").
 * A strip of thumbnails - status chip, Required marker, expiry warning -
 * that opens the full-screen DocumentViewer; the Documents panel for an
 * approved rider (a renewed insurance can be re-verified); and the
 * expiring-documents badge from GET /admin/rider-documents/alerts.
 *
 * Staff upload (owner, 2026-10-11: riders send their documents on
 * WhatsApp): with a `riderId`, every tile has an Upload / Replace button
 * that opens StaffDocumentDialog - front/back pages, remove a page, the
 * expiry date - for waiting applicants and approved riders alike.
 */

function DocumentTile({ item, onOpen, onUpload }: { item: DocItem; onOpen(): void; onUpload?(): void }) {
  const doc = item.doc;
  const front = doc?.pages.find((p) => p.index === 0) ?? null;
  const pdf = isPdf(front?.content_type);
  // Images load as private blobs; a PDF shows a styled tile (it opens in the viewer).
  const file = useDocumentPage(doc && front && !pdf ? doc.id : null, 0, front?.uploaded_at ?? '', Boolean(doc && front && !pdf));
  const expiry = expiryChip(doc?.expiry_state);
  const pages = doc?.pages.length ?? 0;

  return (
    <div className="rd-tile" data-testid={`doc-tile-${item.key}`}>
      {doc ? (
        <button type="button" className="rd-tile__open" aria-label={`Open ${item.label}`} onClick={onOpen}>
          {pdf ? (
            <span className="rd-pdf" aria-hidden="true">
              PDF
              <small>Tap to open</small>
            </span>
          ) : file.url ? (
            <img src={file.url} alt="" />
          ) : file.loading ? (
            <Spinner label={`Loading ${item.label}`} />
          ) : (
            <span className="thumb__empty">{file.error ? 'Could not load' : 'No page'}</span>
          )}
          {doc.pages_needed === 2 ? <span className="rd-tile__pages">{pages}/2</span> : null}
        </button>
      ) : (
        <span className="rd-tile__open rd-tile__open--missing" aria-label={`${item.label} not uploaded`}>
          Not uploaded
        </span>
      )}
      <span className="rd-tile__label">{item.label}</span>
      <span className="rd-tile__chips">
        <span className={`rd-chip rd-chip--${statusTone(item.status)}`}>{DOC_STATUS_LABEL[item.status]}</span>
        {item.required ? <span className="rd-chip rd-chip--required">Required</span> : null}
        {expiry ? <span className={`rd-chip rd-chip--${expiry.tone}`}>{expiry.label}</span> : null}
      </span>
      {doc?.expiry_date ? <span className="rd-tile__meta">Expires {formatDay(doc.expiry_date)}</span> : null}
      {doc?.status === 'REJECTED' && doc.reject_reason_label ? (
        <span className="rd-tile__meta">Rejected: {doc.reject_reason_label}</span>
      ) : null}
      {onUpload ? (
        <button
          type="button"
          className="button button--ghost button--sm rd-tile__upload"
          aria-label={`${doc ? 'Replace' : 'Upload'} ${item.label}`}
          onClick={onUpload}
        >
          {doc ? 'Replace' : 'Upload'}
        </button>
      ) : null}
    </div>
  );
}

/** Thumbnails for one rider plus the viewer they open. */
export function RiderDocumentsReview({
  documents,
  requirements,
  riderName,
  riderId,
  onChanged,
}: {
  documents?: StaffRiderDocument[];
  requirements?: RiderDocumentRequirement[];
  riderName?: string | null;
  /** riders.id: shows the staff Upload / Replace buttons (owner, 2026-10-11). */
  riderId?: string;
  /** Refresh after a verify / reject. */
  onChanged(): void | Promise<void>;
}) {
  const items = useMemo(() => documentItems(documents, requirements), [documents, requirements]);
  const viewable = useMemo(() => items.filter((i) => i.doc), [items]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openIndex = openKey ? viewable.findIndex((i) => i.key === openKey) : -1;
  const [uploadKey, setUploadKey] = useState<string | null>(null);
  const uploadItem = uploadKey ? items.find((i) => i.key === uploadKey) ?? null : null;

  if (items.length === 0) return <span className="cell__secondary">No documents</span>;

  return (
    <>
      <div className="rd-strip" aria-label={`Documents${riderName ? ` of ${riderName}` : ''}`}>
        {items.map((item) => (
          <DocumentTile
            key={item.key}
            item={item}
            onOpen={() => setOpenKey(item.key)}
            onUpload={riderId ? () => setUploadKey(item.key) : undefined}
          />
        ))}
      </div>
      {openIndex >= 0 ? (
        <DocumentViewer
          items={viewable}
          index={openIndex}
          riderName={riderName}
          riderId={riderId}
          onIndex={(i) => setOpenKey(viewable[i]?.key ?? null)}
          onClose={() => setOpenKey(null)}
          onChanged={() => onChanged()}
        />
      ) : null}
      {uploadItem && riderId ? (
        <StaffDocumentDialog
          riderId={riderId}
          item={uploadItem}
          riderName={riderName}
          onClose={() => setUploadKey(null)}
          onChanged={() => onChanged()}
        />
      ) : null}
    </>
  );
}

/** Documents of an approved (or any) rider, from GET /admin/riders/:riderId/documents. */
export function RiderDocumentsPanel({
  riderId,
  riderName,
  onClose,
  onChanged,
}: {
  riderId: string;
  riderName?: string | null;
  onClose(): void;
  onChanged?(): void;
}) {
  const [data, setData] = useState<RiderDocumentsForRider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await riderDocuments.forRider(riderId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the documents.'));
    }
  }, [riderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the panel - unless the viewer is open on top (it closes first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.rd-viewer, .rd-upload')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = data?.rider.full_name ?? riderName ?? 'Rider';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Documents: ${name}`}>
      <div className="modal__panel modal__panel--wide">
        <h2 className="modal__title">Documents · {name}</h2>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : !data ? (
          <Spinner label="Loading documents" />
        ) : (
          <>
            {data.approval_needs_documents === false ? (
              // Settings -> "Documents needed before approval" is off (owner, 2026-10-11).
              <p className="modal__message">Documents are not needed for approval (Settings, Rider documents).</p>
            ) : data.all_required_verified ? (
              <p className="modal__message">Every required document is verified.</p>
            ) : (
              <p className="rd-warning">Not verified yet: {blockingText(data.blocking)}.</p>
            )}
            <RiderDocumentsReview
              documents={data.documents}
              requirements={data.requirements}
              riderName={name}
              riderId={riderId}
              onChanged={async () => {
                await load();
                onChanged?.();
              }}
            />
          </>
        )}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Expired / expiring documents of approved riders, keyed by rider id. Fails quietly. */
export function useRiderDocumentAlerts(enabled = true): {
  byRider: Map<string, RiderDocumentAlert[]>;
  reload(): void;
} {
  const [alerts, setAlerts] = useState<RiderDocumentAlert[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    riderDocuments
      .alerts()
      .then((d) => live && setAlerts(Array.isArray(d?.alerts) ? d.alerts : []))
      .catch(() => live && setAlerts([]));
    return () => {
      live = false;
    };
  }, [enabled, tick]);
  const byRider = useMemo(() => {
    const map = new Map<string, RiderDocumentAlert[]>();
    for (const a of alerts) map.set(a.rider_id, [...(map.get(a.rider_id) ?? []), a]);
    return map;
  }, [alerts]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { byRider, reload };
}

/** "Insurance expired" (red), "Insurance expiring soon" (amber), or a softer one for other documents. */
export function DocumentAlertBadge({ alerts }: { alerts?: RiderDocumentAlert[] }) {
  const badge = alertBadge(alerts);
  if (!badge) return null;
  const detail = (alerts ?? []).map((a) => `${a.label}: ${a.expiry_state === 'EXPIRED' ? 'expired' : 'expires'} ${formatDay(a.expiry_date)}`).join('; ');
  return (
    <span className={`rd-chip rd-chip--${badge.tone}`} title={detail}>
      {badge.label}
    </span>
  );
}
