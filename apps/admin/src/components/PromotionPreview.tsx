import type { Promotion } from '../api/types';

/**
 * Shows the promotion the way the customer carousel composes it: background
 * layer, headline block, foreground visual overlapping it. Kept in step with
 * `home_screen_carousel.dart` deliberately - an operator should not have to
 * save and open the app to see what they are making.
 */
export function PromotionPreview({
  promotion,
  compact = false,
}: {
  promotion: Promotion;
  compact?: boolean;
}) {
  const isImage = promotion.background_type === 'IMAGE' && promotion.background_image_url;
  const isGradient =
    promotion.background_type === 'GRADIENT' &&
    promotion.background_color &&
    promotion.background_color_end;

  const background = isImage
    ? {
        backgroundImage: `linear-gradient(90deg, rgba(16,19,25,0.90) 5%, rgba(16,19,25,0.40) 85%), url(${promotion.background_image_url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : isGradient
      ? {
          backgroundImage: `linear-gradient(135deg, ${promotion.background_color}, ${promotion.background_color_end})`,
        }
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
      {compact ? null : (
      <div className="promo-preview__content">
        <p
          className="promo-preview__title"
          style={{ color: onDark ? '#FFFFFF' : '#12151F' }}
        >
          {promotion.title}
        </p>
        {promotion.subtitle ? (
          <p
            className="promo-preview__subtitle"
            style={{ color: onDark ? 'rgba(255,255,255,0.82)' : '#4B5364' }}
          >
            {promotion.subtitle}
          </p>
        ) : null}
        {promotion.cta_label && promotion.cta_destination_type ? (
          <span className="promo-preview__cta">{promotion.cta_label}</span>
        ) : null}
      </div>
      )}
      {promotion.image_url ? (
        <img className="promo-preview__foreground" src={promotion.image_url} alt="" />
      ) : null}
    </div>
  );
}

/** Mirrors the app's luminance check so the preview picks the same text colour. */
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
  const channel = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance < 0.45;
}
