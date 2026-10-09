import 'package:flutter/material.dart';

import 'tokens.dart';

/// Poppins type scale (size / line height). Nothing below 12.
///
/// 2026-09-24: switched from Catamaran to **Poppins**, the geometric rounded
/// sans the reference design uses — the user asked for the reference's
/// typography, not only its layout. Poppins is SIL Open Font License and is
/// bundled (Latin subset) in `Assets/Fonts/`.
///
/// Trade-off, recorded so it is not rediscovered: Catamaran covers Tamil,
/// Poppins does not. The UI is English today, so nothing regresses now — but a
/// future Tamil localisation would need Catamaran (or Noto Sans Tamil) back as
/// a fallback family. Catamaran is still declared in `pubspec.yaml` for that
/// reason; it is not dead weight.
abstract final class BlynkText {
  static const String family = 'Poppins';

  static const TextStyle display = TextStyle(
    fontFamily: family,
    fontSize: 28,
    height: 34 / 28,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
  );
  static const TextStyle title = TextStyle(
    fontFamily: family,
    fontSize: 20,
    height: 26 / 20,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
  );
  static const TextStyle heading = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 22 / 16,
    fontWeight: FontWeight.w700,
    color: BlynkColors.ink,
  );
  static const TextStyle body = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
    color: BlynkColors.ink,
  );
  static const TextStyle label = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w700,
    color: BlynkColors.ink,
  );
  static const TextStyle caption = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 16 / 12,
    fontWeight: FontWeight.w600,
    color: BlynkColors.ink,
  );

  /// Prices. Catamaran ships no `tnum` feature, so this falls back to its
  /// default lining figures; the flag keeps columns aligned if a font swap adds it.
  static const TextStyle price = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 22 / 16,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  // 2026-09 redesign additions. Existing entries above are reused where they
  // already fit (card titles use [label], meta text uses [caption]).

  /// Home's two-line headline ("Your Daily Essentials," / "Simplified").
  static const TextStyle headline = TextStyle(
    fontFamily: family,
    fontSize: 22,
    height: 28 / 22,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
  );

  /// Section headers ("Recommended for You").
  static const TextStyle sectionHeader = TextStyle(
    fontFamily: family,
    fontSize: 17,
    height: 22 / 17,
    fontWeight: FontWeight.w700,
    color: BlynkColors.ink,
  );

  /// The primary CTA's dark, bold label on its flat `signal` fill
  /// ("Add to cart", "Checkout").
  static const TextStyle ctaLabel = TextStyle(
    fontFamily: family,
    fontSize: 17,
    height: 22 / 17,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
  );

  /// Product-card price.
  static const TextStyle priceSmall = TextStyle(
    fontFamily: family,
    fontSize: 15,
    height: 20 / 15,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  /// Product-detail current price.
  static const TextStyle priceLarge = TextStyle(
    fontFamily: family,
    fontSize: 26,
    height: 32 / 26,
    fontWeight: FontWeight.w800,
    color: BlynkColors.ink,
    fontFeatures: [FontFeature.tabularFigures()],
  );

  /// A full-width row label bigger than [label] but not a section header —
  /// the product detail screen's expandable rows ("Product Details" etc.).
  static const TextStyle rowLabel = TextStyle(
    fontFamily: family,
    fontSize: 15,
    height: 20 / 15,
    fontWeight: FontWeight.w700,
    color: BlynkColors.ink,
  );

  /// The quiet supporting line that sits under a [rowLabel]: the second line
  /// of the checkout delivery-address and payment rows. `body` weight in
  /// `ink2`, declared once so the pair is one decision rather than a
  /// `copyWith(color:)` repeated at every call site — which is how the two
  /// checkout rows ended up on two different ramps in the first place.
  static const TextStyle bodyMuted = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
    color: BlynkColors.ink2,
  );

  /// The smallest chrome/label style: count badges and map attribution.
  /// The reference mock shows ~11 px here, but this is pinned at the 12 px
  /// floor on purpose (review R1 I-2: a sub-floor size declared inside a
  /// token is invisible to design_hygiene_ratchet_test.dart's floor guard,
  /// silently bypassing an accessibility floor every time it is read as
  /// real copy). Not the bottom nav's label — that's [caption].
  static const TextStyle microLabel = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 14 / 12,
    fontWeight: FontWeight.w700,
    color: BlynkColors.ink,
  );

  /// The absolute size floor. Nothing in the app renders text below this,
  /// including nav labels, badges and third-party map attribution.
  static const double minSize = 12;

  /// A responsive hero headline. The *ladder* of sizes belongs to the
  /// responsive widget that picks a breakpoint; the family, weight, tracking
  /// and the 12 px floor belong here, so no caller can declare a `fontSize:`
  /// of its own (or slip under the floor) to get one.
  static TextStyle heroTitle(double size) {
    assert(size >= minSize, 'hero title $size is below the ${minSize}px floor');
    return TextStyle(
      fontFamily: family,
      fontSize: size < minSize ? minSize : size,
      height: 1.05,
      letterSpacing: -0.6,
      fontWeight: FontWeight.w800,
      color: BlynkColors.ink,
    );
  }

  /// The subtitle under a [heroTitle], same rules.
  static TextStyle heroSubtitle(double size) {
    assert(size >= minSize, 'hero subtitle $size is below the ${minSize}px floor');
    return TextStyle(
      fontFamily: family,
      fontSize: size < minSize ? minSize : size,
      height: 1.35,
      fontWeight: FontWeight.w500,
      color: BlynkColors.ink,
    );
  }

  /// Draws an icon-font glyph as text (a map marker image is painted this way,
  /// where no Icon widget exists). Not part of the type scale — it can only
  /// ever render an [IconData] codepoint, never copy.
  ///
  /// It still asserts [minSize] (review M-4): this and the two `hero*`
  /// functions are the only size paths out of the type layer that the
  /// `fontSize:` guard cannot see, so all three enforce the floor themselves.
  /// Today's callers pass 40 and 22.
  static TextStyle glyph(IconData icon, double size, Color color) {
    assert(size >= minSize, 'glyph $size is below the ${minSize}px floor');
    return TextStyle(
      inherit: false,
      fontFamily: icon.fontFamily,
      package: icon.fontPackage,
      fontSize: size,
      color: color,
    );
  }

  /// The scale mapped onto Material's roles so plain `Text` and Material
  /// widgets pick it up without per-call styling.
  static final TextTheme textTheme = TextTheme(
    displayLarge: display,
    displayMedium: display,
    displaySmall: body.copyWith(color: BlynkColors.ink2),
    headlineLarge: display,
    headlineMedium: title,
    headlineSmall: heading,
    titleLarge: title,
    titleMedium: heading,
    titleSmall: label,
    bodyLarge: body,
    bodyMedium: body,
    bodySmall: caption,
    labelLarge: label,
    labelMedium: caption,
    labelSmall: caption,
  );
}
