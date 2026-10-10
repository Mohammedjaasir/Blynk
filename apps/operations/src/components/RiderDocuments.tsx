import { Check, FileText, Minus, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { fetchPrivateFile } from '../api/client';
import { riderDocumentPagePath, riderDocuments } from '../api/resources';
import type { RiderDocumentRejectReason, RiderDocumentsForRider, StaffRiderDocument } from '../api/types';
import {
  REJECT_NOTE_MAX,
  REJECT_REASONS,
  STATUS_LABEL,
  blockingLine,
  documentErrorMessage,
  documentSlots,
  expiryChip,
  formatDay,
  statusTone,
  type DocumentSlot,
} from '../lib/riderDocuments';
import { formatDateTime } from '../lib/inventory';
import { colomboDate } from '../lib/slots';
import { DatePicker } from './DatePicker';
import { Spinner, Status } from './ui';
import './rider-documents.css';

/**
 * Rider documents for staff (owner, 2026-10-10: "Ops and Admin verify them
 * before approval"). Thumbnails, a full-screen viewer with zoom and the
 * per-document Verify / Reject actions, shared by Rider requests and the
 * Riders list. The files are PRIVATE: every page is fetched with the
 * staff token (`fetchPrivateFile`), shown from an object URL and revoked on
 * unmount - never cached, never a public URL.
 */

/** A private page as an object URL for as long as the caller is mounted (owner, 2026-10-10). */
export function usePrivateFile(path: string | null) {
  const [state, setState] = useState<{ url: string | null; type: string | null; error: string | null; loading: boolean }>({
    url: null,
    type: null,
    error: null,
    loading: Boolean(path),
  });
  useEffect(() => {
    if (!path) {
      setState({ url: null, type: null, error: null, loading: false });
      return;
    }
    let live = true;
    let url: string | null = null;
    const controller = new AbortController();
    setState({ url: null, type: null, error: null, loading: true });
    fetchPrivateFile(path, { signal: controller.signal })
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setState({ url, type: blob.type || null, error: null, loading: false });
      })
      .catch((err) => {
        if (live) setState({ url: null, type: null, error: documentErrorMessage(err, 'Could not load this page.'), loading: false });
      });
    return () => {
      live = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return state;
}

/** The app's styled on/off switch (same look as Opening hours). */
export function Switch({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle(): void;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={onToggle}>
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
}

const isPdf = (contentType: string | undefined) => contentType === 'application/pdf';

function Thumb({ document, label }: { document: StaffRiderDocument; label: string }) {
  const front = document.pages.find((p) => p.index === 0) ?? document.pages[0];
  const pdf = isPdf(front?.content_type);
  const file = usePrivateFile(front && !pdf ? riderDocumentPagePath(document.id, front.index) : null);
  if (pdf) {
    return (
      <span className="rdoc-thumb__pdf">
        <FileText size={22} aria-hidden="true" />
        PDF
      </span>
    );
  }
  if (file.url) return <img src={file.url} alt={`${label} front`} />;
  if (file.error) return <span className="rdoc-thumb__note">Could not load</span>;
  return <span className="rdoc-thumb__loading" aria-label={`Loading ${label}`} />;
}

/** The documents of one rider as tiles: thumbnail, status, Required, expiry. */
export function DocumentGrid({
  slots,
  ariaLabel,
  onOpen,
}: {
  slots: DocumentSlot[];
  ariaLabel: string;
  onOpen(slot: DocumentSlot): void;
}) {
  if (slots.length === 0) return <p className="quiet">No documents are asked for this vehicle type.</p>;
  return (
    <ul className="rdoc-grid" aria-label={ariaLabel}>
      {slots.map((slot) => {
        const doc = slot.document;
        const hasPages = Boolean(doc && doc.pages.length > 0);
        const chip = expiryChip(doc?.expiry_state ?? null);
        return (
          <li key={slot.key} className="rdoc-tile" data-state={slot.state.toLowerCase()}>
            {hasPages && doc ? (
              <button type="button" className="rdoc-thumb" aria-label={`Open ${slot.label}`} onClick={() => onOpen(slot)}>
                <Thumb document={doc} label={slot.label} />
                {doc.pages.length > 1 ? <span className="rdoc-thumb__pages">{doc.pages.length} pages</span> : null}
              </button>
            ) : (
              <span className="rdoc-thumb rdoc-thumb--missing">Not uploaded</span>
            )}
            <p className="rdoc-tile__label">
              {slot.label}
              {slot.required ? <span className="rdoc-required">Required</span> : null}
            </p>
            <Status tone={statusTone(slot.state, slot.required)}>{STATUS_LABEL[slot.state]}</Status>
            {doc?.expiry_date ? (
              <p className="rdoc-tile__expiry">
                Expires {formatDay(doc.expiry_date)}
                {chip ? <Status tone={chip.tone}>{chip.text}</Status> : null}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clampZoom = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));

/** A zoomable page: pinch, double-tap, +/- buttons; drag to pan when zoomed. */
function ZoomStage({ url, alt }: { url: string; alt: string }) {
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; s: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastTap = useRef(0);

  function clampPan(s: number, x: number, y: number) {
    const rect = stage.current?.getBoundingClientRect();
    const maxX = rect ? (rect.width * (s - 1)) / 2 : 0;
    const maxY = rect ? (rect.height * (s - 1)) / 2 : 0;
    return { s, x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }

  function zoomTo(next: number) {
    setZ((prev) => {
      const s = clampZoom(next);
      return s === 1 ? { s: 1, x: 0, y: 0 } : clampPan(s, prev.x, prev.y);
    });
  }

  const toggleZoom = () => zoomTo(z.s > 1 ? 1 : 2.5);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinch.current = { dist: distance(), s: z.s };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y };
    }
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      zoomTo((pinch.current.s * distance()) / pinch.current.dist);
    } else if (drag.current && z.s > 1) {
      const d = drag.current;
      setZ((prev) => clampPan(prev.s, d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y)));
    }
  }
  function up(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      const moved = drag.current ? Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) : 0;
      drag.current = null;
      // A touch double-tap (mouse uses onDoubleClick).
      if (e.pointerType !== 'mouse' && moved < 10) {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          toggleZoom();
          lastTap.current = 0;
        } else lastTap.current = now;
      }
    }
  }

  return (
    <>
      <div
        ref={stage}
        className={`rdoc-stage${z.s > 1 ? ' is-zoomed' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={toggleZoom}
      >
        <img
          src={url}
          alt={alt}
          draggable={false}
          style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})` }}
        />
      </div>
      <div className="rdoc-zoom" role="group" aria-label="Zoom">
        <button type="button" className="rdoc-round" aria-label="Zoom out" disabled={z.s <= MIN_ZOOM} onClick={() => zoomTo(z.s - 0.5)}>
          <Minus size={18} aria-hidden="true" />
        </button>
        <span className="rdoc-zoom__value" aria-live="polite">
          {Math.round(z.s * 100)}%
        </span>
        <button type="button" className="rdoc-round" aria-label="Zoom in" disabled={z.s >= MAX_ZOOM} onClick={() => zoomTo(z.s + 0.5)}>
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

function PageView({ document, page, label }: { document: StaffRiderDocument; page: number; label: string }) {
  const info = document.pages.find((p) => p.index === page);
  const file = usePrivateFile(info ? riderDocumentPagePath(document.id, page) : null);
  const side = page === 0 ? 'front' : 'back';
  if (!info) return <p className="rdoc-viewer__note">The {side} page was not uploaded.</p>;
  if (file.error) return <p className="rdoc-viewer__note">{file.error}</p>;
  if (!file.url) return <Spinner label={`Loading ${label} ${side}`} />;
  if (isPdf(info.content_type) || file.type === 'application/pdf') {
    return (
      <div className="rdoc-viewer__pdf">
        <FileText size={48} aria-hidden="true" />
        <p>
          {label} ({side}) is a PDF.
        </p>
        <a className="button" href={file.url} target="_blank" rel="noopener noreferrer">
          Open PDF
        </a>
      </div>
    );
  }
  return <ZoomStage key={file.url} url={file.url} alt={`${label} ${side}`} />;
}

/**
 * Full screen: the page (Front / Back), zoom, and Verify / Reject (owner,
 * 2026-10-10). After an action the parent gets the updated document and
 * refreshes its row; the viewer stays open on the new status.
 */
export function DocumentViewer({
  slot,
  ownerName,
  onClose,
  onChanged,
}: {
  slot: DocumentSlot & { document: StaffRiderDocument };
  ownerName?: string | null;
  onClose(): void;
  onChanged(document: StaffRiderDocument, message: string): void;
}) {
  const doc = slot.document;
  const today = colomboDate(new Date());
  const [page, setPage] = useState(0);
  const [expiry, setExpiry] = useState<string | null>(doc.expiry_date);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RiderDocumentRejectReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const twoSided = doc.pages_needed === 2 || doc.pages.some((p) => p.index === 1);
  const chip = expiryChip(doc.expiry_state);

  async function verify() {
    setError(null);
    setExpiryError(null);
    if (slot.needsExpiry && !expiry) {
      setExpiryError('Pick the expiry date printed on the document first.');
      return;
    }
    setBusy(true);
    try {
      const sendExpiry = expiry && expiry !== doc.expiry_date ? expiry : slot.needsExpiry ? expiry : undefined;
      const updated = await riderDocuments.verify(doc.id, sendExpiry ?? undefined);
      setNotice(`${slot.label} is verified.`);
      onChanged(updated, `${slot.label} verified.`);
    } catch (err) {
      const message = documentErrorMessage(err, 'Could not verify this document.');
      if ((err as { code?: string })?.code === 'EXPIRY_REQUIRED') setExpiryError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setError(null);
    if (!reason) {
      setError('Pick a reason first.');
      return;
    }
    const text = note.trim();
    if (reason === 'OTHER' && !text) {
      setError('Say what is wrong with the document.');
      return;
    }
    setBusy(true);
    try {
      const updated = await riderDocuments.reject(doc.id, reason, text || undefined);
      setNotice(`${slot.label} was rejected. The rider is asked to upload it again.`);
      setRejecting(false);
      setReason(null);
      setNote('');
      onChanged(updated, `${slot.label} rejected.`);
    } catch (err) {
      setError(documentErrorMessage(err, 'Could not reject this document.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rdoc-viewer" role="dialog" aria-modal="true" aria-label={slot.label}>
      <header className="rdoc-viewer__bar">
        <div className="rdoc-viewer__heading">
          <p className="rdoc-viewer__title">{slot.label}</p>
          {ownerName ? <p className="rdoc-viewer__sub">{ownerName}</p> : null}
        </div>
        <button type="button" className="rdoc-round rdoc-round--light" aria-label="Close" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {twoSided ? (
        <div className="segmented segmented--sm rdoc-viewer__pages" role="group" aria-label="Page">
          {[0, 1].map((p) => (
            <button
              key={p}
              type="button"
              className={p === page ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={p === page}
              onClick={() => setPage(p)}
            >
              {p === 0 ? 'Front' : 'Back'}
            </button>
          ))}
        </div>
      ) : null}

      <div className="rdoc-viewer__body">
        <PageView key={page} document={doc} page={page} label={slot.label} />
      </div>

      <section className="rdoc-viewer__panel" aria-label="Review">
        <div className="rdoc-viewer__status">
          <Status tone={statusTone(slot.state, slot.required)}>{STATUS_LABEL[slot.state]}</Status>
          {slot.required ? <span className="rdoc-required">Required</span> : null}
          {doc.expiry_date ? (
            <span className="rdoc-viewer__meta">
              Expires {formatDay(doc.expiry_date)} {chip ? <Status tone={chip.tone}>{chip.text}</Status> : null}
            </span>
          ) : null}
        </div>
        {doc.reviewed_at ? (
          <p className="rdoc-viewer__meta">
            {doc.status === 'VERIFIED' ? 'Verified' : doc.status === 'REJECTED' ? 'Rejected' : 'Reviewed'} {formatDateTime(doc.reviewed_at)}
            {doc.reviewed_by_name ? ` by ${doc.reviewed_by_name}` : ''}
          </p>
        ) : null}
        {doc.status === 'REJECTED' && doc.reject_reason_label ? (
          <p className="rdoc-viewer__meta">
            Reason: {doc.reject_reason_label}
            {doc.reject_note ? ` - ${doc.reject_note}` : ''}
          </p>
        ) : null}

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

        {!rejecting ? (
          <>
            {slot.needsExpiry ? (
              <DatePicker
                label="Expiry date"
                value={expiry}
                onChange={(next) => {
                  setExpiry(next);
                  setExpiryError(null);
                }}
                today={today}
                min={today}
                hint="As printed on the document."
                error={expiryError}
              />
            ) : null}
            <div className="rdoc-viewer__actions">
              <button type="button" className="button button--ghost" disabled={busy} onClick={() => setRejecting(true)}>
                Reject
              </button>
              <button type="button" className="button button--ink rdoc-verify" disabled={busy} onClick={() => void verify()}>
                <Check size={18} aria-hidden="true" />
                {busy ? 'Saving…' : doc.status === 'VERIFIED' ? 'Verify again' : 'Verify'}
              </button>
            </div>
          </>
        ) : (
          <div className="rdoc-reject">
            <p className="field__label" id="rdoc-reject-reason">
              Why is it rejected?
            </p>
            <div className="specialty-chips" role="group" aria-labelledby="rdoc-reject-reason">
              {REJECT_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={r.id === reason ? 'specialty-chip is-selected' : 'specialty-chip'}
                  aria-pressed={r.id === reason}
                  onClick={() => {
                    setReason(r.id);
                    setError(null);
                  }}
                >
                  {r.text}
                </button>
              ))}
            </div>
            <label className="field">
              <span className="field__label">{reason === 'OTHER' ? 'Note for the rider (required)' : 'Note for the rider (optional)'}</span>
              <textarea
                className="input"
                rows={2}
                maxLength={REJECT_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="rdoc-viewer__actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => {
                  setRejecting(false);
                  setError(null);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={busy || !reason || (reason === 'OTHER' && !note.trim())}
                onClick={() => void reject()}
              >
                {busy ? 'Saving…' : 'Reject document'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * An approved (or any) rider's documents in a sheet (owner, 2026-10-10:
 * Riders list -> Documents), so a renewed insurance can be re-verified.
 */
export function RiderDocumentsSheet({ riderId, name, onClose, onChanged }: { riderId: string; name: string; onClose(): void; onChanged?(): void }) {
  const [data, setData] = useState<RiderDocumentsForRider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  async function load() {
    try {
      setData(await riderDocuments.forRider(riderId));
      setError(null);
    } catch (err) {
      setError(documentErrorMessage(err, 'Could not load this rider’s documents.'));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riderId]);

  const slots = data ? documentSlots(data.documents, data.requirements) : [];
  const open = slots.find((s) => s.key === openKey && s.document);
  const missingNote = data ? blockingLine(data.blocking, 'Still to verify') : null;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Documents of ${name}`}>
      <div className="modal__panel modal__panel--wide rdoc-sheet">
        <div className="rdoc-sheet__head">
          <h2 className="modal__title">Documents · {name}</h2>
          <button type="button" className="rdoc-round" aria-label="Close documents" onClick={onClose}>
            <X size={18} aria-hidden="true" />
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
        {!data && !error ? <Spinner label="Loading documents" /> : null}
        {data ? (
          <>
            {data.all_required_verified ? (
              <p className="quiet quiet--ok">All required documents are verified.</p>
            ) : missingNote ? (
              <p className="rdoc-blocking">{missingNote}</p>
            ) : null}
            <DocumentGrid slots={slots} ariaLabel={`Documents of ${name}`} onOpen={(s) => setOpenKey(s.key)} />
          </>
        ) : null}
      </div>
      {open && open.document ? (
        <DocumentViewer
          key={open.document.id}
          slot={open as DocumentSlot & { document: StaffRiderDocument }}
          ownerName={name}
          onClose={() => setOpenKey(null)}
          onChanged={(_doc, message) => {
            setNotice(message);
            void load();
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
