import { useId, useRef, useState } from 'react';
import { uploadImage, type MediaFolder } from '../api/client';
import { errorMessage } from '../lib/errors';
import { MAX_UPLOAD_BYTES, prepareImageForUpload, validateImageFile } from '../lib/image';
import { Spinner } from './ui';

/**
 * Where the crop anchors, as a percentage of the image's own width and
 * height (backend migration 009). 50/50 is the centre - exactly where a
 * `cover` crop already lands - so this is the value that changes nothing.
 */
export interface FocalPoint {
  x: number;
  y: number;
}

export const CENTRE_FOCAL: FocalPoint = { x: 50, y: 50 };

/** The real shape the image is cropped to on the customer surface. */
export type FocalShape = 'square' | 'wide' | 'circle';

const SHAPE_CAPTION: Record<FocalShape, string> = {
  square: 'Product tile',
  wide: 'Home carousel card',
  circle: 'Category tile',
};

/** Keeps a percentage whole and inside the range the backend accepts. */
export function clampFocal(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Plain-English position, used for the readout and the control's label. */
export function describeFocal(focal: FocalPoint): string {
  if (focal.x === 50 && focal.y === 50) return 'Centre of the image (50% across, 50% down)';
  return `${focal.x}% across, ${focal.y}% down`;
}

/**
 * Upload / preview / replace / remove for one image (task F5). Ported from
 * `apps/admin/src/components/ImageUploader.tsx` (a fresh implementation, not
 * an import - common.md rule 2): the file uploads immediately, the caller
 * receives the stored URL, and saving the
 * product/promotion form just stores that URL (the backend is the only
 * price/catalog authority either way - an image URL carries no pricing
 * decision, common.md rule 8 doesn't apply to it, but rule 7 does: no field
 * here is invented, `media.key`/`media.url` are exactly what
 * `POST /admin/media` returns).
 *
 * ## Focal point
 *
 * Pass `focal` + `onFocalChange` and the uploader also offers a focal-point
 * control (backend migration 009). Product tiles and carousel cards crop the
 * uploaded image to fill a fixed shape, and that crop is anchored at the
 * centre - so a banner whose wording sits along the top loses the wording.
 * The focal point moves the anchor.
 *
 * This is ONE uploader used by both the product form and the promotion
 * background picker, exactly as before; the focal control is an addition to
 * it, not a second component per form. Omit the two props and the uploader is
 * byte-for-byte the control it has always been.
 */
export function ImageUploader({
  value,
  folder,
  onChange,
  label = 'Image',
  focal,
  onFocalChange,
  focalShape = 'square',
}: {
  value: string | null;
  folder: MediaFolder;
  onChange(url: string | null): void;
  label?: string;
  /** Current focal point. Omitted (with `onFocalChange`) hides the control. */
  focal?: FocalPoint;
  onFocalChange?(next: FocalPoint): void;
  /** The shape the live preview is drawn at - the real target shape. */
  focalShape?: FocalShape;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // "Take photo" (owner, 2026-10-08): the camera, straight to the same
  // resize-and-upload path, for products photographed on the spot.
  const cameraRef = useRef<HTMLInputElement>(null);
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
      // before sending it rather than after a slow upload.
      if (prepared.size > MAX_UPLOAD_BYTES) {
        setError('That image is larger than 2 MB even after resizing. Choose a smaller one.');
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
    // Only the FIELD is cleared. The stored file is not deleted here: the
    // saved record still points at it until the form is saved, and a
    // cancelled or failed save must leave it working. The form deletes
    // replaced files after a successful save (lib/image.ts `replacedImages`).
    onChange(null);
    setLocalPreview(null);
    // Deliberately NOT also resetting the focal point here. Two callbacks
    // fired in one tick are two updates computed from the same stale form
    // state, so the second silently undoes the first - which is exactly how
    // `Remove` stopped clearing the image the first time this was written.
    // The focal point simply stays where the operator put it: the picker is
    // hidden while there is no image, and the moment a new one is uploaded
    // the live preview shows that anchor applied to it, with `Reset to
    // centre` one press away.
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
            <img
              src={preview}
              alt=""
              // The thumbnail crops to a square, so it honours the anchor too
              // - otherwise the one picture on screen would contradict the
              // control right next to it.
              style={focal ? { objectPosition: `${focal.x}% ${focal.y}%` } : undefined}
            />
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
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            data-testid="camera-input"
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
            onClick={() => cameraRef.current?.click()}
          >
            Take photo
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {preview ? 'Replace image' : 'Upload image'}
          </button>
          {preview ? (
            <button type="button" className="button button--ghost" disabled={busy} onClick={handleRemove}>
              Remove
            </button>
          ) : null}
          <p className="uploader__hint">JPEG, PNG or WebP, up to 2 MB. Large photos are resized before upload.</p>
          {error ? <p className="field__error-text">{error}</p> : null}
        </div>
      </div>

      {focal && onFocalChange && preview ? (
        <FocalPointPicker
          imageUrl={preview}
          value={focal}
          onChange={onFocalChange}
          shape={focalShape}
        />
      ) : null}
    </div>
  );
}

/**
 * The focal-point control: click the part of the image that must survive the
 * crop, or move it with the keyboard, and watch a live preview at the REAL
 * target shape.
 *
 * The preview is the point of the feature. A focal point with no preview is
 * guesswork - the operator cannot tell from the full picture what a square
 * tile or a wide card will keep, because the answer depends on the target's
 * aspect ratio, not on the image alone.
 *
 * ## Keyboard
 *
 * Two native `<input type="range">` sliders carry the value. That is
 * deliberate rather than a bare div with an `onKeyDown`: a range input is
 * reachable by Tab, moves by 1% on an arrow key and 10% on Page Up/Down,
 * announces its own value through `aria-valuetext` in EVERY screen-reader
 * mode, and needs no `role="application"` to stop a reader swallowing the
 * arrow keys. The image surface is the pointer affordance on top of that,
 * and is marked `aria-hidden` so it is not a second, unlabelled copy of the
 * same control in the tab order.
 */
function FocalPointPicker({
  imageUrl,
  value,
  onChange,
  shape,
}: {
  imageUrl: string;
  value: FocalPoint;
  onChange(next: FocalPoint): void;
  shape: FocalShape;
}) {
  const id = useId();
  const isCentre = value.x === 50 && value.y === 50;

  /** Turns a pointer position on the image into a percentage pair. */
  function pickFromPointer(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onChange({
      x: clampFocal(((event.clientX - rect.left) / rect.width) * 100),
      y: clampFocal(((event.clientY - rect.top) / rect.height) * 100),
    });
  }

  return (
    <div className="focal">
      <p className="focal__intro">
        Click the part of the image that must stay visible, or move the focus with the sliders. Everything outside the
        preview shape is cropped away.
      </p>

      <div className="focal__row">
        {/* Pointer affordance only: the sliders below are the accessible,
            focusable control, so this must not be a second tab stop. */}
        <div
          className="focal__surface"
          aria-hidden="true"
          onClick={pickFromPointer}
          data-testid="focal-surface"
        >
          <img className="focal__surface-image" src={imageUrl} alt="" />
          <span
            className="focal__marker"
            style={{ left: `${value.x}%`, top: `${value.y}%` }}
            data-testid="focal-marker"
          />
        </div>

        <figure className="focal__preview-figure">
          <div
            className={`focal__preview focal__preview--${shape}`}
            data-testid="focal-preview"
            role="img"
            aria-label={`Preview: the ${SHAPE_CAPTION[shape].toLowerCase()} cropped to ${describeFocal(value).toLowerCase()}`}
            style={{
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: `${value.x}% ${value.y}%`,
            }}
          />
          <figcaption className="focal__caption">{SHAPE_CAPTION[shape]}</figcaption>
        </figure>
      </div>

      <div className="focal__sliders">
        <label className="focal__slider" htmlFor={`${id}-x`}>
          <span>Focus across</span>
          <input
            id={`${id}-x`}
            className="focal__range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value.x}
            aria-valuetext={`${value.x}% from the left`}
            onChange={(event) => onChange({ ...value, x: clampFocal(Number(event.target.value)) })}
          />
        </label>
        <label className="focal__slider" htmlFor={`${id}-y`}>
          <span>Focus down</span>
          <input
            id={`${id}-y`}
            className="focal__range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value.y}
            aria-valuetext={`${value.y}% from the top`}
            onChange={(event) => onChange({ ...value, y: clampFocal(Number(event.target.value)) })}
          />
        </label>
      </div>

      <div className="focal__footer">
        {/* One spoken announcement of the position, not two competing ones. */}
        <p className="focal__readout" role="status">
          Focus point: {describeFocal(value)}
        </p>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={isCentre}
          onClick={() => onChange(CENTRE_FOCAL)}
        >
          Reset to centre
        </button>
      </div>
    </div>
  );
}
