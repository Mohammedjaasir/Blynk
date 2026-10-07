import 'package:flutter/material.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/card_product.dart';
import '../../../Models/product_model.dart';
import '../../../app_responsive.dart';
import '../Atoms/entrance_fade.dart';
import '../../../design/motion.dart';

/// The horizontal product scroller Home sections are built from. It renders
/// the same [ProductCard] the grids do — there is deliberately no separate
/// "card for rails" to keep in sync.
///
/// * **Lazily built**: a `ListView.builder` with a viewport exactly one card
///   tall, so a 40-product rail builds only the cards on screen.
/// * **Aligned to the page gutter**: the first card's left edge sits on the
///   same gutter as a section header's title
///   ([BlynkProductGrid.gutterFor]), and the trailing gutter is real padding
///   rather than a gap after the last card, so the rail scrolls to a clean
///   edge.
/// * **Keyboard and screen-reader reachable**: it is an ordinary scrollable
///   with a `ScrollController`, and each card keeps its own semantics.
///
/// It draws no header — compose it under a `BlynkSectionHeader`.
class ProductRail extends StatelessWidget {
  const ProductRail({
    super.key,
    required this.products,
    this.loading = false,
    this.loadingCount = 4,
    this.controller,
    this.padding,
    this.heroes = true,
  });

  /// Real products from the provider. Never padded out with placeholders.
  final List<ProductModel> products;

  /// Shows [loadingCount] skeleton cards in the same box instead. The rail's
  /// height does not change when the data lands.
  final bool loading;
  final int loadingCount;

  final ScrollController? controller;

  /// Overrides the gutter-derived edge padding.
  final EdgeInsets? padding;

  /// Whether the cards' images fly to the detail screen ([ProductCard.hero]).
  final bool heroes;

  /// The card width for the available [width] — the one rule, shared with
  /// every other rail.
  static double cardWidthFor(double width) => BlynkProductGrid.railCardWidthFor(width);

  /// The rail's viewport height: exactly one card, at the current text scale.
  static double heightFor(BuildContext context, double width) =>
      ProductCard.heightFor(context, cardWidthFor(width));

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final available = constraints.hasBoundedWidth
            ? constraints.maxWidth
            : MediaQuery.sizeOf(context).width;
        final cardWidth = cardWidthFor(available);
        final edge = padding ?? BlynkProductGrid.paddingFor(available);
        final count = loading ? loadingCount : products.length;

        final rail = SizedBox(
          height: ProductCard.heightFor(context, cardWidth),
          child: ListView.separated(
            controller: controller,
            scrollDirection: Axis.horizontal,
            padding: edge,
            physics: const BouncingScrollPhysics(),
            itemCount: count,
            separatorBuilder: (_, __) => const SizedBox(width: BlynkProductGrid.railGap),
            itemBuilder: (context, index) => SizedBox(
              width: cardWidth,
              child: loading
                  ? const ProductCardSkeleton()
                  : EntranceFade(
                      key: ValueKey(products[index].id),
                      delay: BlynkMotion.staggerFor(index),
                      child: ProductCard(product: products[index], hero: heroes),
                    ),
            ),
          ),
        );

        // One pulse for the whole loading rail rather than one per card -
        // and `ensure`, not a bare SkeletonScope, so a page that already runs
        // one pulse above its whole loading region does not gain a second
        // ticker per rail.
        return loading ? SkeletonScope.ensure(child: rail) : rail;
      },
    );
  }
}
