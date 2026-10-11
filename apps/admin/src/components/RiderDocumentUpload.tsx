import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { riderDocuments, type StaffRiderDocument } from '../api/riderDocuments';
import {
  DOCUMENT_ACCEPT,
  DOC_STATUS_LABEL,
  documentFileProblem,
  expiryChip,
  fileSize,
  formatDay,
  isPdf,
  staffUploadError,
  statusTone,
  type DocItem,
} from '../lib/riderDocuments';
import { colomboDateKey } from '../lib/schedule';
import { DatePicker } from './DatePicker';
import { Spinner, useToast } from './ui';
import './riderDocuments.css';

/**
 * Staff upload rider documents themselves (owner, 2026-10-11: "Mainly I am
 * going to approve the drivers manually; they will send docs on WhatsApp" /
 * "Add a delivery rider and I upload the things"). "Choose file" and "Take
 * photo" (the camera on a phone or tablet) are the site's own buttons over
 * hidden file inputs; files are checked here (type, 8 MB) before upload.
 * A document staff upload counts as verified once every page (and the
 * expiry date, when needed) is in.
 */

export const PAGE_NAME = ['Front', 'Back'] as const;

/** "Choose file" + "Take photo" for one page (owner, 2026-10-11). */
export function FilePickButtons({
  name,
  onFile,
  replace = false,
  disabled = false,
  testId,
}: {
  /** Accessible context, e.g. "Insurance certificate, front". */
  name: string;
  onFile(file: File): void;
  /** A page is already there: "Replace file" / "Retake photo". */
  replace?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const choose = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picked = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  };
  return (
    <span className="rd-pick">
      <input
        ref={choose}
        type="file"
        accept={DOCUMENT_ACCEPT}
        hidden
        data-testid={testId ? `${testId}-file` : undefined}
        onChange={(e) => picked(e.currentTarget)}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid={testId ? `${testId}-camera` : undefined}
        onChange={(e) => picked(e.currentTarget)}
      />
      <button
        type="button"
        className="button button--ghost button--sm"
        disabled={disabled}
        aria-label={`${replace ? 'Replace file' : 'Choose file'}: ${name}`}
        onClick={() => choose.current?.click()}
      >
        {replace ? 'Replace file' : 'Choose file'}
      </button>
      <button
        type="button"
        className="button button--ghost button--sm"
        disabled={disabled}
        aria-label={`${replace ? 'Retake photo' : 'Take photo'}: ${name}`}
        onClick={() => camera.current?.click()}
      >
        {replace ? 'Retake photo' : 'Take photo'}
      </button>
    </span>
  );
}

/** An object URL for a local File (image preview), revoked when it changes. */
export function useLocalPreview(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || isPdf(file.type) || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(next);
    };
  }, [file]);
  return url;
}

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});

const typeName = (contentType: string) =>
  contentType === 'application/pdf' ? 'PDF' : contentType.replace(/^image\//, '').toUpperCase();

/**
 * Upload / replace / remove the pages of one document and set its expiry,
 * for a waiting applicant or an approved rider alike (owner, 2026-10-11).
 */
export function StaffDocumentDialog({
  riderId,
  item,
  riderName,
  onClose,
  onChanged,
}: {
  riderId: string;
  item: DocItem;
  riderName?: string | null;
  onClose(): void;
  /** After every change (the parent refreshes); null = the document is gone. */
  onChanged(doc: StaffRiderDocument | null): void | Promise<void>;
}) {
  const toast = useToast();
  const [doc, setDoc] = useState<StaffRiderDocument | null>(item.doc);
  const [expiry, setExpiry] = useState(item.doc?.expiry_date ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = colomboDateKey();

  const twoSided = item.needsBack || doc?.pages_needed === 2 || (doc?.pages.length ?? 0) > 1;
  const pages = twoSided ? [0, 1] : [0];
  const needsExpiry = item.needsExpiry || Boolean(doc?.expiry_date);
  const hasFront = Boolean(doc?.pages.some((p) => p.index === 0));

  // Escape closes this dialog first (the Documents panel stays open under it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(key: string, action: () => Promise<StaffRiderDocument | null>, done: (d: StaffRiderDocument | null) => string) {
    setBusy(key);
    setError(null);
    try {
      const updated = await action();
      setDoc(updated);
      if (updated) setExpiry(updated.expiry_date ?? '');
      toast.success(done(updated));
      await onChanged(updated);
    } catch (err) {
      setError(staffUploadError(err, 'Could not save this document.'));
    } finally {
      setBusy(null);
    }
  }

  function upload(page: number, file: File) {
    const problem = documentFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    if (expiry && expiry < today) {
      setError('That expiry date has passed, so the document is expired. Ask the rider for a current one.');
      return;
    }
    // The expiry travels with the front page (owner, 2026-10-11).
    const sendExpiry = page === 0 && needsExpiry && expiry ? expiry : undefined;
    void run(
      `upload-${page}`,
      () => riderDocuments.uploadPage(riderId, item.key, page, file, sendExpiry),
      (d) => `${item.label}: ${PAGE_NAME[page].toLowerCase()} uploaded${d?.status === 'VERIFIED' ? ' and verified' : ''}.`
    );
  }

  function remove(page: number) {
    void run(
      `remove-${page}`,
      () => riderDocuments.removePage(riderId, item.key, page),
      (d) => (d ? `${item.label}: ${PAGE_NAME[page].toLowerCase()} removed.` : `${item.label} removed.`)
    );
  }

  function saveExpiry() {
    if (expiry && expiry < today) {
      setError('That expiry date has passed, so the document is expired. Ask the rider for a current one.');
      return;
    }
    void run(
      'expiry',
      () => riderDocuments.setExpiry(riderId, item.key, expiry || null),
      (d) => (expiry ? `Expiry date saved${d?.status === 'VERIFIED' ? '; the document is verified' : ''}.` : 'Expiry date cleared.')
    );
  }

  const status = doc?.status ?? 'MISSING';
  const expiryInfo = expiryChip(doc?.expiry_state);
  const completeText = `${twoSided ? 'front and back' : 'the page'}${item.needsExpiry ? ' and the expiry date' : ''}`;

  return createPortal(
    <div className="modal rd-upload" role="dialog" aria-modal="true" aria-label={`Upload ${item.label}`}>
      <div className="modal__panel">
        <h2 className="modal__title">
          {item.label}
          {riderName ? <span className="cell__secondary"> · {riderName}</span> : null}
        </h2>
        <div className="rd-tile__chips">
          {item.required ? <span className="rd-chip rd-chip--required">Required</span> : <span className="rd-chip rd-chip--soft">Optional</span>}
          <span className={`rd-chip rd-chip--${statusTone(status)}`} data-testid="upload-status">
            {DOC_STATUS_LABEL[status]}
          </span>
          {expiryInfo ? <span className={`rd-chip rd-chip--${expiryInfo.tone}`}>{expiryInfo.label}</span> : null}
        </div>
        <p className="modal__message">
          A document you upload counts as verified as soon as {completeText} {twoSided || item.needsExpiry ? 'are' : 'is'} in. JPEG, PNG, WebP or PDF, up to
          8 MB.
        </p>

        {pages.map((page) => {
          const meta = doc?.pages.find((p) => p.index === page) ?? null;
          const name = `${item.label}, ${PAGE_NAME[page].toLowerCase()}`;
          const blocked = page === 1 && !hasFront;
          return (
            <div key={page} className="rd-page" role="group" aria-label={name}>
              <div className="rd-page__info">
                <strong>{PAGE_NAME[page]}</strong>
                <span className="cell__secondary">
                  {meta
                    ? `Uploaded ${when.format(new Date(meta.uploaded_at))} · ${typeName(meta.content_type)} · ${fileSize(meta.bytes)}`
                    : blocked
                      ? 'Upload the front first.'
                      : 'Not uploaded'}
                </span>
              </div>
              <div className="rd-page__actions">
                {busy === `upload-${page}` || busy === `remove-${page}` ? <Spinner label="Saving" /> : null}
                <FilePickButtons
                  name={name}
                  replace={Boolean(meta)}
                  disabled={busy !== null || blocked}
                  testId={`upload-${item.key}-${page}`}
                  onFile={(file) => upload(page, file)}
                />
                {meta ? (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    disabled={busy !== null}
                    aria-label={`Remove page: ${name}`}
                    onClick={() => remove(page)}
                  >
                    Remove page
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {needsExpiry ? (
          <div className="field">
            <span className="field__label">Expiry date (as printed on the document)</span>
            <div className="rd-expiry-row">
              <DatePicker label={`Expiry date: ${item.label}`} value={expiry} today={today} onChange={setExpiry} />
              {doc ? (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy !== null || expiry === (doc.expiry_date ?? '')}
                  onClick={saveExpiry}
                >
                  {busy === 'expiry' ? 'Saving…' : 'Save expiry date'}
                </button>
              ) : null}
            </div>
            {expiry && expiry < today ? (
              <span className="field__error">This date has passed - the document is expired.</span>
            ) : !doc ? (
              <span className="field__hint">Saved with the front page.</span>
            ) : doc.expiry_date ? (
              <span className="field__hint">Now {formatDay(doc.expiry_date)}.</span>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="rd-warning rd-warning--danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
