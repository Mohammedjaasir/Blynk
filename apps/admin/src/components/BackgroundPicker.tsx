import { ImageUploader } from './ImageUploader';

/**
 * Background control for a promotion: solid, gradient, or an image.
 *
 * Operators get a curated set of Blynk-consistent swatches rather than a
 * colour wheel or raw CSS - a promotion should always look like Blynk, and
 * nobody running the store should have to reason about hex values.
 */
export type BackgroundType = 'SOLID' | 'GRADIENT' | 'IMAGE';

export interface BackgroundValue {
  background_type: BackgroundType;
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
}

/** Hand-picked, in brand. Yellow leads; green and ink are accents. */
export const SOLID_SWATCHES: { label: string; value: string }[] = [
  { label: 'Blynk Yellow', value: '#FFE141' },
  { label: 'Butter', value: '#FFF3C4' },
  { label: 'Warm sand', value: '#F6EFE2' },
  { label: 'Leaf', value: '#E4F2E6' },
  { label: 'Blynk Green', value: '#0C831F' },
  { label: 'Ink', value: '#12151F' },
  { label: 'Cloud', value: '#F1F4F9' },
];

export const GRADIENT_PRESETS: {
  label: string;
  start: string;
  end: string;
}[] = [
  { label: 'Sunrise', start: '#FFE141', end: '#FFF8E1' },
  { label: 'Market morning', start: '#FFF3C4', end: '#E4F2E6' },
  { label: 'Fresh', start: '#0C831F', end: '#5FBF6E' },
  { label: 'Midnight', start: '#12151F', end: '#2C3348' },
  { label: 'Paper', start: '#F6EFE2', end: '#FFFFFF' },
];

export function BackgroundPicker({
  value,
  onChange,
}: {
  value: BackgroundValue;
  onChange(next: BackgroundValue): void;
}) {
  const type = value.background_type;

  function setType(next: BackgroundType) {
    if (next === value.background_type) return;
    // Switching type keeps what the new type needs and drops the rest, so a
    // gradient can't be saved with a stale single colour.
    if (next === 'SOLID') {
      onChange({
        background_type: 'SOLID',
        background_color: value.background_color ?? SOLID_SWATCHES[0]!.value,
        background_color_end: null,
        background_image_url: value.background_image_url,
      });
    } else if (next === 'GRADIENT') {
      const preset = GRADIENT_PRESETS[0]!;
      onChange({
        background_type: 'GRADIENT',
        background_color: value.background_color ?? preset.start,
        background_color_end: value.background_color_end ?? preset.end,
        background_image_url: value.background_image_url,
      });
    } else {
      onChange({ ...value, background_type: 'IMAGE' });
    }
  }

  return (
    <div className="bg-picker">
      <div className="segmented" role="group" aria-label="Background type">
        {(['SOLID', 'GRADIENT', 'IMAGE'] as BackgroundType[]).map((option) => (
          <button
            key={option}
            type="button"
            className={option === type ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={option === type}
            onClick={() => setType(option)}
          >
            {option === 'SOLID' ? 'Solid' : option === 'GRADIENT' ? 'Gradient' : 'Image'}
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
                  onChange({
                    ...value,
                    background_type: 'SOLID',
                    background_color: swatch.value,
                    background_color_end: null,
                  })
                }
              />
            );
          })}
        </div>
      ) : null}

      {type === 'GRADIENT' ? (
        <div className="swatches" role="radiogroup" aria-label="Background gradient">
          {GRADIENT_PRESETS.map((preset) => {
            const selected =
              value.background_color === preset.start &&
              value.background_color_end === preset.end;
            return (
              <button
                key={preset.label}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={preset.label}
                title={preset.label}
                className={selected ? 'swatch swatch--wide is-selected' : 'swatch swatch--wide'}
                style={{
                  background: `linear-gradient(135deg, ${preset.start}, ${preset.end})`,
                }}
                onClick={() =>
                  onChange({
                    ...value,
                    background_type: 'GRADIENT',
                    background_color: preset.start,
                    background_color_end: preset.end,
                  })
                }
              />
            );
          })}
        </div>
      ) : null}

      {type === 'IMAGE' ? (
        <>
          <ImageUploader
            value={value.background_image_url}
            folder="promotions"
            label="Background image"
            onChange={(url) =>
              onChange({ ...value, background_type: 'IMAGE', background_image_url: url })
            }
          />
          <p className="uploader__hint">
            The app darkens image backgrounds so the headline stays readable.
          </p>
        </>
      ) : null}
    </div>
  );
}
