import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'category_with_products.dart';
import '../../../Services/Providers/product.provider.dart';

/// Renders one horizontal product rail per real backend category, instead
/// of Home hardcoding a fixed pair of category slugs. A category added to
/// the backend tomorrow shows up here without a code change.
///
/// Capped at [maxSections] so Home stays a browsable summary rather than
/// the entire catalog; the Categories screen is the full list.
class HomeProductSections extends StatelessWidget {
  const HomeProductSections({super.key, this.maxSections = 4});

  final int maxSections;

  @override
  Widget build(BuildContext context) {
    final categories = context.watch<ProductProvider>().categories;

    if (categories.isEmpty) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    final visible = categories.take(maxSections).toList();

    return SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, index) {
          final category = visible[index];
          return CatgorywithProducts(
            title: category.name,
            categorySlug: category.slug,
          );
        },
        childCount: visible.length,
      ),
    );
  }
}
