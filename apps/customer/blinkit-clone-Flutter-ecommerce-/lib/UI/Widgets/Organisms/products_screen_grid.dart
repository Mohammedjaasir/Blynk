import 'package:flutter/material.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/app_state_views.dart';
import '../Atoms/card_product.dart';
import '../../../Models/product_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../Atoms/entrance_fade.dart';

/// The responsive product grid, built on the one rule in [BlynkProductGrid]:
/// 2 columns compact, 3 medium, 4 expanded, 5 from 1200 and 6 from 1440, with the
/// gutter and tile spacing decided there too.
///
/// The tile height is **measured**, not a fixed aspect ratio: a product card
/// is a square image plus a text-scale-dependent chrome block, so a ratio
/// either squashes the image on a wide column or clips the text at 2.0×.
SliverGridDelegate productGridDelegate(BuildContext context, double width) {
  final columns = BlynkProductGrid.columnsFor(width);
  final spacing = BlynkProductGrid.spacingFor(width);
  return SliverGridDelegateWithFixedCrossAxisCount(
    crossAxisCount: columns,
    mainAxisSpacing: spacing,
    crossAxisSpacing: spacing,
    mainAxisExtent: ProductCard.heightFor(context, BlynkProductGrid.tileWidthFor(width)),
  );
}

/// The grid's page padding: the shared gutter on both sides, a little air at
/// the top, and enough at the bottom that the last row clears the floating
/// cart bar instead of hiding behind it.
EdgeInsets _gridPadding(double width) {
  final gutter = BlynkProductGrid.gutterFor(width);
  return EdgeInsets.fromLTRB(gutter, BlynkSpace.s12, gutter, BlynkSpace.s48);
}

Widget buildProductsGrid(BuildContext context, List<ProductModel> products) {
  if (products.isEmpty) {
    // An empty category is not an error: no glyph of failure, no retry, and
    // no invented "check back soon" promise about restocking.
    return const AppStateView.empty(
      title: 'No products in this category',
      message: 'Try another category, or search for what you need.',
    );
  }

  return LayoutBuilder(
    builder: (context, constraints) {
      final width = constraints.maxWidth;
      return GridView.builder(
        padding: _gridPadding(width),
        physics: const BouncingScrollPhysics(),
        gridDelegate: productGridDelegate(context, width),
        itemCount: products.length,
        itemBuilder: (BuildContext context, int index) {
          final product = products[index];
          return EntranceFade(
            key: ValueKey(product.id),
            delay: BlynkMotion.staggerFor(index),
            child: ProductCard(product: product),
          );
        },
      );
    },
  );
}

/// The grid's loading state: the same columns, gutter and tile height as
/// [buildProductsGrid], with one shared pulse for all the skeleton cards.
Widget buildProductsSkeletonGrid(BuildContext context) {
  return LayoutBuilder(
    builder: (context, constraints) {
      final width = constraints.maxWidth;
      return SkeletonScope.ensure(
        child: GridView.builder(
          padding: _gridPadding(width),
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: productGridDelegate(context, width),
          itemCount: BlynkProductGrid.columnsFor(width) * 3,
          itemBuilder: (_, __) => const ProductCardSkeleton(),
        ),
      );
    },
  );
}
