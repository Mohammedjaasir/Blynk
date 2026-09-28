import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Atoms/app_skeleton.dart';
import '../Atoms/category_widget.dart';
import '../Atoms/failure_states.dart';
import '../Atoms/section_header.dart';
import '../../../Models/category_model.dart';
import '../../../app_responsive.dart';
import '../../../design/tokens.dart';
import '../../../Services/Providers/product.provider.dart';

/// Home's categories: a "Categories / See all" header over a 4-across grid
/// of soft rounded-square tiles, in the backend's own display order
/// (2026-09-28, owner's reference - it replaced a scrolling row of circles).
///
/// - At most two rows. With more than 8 categories, the first 7 show and the
///   8th tile is **More**, which opens `/categories` - the full grid.
/// - Tiles are **links**, not a filter: each opens `/products` for that
///   category, the screen that exists for browsing one.
/// - The tile is the shared [CategoryWidget] (in its rounded form), so its
///   photo, fallback glyph, press and focus states match the Categories
///   screen exactly.
/// - Row height is **measured** from the tile plus the reserved label at the
///   current text scale, never a fixed ratio, so a large system font grows the
///   grid instead of clipping the labels.
class HomeScreenCateogoryWidget extends StatefulWidget {
  const HomeScreenCateogoryWidget({super.key});

  /// Columns in the grid.
  static const int columns = 4;

  /// Tiles shown before "More" takes the last slot: two full rows.
  static const int maxTiles = 8;

  /// The "More" tile: opens the full Categories screen. Not a category, so it
  /// has no slug and never reaches the products screen.
  static const CategoryModel moreTile = CategoryModel(id: 'more', name: 'More', slug: '');
  static const IconData moreGlyph = Icons.more_horiz_rounded;

  /// The tile's square size in a cell [cellWidth] wide: a little inset from
  /// the cell, capped so a tablet shows the same tile, not a giant one.
  static double tileSizeFor(double cellWidth) => (cellWidth - BlynkSpace.s8).clamp(48.0, 84.0);

  /// Loading placeholders: one full row.
  static const int skeletonCount = columns;

  @override
  State<HomeScreenCateogoryWidget> createState() => _HomeScreenCateogoryWidgetState();
}

class _HomeScreenCateogoryWidgetState extends State<HomeScreenCateogoryWidget> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ProductProvider>().loadCategories();
    });
  }

  @override
  Widget build(BuildContext context) {
    final width = Responsive.of(context).width;
    final gutter = BlynkSpace.gutterFor(width);
    const spacing = BlynkSpace.s12;
    final cellWidth =
        (width - gutter * 2 - spacing * (HomeScreenCateogoryWidget.columns - 1)) / HomeScreenCateogoryWidget.columns;
    final tile = HomeScreenCateogoryWidget.tileSizeFor(cellWidth);
    final cellHeight = CategoryWidget.heightFor(context, tile);

    Widget grid({required int count, required IndexedWidgetBuilder builder}) {
      return Padding(
        padding: EdgeInsets.symmetric(horizontal: gutter),
        child: GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: HomeScreenCateogoryWidget.columns,
            crossAxisSpacing: spacing,
            mainAxisSpacing: BlynkSpace.s16,
            mainAxisExtent: cellHeight,
          ),
          itemCount: count,
          itemBuilder: builder,
        ),
      );
    }

    // Shown over the grid and over the loading grid, so the section does not
    // pop into place once categories arrive. Not shown over the failure
    // state, which states its own title.
    Widget titled(Widget child) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            BlynkSectionHeader(
              title: 'Categories',
              actionLabel: 'See all',
              actionKey: const Key('categories-see-all'),
              onAction: () => Navigator.of(context).pushNamed('/categories'),
              padding: EdgeInsets.fromLTRB(gutter, BlynkSpace.s8, BlynkSpace.s8, BlynkSpace.s12),
            ),
            child,
          ],
        );

    return Consumer<ProductProvider>(
      builder: (context, productProvider, _) {
        if (productProvider.isLoadingCategories) {
          return SliverToBoxAdapter(
            child: titled(
              grid(
                count: HomeScreenCateogoryWidget.skeletonCount,
                builder: (_, __) => const CategoryTileSkeleton(),
              ),
            ),
          );
        }

        final failure = productProvider.categoriesFailure;
        if (failure != null) {
          return SliverToBoxAdapter(
            child: FailureState(
              failure: failure,
              title: "We couldn't load categories",
              retryKey: const Key('categories-retry'),
              scrollable: false,
              onRetry: () => productProvider.loadCategories(force: true),
            ),
          );
        }

        final categories = productProvider.categories;
        if (categories.isEmpty) {
          return const SliverToBoxAdapter(child: SizedBox.shrink());
        }

        final overflow = categories.length > HomeScreenCateogoryWidget.maxTiles;
        final shown = overflow ? categories.take(HomeScreenCateogoryWidget.maxTiles - 1).toList() : categories;

        return SliverToBoxAdapter(
          child: titled(
            grid(
              count: shown.length + (overflow ? 1 : 0),
              builder: (context, index) {
                final isMore = overflow && index == shown.length;
                final category = isMore ? HomeScreenCateogoryWidget.moreTile : shown[index];
                // Merged so the tile is announced once, as a link, rather than
                // as a label and a target side by side.
                return MergeSemantics(
                  child: Semantics(
                    button: true,
                    child: CategoryWidget(
                      key: isMore ? const Key('categories-more') : null,
                      category: category,
                      rounded: true,
                      diameter: tile,
                      glyph: isMore ? HomeScreenCateogoryWidget.moreGlyph : null,
                      onTap: () => isMore
                          ? Navigator.of(context).pushNamed('/categories')
                          : Navigator.of(context).pushNamed('/products', arguments: category.slug),
                    ),
                  ),
                );
              },
            ),
          ),
        );
      },
    );
  }
}
