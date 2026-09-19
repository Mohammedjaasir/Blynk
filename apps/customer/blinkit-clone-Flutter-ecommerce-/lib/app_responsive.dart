import 'package:flutter/material.dart';

/// Shared breakpoints so every screen agrees on what "desktop" or "tablet"
/// means, instead of each file inventing its own thresholds.
class AppBreakpoints {
  static const double tablet = 600;
  static const double desktop = 1024;
}

/// Central place for responsive decisions (column counts, content width
/// caps) so screens adapt their composition instead of just scaling a
/// mobile layout up or down.
class Responsive {
  final double width;

  const Responsive(this.width);

  factory Responsive.of(BuildContext context) =>
      Responsive(MediaQuery.of(context).size.width);

  bool get isDesktop => width >= AppBreakpoints.desktop;
  bool get isTablet =>
      width >= AppBreakpoints.tablet && width < AppBreakpoints.desktop;
  bool get isMobile => width < AppBreakpoints.tablet;

  /// Product/category grid column count for the current width.
  int get gridColumns {
    if (width >= 1600) return 6;
    if (width >= 1280) return 5;
    if (isDesktop) return 4;
    if (isTablet) return 3;
    return 2;
  }

  /// Caps single-column/list content width on wide desktop viewports so it
  /// doesn't stretch edge-to-edge; returns the full width on mobile.
  double get contentMaxWidth {
    if (isDesktop) return (width * 0.6).clamp(900.0, 1400.0);
    if (isTablet) return 700.0;
    return width;
  }

  double get horizontalPadding {
    if (isDesktop) return 56.0;
    if (isTablet) return 32.0;
    return 16.0;
  }
}
