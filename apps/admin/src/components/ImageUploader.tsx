import { useRef, useState } from 'react';
import { deleteImage, uploadImage } from '../api/client';
import { prepareImageForUpload, validateImageFile } from '../lib/image';
import { Spinner } from './ui';

/**
 * Upload / preview / replace / remove for one image.
 *
 * The preview appears before the product or promotion is saved: the file is
 * uploaded immediately, the caller receives the URL, and saving the form
 * stores that URL. Removing an image both clears the field and deletes the
 * stored file, so local storage doesn't accumulate orphans.
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
      const media = await uploadImage(prepared, folder);
      onChange(media.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setLocalPreview(null);
    } finally {
      setBusy(false);
      URL.revokeObjectURL(previewUrl);
    }
  }

  async function handleRemove() {
    const current = value;
    onChange(null);
    setLocalPreview(null);
    if (!current) return;
    try {
      await deleteImage(current);
    } catch {
      // The field is cleared either way; a leftover file is not worth an error.
    }
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
              onClick={() => void handleRemove()}
            >
              Remove
            </button>
          ) : null}
          <p className="uploader__hint">
            JPEG, PNG or WebP. Large photos are resized before upload.
          </p>
          {error ? <p className="field__error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
