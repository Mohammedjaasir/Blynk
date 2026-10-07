import 'package:flutter/material.dart';

import 'design/tokens.dart';

/// Shared breakpoints so every screen agrees on what "desktop" or "tablet"
/// means, instead of each file inventing its own thresholds.
class AppBreakpoints {
  static const double tablet = 600;
  static const double desktop = 1024;
}

/// The three width classes of the single responsive ladder (plan section 6).
enum ResponsiveClass { compact, medium, expanded }

/// Central place for responsive decisions (column counts, content width
/// caps) so screens adapt their composition instead of just scaling a
/// mobile layout up or down.
class Responsive {
  final double width;

  const Responsive(this.width);

  factory Responsive.of(BuildContext context) =>
      Responsive(MediaQuery.of(context).size.width);

  /// Classifies an *available* width (a `LayoutBuilder` constraint, not
  /// necessarily the screen) against [AppBreakpoints], the only thresholds.
  static ResponsiveClass classOf(double width) {
    if (width >= AppBreakpoints.desktop) return ResponsiveClass.expanded;
    if (width >= AppBreakpoints.tablet) return ResponsiveClass.medium;
    return ResponsiveClass.compact;
  }

  ResponsiveClass get responsiveClass => classOf(width);

  bool get isDesktop => width >= AppBreakpoints.desktop;
  bool get isTablet =>
      width >= AppBreakpoints.tablet && width < AppBreakpoints.desktop;
  bool get isMobile => width < AppBreakpoints.tablet;

  /// Product/category grid column count for the current width.
  ///
  /// W1: this is now one line over [BlynkProductGrid], the single place the
  /// product grid's columns, gutter and spacing are decided. It stays here so
  /// existing call sites keep working; new code should call
  /// `BlynkProductGrid.columnsFor(availableWidth)` with the width it actually
  /// has (a `LayoutBuilder` constraint), not the whole screen's.
  int get gridColumns => BlynkProductGrid.columnsFor(width);

  /// Caps single-column/list content width on wide desktop viewports so it
  /// doesn't stretch edge-to-edge; returns the full width on mobile.
  double get contentMaxWidth {
    if (isDesktop) return (width * 0.6).clamp(900.0, 1400.0);
    if (isTablet) return 700.0;
    return width;
  }

  /// The shop's width cap (Home's product feed): wider than [contentMaxWidth]
  /// on a desktop browser so the grid carries 4-5 readable columns instead
  /// of three oversized cards in a narrow column (owner, 2026-10-07).
  double get shopMaxWidth => isDesktop ? 1280.0 : contentMaxWidth;

  double get horizontalPadding {
    if (isDesktop) return 56.0;
    if (isTablet) return 32.0;
    return 16.0;
  }
}

/// **The product grid rule — defined once, here.** (W1)
///
/// Every listing, category and search grid asks this class rather than
/// choosing its own columns, gutter, spacing or tile width, and every Home
/// rail asks it for its card width. A screen that wants a different density
/// changes this file, not itself: that is what stops six separately-redesigned
/// grids appearing.
///
/// | Class | Width | Columns | Gutter | Spacing |
/// |---|---|---|---|---|
/// | compact | < 600 | **2** | 16 | 12 |
/// | medium | 600–1023 | **3** | 24 | 16 |
/// | expanded | 1024–1199 | **4** | 32 | 16 |
/// | expanded (dense) | 1200–1439 | **5** | 32 | 16 |
/// | expanded (wide) | ≥ 1440 | **6** | 32 | 16 |
///
/// 2026-10-07 (owner: "the browser shopping design is not good"): desktop
/// went one column denser - four columns in the 1280 dp shop left each card
/// ~290 dp wide and so tall that a screen held barely two rows.
///
/// The tile's *aspect* is deliberately not a ratio: a product card is a square
/// image plus a text-scale-dependent chrome block, so a fixed ratio either
/// squashes the image or clips the text at 2.0×. [tileWidthFor] gives the
/// width and `ProductCard.heightFor(context, tileWidth)` gives the matching
/// height — pass it as the grid delegate's `mainAxisExtent`.
abstract final class BlynkProductGrid {
  /// The sixth column only appears when it can still carry a readable card.
  static const double wide = 1440;

  /// The fifth column: from here a card is still ~230 dp wide.
  static const double dense = 1200;

  /// The narrowest screen that can carry three columns.
  ///
  /// Measured, not chosen: three columns leaves each card a content box of
  /// `(width - gutter*2 - spacing*2) / 3 - cardPadding*2`, and the quantity
  /// stepper needs two 48 dp tap targets plus its count - about 96 dp - which
  /// is a floor `touch_targets_test` enforces and no styling can go under.
  /// Below this width that sum does not fit and the stepper overflowed its
  /// row by 32 px, which is exactly how the 2026-09-24 attempt failed.
  static const double threeColumn = 390;

  static int columnsFor(double width) {
    if (width >= wide) return 6;
    if (width >= dense) return 5;
    if (width >= AppBreakpoints.desktop) return 4;
    if (width >= AppBreakpoints.tablet) return 3;
    // 2026-09-25: three columns on a phone, but only where it actually fits.
    // The earlier blanket attempt was reverted because it overflowed at 360
    // AND 412 dp; it failed on the stepper's width, not the card's height, so
    // the fix was to widen the tile (tighter spacing and card padding) and to
    // stop at the width where the tap-target floor stops fitting.
    return width >= threeColumn ? 3 : 2;
  }



  /// The page gutter on both sides — the same ladder the rest of the app uses,
  /// so a grid's first column lines up with a section header's title.
  static double gutterFor(double width) => BlynkSpace.gutterFor(width);

  /// The gap between tiles, in both axes.
  static double spacingFor(double width) =>
      width < AppBreakpoints.tablet ? BlynkSpace.s8 : BlynkSpace.s16;

  static EdgeInsets paddingFor(double width) =>
      EdgeInsets.symmetric(horizontal: gutterFor(width));

  /// The width one tile gets inside [width] of available space.
  static double tileWidthFor(double width) {
    final columns = columnsFor(width);
    final inner = width - gutterFor(width) * 2 - spacingFor(width) * (columns - 1);
    return inner / columns;
  }

  // Home-rail card widths, one per class. A rail card is narrower than a grid
  // tile on purpose: the next card must peek past the edge so the rail reads
  // as scrollable without a scrollbar.
  static const double railCardCompact = 152;
  static const double railCardMedium = 175;
  static const double railCardExpanded = 190;

  static double railCardWidthFor(double width) => switch (Responsive.classOf(width)) {
        ResponsiveClass.compact => railCardCompact,
        ResponsiveClass.medium => railCardMedium,
        ResponsiveClass.expanded => railCardExpanded,
      };

  /// The gap between rail cards.
  static const double railGap = BlynkSpace.s12;
}

/// Centres [child] in a column whose width follows the ladder: full width when
/// compact, 840 when medium, 1200 when expanded (further limited by
/// [maxWidth], e.g. 720 for list screens). It measures the width it is given
/// with a `LayoutBuilder`, so it is right inside a rail layout too.
///
/// [gutter] adds the page gutter (`BlynkSpace.gutterFor`) on both sides;
/// screens whose content already carries its own side padding turn it off so
/// their compact layout does not change.
class ContentFrame extends StatelessWidget {
  const ContentFrame({
    super.key,
    required this.child,
    this.maxWidth,
    this.gutter = true,
  });

  final Widget child;
  final double? maxWidth;
  final bool gutter;

  /// The ladder's own cap for a width class; compact is uncapped.
  static double capFor(ResponsiveClass c) => switch (c) {
        ResponsiveClass.compact => double.infinity,
        ResponsiveClass.medium => 840,
        ResponsiveClass.expanded => 1200,
      };

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final available = constraints.hasBoundedWidth
            ? constraints.maxWidth
            : MediaQuery.sizeOf(context).width;
        var cap = capFor(Responsive.classOf(available));
        if (maxWidth != null && maxWidth! < cap) cap = maxWidth!;
        return Padding(
          padding: gutter
              ? EdgeInsets.symmetric(horizontal: BlynkSpace.gutterFor(available))
              : EdgeInsets.zero,
          child: Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: cap),
              child: child,
            ),
          ),
        );
      },
    );
  }
}
