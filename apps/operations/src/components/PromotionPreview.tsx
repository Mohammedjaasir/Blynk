import type { Promotion } from '../api/types';

/**
 * Shows a promotion the way the customer carousel composes it: background
 * layer, headline block, foreground visual overlapping it (task F5). Ported
 * from `apps/admin/src/components/PromotionPreview.tsx` (a fresh
 * implementation, not an import - common.md rule 2), kept in step with the
 * same `home_screen_carousel.dart` composition it mirrors - an operator
 * should not have to save and open the customer app to see what they made.
 */
export function PromotionPreview({ promotion, compact = false }: { promotion: Promotion; compact?: boolean }) {
  const isImage = promotion.background_type === 'IMAGE' && promotion.background_image_url;
  // A finished banner, uploaded as-is: full-bleed, no scrim, and none of the
  // app's own words over it. Same card shape and radius as every other type,
  // so the preview still shows the real placement in the carousel.
  const isArtwork = promotion.background_type === 'ARTWORK' && promotion.background_image_url;
  const isGradient =
    promotion.background_type === 'GRADIENT' && promotion.background_color && promotion.background_color_end;

  // 2026-09-24: this preview used a left-to-right scrim ramping from 90% to
  // 40% ink, which blotted out the left half of an uploaded banner — and,
  // worse, it is NOT what the customer app draws. The customer renders a FLAT
  // ink scrim at BlynkPromo.scrimOpacity (0.66) across the whole image.
  //
  // A preview whose treatment differs from the real screen is worse than an
  // ugly one: the operator tunes their artwork against a render that does not
  // exist. Matching the flat 0.66 both lightens the left and makes the preview
  // truthful. Keep this number in step with BlynkPromo.scrimOpacity in
  // apps/customer/.../lib/design/components.dart.
  //
  // Owner, 2026-10-18: "give me a option to upload photo in anysize but it
  // should automatically fit" - the card no longer crops the background with
  // `cover`; it fits the whole upload with `contain`, centred, any size or
  // shape, with the card's own background (#F1F4F9) showing through on the
  // sides. `background_focal_x/y` are still stored but no longer read here.
  const background = isArtwork
    ? {
        // No scrim layer at all - not even a transparent one. The operator's
        // file is the card.
        backgroundImage: `url(${promotion.background_image_url})`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#F1F4F9',
      }
    : isImage
      ? {
          backgroundImage: `linear-gradient(rgba(16,19,25,0.66), rgba(16,19,25,0.66)), url(${promotion.background_image_url})`,
          backgroundSize: 'cover, contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundColor: '#F1F4F9',
        }
      : isGradient
        ? { backgroundImage: `linear-gradient(135deg, ${promotion.background_color}, ${promotion.background_color_end})` }
        : { background: promotion.background_color ?? '#F1F4F9' };

  const onDark = isImage || isDark(promotion.background_color);

  return (
    <div
      className={compact ? 'promo-preview promo-preview--compact' : 'promo-preview'}
      style={background}
      aria-hidden={compact ? true : undefined}
    >
      {/* The row preview is a composition swatch: the title already has its
          own column, so repeating it here would just be noise. */}
      {compact ? null : isArtwork ? (
        /* ARTWORK draws no headline and no subtitle - the banner already
           carries its own. A CTA is still drawn when the operator gave it a
           label (an artwork banner may still want a button); with no label
           the whole card is the tap target in the customer app, so there is
           nothing to draw here at all. */
        promotion.cta_label && promotion.cta_destination_type ? (
          <div className="promo-preview__content">
            <span className="promo-preview__cta">{promotion.cta_label}</span>
          </div>
        ) : null
      ) : (
        <div className="promo-preview__content">
          <p className="promo-preview__title" style={{ color: onDark ? '#FFFFFF' : '#12151F' }}>
            {promotion.title}
          </p>
          {promotion.subtitle ? (
            <p className="promo-preview__subtitle" style={{ color: onDark ? 'rgba(255,255,255,0.82)' : '#4B5364' }}>
              {promotion.subtitle}
            </p>
          ) : null}
          {promotion.cta_label && promotion.cta_destination_type ? (
            <span className="promo-preview__cta">{promotion.cta_label}</span>
          ) : null}
        </div>
      )}
      {promotion.image_url ? <img className="promo-preview__foreground" src={promotion.image_url} alt="" /> : null}
    </div>
  );
}

/** Mirrors the customer app's luminance check so the preview picks the same text colour. */
function isDark(hex: string | null): boolean {
  if (!hex) return false;
  let value = hex.replace('#', '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (value.length !== 6) return false;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance < 0.45;
}
