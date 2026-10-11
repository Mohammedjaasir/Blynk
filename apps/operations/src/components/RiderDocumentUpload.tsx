import { FileText, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { riderDocuments } from '../api/resources';
import type { StaffRiderDocument } from '../api/types';
import { formatDateTime } from '../lib/inventory';
import {
  DOCUMENT_FILE_ACCEPT,
  STATUS_LABEL,
  documentFileProblem,
  formatDay,
  isPdfFile,
  statusTone,
  uploadErrorMessage,
  type DocumentSlot,
} from '../lib/riderDocuments';
import { colomboDate } from '../lib/slots';
import { DatePicker } from './DatePicker';
import { ConfirmDialog, Status } from './ui';
import './rider-documents.css';

/**
 * Staff upload rider documents themselves (owner, 2026-10-11: "Mainly I am
 * going to approve the drivers manually; they will send docs on WhatsApp" /
 * "Add a delivery rider and I upload the things"). The app's own buttons
 * open the camera ("Take photo") or the file chooser ("Choose file") - the
 * native file inputs stay hidden. The backend strips GPS data, stores the
 * page privately and marks a complete staff upload VERIFIED.
 */

export const SIDE_LABEL = ['front', 'back'] as const;

/** "Take photo" + "Choose file" in the app's button style (owner, 2026-10-11). */
export function FilePickButtons({
  label,
  testId,
  disabled,
  onPick,
}: {
  /** e.g. "Driving licence front" - names the buttons for screen readers. */
  label: string;
  testId: string;
  disabled?: boolean;
  onPick(file: File): void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onPick(file);
  };
  return (
    <div className="rdoc-pick">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid={`${testId}-camera`}
        onChange={picked}
      />
      <input ref={fileRef} type="file" accept={DOCUMENT_FILE_ACCEPT} hidden data-testid={`${testId}-file`} onChange={picked} />
      <button
        type="button"
        className="button button--sm button--ghost"
        disabled={disabled}
        aria-label={`Take photo of ${label}`}
        onClick={() => cameraRef.current?.click()}
      >
        Take photo
      </button>
      <button
        type="button"
        className="button button--sm button--ghost"
        disabled={disabled}
        aria-label={`Choose file for ${label}`}
        onClick={() => fileRef.current?.click()}
      >
        Choose file
      </button>
    </div>
  );
}

/** A picked (not yet uploaded) file: a small preview or a PDF tile, the name, Remove. */
export function PickedFile({ file, label, onRemove }: { file: File; label: string; onRemove(): void }) {
  const pdf = isPdfFile(file);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (pdf) return;
    let made: string | null = null;
    try {
      made = URL.createObjectURL(file);
      setUrl(made);
    } catch {
      setUrl(null);
    }
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [file, pdf]);
  return (
    <div className="rdoc-picked">
      <span className="rdoc-picked__preview">
        {pdf ? (
          <span className="rdoc-thumb__pdf">
            <FileText size={16} aria-hidden="true" />
            PDF
          </span>
        ) : url ? (
          <img src={url} alt={`${label} preview`} />
        ) : null}
      </span>
      <span className="rdoc-picked__name">{file.name}</span>
      <button type="button" className="button button--sm button--ghost" aria-label={`Remove ${label}`} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

/** What a staff-uploaded document still needs before it counts as verified. */
export function stillNeeded(slot: Pick<DocumentSlot, 'needsBack' | 'needsExpiry'>, doc: StaffRiderDocument | null): string[] {
  const missing: string[] = [];
  const has = (i: number) => Boolean(doc?.pages.some((p) => p.index === i));
  if (!has(0)) missing.push('the front page');
  if (slot.needsBack && !has(1)) missing.push('the back page');
  if (slot.needsExpiry && !doc?.expiry_date) missing.push('the expiry date');
  return missing;
}

const joinAnd = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

function afterLine(label: string, slot: DocumentSlot, doc: StaffRiderDocument | null): string {
  if (!doc) return `${label} has no pages now.`;
  if (doc.status === 'VERIFIED') return `${label} is verified.`;
  const missing = stillNeeded(slot, doc);
  return missing.length > 0 ? `Add ${joinAnd(missing)} to verify it.` : 'It is waiting review.';
}

/**
 * Upload / replace / remove a document's pages and set its expiry date, for
 * a pending applicant or an approved rider alike (owner, 2026-10-11). Each
 * action is saved at once; the parent re-reads the rider's documents.
 */
export function DocumentUploadSheet({
  riderId,
  slot,
  ownerName,
  onClose,
  onChanged,
}: {
  riderId: string;
  slot: DocumentSlot;
  ownerName?: string | null;
  onClose(): void;
  onChanged(document: StaffRiderDocument | null, message: string): void;
}) {
  const today = colomboDate(new Date());
  const [doc, setDoc] = useState<StaffRiderDocument | null>(slot.document);
  const [expiry, setExpiry] = useState<string | null>(slot.document?.expiry_date ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  // A refreshed parent row wins over the local copy.
  useEffect(() => {
    setDoc(slot.document);
  }, [slot.document]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const has = (i: number) => Boolean(doc?.pages.some((p) => p.index === i));
  const pages = slot.needsBack || has(1) ? [0, 1] : [0];

  function done(next: StaffRiderDocument | null, first: string) {
    setDoc(next);
    if (next) setExpiry(next.expiry_date ?? null);
    const message = `${first} ${afterLine(slot.label, slot, next)}`;
    setNotice(message);
    onChanged(next, message);
  }

  async function upload(page: number, file: File) {
    setError(null);
    setNotice(null);
    const problem = documentFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    if (page === 1 && !has(0)) {
      setError('Upload the front page first, then the back.');
      return;
    }
    setBusy(`upload-${page}`);
    try {
      const sendExpiry = slot.needsExpiry && expiry ? expiry : undefined;
      const next = await riderDocuments.uploadPage(riderId, slot.key, page, file, sendExpiry);
      done(next, `${slot.label}: ${SIDE_LABEL[page]} page uploaded.`);
    } catch (err) {
      setError(uploadErrorMessage(err, `Could not upload the ${SIDE_LABEL[page]} page.`));
    } finally {
      setBusy(null);
    }
  }

  async function removePage(page: number) {
    setRemoving(null);
    setError(null);
    setNotice(null);
    setBusy(`remove-${page}`);
    try {
      const next = await riderDocuments.removePage(riderId, slot.key, page);
      done(next, `${slot.label}: ${SIDE_LABEL[page]} page removed.`);
    } catch (err) {
      setError(uploadErrorMessage(err, `Could not remove the ${SIDE_LABEL[page]} page.`));
    } finally {
      setBusy(null);
    }
  }

  async function saveExpiry() {
    setError(null);
    setNotice(null);
    setBusy('expiry');
    try {
      const next = await riderDocuments.setExpiry(riderId, slot.key, expiry);
      done(next, expiry ? `${slot.label}: expiry date saved (${formatDay(expiry)}).` : `${slot.label}: expiry date cleared.`);
    } catch (err) {
      setError(uploadErrorMessage(err, 'Could not save the expiry date.'));
    } finally {
      setBusy(null);
    }
  }

  const state = doc && doc.pages.length > 0 ? doc.status : 'MISSING';
  const expiryChanged = Boolean(doc) && (expiry ?? null) !== (doc?.expiry_date ?? null);

  return (
    <div className="modal rdoc-upload-modal" role="dialog" aria-modal="true" aria-label={`Upload ${slot.label}`}>
      <div className="modal__panel rdoc-upload">
        <div className="rdoc-sheet__head">
          <div>
            <h2 className="modal__title">Upload · {slot.label}</h2>
            {ownerName ? <p className="quiet">{ownerName}</p> : null}
          </div>
          <button type="button" className="rdoc-round" aria-label="Close upload" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="rdoc-viewer__status">
          <Status tone={statusTone(state, slot.required)}>{STATUS_LABEL[state]}</Status>
          {slot.required ? <span className="rdoc-required">Required</span> : null}
        </div>
        <p className="quiet">
          Photos or PDFs the rider sent (e.g. on WhatsApp). JPEG, PNG, WebP or PDF, up to 8 MB. A complete upload counts as
          verified by you.
        </p>

        {slot.needsExpiry ? (
          <div className="rdoc-upload__expiry">
            <DatePicker
              label="Expiry date"
              value={expiry}
              onChange={(next) => {
                setExpiry(next);
                setError(null);
              }}
              today={today}
              min={today}
              hint={doc ? 'As printed on the document.' : 'As printed on the document. Saved with the front page.'}
            />
            {expiryChanged ? (
              <button type="button" className="button button--sm" disabled={busy !== null} onClick={() => void saveExpiry()}>
                {busy === 'expiry' ? 'Saving…' : 'Save expiry date'}
              </button>
            ) : null}
          </div>
        ) : null}

        {pages.map((page) => {
          const info = doc?.pages.find((p) => p.index === page);
          const side = SIDE_LABEL[page];
          const sideTitle = page === 0 ? 'Front' : 'Back';
          return (
            <section key={page} className="rdoc-upload__page" aria-label={`${sideTitle} page`}>
              <div className="rdoc-upload__page-head">
                <p className="rdoc-upload__side">{sideTitle}</p>
                <p className="quiet">
                  {info ? `Uploaded ${formatDateTime(info.uploaded_at)}${info.content_type === 'application/pdf' ? ' (PDF)' : ''}` : 'Not uploaded'}
                </p>
              </div>
              {busy === `upload-${page}` ? <p className="quiet">Uploading…</p> : null}
              <div className="rdoc-upload__actions">
                <FilePickButtons
                  label={`${slot.label} ${side}`}
                  testId={`upload-${slot.key}-${page}`}
                  disabled={busy !== null || (page === 1 && !has(0))}
                  onPick={(file) => void upload(page, file)}
                />
                {info ? (
                  <button
                    type="button"
                    className="button button--sm button--ghost"
                    disabled={busy !== null}
                    aria-label={`Remove ${slot.label} ${side} page`}
                    onClick={() => setRemoving(page)}
                  >
                    Remove page
                  </button>
                ) : null}
              </div>
              {page === 1 && !has(0) ? <p className="quiet">Upload the front first.</p> : null}
            </section>
          );
        })}

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
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {removing !== null ? (
        <ConfirmDialog
          title={`Remove the ${SIDE_LABEL[removing]} page?`}
          message={`The ${SIDE_LABEL[removing]} page of ${slot.label} is deleted. You can upload it again.`}
          confirmLabel="Remove page"
          destructive
          onCancel={() => setRemoving(null)}
          onConfirm={() => void removePage(removing)}
        />
      ) : null}
    </div>
  );
}
