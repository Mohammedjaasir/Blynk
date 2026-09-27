import 'package:flutter/painting.dart';

/// Raw design values. This is the only file where brand colour hex literals
/// live; everything else reads them through `tokens.dart`.
abstract final class BlynkPalette {
  /// Blynk Yellow — the brand's primary-action colour (plan §5). An earlier
  /// redesign pass retuned this to the reference mock's #F7E95C; that moved
  /// the palette off Blynk's identity and is reverted here. `ink` on it is
  /// 12.79:1.
  static const Color signal = Color(0xFFFFE141);

  /// Pressed [signal]. 1.29:1 against [signal] (visibly darker) while `ink`
  /// stays 9.93:1 on it — both existing floors clear without moving either.
  static const Color signalPressed = Color(0xFFE5C700);

  /// [signalWash] under a finger: [signal] at 30% over [paper]. `ink2` on it
  /// measures 4.43:1, well clear of the 3:1 non-text floor its glyph needs.
  static const Color signalWashPressed = Color(0xFFFFF6C6);

  /// [signal] at 18% over [paper] - the faintest usable yellow. It marks the
  /// selected category without the tile becoming a yellow block, and `ink2`
  /// on it still measures 4.60:1, so a glyph sitting on it stays legible.
  static const Color signalWash = Color(0xFFFFFADD);
  static const Color ink = Color(0xFF1A1D2E);
  static const Color ink2 = Color(0xFF6B7280);
  static const Color ink3 = Color(0xFF4B5563);
  static const Color paper = Color(0xFFFFFFFF);

  /// [paper] softened for the *supporting* line on an [ink] fill (the cart
  /// bar's item count under its total). It is [paper] at 72% composited over
  /// [ink] rather than a translucent white, so the colour is a fixed value a
  /// contrast check can read: 9.09:1 on [ink], against plain [paper]'s
  /// 16.51:1. The gap between the two is the hierarchy.
  static const Color paperMuted = Color(0xFFBFC0C5);
  static const Color well = Color(0xFFF6F8FB);
  static const Color line = Color(0xFFE5E9F0);
  static const Color lineStrong = Color(0xFF7B8494);

  /// Blynk Green — success / available / delivered / confirmed only. It is
  /// the *only* green: a second decorative green (`accentGreen`) was added by
  /// the previous pass and removed again (plan §5 "No third brand colour").
  static const Color positive = Color(0xFF0C831F);
  static const Color positiveInk = Color(0xFF0A741B);
  static const Color positiveTint = Color(0xFFE8F5EA);
  static const Color problem = Color(0xFFB42318);
  static const Color problemTint = Color(0xFFFDECEA);
  static const Color notice = Color(0xFF8A5A00);
  static const Color noticeTint = Color(0xFFFFF6BF);

  /// Struck original price. Tuned from the reference's #9AA0A6 (2.64:1 on
  /// paper, below the 4.5:1 floor) down to a shade that clears 4.67:1. Kept
  /// because real struck prices exist; the discount *pill* did not have a
  /// real data source and its tokens are gone.
  static const Color strike = Color(0xFF6E757B);

  // 2026-09-24: the four `categoryTint*` pastels were DELETED here. They were
  // a reviewed deviation from plan section 5 ("No per-screen colours", "No new
  // palette"), kept only because removing them meant restyling the category
  // tile — which the category redesign has now done. The tile sits on `well`
  // like every other surface, and the deviation is closed rather than
  // permanent. `design_tokens_test.dart` asserts it cannot return.

  /// Black at 50 %.
  static const Color scrim = Color(0x80000000);
  static const Color clear = Color(0x00000000);

  /// Black at 10 % / 16 %: the pre-redesign shadows (still used by
  /// [raised]/overlay surfaces). Black at ~6 %: the redesign's floating
  /// card shadow ([BlynkElevation.soft]).
  static const Color shadowRaised = Color(0x1A000000);
  static const Color shadowOverlay = Color(0x29000000);
  static const Color shadowSoft = Color(0x0F000000);
}

abstract final class BlynkScale {
  static const double s4 = 4;
  static const double s8 = 8;
  static const double s12 = 12;
  static const double s16 = 16;
  static const double s24 = 24;
  static const double s32 = 32;
  static const double s48 = 48;

  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 20;

  // Motion. Raw milliseconds only; the meaning of each lives in motion.dart.
  static const Duration instant = Duration(milliseconds: 60);
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 200);
  static const Duration slow = Duration(milliseconds: 280);
  static const Duration emphasized = Duration(milliseconds: 320);

  /// An arrival the eye is meant to follow (a section, a card, a counting
  /// number). 2026-09-26: the first pass used 200 ms here and a screen
  /// recording showed Home's whole entrance finishing inside the route fade -
  /// present in code, invisible in use.
  static const Duration entrance = Duration(milliseconds: 450);

  /// The gap between beats of a screen's entrance.
  static const Duration entranceStep = Duration(milliseconds: 90);

  /// A map camera fit. Longer than any UI motion because the whole viewport
  /// moves and the eye needs the extra time to keep its bearings.
  static const Duration camera = Duration(milliseconds: 500);

  /// The gap between one staggered item's start and the next's.
  static const Duration stagger = Duration(milliseconds: 40);

  /// The inline glyph that sits on a 12 px caption line (a status pill, an
  /// inline field error). [iconSm] is 20 and visibly overpowers that line.
  static const double iconXs = 16;
  static const double iconSm = 20;
  static const double iconMd = 24;
  static const double iconLg = 32;
}
