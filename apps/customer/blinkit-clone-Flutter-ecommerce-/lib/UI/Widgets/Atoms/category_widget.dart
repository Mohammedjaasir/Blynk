import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show SliverConstraints, SliverGridLayout;

import '../../../Models/category_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import 'image_well.dart';

/// A single category tile: a circular image container with the category name
/// underneath. Used by Home's category carousel and by the full Categories
/// screen, so the two can never drift out of sync.
///
/// ```
///    (  image  )   BlynkCategory.diameter*, circular, one neutral surface
///     Rice &       BlynkCategory.label, centred, up to two lines
///     Grains
/// ```
///
/// 2026-09-24 redesign. What this replaced and why is in [BlynkCategory] —
/// briefly: large pastel squares whose colour meant nothing, and a selected
/// state that was a solid yellow block twice the visual weight of its
/// neighbours. The image is now the tile, and colour is spent only on the
/// selected state.
///
/// **Geometry is fixed, never proportional.** The circle is
/// [BlynkCategory.diameterCompact]/`Medium`/`Expanded` for the width class
/// and nothing else, so a desktop fits more categories on screen rather than
/// inflating each one. Selecting a tile changes no dimension — the photo
/// carries [BlynkCategory.photoInset] whether or not the ring is drawn — so
/// tapping along a row never reflows it.
class CategoryWidget extends StatefulWidget {
  const CategoryWidget({
    super.key,
    required this.category,
    this.isActive = false,
    this.onTap,
    this.glyph,
    this.diameter,
    this.rounded = false,
  });

  final CategoryModel category;
  final bool isActive;
  final VoidCallback? onTap;

  /// Overrides the glyph derived from the category's name. Only the "All"
  /// control passes this — it is not a real category, so [fallbackGlyphFor]
  /// has no name to map.
  final IconData? glyph;

  /// The circle's diameter. Defaults to [diameterFor] at the current width,
  /// which is what every caller should use; a grid passes its own only when
  /// a narrow cell cannot hold the standard size.
  final double? diameter;

  /// A soft rounded square instead of a circle - Home's 4-across category
  /// grid (2026-09-28, owner's reference). The Categories screen keeps circles.
  final bool rounded;

  /// The circle's diameter for a screen [width]. Capped per class, so the
  /// tile has one intentional size rather than a stretched one.
  static double diameterFor(double width) => switch (Responsive.classOf(width)) {
        ResponsiveClass.compact => BlynkCategory.diameterCompact,
        ResponsiveClass.medium => BlynkCategory.diameterMedium,
        ResponsiveClass.expanded => BlynkCategory.diameterExpanded,
      };

  /// The reserved label box: [BlynkCategory.labelMaxLines] lines of
  /// [BlynkCategory.label] at the live text scale. Derived from the token's
  /// own size and line height, so the tile cannot drift from the type scale.
  static double labelHeightFor(BuildContext context) {
    const style = BlynkCategory.label;
    final size = style.fontSize ?? BlynkText.minSize;
    final leading = style.height ?? 1.25;
    return (MediaQuery.textScalerOf(context).scale(size) *
            leading *
            BlynkCategory.labelMaxLines)
        .ceilToDouble();
  }

  /// The whole tile's height: circle + gap + the reserved label.
  static double heightFor(BuildContext context, double diameter) =>
      diameter + BlynkCategory.gap + labelHeightFor(context);

  @override
  State<CategoryWidget> createState() => _CategoryWidgetState();
}

class _CategoryWidgetState extends State<CategoryWidget> {
  bool _pressed = false;
  bool _hovered = false;
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final size =
        widget.diameter ?? CategoryWidget.diameterFor(Responsive.of(context).width);

    return InkWell(
      // **No ripple.** Every overlay colour is cleared and the feedback is a
      // fill change on the circle instead — see [BlynkCategory.pressedSurface]
      // for why. A splash here washed a stadium-shaped grey block across the
      // circle and its label at once.
      splashColor: BlynkColors.clear,
      highlightColor: BlynkColors.clear,
      hoverColor: BlynkColors.clear,
      focusColor: BlynkColors.clear,
      splashFactory: NoSplash.splashFactory,
      onHighlightChanged: (v) => setState(() => _pressed = v),
      onHover: (v) => setState(() => _hovered = v),
      onFocusChange: (v) => setState(() => _focused = v),
      onTap: widget.onTap ??
          () => Navigator.pushNamed(
                context,
                '/products',
                arguments: widget.category.slug,
              ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: _Disc(
              category: widget.category,
              isActive: widget.isActive,
              glyph: widget.glyph,
              size: size,
              rounded: widget.rounded,
              // Hover and press land on the same step: on a tile this small a
              // second, fainter step is not perceptible, and two near-identical
              // greys read as a flicker when a finger becomes a cursor.
              active: _pressed || _hovered,
              focused: _focused,
            ),
          ),
          const SizedBox(height: BlynkCategory.gap),
          SizedBox(
            height: CategoryWidget.labelHeightFor(context),
            child: Text(
              widget.category.name,
              textAlign: TextAlign.center,
              maxLines: BlynkCategory.labelMaxLines,
              overflow: TextOverflow.ellipsis,
              style: widget.isActive
                  ? BlynkCategory.labelSelected
                  : BlynkCategory.label,
            ),
          ),
        ],
      ),
    );
  }
}

/// The circle: the neutral surface, the photo or its fallback glyph, and the
/// selected ring. Split out so the tile's build reads as composition.
class _Disc extends StatelessWidget {
  const _Disc({
    required this.category,
    required this.isActive,
    required this.glyph,
    required this.size,
    this.rounded = false,
    this.active = false,
    this.focused = false,
  });

  final CategoryModel category;
  final bool isActive;
  final IconData? glyph;
  final double size;

  /// Rounded square instead of a circle; see [CategoryWidget.rounded].
  final bool rounded;

  /// Pressed or hovered — the surface steps down one notch.
  final bool active;

  /// Keyboard focus, which draws an ink ring in place of the yellow one.
  final bool focused;

  Color get _surface {
    if (isActive) {
      return active ? BlynkCategory.selectedPressedSurface : BlynkCategory.selectedSurface;
    }
    return active ? BlynkCategory.pressedSurface : BlynkCategory.surface;
  }

  /// Focus outranks selection: a yellow ring at 1.30:1 cannot show a keyboard
  /// user where they are, and the selected state is still carried by the
  /// surface wash and the label weight while the ink ring is showing.
  BoxBorder? get _border {
    if (focused) {
      return Border.all(
        color: BlynkCategory.focusRing,
        width: BlynkCategory.focusRingWidth,
      );
    }
    if (isActive) {
      return Border.all(
        color: BlynkCategory.selectedRing,
        width: BlynkCategory.ringWidth,
      );
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final url = category.imageUrl;
    final hasPhoto = url != null && url.isNotEmpty;

    return SizedBox(
      width: size,
      height: size,
      child: AnimatedContainer(
        duration: BlynkMotion.resolve(context, BlynkMotion.fast),
        curve: BlynkMotion.easeOut,
        decoration: BoxDecoration(
          color: _surface,
          shape: rounded ? BoxShape.rectangle : BoxShape.circle,
          borderRadius: rounded ? BorderRadius.circular(size * 0.28) : null,
          // Drawn only when selected or focused, but the inset below is
          // unconditional, so no dimension changes when it appears.
          border: _border,
        ),
        padding: const EdgeInsets.all(BlynkCategory.photoInset),
        child: ClipRRect(
          // A circle is a rounded rect with half-size corners.
          borderRadius: BorderRadius.circular(rounded ? size * 0.2 : size),
          child: hasPhoto
              ? Image.network(
                  url,
                  fit: BoxFit.cover,
                  // The operator's chosen focal point (Blynk Ops), not always
                  // the centre.
                  alignment: category.imageAlignment,
                  width: double.infinity,
                  height: double.infinity,
                  errorBuilder: (_, __, ___) => _FallbackGlyph(
                    category: category,
                    glyph: glyph,
                    size: size,
                  ),
                )
              : _FallbackGlyph(category: category, glyph: glyph, size: size),
        ),
      ),
    );
  }
}

/// The no-image state. Not an edge case: no category in the live catalogue
/// carries an `image_url`, so this is the section's default appearance.
///
/// It is one low-emphasis semantic glyph on the tile's own surface —
/// deliberately not a tinted block, not a broken-image icon and not a stock
/// photograph. The glyph comes from the same [fallbackGlyphFor] mapping the
/// product image wells use, so a category and the products inside it show the
/// same symbol and the mapping only has to be right in one place.
class _FallbackGlyph extends StatelessWidget {
  const _FallbackGlyph({
    required this.category,
    required this.glyph,
    required this.size,
  });

  final CategoryModel category;
  final IconData? glyph;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Icon(
        glyph ?? fallbackGlyphFor(category.name),
        color: BlynkCategory.fallbackGlyph,
        size: size * BlynkCategory.fallbackGlyphFraction,
      ),
    );
  }
}

/// Grid layout for [CategoryWidget] tiles. The row height is the circle plus
/// the reserved label at the current text scale (the same formula
/// [CategoryWidget.heightFor] gives the Home rail), so a large system font
/// grows the rows instead of overflowing a fixed aspect ratio.
///
/// The circle keeps its capped diameter, or shrinks to the cell when the cell
/// is narrower than the cap — which is the only case a caller may pass a
/// diameter of its own.
class CategoryTileGridDelegate extends SliverGridDelegate {
  const CategoryTileGridDelegate({
    required this.crossAxisCount,
    required this.mainAxisSpacing,
    required this.crossAxisSpacing,
    required this.labelHeight,
    required this.diameter,
  });

  final int crossAxisCount;
  final double mainAxisSpacing;
  final double crossAxisSpacing;

  /// Height of the reserved label, from [CategoryWidget.labelHeightFor].
  final double labelHeight;

  /// The circle's diameter, from [CategoryWidget.diameterFor].
  final double diameter;

  /// Kept so existing callers keep compiling; it now delegates to the tile
  /// rather than re-deriving the type metrics.
  static double labelHeightFor(BuildContext context) =>
      CategoryWidget.labelHeightFor(context);

  /// The diameter that fits a cell of [tileWidth] on a screen of [width]:
  /// the capped size, or the cell when the cell is smaller.
  static double diameterIn(double width, double tileWidth) {
    final capped = CategoryWidget.diameterFor(width);
    return tileWidth < capped ? tileWidth : capped;
  }

  @override
  SliverGridLayout getLayout(SliverConstraints constraints) {
    return SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: crossAxisCount,
      mainAxisSpacing: mainAxisSpacing,
      crossAxisSpacing: crossAxisSpacing,
      mainAxisExtent: diameter + BlynkCategory.gap + labelHeight,
    ).getLayout(constraints);
  }

  @override
  bool shouldRelayout(CategoryTileGridDelegate old) =>
      old.crossAxisCount != crossAxisCount ||
      old.mainAxisSpacing != mainAxisSpacing ||
      old.crossAxisSpacing != crossAxisSpacing ||
      old.labelHeight != labelHeight ||
      old.diameter != diameter;
}
