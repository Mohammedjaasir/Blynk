import 'package:flutter/material.dart';

import 'package:ecom/app_colors.dart';

/// Spacing scale. Screens use these instead of ad-hoc numbers so vertical
/// rhythm stays consistent between sections that were written months apart.
class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;
}

class AppRadius {
  static const double chip = 999; // fully rounded
  static const double button = 14;
  static const double card = 16;
  static const double sheet = 22;
  static const double field = 12;

  static BorderRadius get cardBorder => BorderRadius.circular(card);
  static BorderRadius get buttonBorder => BorderRadius.circular(button);
  static BorderRadius get fieldBorder => BorderRadius.circular(field);
  static BorderRadius get sheetBorder => const BorderRadius.vertical(
        top: Radius.circular(sheet),
      );
}

/// Deliberately soft: a quick-commerce catalog is mostly a dense grid of
/// cards, and heavy drop shadows on every tile reads as noise rather than
/// depth.
class AppElevation {
  static List<BoxShadow> get card => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.05),
          blurRadius: 10,
          offset: const Offset(0, 2),
        ),
      ];

  static List<BoxShadow> get raised => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.10),
          blurRadius: 18,
          offset: const Offset(0, 6),
        ),
      ];
}

/// Text colours. Blynk's body text is a dark navy rather than pure black -
/// pure black against white is harsher than it needs to be at small sizes.
class AppTextColors {
  static const Color primary = Color(0xff1A1D2E);
  static const Color secondary = Color(0xff6B7280);
  static const Color muted = Color(0xff9CA3AF);
  static const Color onYellow = Color(0xff1A1D2E);

  /// Secondary-weight text that sits on the page background rather than
  /// inside a white card. `secondary` measures 4.83:1 on white but only
  /// 4.29:1 on `AppColors.greyWhiteColor`, so anything on the page itself
  /// uses this instead.
  static const Color onBackground = Color(0xff4B5563); // 6.72:1 on #EDF2F8

  /// Something went wrong or is being destroyed: failure states and the
  /// destructive action. Deliberately a dark red rather than a pure red -
  /// it has to pass 4.5:1 as body text, not just shout.
  static const Color problem = Color(0xffB42318);
}

/// Neutral surfaces used behind images and placeholder tiles.
class AppSurfaces {
  static const Color subtle = Color(0xffF6F8FB);
  static const Color tile = Color(0xffEEF2F7);
  static const Color border = Color(0xffE5E9F0);
}

/// Shared decoration for the app's card surfaces so a product tile, an
/// order row and an address card don't each invent their own radius and
/// shadow.
BoxDecoration appCardDecoration({Color? color, bool raised = false}) {
  return BoxDecoration(
    color: color ?? Colors.white,
    borderRadius: AppRadius.cardBorder,
    boxShadow: raised ? AppElevation.raised : AppElevation.card,
  );
}

/// Blynk Yellow is the primary action colour; Blynk Green is reserved for
/// success/positive status so it stays meaningful instead of becoming the
/// whole palette.
ButtonStyle appPrimaryButtonStyle({EdgeInsetsGeometry? padding}) {
  return ElevatedButton.styleFrom(
    backgroundColor: AppColors.primaryYellowColor,
    foregroundColor: AppTextColors.onYellow,
    elevation: 0,
    padding: padding ??
        const EdgeInsets.symmetric(
          horizontal: AppSpacing.xxl,
          vertical: AppSpacing.md + 2,
        ),
    textStyle: const TextStyle(
      fontFamily: 'Catamaran',
      fontWeight: FontWeight.w800,
      fontSize: 15,
    ),
    shape: RoundedRectangleBorder(borderRadius: AppRadius.buttonBorder),
  );
}
