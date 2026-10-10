import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { riderDocuments, type RejectReason, type StaffRiderDocument } from '../api/riderDocuments';
import {
  DOC_STATUS_LABEL,
  REJECT_NOTE_MAX,
  REJECT_REASONS,
  documentActionError,
  expiryChip,
  formatDay,
  isPdf,
  statusTone,
  type DocItem,
} from '../lib/riderDocuments';
import { colomboDateKey } from '../lib/schedule';
import { DatePicker } from './DatePicker';
import { Spinner, useToast } from './ui';
import { useDocumentPage } from './usePrivateFile';
import './riderDocuments.css';

/**
 * Full-screen rider document viewer (owner, 2026-10-10). The page on the
 * left - zoom with the wheel, a pinch, the +/- buttons or a double-click,
 * drag to pan when zoomed, Front/Back for two-sided documents, arrows for
 * the rider's other documents - and the review on the right: Verify (with
 * the expiry date when the type needs one) or Reject with a preset reason.
 * Escape closes. Pages are private blobs (useDocumentPage), revoked on close.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});

export function DocumentViewer({
  items,
  index,
  riderName,
  onIndex,
  onClose,
  onChanged,
}: {
  /** Only items that have an uploaded document. */
  items: DocItem[];
  index: number;
  riderName?: string | null;
  onIndex(next: number): void;
  onClose(): void;
  /** After a verify/reject: the API's updated document (the parent refreshes). */
  onChanged(doc: StaffRiderDocument): void | Promise<void>;
}) {
  const toast = useToast();
  const [overrides, setOverrides] = useState<Record<string, StaffRiderDocument>>({});
  const item = items[Math.min(index, items.length - 1)];
  const doc = item?.doc ? (overrides[item.doc.id] && overrides[item.doc.id].updated_at >= item.doc.updated_at ? overrides[item.doc.id] : item.doc) : null;

  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Review form
  const [expiry, setExpiry] = useState('');
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'verify' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expiryError, setExpiryError] = useState(false);

  const docId = doc?.id ?? null;
  useEffect(() => {
    setPage(0);
    setReason(null);
    setNote('');
    setActionError(null);
    setExpiryError(false);
  }, [docId]);

  useEffect(() => {
    setExpiry(doc?.expiry_date ?? '');
  }, [docId, doc?.expiry_date]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);
  useEffect(resetZoom, [docId, page, resetZoom]);

  const pageMeta = doc?.pages.find((p) => p.index === page) ?? null;
  const pdf = isPdf(pageMeta?.content_type);
  const file = useDocumentPage(pageMeta ? docId : null, page, pageMeta?.uploaded_at ?? '', Boolean(pageMeta));

  const zoomTo = useCallback((next: number) => {
    const z = clampZoom(next);
    setZoom(z);
    if (z === 1) setPan({ x: 0, y: 0 });
  }, []);

  // Keyboard: Escape closes; +/- zoom; arrows move between documents (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (typing) return;
      if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z * 1.25));
      else if (e.key === '-') {
        setZoom((z) => {
          const n = clampZoom(z / 1.25);
          if (n === 1) setPan({ x: 0, y: 0 });
          return n;
        });
      } else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el || pdf) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const n = clampZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
        if (n === 1) setPan({ x: 0, y: 0 });
        return n;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pdf, file.url]);

  // Drag to pan (one pointer, zoomed) and pinch to zoom (two pointers).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: distance(), zoom };
    else if (zoom > 1) setDragging(true);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current && pinch.current.dist > 0) {
      zoomTo(pinch.current.zoom * (distance() / pinch.current.dist));
    } else if (pointers.current.size === 1 && zoom > 1) {
      setPan((p) => ({ x: p.x + (e.clientX - prev.x), y: p.y + (e.clientY - prev.y) }));
    }
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  }

  async function verify() {
    if (!doc || !item) return;
    if (item.needsExpiry && !expiry) {
      setExpiryError(true);
      setActionError('Enter the expiry date printed on the document, then verify.');
      return;
    }
    setBusy('verify');
    setActionError(null);
    setExpiryError(false);
    try {
      const updated = await riderDocuments.verify(doc.id, expiry || undefined);
      setOverrides((o) => ({ ...o, [updated.id]: updated }));
      toast.success(`${item.label} verified.`);
      await onChanged(updated);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EXPIRY_REQUIRED') setExpiryError(true);
      if (code === 'DOCUMENT_EXPIRED') setReason('EXPIRED');
      setActionError(documentActionError(err, 'Could not verify this document.'));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!doc || !item || !reason) return;
    const text = note.trim();
    if (reason === 'OTHER' && !text) {
      setActionError('Say what is wrong with the document.');
      return;
    }
    setBusy('reject');
    setActionError(null);
    try {
      const updated = await riderDocuments.reject(doc.id, reason, text || undefined);
      setOverrides((o) => ({ ...o, [updated.id]: updated }));
      toast.success(`${item.label} rejected. The rider is asked to upload it again.`);
      setReason(null);
      setNote('');
      await onChanged(updated);
    } catch (err) {
      setActionError(documentActionError(err, 'Could not reject this document.'));
    } finally {
      setBusy(null);
    }
  }

  if (!item || !doc) return null;
  const twoSided = doc.pages_needed === 2 || doc.pages.length > 1;
  const status = doc.status;
  const expiryInfo = expiryChip(doc.expiry_state);
  const noteRequired = reason === 'OTHER';
  const today = colomboDateKey();

  return createPortal(
    <div className="rd-viewer" role="dialog" aria-modal="true" aria-label={`${item.label} - document viewer`}>
      <div className="rd-viewer__main">
        <div className="rd-viewer__bar">
          <h2 className="rd-viewer__title">
            {item.label}
            {riderName ? <span style={{ fontWeight: 600, opacity: 0.7 }}> · {riderName}</span> : null}
          </h2>
          {items.length > 1 ? (
            <>
              <button type="button" className="rd-viewer__btn" aria-label="Previous document" disabled={index === 0} onClick={() => onIndex(index - 1)}>
                ‹
              </button>
              <span className="rd-viewer__zoom">
                {index + 1} / {items.length}
              </span>
              <button
                type="button"
                className="rd-viewer__btn"
                aria-label="Next document"
                disabled={index >= items.length - 1}
                onClick={() => onIndex(index + 1)}
              >
                ›
              </button>
            </>
          ) : null}
          {twoSided ? (
            <div role="group" aria-label="Page" style={{ display: 'flex', gap: 4 }}>
              {[0, 1].map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`rd-viewer__btn${page === p ? ' is-selected' : ''}`}
                  aria-pressed={page === p}
                  onClick={() => setPage(p)}
                >
                  {p === 0 ? 'Front' : 'Back'}
                </button>
              ))}
            </div>
          ) : null}
          {!pdf ? (
            <>
              <button type="button" className="rd-viewer__btn" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom / 1.25)}>
                −
              </button>
              <span className="rd-viewer__zoom" aria-label="Zoom level">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" className="rd-viewer__btn" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom * 1.25)}>
                +
              </button>
              {zoom > 1 ? (
                <button type="button" className="rd-viewer__btn" onClick={resetZoom}>
                  Fit
                </button>
              ) : null}
            </>
          ) : file.url ? (
            <a className="rd-viewer__btn" href={file.url} target="_blank" rel="noopener noreferrer">
              Open in new tab
            </a>
          ) : null}
          <button type="button" className="rd-viewer__btn" aria-label="Close viewer" onClick={onClose}>
            ✕
          </button>
        </div>
        <div
          ref={stage}
          className={`rd-viewer__stage${zoom > 1 ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
          onPointerDown={pdf ? undefined : onPointerDown}
          onPointerMove={pdf ? undefined : onPointerMove}
          onPointerUp={pdf ? undefined : onPointerUp}
          onPointerCancel={pdf ? undefined : onPointerUp}
          onDoubleClick={pdf ? undefined : () => (zoom > 1 ? resetZoom() : zoomTo(2.5))}
        >
          {!pageMeta ? (
            <div className="rd-viewer__empty">
              <strong>{page === 1 ? 'The back page is missing.' : 'No page uploaded.'}</strong>
              <span>Reject the document and ask the rider for {page === 1 ? 'a photo of the back' : 'a clear photo'}.</span>
            </div>
          ) : file.loading ? (
            <Spinner label="Loading the document" />
          ) : file.error ? (
            <div className="rd-viewer__empty" role="alert">
              {file.error}
            </div>
          ) : file.url && pdf ? (
            <iframe className="rd-viewer__pdf" src={file.url} title={`${item.label} (PDF)`} />
          ) : file.url ? (
            <img
              className="rd-viewer__img"
              src={file.url}
              alt={`${item.label}, ${page === 0 ? 'front' : 'back'}`}
              draggable={false}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            />
          ) : null}
        </div>
      </div>

      <aside className="rd-viewer__side" aria-label="Review">
        <div className="rd-tile__chips">
          {item.required ? <span className="rd-chip rd-chip--required">Required</span> : <span className="rd-chip rd-chip--soft">Optional</span>}
          <span className={`rd-chip rd-chip--${statusTone(status)}`} data-testid="viewer-status">
            {DOC_STATUS_LABEL[status]}
          </span>
          {expiryInfo ? <span className={`rd-chip rd-chip--${expiryInfo.tone}`}>{expiryInfo.label}</span> : null}
        </div>
        <dl className="rd-viewer__facts">
          {doc.expiry_date || item.needsExpiry ? (
            <>
              <dt>Expiry date</dt>
              <dd>{formatDay(doc.expiry_date)}</dd>
            </>
          ) : null}
          {doc.pages[0] ? (
            <>
              <dt>Uploaded</dt>
              <dd>{when.format(new Date(doc.pages[0].uploaded_at))}</dd>
            </>
          ) : null}
          {doc.reviewed_at ? (
            <>
              <dt>{status === 'REJECTED' ? 'Rejected' : 'Reviewed'}</dt>
              <dd>
                {when.format(new Date(doc.reviewed_at))}
                {doc.reviewed_by_name ? ` by ${doc.reviewed_by_name}` : ''}
              </dd>
            </>
          ) : null}
          {status === 'REJECTED' && doc.reject_reason_label ? (
            <>
              <dt>Reason</dt>
              <dd>
                {doc.reject_reason_label}
                {doc.reject_note ? ` - ${doc.reject_note}` : ''}
              </dd>
            </>
          ) : null}
        </dl>

        <section className="rd-viewer__section" aria-label="Verify">
          <h3>Verify</h3>
          {item.needsExpiry ? (
            <div className="field">
              <span className="field__label">Expiry date (as printed on the document)</span>
              <DatePicker
                label="Expiry date"
                value={expiry}
                today={today}
                invalid={expiryError}
                onChange={(next) => {
                  setExpiry(next);
                  setExpiryError(false);
                }}
              />
              {expiry && expiry < today ? <span className="field__error">This date has passed - the document is expired.</span> : null}
            </div>
          ) : null}
          <button type="button" className="button rd-button-verify" disabled={busy !== null} onClick={() => void verify()}>
            {busy === 'verify' ? 'Verifying…' : status === 'VERIFIED' ? 'Verify again ✓' : 'Verify ✓'}
          </button>
        </section>

        <section className="rd-viewer__section" aria-label="Reject">
          <h3>Reject</h3>
          <div className="rd-choices" role="group" aria-label="Reject reason">
            {REJECT_REASONS.map((r) => (
              <button
                key={r.reason}
                type="button"
                className={`rd-choice rd-choice--danger${reason === r.reason ? ' is-selected' : ''}`}
                aria-pressed={reason === r.reason}
                onClick={() => {
                  setReason(reason === r.reason ? null : r.reason);
                  setActionError(null);
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          {reason ? (
            <label className="field">
              <span className="field__label">{noteRequired ? 'What is wrong? (required)' : 'Note for the rider (optional)'}</span>
              <textarea
                className="input"
                rows={2}
                maxLength={REJECT_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="button button--danger"
            disabled={busy !== null || !reason || (noteRequired && !note.trim())}
            onClick={() => void reject()}
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </section>

        {actionError ? (
          <p className="rd-warning rd-warning--danger" role="alert">
            {actionError}
          </p>
        ) : null}
      </aside>
    </div>,
    document.body
  );
}
