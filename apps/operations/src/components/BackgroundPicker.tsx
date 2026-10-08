import { ImageUploader } from './ImageUploader';

/**
 * Background control for a promotion (task F5): solid, gradient, an image,
 * or a full-bleed artwork banner. Ported from
 * `apps/admin/src/components/BackgroundPicker.tsx` (a fresh implementation,
 * not an import - common.md rule 2), including the same curated, in-brand
 * swatches (no colour wheel, no raw hex entry) - a promotion should always
 * look like Blynk.
 *
 * `IMAGE` and `ARTWORK` both store their file in `background_image_url` and
 * both use the same uploader; the difference is entirely in what the customer
 * app paints over it. IMAGE gets a flat ink scrim plus the app's headline and
 * subtitle; ARTWORK gets neither, because the uploaded banner already carries
 * its own artwork and wording.
 */
export type BackgroundType = 'SOLID' | 'GRADIENT' | 'IMAGE' | 'ARTWORK';

/** The two types whose card is filled by an uploaded file. */
export function usesBackgroundImage(type: BackgroundType): boolean {
  return type === 'IMAGE' || type === 'ARTWORK';
}

const TYPE_LABELS: Record<BackgroundType, string> = {
  SOLID: 'Solid',
  GRADIENT: 'Gradient',
  IMAGE: 'Image',
  ARTWORK: 'Designed banner (full picture)',
};

export interface BackgroundValue {
  background_type: BackgroundType;
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  /**
   * Where the card's crop anchors on the background image (backend migration
   * 009), as a percentage of that image's own width and height. IMAGE and
   * ARTWORK share it because they share the file. 50/50 is the centre, which
   * is what the card cropped at before this existed.
   */
  background_focal_x: number;
  background_focal_y: number;
}

export const SOLID_SWATCHES: { label: string; value: string }[] = [
  { label: 'Blynk Yellow', value: '#FFE141' },
  { label: 'Butter', value: '#FFF3C4' },
  { label: 'Warm sand', value: '#F6EFE2' },
  { label: 'Leaf', value: '#E4F2E6' },
  { label: 'Blynk Green', value: '#0C831F' },
  { label: 'Ink', value: '#12151F' },
  { label: 'Cloud', value: '#F1F4F9' },
];

export const GRADIENT_PRESETS: { label: string; start: string; end: string }[] = [
  { label: 'Sunrise', start: '#FFE141', end: '#FFF8E1' },
  { label: 'Market morning', start: '#FFF3C4', end: '#E4F2E6' },
  { label: 'Fresh', start: '#0C831F', end: '#5FBF6E' },
  { label: 'Midnight', start: '#12151F', end: '#2C3348' },
  { label: 'Paper', start: '#F6EFE2', end: '#FFFFFF' },
];

export function BackgroundPicker({ value, onChange }: { value: BackgroundValue; onChange(next: BackgroundValue): void }) {
  const type = value.background_type;

  function setType(next: BackgroundType) {
    if (next === value.background_type) return;
    // Switching type keeps what the new type needs and drops the rest, so a
    // gradient can't be saved with a stale single colour.
    if (next === 'SOLID') {
      onChange({
        ...value,
        background_type: 'SOLID',
        background_color: value.background_color ?? SOLID_SWATCHES[0]!.value,
        background_color_end: null,
        background_image_url: value.background_image_url,
      });
    } else if (next === 'GRADIENT') {
      const preset = GRADIENT_PRESETS[0]!;
      onChange({
        ...value,
        background_type: 'GRADIENT',
        background_color: value.background_color ?? preset.start,
        background_color_end: value.background_color_end ?? preset.end,
        background_image_url: value.background_image_url,
      });
    } else {
      // IMAGE and ARTWORK share `background_image_url`, so switching between
      // them keeps the uploaded file - the operator is changing how it is
      // treated, not replacing it.
      onChange({ ...value, background_type: next });
    }
  }

  return (
    <div className="bg-picker">
      <div className="segmented" role="group" aria-label="Background type">
        {(['ARTWORK', 'SOLID', 'GRADIENT', 'IMAGE'] as BackgroundType[]).map((option) => (
          <button
            key={option}
            type="button"
            className={option === type ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={option === type}
            onClick={() => setType(option)}
          >
            {TYPE_LABELS[option]}
          </button>
        ))}
      </div>

      {type === 'SOLID' ? (
        <div className="swatches" role="radiogroup" aria-label="Background colour">
          {SOLID_SWATCHES.map((swatch) => {
            const selected = value.background_color === swatch.value;
            return (
              <button
                key={swatch.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={swatch.label}
                title={swatch.label}
                className={selected ? 'swatch is-selected' : 'swatch'}
                style={{ background: swatch.value }}
                onClick={() =>
                  onChange({ ...value, background_type: 'SOLID', background_color: swatch.value, background_color_end: null })
                }
              />
            );
          })}
        </div>
      ) : null}

      {type === 'GRADIENT' ? (
        <div className="swatches" role="radiogroup" aria-label="Background gradient">
          {GRADIENT_PRESETS.map((preset) => {
            const selected = value.background_color === preset.start && value.background_color_end === preset.end;
            return (
              <button
                key={preset.label}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={preset.label}
                title={preset.label}
                className={selected ? 'swatch swatch--wide is-selected' : 'swatch swatch--wide'}
                style={{ background: `linear-gradient(135deg, ${preset.start}, ${preset.end})` }}
                onClick={() =>
                  onChange({ ...value, background_type: 'GRADIENT', background_color: preset.start, background_color_end: preset.end })
                }
              />
            );
          })}
        </div>
      ) : null}

      {/* One uploader, not two: IMAGE and ARTWORK write the same field. Only
          the label and the hint differ, because only the treatment differs. */}
      {usesBackgroundImage(type) ? (
        <>
          <ImageUploader
            value={value.background_image_url}
            folder="promotions"
            label={type === 'ARTWORK' ? 'Banner artwork' : 'Background image'}
            onChange={(url) => onChange({ ...value, background_type: type, background_image_url: url })}
            // The same focal control the product form gets, from the same
            // uploader - only the preview shape differs, because the card the
            // customer app crops to is wide, not square.
            focal={{ x: value.background_focal_x, y: value.background_focal_y }}
            onFocalChange={(focal) =>
              onChange({
                ...value,
                background_type: type,
                background_focal_x: focal.x,
                background_focal_y: focal.y,
              })
            }
            focalShape="wide"
          />
          {type === 'ARTWORK' ? (
            <p className="uploader__hint">
              <strong>Any size works:</strong> the banner is shown whole, at its own shape (a wide picture such as
              1200 × 630 px suits phones best). Your banner is shown exactly as uploaded. The headline and supporting text are
              <strong> not</strong> drawn over it and there is no darkening, so the artwork must already carry its own
              wording. The headline is still required — it is what a screen reader announces for this slide, and how
              this promotion is listed here.
            </p>
          ) : (
            <p className="uploader__hint">The app darkens image backgrounds so the headline stays readable.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
