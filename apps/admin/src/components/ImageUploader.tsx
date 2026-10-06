import { useRef, useState } from 'react';
import { uploadImage } from '../api/client';
import { errorMessage } from '../lib/apiErrors';
import { prepareImageForUpload, validateImageFile, validatePreparedFile } from '../lib/image';
import { Spinner } from './ui';

/**
 * Upload / preview / replace / remove for one image.
 *
 * The preview appears before the product or promotion is saved: the file is
 * uploaded immediately, the caller receives the URL, and saving the form
 * stores that URL.
 *
 * Remove and Replace only change the field. The old file is NOT deleted
 * here: until the form is saved, the product or promotion still points at
 * it, and a failed or cancelled save must leave it working. The form
 * deletes replaced files after a successful save (lib/imageCleanup.ts).
 */
export function ImageUploader({
  value,
  folder,
  onChange,
  label = 'Image',
}: {
  value: string | null;
  folder: 'products' | 'promotions';
  onChange(url: string | null): void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    const validation = validateImageFile(file);
    if (!validation.ok) {
      setError(validation.message ?? 'That file cannot be used.');
      return;
    }

    // Show the picked file straight away, then swap to the stored URL.
    const previewUrl = URL.createObjectURL(file);
    setLocalPreview(previewUrl);
    setBusy(true);
    try {
      const prepared = await prepareImageForUpload(file);
      // The API refuses anything over 2 MB (413 FILE_TOO_LARGE); say so
      // before sending it rather than after.
      const sized = validatePreparedFile(prepared);
      if (!sized.ok) {
        setError(sized.message ?? 'That image is too large.');
        setLocalPreview(null);
        return;
      }
      const media = await uploadImage(prepared, folder);
      onChange(media.url);
    } catch (err) {
      setError(errorMessage(err, 'Upload failed.'));
      setLocalPreview(null);
    } finally {
      setBusy(false);
      URL.revokeObjectURL(previewUrl);
    }
  }

  function handleRemove() {
    // Only the field: the file is deleted once the form saves without it.
    onChange(null);
    setLocalPreview(null);
    setError(null);
  }

  const preview = value ?? localPreview;

  return (
    <div className="uploader">
      <span className="field__label">{label}</span>
      <div className="uploader__row">
        <div className="uploader__preview" aria-live="polite">
          {busy ? (
            <Spinner label="Uploading image" />
          ) : preview ? (
            <img src={preview} alt="" />
          ) : (
            <span className="uploader__placeholder">No image</span>
          )}
        </div>
        <div className="uploader__actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {preview ? 'Replace image' : 'Upload image'}
          </button>
          {preview ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={handleRemove}
            >
              Remove
            </button>
          ) : null}
          <p className="uploader__hint">
            JPEG, PNG or WebP, 2 MB or less after resizing. Large photos are resized before upload.
          </p>
          {error ? <p className="field__error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
