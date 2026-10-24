import { useEffect, useRef, useState } from 'react';
import { sellerApi } from '../api/resources';
import { errorMessage } from '../lib/apiErrors';
import { prepareImageForUpload, validateImageFile, validatePreparedFile } from '../lib/image';
import { IconCamera, IconImage } from './icons';
import { Spinner } from './ui';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * Photo upload with a preview, friendly to phones: one button opens the
 * camera, the other the gallery. The photo is uploaded as soon as it is
 * picked; the form then saves the returned URL with the product.
 */
export function ImagePicker({
  value,
  onChange,
  onBusyChange,
}: {
  value: string | null;
  onChange(url: string | null): void;
  onBusyChange?(busy: boolean): void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  // Free the temporary preview URL when it is replaced or the form closes.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function setBusyState(next: boolean) {
    setBusy(next);
    onBusyChange?.(next);
  }

  async function handleFile(file: File) {
    setError(null);
    const checked = validateImageFile(file);
    if (!checked.ok) {
      setError(checked.message ?? 'That file cannot be used.');
      return;
    }

    // Show the picked photo straight away, then keep the stored URL.
    setLocalPreview(URL.createObjectURL(file));
    setBusyState(true);
    try {
      const prepared = await prepareImageForUpload(file);
      const sized = validatePreparedFile(prepared);
      if (!sized.ok) {
        setError(sized.message ?? 'That photo is too big.');
        setLocalPreview(null);
        return;
      }
      const url = await sellerApi.uploadImage(prepared);
      onChange(url);
    } catch (err) {
      setError(errorMessage(err, 'Could not upload the photo. Please try again.'));
      setLocalPreview(null);
    } finally {
      setBusyState(false);
    }
  }

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void handleFile(file);
  }

  const shown = localPreview ?? value;

  return (
    <div className="photo">
      <div className={`photo__frame${shown ? ' photo__frame--filled' : ''}`}>
        {shown ? (
          <img src={shown} alt="Product photo preview" className="photo__img" />
        ) : (
          <button
            type="button"
            className="photo__none"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
            aria-describedby="photo-hint"
          >
            <span className="photo__none-icon" aria-hidden="true">
              <IconImage size={28} />
            </span>
            <span className="photo__none-title">No photo yet</span>
            <span className="photo__none-sub">Tap to add one</span>
          </button>
        )}
        {busy ? (
          <span className="photo__busy">
            <Spinner label="Uploading photo" />
          </span>
        ) : null}
      </div>
      <div className="photo__actions">
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
        >
          <IconCamera size={18} /> Take a photo
        </button>
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={busy}
          onClick={() => galleryRef.current?.click()}
        >
          <IconImage size={18} /> {shown ? 'Choose another photo' : 'Choose from gallery'}
        </button>
        {shown && !busy ? (
          <button
            type="button"
            className="button button--link"
            onClick={() => {
              setLocalPreview(null);
              onChange(null);
            }}
          >
            Remove photo
          </button>
        ) : null}
      </div>
      <input ref={cameraRef} type="file" accept={ACCEPT} capture="environment" hidden onChange={pick} aria-label="Take a photo with the camera" />
      <input ref={galleryRef} type="file" accept={ACCEPT} hidden onChange={pick} aria-label="Choose a photo from the gallery" />
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : (
        <p className="field__hint" id="photo-hint">
          A clear photo on a plain background sells best. JPEG, PNG or WebP.
        </p>
      )}
    </div>
  );
}
