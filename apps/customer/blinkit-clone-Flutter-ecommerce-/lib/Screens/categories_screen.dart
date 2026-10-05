import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../Services/Providers/product.provider.dart';
import '../UI/Widgets/Atoms/app_skeleton.dart';
import '../UI/Widgets/Atoms/app_state_views.dart';
import '../UI/Widgets/Atoms/category_widget.dart';
import '../UI/Widgets/Atoms/failure_states.dart';
import '../app_responsive.dart';
import '../design/tokens.dart';

/// Full catalog browse screen. Every category comes from the backend via
/// ProductProvider - nothing here is a hardcoded list.
///
/// 2026-09 redesign (W3): the grid takes the page gutter and tile spacing from
/// the shared ladder (so its first column lines up with a section header
/// elsewhere in the app), and each tile is handed its position so the
/// unselected pastel tints cycle instead of every tile being the same colour.
///
/// The page stays [BlynkColors.paper] rather than the `well` tint the product
/// *listing* uses. The rule is that a page is the opposite surface of what sits
/// on it: a listing is white cards, so its page is tinted; this screen is
/// **tinted tiles**, so its page is white. It is also what keeps the loading
/// state visible — `CategoryTileSkeleton` is a bare `well` block with no card
/// under it, and a `well` page would swallow it.
///
/// There is no rating, no product count and no "new" badge on a tile: the
/// categories endpoint returns an id, a name, a slug, a display order and an
/// image url, and nothing here renders anything else.
class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({super.key});

  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  /// Twelve tiles is roughly one screenful at the compact column count, so the
  /// loading grid is the same shape as the loaded one rather than a short stub.
  static const int _skeletonTiles = 12;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Re-validate on open; the cached list stays visible meanwhile.
      context.read<ProductProvider>().loadCategories(force: true);
    });
  }

  /// A category tile is about half a product tile wide, so it takes roughly
  /// twice the columns at the same width. The *classes* are still the one
  /// ladder in `app_responsive.dart` - this only picks a density inside them,
  /// and [BlynkProductGrid.wide] is the same named threshold the product grid
  /// uses for its fifth column, not a new breakpoint.
  static int _columnsFor(double width) => switch (Responsive.classOf(width)) {
        ResponsiveClass.compact => 3,
        ResponsiveClass.medium => 5,
        ResponsiveClass.expanded => width >= BlynkProductGrid.wide ? 8 : 6,
      };

  @override
  Widget build(BuildContext context) {
    final responsive = Responsive.of(context);

    return Scaffold(
      backgroundColor: BlynkColors.paper,
      appBar: AppBar(title: const Text('Categories')),
      body: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: responsive.contentMaxWidth),
          child: Consumer<ProductProvider>(
            builder: (context, productProvider, _) {
              // The available width, not the screen's: this grid can sit
              // beside the navigation rail.
              return LayoutBuilder(
                builder: (context, constraints) {
                  final width = constraints.maxWidth;

                  if (productProvider.isLoadingCategories) {
                    // One shared pulse for all the tiles.
                    return SkeletonScope.ensure(
                      child: GridView.builder(
                        padding: _padding(width),
                        physics: const NeverScrollableScrollPhysics(),
                        gridDelegate: _delegate(context, width),
                        itemCount: _skeletonTiles,
                        itemBuilder: (_, __) => const CategoryTileSkeleton(),
                      ),
                    );
                  }

                  final failure = productProvider.categoriesFailure;
                  if (failure != null) {
                    return FailureState(
                      failure: failure,
                      title: "We couldn't load categories",
                      scrollable: false,
                      onRetry: () =>
                          productProvider.loadCategories(force: true),
                    );
                  }

                  // Sub-categories are reached through their parent.
                  final categories = productProvider.topLevelCategories;

                  if (categories.isEmpty) {
                    return const AppStateView(
                      icon: Icons.storefront_outlined,
                      title: 'No categories yet',
                      message:
                          'Our catalog is being stocked. Please check back shortly.',
                    );
                  }

                  return RefreshIndicator(
                    onRefresh: () =>
                        productProvider.loadCategories(force: true),
                    child: GridView.builder(
                      padding: _padding(width),
                      physics: const AlwaysScrollableScrollPhysics(
                        parent: BouncingScrollPhysics(),
                      ),
                      gridDelegate: _delegate(context, width),
                      itemCount: categories.length,
                      itemBuilder: (context, index) => CategoryWidget(
                        category: categories[index],
                        diameter: _diameter(context, width),
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }

  /// The page gutter on both sides - the same ladder the product grid uses, so
  /// a category tile and a product tile start at the same x. Generous at the
  /// bottom so the last row clears the floating cart bar.
  EdgeInsets _padding(double width) {
    final gutter = BlynkSpace.gutterFor(width);
    return EdgeInsets.fromLTRB(
      gutter,
      BlynkSpace.s16,
      gutter,
      BlynkSpace.s48,
    );
  }

  SliverGridDelegate _delegate(BuildContext context, double width) {
    return CategoryTileGridDelegate(
      crossAxisCount: _columnsFor(width),
      // More air between rows than between columns: rows are what carries the
      // page's vertical rhythm.
      mainAxisSpacing: BlynkSpace.s24,
      crossAxisSpacing: BlynkProductGrid.spacingFor(width),
      labelHeight: CategoryTileGridDelegate.labelHeightFor(context),
      diameter: _diameter(context, width),
    );
  }

  /// The circle's diameter for this grid: the capped size for the width
  /// class, or the cell itself when a narrow phone gives a cell smaller than
  /// the cap. The tile and the delegate must be given the same number or the
  /// rows would be measured for a circle that is not the one drawn.
  double _diameter(BuildContext context, double width) {
    final gutter = BlynkSpace.gutterFor(width);
    final columns = _columnsFor(width);
    final spacing = BlynkProductGrid.spacingFor(width);
    final cell = (width - gutter * 2 - spacing * (columns - 1)) / columns;
    return CategoryTileGridDelegate.diameterIn(width, cell);
  }
}
