import 'package:flutter/material.dart';

/// The app's scroll behaviour: Material's, minus the Android 12+ **stretch**
/// overscroll effect.
///
/// 2026-09-26: pulling any list past its end made Flutter's
/// `StretchingOverscrollIndicator` scale the whole viewport vertically -
/// product photos visibly bent and the text under them stretched with them.
/// That is the platform effect working as designed, but on an image-first
/// shop it reads as the pictures being distorted, so it is off everywhere.
/// Android's scroll physics already clamp at the ends, and pull-to-refresh
/// listens to overscroll notifications, not to this indicator, so it still
/// works.
class BlynkScrollBehavior extends MaterialScrollBehavior {
  const BlynkScrollBehavior();

  @override
  Widget buildOverscrollIndicator(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) =>
      child;
}
