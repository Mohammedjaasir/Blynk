import { Camera, CircleAlert, CircleCheck, Clock, FileText, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { applicantApi, type RiderDocument, type RiderDocumentType } from '../api/applicant';
import { DocumentFileError, isPdf, prepareDocumentFile } from '../lib/document-image';
import { errorMessage } from '../lib/errors';
import { DatePicker, formatDay } from './DatePicker';

/**
 * One document in the application (owner, 2026-10-10): its pages (front,
 * and back when asked; any document may have a second page), each taken
 * with the camera or chosen from the gallery, uploaded at once with a
 * progress bar, and retaken or removed. An optional expiry date. When Ops
 * rejected it: which reason, their note, and "upload it again" - which puts
 * it back to "waiting for review".
 */

export type DocumentTypeFor = RiderDocumentType & { required: boolean };

const STATUS_TEXT: Record<RiderDocument['status'], string> = {
  PENDING: 'Waiting for review',
  VERIFIED: 'Verified',
  REJECTED: 'Not accepted',
};

export function DocumentCard({
  type,
  doc,
  onChange,
  showStatus,
}: {
  type: DocumentTypeFor;
  doc: RiderDocument | undefined;
  /** The document after a change (null when its last page was removed). */
  onChange(doc: RiderDocument | null): void;
  /** Show Ops' review (after the application was sent). */
  showStatus: boolean;
}) {
  const [pendingExpiry, setPendingExpiry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingExpiry, setSavingExpiry] = useState(false);
  const pages = doc?.pages ?? [];
  const slots = type.needs_back || pages.length >= 1 ? 2 : 1;
  const complete = !!doc && pages.length >= (type.needs_back ? 2 : 1);
  const rejected = doc?.status === 'REJECTED';

  async function changeExpiry(next: string | null) {
    setError(null);
    if (!doc) {
      // Sent with the first page.
      setPendingExpiry(next);
      return;
    }
    setSavingExpiry(true);
    try {
      onChange(await applicantApi.setExpiry(type.key, next));
    } catch (err) {
      setError(errorMessage(err, 'Could not save the expiry date.'));
    } finally {
      setSavingExpiry(false);
    }
  }

  let tag: { text: string; tone: string; icon: JSX.Element };
  if (showStatus && doc) {
    tag = {
      text: STATUS_TEXT[doc.status],
      tone: doc.status === 'VERIFIED' ? 'done' : doc.status === 'REJECTED' ? 'stop' : 'wait',
      icon: doc.status === 'VERIFIED' ? <CircleCheck size={16} /> : doc.status === 'REJECTED' ? <CircleAlert size={16} /> : <Clock size={16} />,
    };
  } else if (complete) {
    tag = { text: 'Uploaded', tone: 'done', icon: <CircleCheck size={16} /> };
  } else {
    tag = { text: type.required ? 'Required' : 'Optional', tone: type.required ? 'need' : 'opt', icon: <FileText size={16} /> };
  }

  return (
    <section className={`doc-card${rejected ? ' doc-card--rejected' : ''}`} aria-label={type.label}>
      <header className="doc-card__head">
        <h3 className="doc-card__title">{type.label}</h3>
        <span className={`doc-tag doc-tag--${tag.tone}`}>
          {tag.icon}
          {tag.text}
        </span>
      </header>
      {type.required && !complete ? (
        <p className="doc-card__hint">{type.needs_back ? 'Photo of the front and the back.' : 'A clear photo of the whole page.'}</p>
      ) : null}

      {rejected ? (
        <div className="doc-card__rejected" role="alert">
          <p className="doc-card__rejected-title">Ops couldn't accept this: {doc!.reject_reason_label ?? 'see the note'}</p>
          {doc!.reject_note ? <p className="doc-card__rejected-note">“{doc!.reject_note}”</p> : null}
          <p>Upload it again below - it goes back for review.</p>
        </div>
      ) : null}

      <div className="doc-card__pages">
        {Array.from({ length: slots }, (_, index) => (
          <PageSlot
            key={`${index}-${pages[index]?.uploaded_at ?? 'empty'}`}
            docType={type.key}
            index={index}
            label={index === 0 ? 'Front' : type.needs_back ? 'Back' : 'Second page (optional)'}
            page={pages[index]}
            canAdd={index <= pages.length}
            expiryForFirstUpload={doc ? undefined : pendingExpiry}
            onUploaded={(next) => {
              setPendingExpiry(null);
              onChange(next);
            }}
            onRemoved={onChange}
          />
        ))}
      </div>

      {type.needs_expiry ? (
        <DatePicker
          label={`Expiry date${type.required ? '' : ' (optional)'}`}
          value={doc ? doc.expiry_date : pendingExpiry}
          onChange={(next) => void changeExpiry(next)}
          disabled={savingExpiry}
          placeholder="Add the expiry date (optional)"
          hint={
            doc?.expiry_state === 'EXPIRED'
              ? 'This date has passed - upload a current document.'
              : doc?.expiry_state === 'EXPIRING'
                ? `Expires soon (${formatDay(doc.expiry_date)}).`
                : undefined
          }
        />
      ) : null}

      {error ? (
        <p className="doc-card__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** One page: empty (camera / gallery), uploading (progress), or uploaded (preview, retake, remove). */
function PageSlot({
  docType,
  index,
  label,
  page,
  canAdd,
  expiryForFirstUpload,
  onUploaded,
  onRemoved,
}: {
  docType: string;
  index: number;
  label: string;
  page: RiderDocument['pages'][number] | undefined;
  canAdd: boolean;
  expiryForFirstUpload: string | null | undefined;
  onUploaded(doc: RiderDocument): void;
  onRemoved(doc: RiderDocument | null): void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const ids = { camera: useId(), gallery: useId() };
  const [progress, setProgress] = useState<number | null>(null); // null = idle; -1 = working, unknown %
  const [localPreview, setLocalPreview] = useState<{ url: string; pdf: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const preview = usePrivatePage(docType, index, page);
  const busy = progress !== null || removing;

  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview.url);
  }, [localPreview]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    let prepared: { blob: Blob; name: string; isPdf: boolean };
    try {
      prepared = await prepareDocumentFile(file);
    } catch (err) {
      setError(err instanceof DocumentFileError ? err.message : "This file can't be used.");
      return;
    }
    const url = URL.createObjectURL(prepared.blob);
    setLocalPreview({ url, pdf: prepared.isPdf });
    setProgress(-1);
    try {
      const doc = await applicantApi.uploadPage(docType, index, prepared.blob, prepared.name, {
        expiryDate: expiryForFirstUpload ?? undefined,
        onProgress: (fraction) => setProgress(fraction),
      });
      onUploaded(doc);
    } catch (err) {
      setError(errorMessage(err, 'The upload did not finish. Try again.'));
      setLocalPreview(null);
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    setError(null);
    setRemoving(true);
    try {
      onRemoved(await applicantApi.removePage(docType, index));
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the page.'));
    } finally {
      setRemoving(false);
    }
  }

  const shown = localPreview ?? (page ? { url: preview, pdf: isPdf({ type: page.content_type }) } : null);
  const percent = progress !== null && progress >= 0 ? Math.round(progress * 100) : null;

  return (
    <div className={`doc-page${page ? ' doc-page--filled' : ''}`}>
      <span className="doc-page__label">{label}</span>
      {/* Hidden pickers: the camera straight away, or the gallery / files (photos and PDFs). */}
      <input
        ref={cameraRef}
        id={ids.camera}
        className="doc-page__input"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={`Take a photo: ${label}`}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        id={ids.gallery}
        className="doc-page__input"
        type="file"
        accept="image/*,application/pdf"
        aria-label={`Choose from gallery: ${label}`}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {shown ? (
        <div className="doc-page__preview">
          {shown.pdf ? (
            <span className="doc-page__pdf">
              <FileText aria-hidden="true" size={30} />
              PDF
            </span>
          ) : shown.url ? (
            <img src={shown.url} alt={`${label} of the document`} />
          ) : (
            <span className="doc-page__loading" aria-label="Loading the photo" />
          )}
          {progress !== null ? (
            <div className="doc-progress" role="progressbar" aria-label={`Uploading ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
              <span
                className={`doc-progress__bar${percent === null ? ' doc-progress__bar--busy' : ''}`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
              <span className="doc-progress__text">{percent === null ? 'Uploading…' : `Uploading ${percent}%`}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {page && progress === null ? (
        <div className="doc-page__actions">
          <button type="button" className="doc-btn" onClick={() => cameraRef.current?.click()} disabled={busy}>
            <RotateCcw aria-hidden="true" size={18} />
            Retake
          </button>
          <button type="button" className="doc-btn" onClick={() => galleryRef.current?.click()} disabled={busy}>
            <ImagePlus aria-hidden="true" size={18} />
            Gallery
          </button>
          <button type="button" className="doc-btn doc-btn--quiet" onClick={() => void remove()} disabled={busy} aria-label={`Remove ${label}`}>
            <Trash2 aria-hidden="true" size={18} />
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : null}

      {!page && progress === null ? (
        <div className="doc-page__actions doc-page__actions--empty">
          <button type="button" className="doc-btn doc-btn--main" onClick={() => cameraRef.current?.click()} disabled={busy || !canAdd}>
            <Camera aria-hidden="true" size={20} />
            Take photo
          </button>
          <button type="button" className="doc-btn" onClick={() => galleryRef.current?.click()} disabled={busy || !canAdd}>
            <ImagePlus aria-hidden="true" size={20} />
            Gallery
          </button>
        </div>
      ) : null}
      {!page && !canAdd ? <span className="doc-page__wait">Add the front first.</span> : null}

      {error ? (
        <p className="doc-card__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** An uploaded page, fetched privately as a Blob and shown via an object URL (revoked on change). */
function usePrivatePage(docType: string, index: number, page: RiderDocument['pages'][number] | undefined): string {
  const [url, setUrl] = useState('');
  const key = page && !isPdf({ type: page.content_type }) ? page.uploaded_at : null;
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    let made = '';
    applicantApi
      .fetchPage(docType, index)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => {
        /* the preview just stays a placeholder */
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl('');
    };
  }, [docType, index, key]);
  return url;
}
